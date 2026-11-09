import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorldSource } from './source.js';

test('board reads and Refresh use their own same-origin routes', async () => {
  const calls = [];
  const state = {
    countries: {},
    countryIndex: [],
    indicators: [],
    sources: [],
  };
  const source = createWorldSource({
    fetchImpl: async (url, options) => {
      calls.push([url, options.method, options.cache]);
      return Response.json(state);
    },
  });
  assert.deepEqual(await source.getSnapshot(), state);
  assert.deepEqual(await source.refresh(), state);
  assert.deepEqual(await source.refresh({ sourceId: 'gdacs' }), state);
  assert.deepEqual(calls, [
    ['/api/world', 'GET', 'no-store'],
    ['/api/world/refresh', 'POST', 'no-store'],
    ['/api/world/refresh?source=gdacs', 'POST', 'no-store'],
  ]);
});

test('source surfaces an HTTP error and rejects an invalid snapshot', async () => {
  let response = Response.json(
    { error: 'Refresh unavailable' },
    { status: 503 },
  );
  const source = createWorldSource({ fetchImpl: async () => response });
  await assert.rejects(source.refresh(), /Refresh unavailable/);
  response = Response.json([]);
  await assert.rejects(source.getSnapshot(), /Malformed World Board snapshot/);
});
