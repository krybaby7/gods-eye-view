import { decodeEntities } from '../../common/rss.js';
import { fetchNewsBody, fetchNewsBytes, httpFailure } from './http.js';
import {
  FETCHER_ITEM_CAP,
  candidate,
  errorMessage,
  sourceStatus,
} from './text.js';
import { readSingleEntryZip } from './zip.js';

/**
 * gdelt-domain outlets from GDELT 2.0's 15-minute Global Knowledge Graph
 * files instead of the DOC search API: no query, so no per-IP query limit.
 * `lastupdate.txt` names the newest file; each file is one zipped,
 * tab-separated table with one row per article (GKG 2.1 codebook, checked
 * against the 2026-10-28 files): 0 record id (`-T` marks the translation
 * stream), 1 the file's 15-minute stamp, 3 the outlet's domain, 4 the
 * article URL, 25 translation info (`srclc:ara;...`), 26 extras XML with
 * `<PAGE_TITLE>`. A field can hold line breaks, so a record runs until the
 * next line that starts with a record id.
 *
 * One process-wide feed downloads each file once, keeps only rows from
 * registered outlets, and serves them to every theater from a small memory.
 */

export const GDELT_SEED_FILES = 4;
export const GDELT_FILE_MAX_BYTES = 32 * 1024 * 1024;
export const GDELT_CSV_MAX_BYTES = 192 * 1024 * 1024;
const GDELT_DATA = 'https://data.gdeltproject.org/gdeltv2/';
const FILE_STEP_MS = 15 * 60_000;
const KEPT_FILES = 8;
const GKG_COLUMNS = 27;
const RECORD_START = /^\d{14}-T?\d+\t/;
const LAST_UPDATE_GKG =
  /^(\d+)\s+\S+\s+https?:\/\/data\.gdeltproject\.org\/gdeltv2\/(\d{14})\.gkg\.csv\.zip$/;
const TRANSLATED_LANGUAGES = new Map([
  ['ara', 'ar'],
  ['deu', 'de'],
  ['fas', 'fa'],
  ['fra', 'fr'],
  ['heb', 'he'],
  ['rus', 'ru'],
  ['spa', 'es'],
  ['tur', 'tr'],
]);

/** `NEWS_GDELT_FILES=off` falls back to the DOC search API. */
export function gdeltFilesEnabled(env = {}) {
  return (
    String(env.NEWS_GDELT_FILES || '')
      .trim()
      .toLowerCase() !== 'off'
  );
}

