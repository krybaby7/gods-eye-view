import assert from 'node:assert/strict';
import test from 'node:test';
import { createNewsSource } from './source.js';
import {
  filterNewsStories,
  formatUsdShort,
  normalizeHiddenCategories,
  normalizeNewsSnapshot,
} from './records.js';

const minimal = {
  revision: '1.0',
  theater: {
    id: 'iran-israel-us',
    name: 'T',
    categories: [{ id: 'war-military', label: 'War', color: '#ef4444' }],
  },
  items: [
    {
      id: 'i1',
      title: 'Headline',
      url: 'javascript:alert(1)',
      folder: 'gossip',
      publishedAt: 'not a date',
    },
    { id: 2, title: 'bad id' },
  ],
  stories: [
    {
      id: 'st_1',
      title: 'Story',
      verification: 'proven',
      location: { lat: 95, lon: 0 },
      claims: [{ text: 'x', status: 'nope' }],
    },
  ],
};

test('construction makes no request; snapshots carry theater and revision', async () => {
  const calls = [];
  const source = createNewsSource({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json(minimal);
    },
  });
  assert.equal(calls.length, 0);
  const snapshot = await source.getSnapshot({
    theater: 'iran-israel-us',
    rev: '0.9',
  });
  assert.equal(calls[0].url, '/api/news?theater=iran-israel-us&rev=0.9');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(snapshot.revision, '1.0');
  assert.equal(
    snapshot.items.length,
    1,
    'records without a string id are dropped',
  );
  assert.equal(snapshot.items[0].url, null, 'non-http links are removed');
  assert.equal(snapshot.items[0].folder, 'reporting');
  assert.equal(snapshot.items[0].publishedAt, null);
  assert.equal(snapshot.stories[0].verification, 'reported');
  assert.equal(snapshot.stories[0].location, null);
  assert.equal(snapshot.stories[0].claims[0].status, 'reported');
});

test('unchanged and malformed answers', async () => {
  const unchanged = createNewsSource({
    fetchImpl: async () => Response.json({ unchanged: true, revision: '1.0' }),
  });
  assert.deepEqual(await unchanged.getSnapshot(), {
    unchanged: true,
    revision: '1.0',
  });
  const malformed = createNewsSource({
    fetchImpl: async () => Response.json({ items: [] }),
  });
  await assert.rejects(malformed.getSnapshot(), /Malformed news snapshot/);
  const down = createNewsSource({
    fetchImpl: async () => new Response('', { status: 500 }),
  });
  await assert.rejects(down.getSnapshot(), /News HTTP 500/);
  assert.equal(normalizeNewsSnapshot(null), null);
});

test('digest outcomes: 503 no_key maps to keyRequired; refusals are outcomes', async () => {
  const answer = (status, body) =>
    createNewsSource({
      fetchImpl: async () => Response.json(body, { status }),
    });
  let request;
  const ok = createNewsSource({
    fetchImpl: async (url, init) => {
      request = { url, init };
      return Response.json({
        ok: true,
        run: { id: 'run_1' },
        budget: { remainingUsd: 1 },
      });
    },
  });
  assert.deepEqual(await ok.requestDigest({ theater: 'iran-israel-us' }), {
    ok: true,
    run: { id: 'run_1' },
    budget: { remainingUsd: 1 },
  });
  assert.equal(request.url, '/api/news/digest?theater=iran-israel-us');
  assert.equal(request.init.method, 'POST');
  assert.deepEqual(
    await answer(503, { error: 'no_key', keyRequired: true }).requestDigest(),
    {
      ok: false,
      keyRequired: true,
      error: 'no_key',
    },
  );
  assert.deepEqual(await answer(409, { error: 'in_flight' }).requestDigest(), {
    ok: false,
    status: 409,
    error: 'in_flight',
    message: null,
    run: null,
  });
  assert.equal(
    (
      await answer(429, {
        error: 'over_budget',
        reason: 'Spent',
      }).requestDigest()
    ).message,
    'Spent',
  );
  assert.deepEqual(
    await answer(200, {
      skipped: true,
      message: 'Nothing new',
      run: { id: 'r' },
    }).requestDigest(),
    {
      ok: true,
      skipped: true,
      message: 'Nothing new',
      run: { id: 'r' },
    },
  );
});

test('category filter values normalize to a sorted comma list', () => {
  assert.equal(
    normalizeHiddenCategories([
      'war-military',
      'environmental',
      'war-military',
    ]),
    'environmental,war-military',
  );
  assert.equal(normalizeHiddenCategories('b,a,Bad Id,'), 'a,b');
  assert.equal(normalizeHiddenCategories(null), '');
  const stories = [{ category: 'a' }, { category: 'b' }];
  assert.deepEqual(filterNewsStories(stories, new Set(['a'])), [
    { category: 'b' },
  ]);
  assert.equal(filterNewsStories(stories, new Set()), stories);
});

test('costs read as cents, budgets as dollars', () => {
  assert.equal(formatUsdShort(0.18), '18¢');
  assert.equal(formatUsdShort(0.004), '<1¢');
  assert.equal(formatUsdShort(0), '0¢');
  assert.equal(formatUsdShort(1.4251), '$1.43');
  assert.equal(formatUsdShort(null), '—');
});
