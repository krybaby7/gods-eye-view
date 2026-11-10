import { setTimeout as wait } from 'node:timers/promises';
import { readResponseJsonCapped } from '../../../../src/sources/httpBody.js';
import { fetchOnDispatch } from './transport.js';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const PAUSE_MS = 300;
const DEADLINE_MS = 20_000;

export function createWdqsClient(fetchImpl, now = new Date(), budget) {
  const sparql = (query) => [
    ENDPOINT,
    {
      method: 'POST',
      headers: {
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ query }),
    },
  ];
  const sitelinks = (ids) => [
    'https://www.wikidata.org/w/api.php?' +
      new URLSearchParams({
        action: 'wbgetentities',
        ids: ids.join('|'),
        props: 'sitelinks',
        sitefilter: 'enwiki',
        format: 'json',
      }),
    { headers: { Accept: 'application/json' } },
  ];
  const started = performance.now();
  let attempted = false;

  // The adapter decides whether a Retry-After fits the current batch.
  return async function queryWdqs(query) {
    if (attempted) await wait(PAUSE_MS, null, { signal: budget });
    attempted = true;
    const labels = Array.isArray(query);
    const [url, options] = labels ? sitelinks(query) : sparql(query);
    const response = await fetchOnDispatch(
      fetchImpl,
      url,
      { ...options, signal: budget, redirect: 'error' },
      () => {
        const deadline = AbortSignal.timeout(DEADLINE_MS);
        return budget ? AbortSignal.any([budget, deadline]) : deadline;
      },
    );
    if (!response.ok) {
      const error = new Error(
        'HTTP ' + response.status + ' from ' + new URL(url).hostname,
      );
      error.status = response.status;
      if (response.status === 429 || response.status >= 500) {
        const retry = response.headers.get('Retry-After')?.trim() ?? '';
        const received = +now + Math.floor(performance.now() - started);
        const requested = /^\d+$/.test(retry)
          ? received + Number(retry) * 1000
          : Date.parse(retry);
        if (Number.isFinite(requested) && Math.abs(requested) <= 8.64e15) {
          error.retryAfterMs = Math.max(requested - received, 1000);
          error.retryAt = new Date(
            Math.max(requested, received + 1000),
          ).toISOString();
        } else if (response.status === 429) {
          error.retryAfterMs = 3_600_000;
          error.retryAt = new Date(received + error.retryAfterMs).toISOString();
        }
      }
      await response.body?.cancel();
      throw error;
    }
    const body = await readResponseJsonCapped(response, 12_000_000);
    if (labels) {
      if (!body?.entities || typeof body.entities !== 'object')
        throw new Error('Invalid Wikidata entity response');
      return body.entities;
    }
    if (!Array.isArray(body?.results?.bindings))
      throw new Error('Invalid Wikidata SPARQL response');
    return body.results.bindings;
  };
}
