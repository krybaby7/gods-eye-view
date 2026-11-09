import { setTimeout as wait } from 'node:timers/promises';
import { readResponseJsonCapped } from '../../../../src/sources/httpBody.js';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const PAUSE_MS = 300;
const DEADLINE_MS = 20_000;

export function createWdqsClient(fetchImpl, now = new Date()) {
  const started = performance.now();
  let attempted = false;

  // Await each call before starting the next one. Stop the run when a request
  // reports retryAt and keep that timestamp in the source cache.
  return async function queryWdqs(query) {
    if (attempted) await wait(PAUSE_MS);
    attempted = true;
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ query }),
      signal: AbortSignal.timeout(DEADLINE_MS),
      redirect: 'error',
    });
    if (!response.ok) {
      const error = new Error(
        'HTTP ' + response.status + ' from query.wikidata.org',
      );
      if (response.status === 429 || response.status >= 500) {
        const retry = response.headers.get('Retry-After')?.trim() ?? '';
        const received = +now + Math.floor(performance.now() - started);
        const requested = /^\d+$/.test(retry)
          ? received + Number(retry) * 1000
          : Date.parse(retry);
        if (Number.isFinite(requested) && Math.abs(requested) <= 8.64e15) {
          error.retryAt = new Date(
            Math.max(requested, received + 1000),
          ).toISOString();
        } else if (response.status === 429) {
          error.retryAt = new Date(received + 3_600_000).toISOString();
        }
      }
      await response.body?.cancel();
      throw error;
    }
    const body = await readResponseJsonCapped(response, 12_000_000);
    if (!Array.isArray(body?.results?.bindings))
      throw new Error('Invalid Wikidata SPARQL response');
    return body.results.bindings;
  };
}
