import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fetchObservations } from './worldbank.js';

const fixture = (name) =>
  readFile(new URL(`./fixtures/wb-${name}.json`, import.meta.url), 'utf8');

test('World Bank checks population first and recovers when the first response is rate limited', async () => {
  const requests = [];
  const result = await fetchObservations({
    registry: {
      countries: [{ iso3: 'FIN' }],
      indicators: [
        { id: 'gdp', source: 'worldbank', sourceCode: 'NY.GDP.MKTP.PP.CD' },
      ],
    },
    now: new Date('2026-11-09T00:00:00Z'),
    async fetchImpl(url, { signal }) {
      const path = new URL(url).pathname.split('/').at(-1);
      requests.push({ path, signal });
      if (requests.length === 1) {
        return new Response('', {
          status: 429,
          headers: { 'Retry-After': '0' },
        });
      }
      const file = {
        all: 'countries',
        'SP.POP.TOTL': 'population',
        'NY.GDP.MKTP.PP.CD': 'gdp',
      }[path];
      return new Response(await fixture(file));
    },
  });
  assert.deepEqual(
    requests.map(({ path }) => path),
    ['all', 'all', 'SP.POP.TOTL', 'NY.GDP.MKTP.PP.CD'],
  );
  assert.notEqual(requests[0].signal, requests[1].signal);
  assert.equal(result.error, undefined);
  assert.ok(
    result.observations.some(
      ({ indicator }) => indicator === 'population.total',
    ),
  );
});
