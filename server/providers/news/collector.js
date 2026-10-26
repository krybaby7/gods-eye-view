import { fetchRssSource } from './fetchers/rss.js';
import { fetchTelegramSource } from './fetchers/telegramPublic.js';
import {
  fetchGdeltDomainGroup,
  gdeltQueue,
  groupGdeltSources,
} from './fetchers/gdeltDomain.js';
import { fetchReliefwebSource } from './fetchers/reliefweb.js';

/**
 * Timed collection for one theater. Collect is free and runs on timers; it
 * never calls the digest model. Each transport has its own cadence and is
 * single-flight; failures keep the previous items (serve stale) and surface
 * as per-source health.
 */

export const NEWS_POLL_CADENCE_MS = Object.freeze({
  rss: 10 * 60_000,
  'telegram-public': 5 * 60_000,
  'gdelt-domain': 15 * 60_000,
  reliefweb: 30 * 60_000,
});
const TICK_MS = 60_000;
const FEED_CONCURRENCY = 4;

async function mapLimited(list, limit, worker) {
  const results = new Array(list.length);
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(limit, list.length) },
    async () => {
      while (next < list.length) {
        const index = next++;
        results[index] = await worker(list[index]);
      }
    },
  );
  await Promise.all(lanes);
  return results;
}

function initialHealth(source) {
  return {
    ok: false,
    count: 0,
    error: null,
    blocked: false,
    rateLimited: false,
    disabled: source.transport.type === 'link-only',
    linkOnly: source.transport.type === 'link-only',
    fragile: source.transport.type === 'telegram-public',
    loading: false,
    lastAttemptAt: null,
    lastOkAt: null,
  };
}

/**
 * @param {{
 *   registry: {theater: object, sourcesById: Map<string, object>},
 *   store: ReturnType<import('./store.js').createNewsItemStore>,
 *   fetchImpl?: Function,
 *   env?: Record<string, string|undefined>,
 *   now?: () => number,
 *   queue?: ReturnType<import('./fetchers/gdeltDomain.js').createGdeltQueue>,
 *   timers?: {setInterval: Function, clearInterval: Function},
 *   onUpdate?: () => void,
 * }} options
 */
export function createNewsCollector({
  registry,
  store,
  fetchImpl,
  env = process.env,
  now = Date.now,
  queue = gdeltQueue,
  timers = globalThis,
  onUpdate = () => {},
}) {
  const { theater, sourcesById } = registry;
  const sources = theater.sourceIds.map((id) => sourcesById.get(id));
  const health = new Map(sources.map((s) => [s.id, initialHealth(s)]));
  const lastRunAt = new Map();
  const running = new Map();
  let timer = null;

  function sourcesOf(type) {
    return sources.filter((source) => source.transport.type === type);
  }

  async function fetchTransport(type) {
    const options = { fetchImpl };
    const list = sourcesOf(type);
    switch (type) {
      case 'rss':
        return mapLimited(list, FEED_CONCURRENCY, (s) =>
          fetchRssSource(s, options),
        );
      case 'telegram-public':
        return mapLimited(list, 2, (s) => fetchTelegramSource(s, options));
      case 'reliefweb':
        return mapLimited(list, 1, (s) =>
          fetchReliefwebSource(s, {
            ...options,
            now,
            appname: String(env.RELIEFWEB_APPNAME || '').trim(),
          }),
        );
      case 'gdelt-domain': {
        const results = [];
        for (const group of groupGdeltSources(list)) {
          const { items, statuses } = await fetchGdeltDomainGroup(group, {
            ...options,
            terms: theater.gdeltTerms,
            queue,
          });
          statuses.forEach((status, index) =>
            results.push({ items: index === 0 ? items : [], status }),
          );
        }
        return results;
      }
      default:
        return [];
    }
  }

  async function runTransportOnce(type) {
    const list = sourcesOf(type);
    if (!list.length) return { added: 0 };
    const attemptAt = now();
    for (const source of list) health.get(source.id).loading = true;
    let results;
    try {
      results = await fetchTransport(type);
    } finally {
      for (const source of list) health.get(source.id).loading = false;
    }
    const items = [];
    for (const { items: found, status } of results) {
      for (const item of found) items.push(item);
      const previous = health.get(status.sourceId);
      if (!previous) continue;
      health.set(status.sourceId, {
        ...previous,
        ok: status.ok,
        count: status.count,
        error: status.error,
        blocked: status.blocked,
        rateLimited: status.rateLimited,
        disabled: status.disabled,
        loading: false,
        lastAttemptAt: new Date(attemptAt).toISOString(),
        lastOkAt: status.ok
          ? new Date(attemptAt).toISOString()
          : previous.lastOkAt,
      });
    }
    const outcome = store.ingest(items, sourcesById);
    const failing = results.filter(
      (r) => !r.status.ok && !r.status.disabled,
    ).length;
    if (failing)
      console.warn(
        `[news] ${theater.id} ${type}: ${results.length - failing}/${results.length} sources ok`,
      );
    if (outcome.added || outcome.pruned) await store.save();
    onUpdate();
    return outcome;
  }

  /** Run one transport now unless it is already running (single-flight). */
  function runTransport(type) {
    if (running.has(type)) return running.get(type);
    lastRunAt.set(type, now());
    const pending = runTransportOnce(type)
      .catch((error) => {
        console.warn(`[news] ${type} collection failed:`, error?.message);
        return { added: 0 };
      })
      .finally(() => running.delete(type));
    running.set(type, pending);
    return pending;
  }

  function tick() {
    for (const [type, cadence] of Object.entries(NEWS_POLL_CADENCE_MS)) {
      if (running.has(type)) continue;
      const last = lastRunAt.get(type);
      if (last === undefined || now() - last >= cadence)
        void runTransport(type);
    }
  }

  return {
    /** Start the timers and an immediate first pass; idempotent. */
    start() {
      if (timer) return;
      timer = timers.setInterval(tick, TICK_MS);
      timer?.unref?.();
      tick();
    },

    stop() {
      if (timer) timers.clearInterval(timer);
      timer = null;
    },

    running() {
      return timer !== null;
    },

    /** Run every transport now and wait (tests, QA fixtures). */
    async collectAll() {
      await Promise.all(
        Object.keys(NEWS_POLL_CADENCE_MS).map((type) => runTransport(type)),
      );
    },

    /**
     * Per-source health. `stale` means the last success is older than two
     * cadences; the source's earlier items are still served.
     */
    health() {
      const nowMs = now();
      return sources.map((source) => {
        const entry = health.get(source.id);
        const cadence = NEWS_POLL_CADENCE_MS[source.transport.type];
        const lastOk = Date.parse(entry.lastOkAt || '');
        const stale =
          !entry.linkOnly &&
          !entry.disabled &&
          !Number.isNaN(lastOk) &&
          nowMs - lastOk > 2 * cadence;
        return {
          sourceId: source.id,
          ...entry,
          stale,
          degraded:
            !entry.linkOnly &&
            !entry.disabled &&
            entry.lastAttemptAt !== null &&
            (!entry.ok || stale),
        };
      });
    },
  };
}
