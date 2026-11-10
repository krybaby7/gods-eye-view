import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
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

test('each detail caller can abort while another caller receives the shared result', async () => {
  let release;
  let requests = 0;
  const source = createWorldSource({
    fetchImpl: (_url, { signal }) => {
      requests++;
      return new Promise((resolve, reject) => {
        release = resolve;
        signal?.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    },
  });
  const first = new AbortController();
  const second = new AbortController();
  const getDetail = (signal) => source.getDetail('IND', 'assets', { signal });
  const firstResult = getDetail(first.signal).catch((error) => error);
  const secondResult = getDetail(second.signal).catch((error) => error);
  const activeResult = getDetail().catch((error) => error);
  first.abort(new Error('First caller left'));
  second.abort(new Error('Second caller left'));

  const pending = Symbol('pending');
  await setImmediate();
  const beforeResponse = await Promise.all([
    Promise.race([firstResult, pending]),
    Promise.race([secondResult, pending]),
    Promise.race([activeResult, pending]),
  ]);
  release(Response.json({ country: 'IND', lens: 'assets', data: [1] }));

  assert.deepEqual(beforeResponse, [
    first.signal.reason,
    second.signal.reason,
    pending,
  ]);
  assert.deepEqual(await activeResult, [1]);
  assert.deepEqual(await getDetail(), [1]);
  assert.equal(requests, 1);
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
