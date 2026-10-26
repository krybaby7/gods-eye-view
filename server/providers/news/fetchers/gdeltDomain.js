import { normalizeRegionalArticles } from '../../../../src/data/regionalModel.js';
import { fetchNewsBody, httpFailure } from './http.js';
import {
  FETCHER_ITEM_CAP,
  candidate,
  errorMessage,
  sourceStatus,
} from './text.js';

/**
 * GDELT DOC 2.0 `domainis:` queries for outlets that are bot-protected or
 * publish no feed. GDELT allows one request per five seconds per IP, so every
 * query in the process goes through one queue: 5.5 s between requests, and
 * an exponential pause after a 429.
 */

export const GDELT_DOMAINS_PER_QUERY = 10;
export const GDELT_SPACING_MS = 5_500;
const GDELT_BACKOFF_MS = 60_000;
const GDELT_MAX_BACKOFF_MS = 15 * 60_000;
const GDELT_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GDELT_LANGUAGES = new Map([
  ['english', 'en'],
  ['arabic', 'ar'],
  ['hebrew', 'he'],
  ['persian', 'fa'],
  ['farsi', 'fa'],
  ['french', 'fr'],
  ['turkish', 'tr'],
]);

/**
 * A serial request queue with minimum spacing and 429 backoff.
 * @param {{spacingMs?: number, backoffMs?: number, maxBackoffMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void>}} [options]
 */
export function createGdeltQueue({
  spacingMs = GDELT_SPACING_MS,
  backoffMs = GDELT_BACKOFF_MS,
  maxBackoffMs = GDELT_MAX_BACKOFF_MS,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.()),
} = {}) {
  let tail = Promise.resolve();
  let nextAt = 0;
  let backoff = 0;
  let pending = 0;
  return {
    /**
     * Run `task` after the previous task settles and the spacing elapses.
     * A task result with `status === 429` doubles the pause before the next.
     * @template T
     * @param {() => Promise<T>} task
     * @returns {Promise<T>}
     */
    run(task) {
      pending += 1;
      const job = tail.then(async () => {
        const wait = nextAt - now();
        if (wait > 0) await sleep(wait);
        try {
          const result = await task();
          if (result?.status === 429) {
            backoff = backoff ? Math.min(backoff * 2, maxBackoffMs) : backoffMs;
            nextAt = now() + backoff;
          } else {
            backoff = 0;
            nextAt = now() + spacingMs;
          }
          return result;
        } catch (error) {
          nextAt = now() + spacingMs;
          throw error;
        } finally {
          pending -= 1;
        }
      });
      tail = job.catch(() => {});
      return job;
    },
    state() {
      return { pending, nextAt, backoffMs: backoff };
    },
  };
}

/** The process-wide queue every GDELT domain query shares. */
export const gdeltQueue = createGdeltQueue();

function orGroup(terms) {
  return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`;
}

/**
 * `(domainis:a OR domainis:b) (Iran OR Israel OR "Red Sea")`. GDELT only
 * accepts parentheses around OR'd terms, so a single term stays bare.
 * @param {string[]} domains
 * @param {string[]} terms
 */
export function buildGdeltDomainQuery(domains, terms = []) {
  const domainPart = orGroup(domains.map((domain) => `domainis:${domain}`));
  const quoted = terms
    .map((term) => String(term).replace(/["()]/g, '').trim())
    .filter(Boolean)
    .map((term) => (/\s/.test(term) ? `"${term}"` : term));
  return quoted.length ? `${domainPart} ${orGroup(quoted)}` : domainPart;
}

/** Split gdelt-domain sources into query groups of up to ten domains. */
export function groupGdeltSources(sources, size = GDELT_DOMAINS_PER_QUERY) {
  const groups = [];
  const eligible = sources.filter((s) => s.transport.type === 'gdelt-domain');
  for (let i = 0; i < eligible.length; i += size)
    groups.push(eligible.slice(i, i + size));
  return groups;
}

function sourceForUrl(url, sources) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return (
    sources.find(
      (source) =>
        host === source.transport.domain ||
        host.endsWith(`.${source.transport.domain}`),
    ) || null
  );
}

/**
 * Fetch one group of up to ten domains through the shared queue. Never throws.
 * @param {Array<object>} sources gdelt-domain sources of one group.
 * @param {{terms?: string[], fetchImpl?: Function, queue?: ReturnType<typeof createGdeltQueue>, timespan?: string}} [options]
 * @returns {Promise<{items: Array<object>, statuses: Array<object>}>}
 */
export async function fetchGdeltDomainGroup(sources, options = {}) {
  const {
    terms = [],
    queue = gdeltQueue,
    timespan = '24h',
    ...fetchOptions
  } = options;
  const startedAt = Date.now();
  const statuses = (fields) =>
    sources.map((source) =>
      sourceStatus(source, { ...fields, durationMs: Date.now() - startedAt }),
    );
  if (!sources.length) return { items: [], statuses: [] };
  const params = new URLSearchParams({
    query: buildGdeltDomainQuery(
      sources.map((s) => s.transport.domain),
      terms,
    ),
    mode: 'artlist',
    format: 'json',
    maxrecords: '250',
    sort: 'datedesc',
    timespan,
  });
  try {
    const response = await queue.run(() =>
      fetchNewsBody(`${GDELT_ENDPOINT}?${params}`, {
        ...fetchOptions,
        timeoutMs: 30_000,
        headers: { Accept: 'application/json' },
      }),
    );
    if (!response.ok)
      return { items: [], statuses: statuses(httpFailure(response.status)) };
    let payload;
    try {
      payload = JSON.parse(response.text || '{}');
    } catch {
      return {
        items: [],
        statuses: statuses({
          error: `GDELT: ${response.text.slice(0, 80).trim() || 'not JSON'}`,
        }),
      };
    }
    const languageByUrl = new Map(
      (Array.isArray(payload?.articles) ? payload.articles : []).map((row) => [
        row?.url,
        GDELT_LANGUAGES.get(String(row?.language || '').toLowerCase()),
      ]),
    );
    const articles = normalizeRegionalArticles(payload, 250, { cap: 250 });
    const counts = new Map();
    const items = [];
    for (const article of articles) {
      const source = sourceForUrl(article.url, sources);
      if (!source) continue;
      const count = counts.get(source.id) || 0;
      if (count >= FETCHER_ITEM_CAP) continue;
      counts.set(source.id, count + 1);
      items.push(
        candidate(source, {
          title: article.title,
          snippet: '',
          url: article.url,
          publishedAt: article.publishedAt,
          language: languageByUrl.get(article.url),
        }),
      );
    }
    return {
      items,
      statuses: sources.map((source) =>
        sourceStatus(source, {
          ok: true,
          count: counts.get(source.id) || 0,
          durationMs: Date.now() - startedAt,
        }),
      ),
    };
  } catch (error) {
    return { items: [], statuses: statuses({ error: errorMessage(error) }) };
  }
}
