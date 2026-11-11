import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorldFetch } from './transport.js';

test('a redirect waits for the destination host while another response body is open', async () => {
  const target = 'https://data.example/file';
  const redirect = 'https://catalog.example/file';
  const started = [];
  const fetchWorld = createWorldFetch(async (url, { redirect: mode }) => {
    started.push(url);
    if (url === redirect) {
      assert.equal(mode, 'manual');
      return new Response(null, { status: 302, headers: { location: target } });
    }
    return new Response('bytes');
  });
  const first = await fetchWorld(target);
  const second = fetchWorld(redirect);
  const wait = new Promise((resolve) => setImmediate(resolve));
  await Promise.race([second, wait]);
  assert.deepEqual(started, [target, redirect]);
  await first.body.cancel();
  assert.equal(await (await second).text(), 'bytes');
  assert.deepEqual(started, [target, redirect, target]);
});

test('a connection error is retried once and a later same-host request can abort while queued', async () => {
  let attempts = 0;
  const fetchWorld = createWorldFetch(
    async () => {
      attempts++;
      if (attempts === 1) {
        throw new TypeError('fetch failed', { cause: { code: 'ETIMEDOUT' } });
      }
      return new Response('ok');
    },
    { retryDelayMs: 0 },
  );
  const first = await fetchWorld('https://data.example/slow');
  const controller = new AbortController();
  const second = fetchWorld('https://data.example/queued', {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(second, { name: 'AbortError' });
  assert.equal(attempts, 2);
  assert.equal(await first.text(), 'ok');
  const third = await fetchWorld('https://data.example/next');
  assert.equal(await third.text(), 'ok');
  assert.equal(attempts, 3);
});

test('Retry-After also gates queued requests to a rate-limited host', async () => {
  const fetchWorld = createWorldFetch(
    async () =>
      new Response('busy', {
        status: 503,
        headers: { 'Retry-After': '1' },
      }),
  );
  const busy = await fetchWorld('https://data.example/busy');
  const signal = AbortSignal.timeout(30);
  const queued = fetchWorld('https://data.example/queued', { signal });
  await busy.body.cancel();
  await assert.rejects(queued, { name: 'TimeoutError' });
});

test('an IPv6-unreachable family race switches only the affected host to IPv4', async () => {
  const attempts = [];
  const fetchWorld = createWorldFetch(
    async (url, options) => {
      attempts.push({ url, dispatcher: options.dispatcher });
      if (attempts.length === 1) {
        throw new TypeError('fetch failed', {
          cause: new AggregateError([
            { code: 'ETIMEDOUT', address: '203.0.113.9' },
            { code: 'ENETUNREACH', address: '2001:db8::5' },
          ]),
        });
      }
      return new Response('ok');
    },
    { retryDelayMs: 0 },
  );
  for (const url of [
    'https://slow.example/one',
    'https://slow.example/two',
    'https://healthy.example/three',
  ]) {
    assert.equal(await (await fetchWorld(url)).text(), 'ok');
  }
  assert.equal(attempts[0].dispatcher, undefined);
  assert.ok(attempts[1].dispatcher);
  assert.equal(attempts[2].dispatcher, attempts[1].dispatcher);
  assert.equal(attempts[3].dispatcher, undefined);
});
