import { createHash } from 'node:crypto';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

/**
 * Collected news items for one theater: dedupe, 72 h retention, a per-source
 * cap and a disk cache at .gev-cache/news/<theater>.json. Items are reporting
 * metadata only (headline, snippet, link, publisher); nothing here is a
 * verified incident.
 */

export const ITEM_RETENTION_MS = 72 * 3600_000;
export const ITEM_PER_SOURCE_CAP = 60;
const CACHE_VERSION = 1;
const TRACKING_PARAM =
  /^(utm_\w+|fbclid|gclid|dclid|mc_cid|mc_eid|ocid|cmpid|at_\w+|ref|ref_src|src|smid|taid|sr_share|cid)$/i;

/**
 * Canonical identity for an article URL: https, lowercase host without
 * "www.", no fragment, no tracking parameters, no trailing slash. The
 * original `url` is kept for the open-original link.
 * @param {string} raw
 * @returns {?string}
 */
export function canonicalizeUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  url.username = '';
  url.password = '';
  url.port = '';
  for (const key of [...url.searchParams.keys()])
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

/** Stable item id: the first 16 hex digits of sha1(canonicalUrl). */
export function newsItemId(canonicalUrl) {
  return createHash('sha1').update(canonicalUrl).digest('hex').slice(0, 16);
}

function titleKey(title, sourceId) {
  return `${String(title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()}|${sourceId}`;
}

function timeOf(item) {
  const published = Date.parse(item.publishedAt || '');
  return Number.isNaN(published) ? Date.parse(item.collectedAt) : published;
}

