import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorldSource } from './source.js';

test('board reads, Refresh and progress use their own same-origin routes', async () => {
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
      return Response.json(
        url === '/api/world' ? state : { refresh: null, revision: 2 },
      );
    },
  });
  assert.deepEqual(await source.getSnapshot(), state);
  assert.deepEqual(await source.refresh(), { refresh: null, revision: 2 });
  assert.deepEqual(await source.getProgress(), { refresh: null, revision: 2 });
  assert.deepEqual(calls, [
    ['/api/world', 'GET', 'no-store'],
    ['/api/world/refresh', 'POST', 'no-store'],
    ['/api/world/progress', 'GET', 'no-store'],
  ]);
});

test('detail is cached per country and lens until the board is replaced', async () => {
  const calls = [];
  const source = createWorldSource({
    fetchImpl: async (url) => {
      calls.push(url);
      const params = new URL(url, 'http://localhost').searchParams;
      return Response.json({
        country: params.get('country'),
        lens: params.get('lens'),
        data: [calls.length],
      });
    },
  });
  assert.deepEqual(await source.getDetail('IND', 'assets'), [1]);
  assert.deepEqual(await source.getDetail('IND', 'assets'), [1]);
  assert.deepEqual(await source.getDetail('JPN', 'assets'), [2]);
  assert.deepEqual(await source.getDetail('IND', 'people'), [3]);
  assert.deepEqual(await source.getDetail(null, 'assets'), [4]);
  source.invalidateDetails();
  assert.deepEqual(await source.getDetail('IND', 'assets'), [5]);
  assert.deepEqual(calls, [
    '/api/world/detail?country=IND&lens=assets',
    '/api/world/detail?country=JPN&lens=assets',
    '/api/world/detail?country=IND&lens=people',
    '/api/world/detail?lens=assets',
    '/api/world/detail?country=IND&lens=assets',
  ]);
});

test('an in-flight detail response cannot refill an invalidated cache', async () => {
  let release;
  const source = createWorldSource({
    fetchImpl: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const reply = (data) =>
    Response.json({ country: 'IND', lens: 'assets', data });
  const old = source.getDetail('IND', 'assets');
  source.invalidateDetails();
  release(reply('old'));
  assert.equal(await old, 'old');
  const current = source.getDetail('IND', 'assets');
  release(reply('current'));
  assert.equal(await current, 'current');
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