function stampMs(stamp) {
  const parts = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(
    String(stamp || ''),
  );
  if (!parts) return NaN;
  const [, y, mo, d, h, mi, s] = parts.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

function stampOf(ms) {
  return new Date(ms).toISOString().replace(/\D/g, '').slice(0, 14);
}

const megabytes = (bytes) => Number((bytes / 1024 / 1024).toFixed(1));

/**
 * The newest GKG file in lastupdate.txt, only when it is on GDELT's own host.
 * @returns {?{stamp: string, bytes: number}}
 */
export function parseLastUpdate(text) {
  for (const line of String(text || '').split('\n')) {
    const match = LAST_UPDATE_GKG.exec(line.trim());
    if (match) return { stamp: match[2], bytes: Number(match[1]) };
  }
  return null;
}

/**
 * File stamps after `after` up to `latest`, oldest first, at most `max` of
 * the newest: the seed on first start, and the cap after a long gap.
 * @param {string} latest
 * @param {?string} after
 */
export function gdeltFileStamps(latest, after, max = GDELT_SEED_FILES) {
  const latestMs = stampMs(latest);
  if (Number.isNaN(latestMs)) return [];
  const afterMs = stampMs(after);
  const stamps = [];
  for (let ms = latestMs; stamps.length < max; ms -= FILE_STEP_MS) {
    if (!Number.isNaN(afterMs) && ms <= afterMs) break;
    stamps.unshift(stampOf(ms));
  }
  return stamps;
}

/**
 * Case-insensitive title filter on the theater's GDELT terms, matched at the
 * start of a word ("Iran" keeps "Iranian", not "Tirana"). No terms keep all.
 * @param {string[]} terms
 * @returns {(title: string) => boolean}
 */
export function gdeltTitleFilter(terms = []) {
  const words = terms
    .map((term) => String(term).trim())
    .filter(Boolean)
    .map((term) =>
      term
        .split(/\s+/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s+'),
    );
  if (!words.length) return () => true;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})`, 'iu');
  return (title) => pattern.test(title);
}

/** The most specific registered domain the host is, or is under. */
function registeredDomain(host, domains) {
  const labels = host.split('.');
  for (let index = 0; index < labels.length - 1; index++) {
    const candidateDomain = labels.slice(index).join('.');
    if (domains.has(candidateDomain)) return candidateDomain;
  }
  return null;
}

/** Field `index` of a record, read without decoding the rest of it. */
function fieldBounds(bytes, start, end, index) {
  let from = start;
  for (let field = 0; field < index; field++) {
    const tab = bytes.indexOf(0x09, from);
    if (tab === -1 || tab >= end) return null;
    from = tab + 1;
  }
  const tab = bytes.indexOf(0x09, from);
  return [from, tab === -1 || tab > end ? end : tab];
}

/**
 * Rows of one unzipped GKG file whose URL host is, or is under, one of
 * `domains`; rows without a page title are dropped. Only matching records
 * are decoded. A row is dated by its file's stamp, which GDELT sets about
 * ten minutes ahead of publishing the file, so never after `readAt`.
 * @param {Uint8Array} bytes
 * @param {Iterable<string>} domains
 * @param {{readAt?: number}} [options]
 * @returns {{rows: Array<{domain: string, url: string, title: string, publishedAt: ?string, language: ?string}>, total: number}}
 */
export function gkgRows(bytes, domains, { readAt = Date.now() } = {}) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wanted = new Set([...domains].map((d) => String(d).toLowerCase()));
  const starts = [];
  for (let line = 0; line < buffer.length;) {
    const head = buffer.toString('latin1', line, line + 32);
    if (RECORD_START.test(head)) starts.push(line);
    const newline = buffer.indexOf(0x0a, line);
    line = newline === -1 ? buffer.length : newline + 1;
  }
  const rows = [];
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    let end = (starts[index + 1] ?? buffer.length + 1) - 1;
    while (
      end > start &&
      (buffer[end - 1] === 0x0a || buffer[end - 1] === 0x0d)
    )
      end--;
    const urlField = fieldBounds(buffer, start, end, 4);
    if (!urlField || !wanted.size) continue;
    let host;
    try {
      host = new URL(buffer.toString('utf8', ...urlField)).hostname;
    } catch {
      continue;
    }
    const domain = registeredDomain(host.toLowerCase(), wanted);
    if (!domain) continue;
    const fields = buffer.toString('utf8', start, end).split('\t');
    if (fields.length !== GKG_COLUMNS) continue;
    const title = decodeEntities(
      /<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/.exec(fields[26])?.[1] || '',
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) continue;
    const fileMs = stampMs(fields[1]);
    const translated = fields[0].includes('-T');
    rows.push({
      domain,
      url: fields[4],
      title,
      publishedAt: Number.isNaN(fileMs)
        ? null
        : new Date(Math.min(fileMs, readAt)).toISOString(),
      language: translated
        ? (TRANSLATED_LANGUAGES.get(/srclc:(\w+)/.exec(fields[25])?.[1]) ??
          null)
        : 'en',
    });
  }
  return { rows, total: starts.length };
}

function fileError(message) {
  return Object.assign(new Error(message), { code: 'GDELT_FILE' });
}

/**
 * The shared reader. Reads are serialized; a file's matching rows are kept
 * for the newest eight files, so a second theater, or a theater a file
 * behind, is served without downloading again. Holds one file's bytes at a
 * time.
 * @param {{maxFileBytes?: number, maxCsvBytes?: number, seedFiles?: number, log?: (line: string) => void}} [options]
 */
export function createGdeltFileFeed({
  maxFileBytes = GDELT_FILE_MAX_BYTES,
  maxCsvBytes = GDELT_CSV_MAX_BYTES,
  seedFiles = GDELT_SEED_FILES,
  log = (line) => console.log(line),
} = {}) {
  /** @type {Map<string, Array<object>>} `${stamp}|${domains}` → rows */
  const kept = new Map();
  let tail = Promise.resolve();

  function keep(key, rows) {
    kept.set(key, rows);
    if (kept.size <= KEPT_FILES) return;
    const oldest = [...kept.keys()].sort().slice(0, kept.size - KEPT_FILES);
    for (const stale of oldest) kept.delete(stale);
  }

  async function download(stamp, declaredBytes, fetchOptions) {
    if (declaredBytes > maxFileBytes)
      throw fileError(
        `file ${stamp} is ${megabytes(declaredBytes)} MB, over the ${megabytes(maxFileBytes)} MB cap`,
      );
    let response;
    try {
      response = await fetchNewsBytes(`${GDELT_DATA}${stamp}.gkg.csv.zip`, {
        ...fetchOptions,
        timeoutMs: 120_000,
        maxBytes: maxFileBytes,
        headers: { Accept: 'application/zip' },
      });
    } catch (error) {
      if (error?.code === 'RESPONSE_TOO_LARGE')
        throw fileError(
          `file ${stamp} is over the ${megabytes(maxFileBytes)} MB cap`,
        );
      throw error;
    }
    return response;
  }

  async function readOnce({ after, domains, fetchImpl, now }) {
    const wanted = [...new Set(domains)].sort();
    const result = {
      rows: [],
      cursor: after || null,
      latest: null,
      downloads: [],
      error: null,
    };
    try {
      const head = await fetchNewsBody(`${GDELT_DATA}lastupdate.txt`, {
        fetchImpl,
        maxBytes: 64 * 1024,
        headers: { Accept: 'text/plain' },
      });
      if (!head.ok)
        throw fileError(`lastupdate.txt ${httpFailure(head.status).error}`);
      const latest = parseLastUpdate(head.text);
      if (!latest) throw fileError('no GKG file in lastupdate.txt');
      result.latest = latest.stamp;
      for (const stamp of gdeltFileStamps(latest.stamp, after, seedFiles)) {
        const key = `${stamp}|${wanted.join(',')}`;
        let rows = kept.get(key);
        if (!rows) {
          const isLatest = stamp === latest.stamp;
          const response = await download(stamp, isLatest ? latest.bytes : 0, {
            fetchImpl,
          });
          // GDELT now and then skips an interval; only the newest must exist.
          if (response.status === 404 && !isLatest) {
            result.cursor = stamp;
            continue;
          }
          if (!response.ok)
            throw fileError(
              `file ${stamp} ${httpFailure(response.status).error}`,
            );
          const { data } = readSingleEntryZip(response.bytes, {
            maxBytes: maxCsvBytes,
          });
          const parsed = gkgRows(data, wanted, { readAt: now() });
          rows = parsed.rows;
          result.downloads.push({
            stamp,
            bytes: response.bytes.byteLength,
            rows: parsed.total,
            kept: rows.length,
          });
          keep(key, rows);
        }
        result.rows.push(...rows);
        result.cursor = stamp;
      }
    } catch (error) {
      result.error =
        error?.code === 'GDELT_FILE' || error?.code === 'ZIP_INVALID'
          ? error.message
          : errorMessage(error);
    }
    if (result.downloads.length) {
      const sum = (field) =>
        result.downloads.reduce((total, d) => total + d[field], 0);
      const count = result.downloads.length;
      log(
        `[news] GDELT files: ${count} file${count === 1 ? '' : 's'}, ${megabytes(sum('bytes')).toFixed(1)} MB, ${sum('rows')} rows, ${sum('kept')} kept`,
      );
    }
    return result;
  }

  return {
    /**
     * Rows from every file newer than `after` (at most the newest
     * `seedFiles`), and the stamp of the last file read: the caller's next
     * `after`. A failure stops at the file that failed and reports it; the
     * rows read before it are still returned. Never throws.
     * @param {{after: ?string, domains: string[], fetchImpl?: Function, now?: () => number}} options
     */
    read({ after = null, domains, fetchImpl, now = Date.now }) {
      const job = tail.then(() => readOnce({ after, domains, fetchImpl, now }));
      tail = job.catch(() => {});
      return job;
    },
  };
}

/** The process-wide feed every theater's collector shares. */
export const gdeltFileFeed = createGdeltFileFeed();

/**
 * One collection cycle for a theater's gdelt-domain sources. Each source
 * reports ok and its count; a failed download or parse gives every source
 * the same `GDELT files: ...` error. Never throws.
 * @param {Array<object>} sources This theater's gdelt-domain sources.
 * @param {{feed?: ReturnType<typeof createGdeltFileFeed>, after: ?string, domains: string[], terms?: string[], fetchImpl?: Function, now?: () => number}} options
 *   `domains` is every gdelt-domain source's domain across all theaters.
 * @returns {Promise<{results: Array<{items: Array<object>, status: object}>, cursor: ?string}>}
 */
export async function fetchGdeltFileSources(sources, options) {
  const {
    feed = gdeltFileFeed,
    after,
    domains,
    terms = [],
    fetchImpl,
    now = Date.now,
  } = options;
  const startedAt = now();
  const read = await feed.read({ after, domains, fetchImpl, now });
  const keepTitle = gdeltTitleFilter(terms);
  const byDomain = new Map(
    sources.map((source) => [source.transport.domain.toLowerCase(), source]),
  );
  const itemsBySource = new Map(sources.map((source) => [source.id, []]));
  // Newest files last in `rows`; walk back so the cap keeps the newest.
  for (let index = read.rows.length - 1; index >= 0; index--) {
    const row = read.rows[index];
    const source = byDomain.get(row.domain);
    if (!source || !keepTitle(row.title)) continue;
    const list = itemsBySource.get(source.id);
    if (list.length >= FETCHER_ITEM_CAP) continue;
    list.unshift(
      candidate(source, {
        title: row.title,
        snippet: '',
        url: row.url,
        publishedAt: row.publishedAt,
        language: row.language ?? undefined,
      }),
    );
  }
  const durationMs = now() - startedAt;
  return {
    cursor: read.cursor,
    results: sources.map((source) => {
      const items = itemsBySource.get(source.id);
      return {
        items,
        status: sourceStatus(
          source,
          read.error
            ? { error: `GDELT files: ${read.error}`, durationMs }
            : { ok: true, count: items.length, durationMs },
        ),
      };
    }),
  };
}
