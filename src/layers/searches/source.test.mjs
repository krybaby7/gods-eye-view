import assert from 'node:assert/strict';
import test from 'node:test';

import { createSearchesSource } from './source.js';

test('search source builds history queries and uses revision responses without replacing records', async () => {
  const calls = [];
  const source = createSearchesSource({
    timeZone: 'Europe/Paris',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ unchanged: true, revision: '4' });
    },
  });
  assert.deepEqual(await source.getSnapshot({ rev: '4', asOf: '2026-11-06' }), {
    unchanged: true,
    revision: '4',
  });
  assert.equal(
    calls[0].url,
    '/api/searches?rev=4&asOf=2026-11-06&timeZone=Europe%2FParis',
  );
  assert.equal(calls[0].options.cache, 'no-store');
});

test('search source sends only patch fields and reports server refusals', async () => {
  const source = createSearchesSource({
    fetchImpl: async (url, options) => {
      assert.equal(url, '/api/searches/sr_0123');
      assert.equal(options.method, 'PATCH');
      assert.deepEqual(JSON.parse(options.body), { visible: true });
      return Response.json(
        { error: 'visible_limit', reason: 'Hide a search first' },
        { status: 409 },
      );
    },
  });
  await assert.rejects(
    source.action('patch', { id: 'sr_0123', visible: true }),
    { message: 'Hide a search first', code: 'visible_limit', status: 409 },
  );
});