/** Newest first: published time, then collected time, then id. */
export function compareItemsNewestFirst(a, b) {
  return (
    timeOf(b) - timeOf(a) ||
    Date.parse(b.collectedAt) - Date.parse(a.collectedAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Build a stored item from a fetcher candidate and its registry source.
 * Returns null when the URL cannot be canonicalized.
 */
export function buildNewsItem(candidate, source, theaterId, nowMs) {
  const canonicalUrl = canonicalizeUrl(candidate.url);
  if (!canonicalUrl || !candidate.title) return null;
  const nowIso = new Date(nowMs).toISOString();
  const published = Date.parse(candidate.publishedAt || '');
  // A publisher clock in the future is not news from the future.
  const publishedAt =
    Number.isNaN(published) || published > nowMs + 10 * 60_000
      ? null
      : new Date(published).toISOString();
  return {
    id: newsItemId(canonicalUrl),
    theater: theaterId,
    sourceId: source.id,
    folder: source.folder,
    kind: source.kind,
    perspective: source.perspective,
    title: candidate.title,
    titleOriginal: candidate.titleOriginal || candidate.title,
    snippet: candidate.snippet || '',
    language: candidate.language || source.languages?.[0] || 'en',
    url: candidate.url,
    canonicalUrl,
    publishedAt,
    collectedAt: nowIso,
    primarySource: candidate.primarySource || null,
    transport: candidate.transport || source.transport?.type || null,
    digestedAt: null,
    storyId: null,
  };
}

/**
 * @param {{theaterId: string, cacheDir: string, now?: () => number, retentionMs?: number, perSourceCap?: number}} options
 */
export function createNewsItemStore({
  theaterId,
  cacheDir,
  now = Date.now,
  retentionMs = ITEM_RETENTION_MS,
  perSourceCap = ITEM_PER_SOURCE_CAP,
}) {
  const cachePath = path.join(cacheDir, `${theaterId}.json`);
  /** @type {Map<string, object>} */
  const items = new Map();
  const titles = new Map();
  let revision = 0;
  let loaded = null;
  let saving = Promise.resolve();

  function index(item) {
    items.set(item.id, item);
    titles.set(titleKey(item.title, item.sourceId), item.id);
  }

  function remove(id) {
    const item = items.get(id);
    if (!item) return;
    items.delete(id);
    const key = titleKey(item.title, item.sourceId);
    if (titles.get(key) === id) titles.delete(key);
  }

  /** Drop expired items and keep the newest `perSourceCap` per source. */
  function prune() {
    const cutoff = now() - retentionMs;
    let removed = 0;
    const bySource = new Map();
    for (const item of items.values()) {
      if (Date.parse(item.collectedAt) < cutoff) {
        remove(item.id);
        removed++;
        continue;
      }
      if (!bySource.has(item.sourceId)) bySource.set(item.sourceId, []);
      bySource.get(item.sourceId).push(item);
    }
    for (const list of bySource.values()) {
      if (list.length <= perSourceCap) continue;
      list.sort(compareItemsNewestFirst);
      for (const item of list.slice(perSourceCap)) {
        remove(item.id);
        removed++;
      }
    }
    return removed;
  }

  return {
    cachePath,

    /** Read the disk cache once; malformed caches are ignored. */
    load() {
      loaded ??= (async () => {
        try {
          const parsed = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
          if (parsed?.version !== CACHE_VERSION || !Array.isArray(parsed.items))
            return;
          for (const item of parsed.items)
            if (
              typeof item?.id === 'string' &&
              typeof item.sourceId === 'string' &&
              typeof item.collectedAt === 'string'
            )
              index(item);
          prune();
          revision++;
        } catch {
          /* no cache yet */
        }
      })();
      return loaded;
    },

    /**
     * Write the cache. Saves are serialized: transports finish concurrently
     * and must not interleave their writes to one temporary file.
     */
    save() {
      saving = saving.then(async () => {
        const body = JSON.stringify({
          version: CACHE_VERSION,
          theater: theaterId,
          savedAt: new Date(now()).toISOString(),
          items: [...items.values()],
        });
        try {
          await fsp.mkdir(cacheDir, { recursive: true });
          const temporary = `${cachePath}.${process.pid}.tmp`;
          await fsp.writeFile(temporary, body, 'utf8');
          await fsp.rename(temporary, cachePath);
        } catch (error) {
          console.warn(
            '[news] item cache write failed:',
            error?.code || error?.message || error,
          );
        }
      });
      return saving;
    },

    /**
     * Add fetcher candidates. Exact repeats (canonical URL, or the same
     * lowercase title from the same publisher) are skipped; items published
     * before the retention window are not collected.
     * @param {Array<object>} candidates
     * @param {Map<string, object>} sourcesById
     * @returns {{added: number, duplicates: number, rejected: number, pruned: number}}
     */
    ingest(candidates, sourcesById) {
      const nowMs = now();
      let added = 0;
      let duplicates = 0;
      let rejected = 0;
      for (const candidate of candidates || []) {
        const source = sourcesById.get(candidate?.sourceId);
        const item = source
          ? buildNewsItem(candidate, source, theaterId, nowMs)
          : null;
        if (!item) {
          rejected++;
          continue;
        }
        if (
          item.publishedAt &&
          Date.parse(item.publishedAt) < nowMs - retentionMs
        ) {
          rejected++;
          continue;
        }
        // A Telegram post URL is its identity; channels reuse header lines.
        if (
          items.has(item.id) ||
          (item.transport !== 'telegram-public' &&
            titles.has(titleKey(item.title, item.sourceId)))
        ) {
          duplicates++;
          continue;
        }
        index(item);
        added++;
      }
      const pruned = prune();
      if (added || pruned) revision++;
      return { added, duplicates, rejected, pruned };
    },

    /** All retained items, newest first. */
    list() {
      prune();
      return [...items.values()].sort(compareItemsNewestFirst);
    },

    get(id) {
      return items.get(id) || null;
    },

    has(id) {
      return items.has(id);
    },

    /** Items no digest has processed yet, newest first. */
    undigested() {
      return this.list().filter((item) => !item.digestedAt);
    },

    /**
     * Record a digest's outcome: every item it processed gets `digestedAt`;
     * cited items get their story id, uncited ones stay unassigned.
     * @param {string[]} processedIds
     * @param {Map<string, string>} storyByItem item id → story id
     * @param {string} atIso
     */
    markDigested(processedIds, storyByItem, atIso) {
      for (const id of processedIds) {
        const item = items.get(id);
        if (!item) continue;
        item.digestedAt = atIso;
        item.storyId = storyByItem.get(id) || null;
      }
      for (const [id, storyId] of storyByItem) {
        const item = items.get(id);
        if (item) item.storyId = storyId;
      }
      revision++;
    },

    size() {
      return items.size;
    },

    revision() {
      return revision;
    },
  };
}
