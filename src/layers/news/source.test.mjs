import assert from 'node:assert/strict';
import test from 'node:test';
import { createNewsSource } from './source.js';
import {
  filterNewsStories,
  formatBriefOutcome,
  formatDigestOutcome,
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
    briefRun: null,
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

const line = (text, storyIds = ['st_1']) => ({ text, storyIds });

test('the snapshot carries the brief, its run and status, and the theater actors', () => {
  const snapshot = normalizeNewsSnapshot({
    ...minimal,
    theater: {
      ...minimal.theater,
      actors: [
        {
          id: 'oman',
          name: 'Oman',
          type: 'state',
          role: 'mediator',
          aliases: ['Muscat'],
        },
        {
          id: 'saudi-arabia',
          name: 'Saudi Arabia',
          type: 'state',
          role: 'party',
          aliases: [],
          startingRole: 'external',
          roleSince: '2026-10-28T14:03:00Z',
          roleStoryIds: ['st_1'],
          changedFrom: 'external',
        },
        {
          id: 'egypt',
          name: 'Egypt',
          type: 'state',
          role: 'external',
          aliases: [],
          roleSince: '2026-10-28T14:03:00Z',
          roleStoryIds: ['st_2'],
          learned: true,
        },
        { id: 'x', name: 'Bad role', type: 'state', role: 'ally' },
        { name: 'No id' },
      ],
      drivers: [
        {
          text: 'A cause.',
          source: { name: 'CFR', url: 'https://www.cfr.org/x' },
        },
        { text: 'Bad link.', source: { name: 'X', url: 'javascript:1' } },
      ],
      tracks: [{ id: 'military', label: 'Military' }, { label: 'No id' }],
    },
    brief: {
      id: 'br_1',
      digestRunId: 'run_1',
      createdAt: '2026-10-28T14:03:00Z',
      headline: line('Headline.'),
      changes: [line('Change.'), { text: 7 }, line('Uncited.', [])],
      trigger: null,
      tracks: [
        { id: 'military', state: 'escalating', reason: 'R.', storyIds: ['a'] },
        { id: 'diplomatic', state: 'winning', reason: 'R.', storyIds: ['a'] },
      ],
      affected: [],
      scenarios: [
        {
          title: 'Talks',
          horizon: 'weeks',
          text: 'Two sentences.',
          storyIds: ['st_1'],
          signposts: [
            { text: 'Seen', seenIn: ['st_1'] },
            { text: 'Not yet', seenIn: [] },
          ],
        },
      ],
      unknowns: [line('Unknown.')],
      actorRoles: [
        {
          actorId: 'oman',
          role: 'mediator',
          text: 'Hosted.',
          storyIds: ['st_1'],
        },
        { actorId: 'oman', role: 'ally', text: 'Bad.', storyIds: ['st_1'] },
      ],
    },
    briefRun: {
      id: 'run_2',
      kind: 'brief',
      status: 'failed',
      digestRunId: 'run_1',
      error: 'truncated',
      costUsd: 0.09,
      reasoningTokens: 3100,
    },
    briefStatus: {
      digestsBehind: 1,
      retryable: true,
      retryDisabledReason: null,
    },
    budget: { lastBriefCostUsd: 0.12 },
    digest: { running: true, phase: 'brief' },
  });
  assert.deepEqual(snapshot.theater.actors, [
    {
      id: 'oman',
      name: 'Oman',
      type: 'state',
      role: 'mediator',
      aliases: ['Muscat'],
      startingRole: 'mediator',
      roleSince: null,
      roleStoryIds: [],
      changedFrom: null,
      learned: false,
    },
    {
      id: 'saudi-arabia',
      name: 'Saudi Arabia',
      type: 'state',
      role: 'party',
      aliases: [],
      startingRole: 'external',
      roleSince: '2026-10-28T14:03:00.000Z',
      roleStoryIds: ['st_1'],
      changedFrom: 'external',
      learned: false,
    },
    {
      id: 'egypt',
      name: 'Egypt',
      type: 'state',
      role: 'external',
      aliases: [],
      startingRole: 'external',
      roleSince: '2026-10-28T14:03:00.000Z',
      roleStoryIds: ['st_2'],
      changedFrom: null,
      learned: true,
    },
  ]);
  assert.deepEqual(snapshot.brief.actorRoles, [
    { actorId: 'oman', role: 'mediator', text: 'Hosted.', storyIds: ['st_1'] },
  ]);
  assert.deepEqual(snapshot.theater.drivers, [
    {
      text: 'A cause.',
      source: { name: 'CFR', url: 'https://www.cfr.org/x' },
    },
    { text: 'Bad link.', source: { name: 'X', url: null } },
  ]);
  assert.deepEqual(snapshot.theater.tracks, [
    { id: 'military', label: 'Military' },
  ]);
  const brief = snapshot.brief;
  assert.equal(brief.createdAt, '2026-10-28T14:03:00.000Z');
  assert.deepEqual(brief.changes, [line('Change.')]);
  assert.deepEqual(brief.tracks, [
    { id: 'military', state: 'escalating', reason: 'R.', storyIds: ['a'] },
    { id: 'diplomatic', state: 'unclear', reason: 'R.', storyIds: ['a'] },
  ]);
  assert.deepEqual(brief.scenarios[0].signposts[1], {
    text: 'Not yet',
    seenIn: [],
  });
  assert.equal(snapshot.briefRun.kind, 'brief');
  assert.equal(snapshot.briefRun.error, 'truncated');
  assert.equal(snapshot.briefRun.reasoningTokens, 3100);
  assert.deepEqual(snapshot.briefStatus, {
    digestsBehind: 1,
    retryable: true,
    retryDisabledReason: null,
  });
  assert.equal(snapshot.budget.lastBriefCostUsd, 0.12);
  assert.equal(snapshot.digest.phase, 'brief');
  // A brief without a headline is not a brief.
  assert.equal(
    normalizeNewsSnapshot({ ...minimal, brief: { id: 'br', headline: null } })
      .brief,
    null,
  );
  const bare = normalizeNewsSnapshot(minimal);
  assert.equal(bare.brief, null);
  assert.equal(bare.briefRun, null);
  assert.deepEqual(bare.briefStatus, {
    digestsBehind: null,
    retryable: false,
    retryDisabledReason: null,
  });
  assert.deepEqual(bare.theater.actors, []);
});

test('the Situation Brief is on unless the theater says situationBrief: false', () => {
  assert.equal(normalizeNewsSnapshot(minimal).theater.situationBrief, true);
  const off = normalizeNewsSnapshot({
    ...minimal,
    theater: { ...minimal.theater, situationBrief: false },
  });
  assert.equal(off.theater.situationBrief, false);
  const junk = normalizeNewsSnapshot({
    ...minimal,
    theater: { ...minimal.theater, situationBrief: 'no' },
  });
  assert.equal(junk.theater.situationBrief, true);
});

test('Retry brief posts to its own route; refusals are outcomes', async () => {
  let request;
  const ok = createNewsSource({
    fetchImpl: async (url, init) => {
      request = { url, init };
      return Response.json({ ok: true, briefRun: { id: 'r' }, budget: {} });
    },
  });
  assert.deepEqual(await ok.requestBrief({ theater: 'iran-israel-us' }), {
    ok: true,
    briefRun: { id: 'r' },
    budget: {},
  });
  assert.equal(request.url, '/api/news/brief?theater=iran-israel-us');
  assert.equal(request.init.method, 'POST');
  const refused = createNewsSource({
    fetchImpl: async () =>
      Response.json(
        { error: 'nothing_to_retry', message: 'Only after a failure' },
        { status: 409 },
      ),
  });
  assert.deepEqual(await refused.requestBrief(), {
    ok: false,
    status: 409,
    error: 'nothing_to_retry',
    message: 'Only after a failure',
    briefRun: null,
  });
});

test('digest and brief outcomes read as one sentence each', () => {
  const run = {
    storiesCreated: 1,
    storiesUpdated: 0,
    itemCount: 2,
    unassignedCount: 1,
    costUsd: 0.18,
  };
  const done =
    'Digest done: 1 new and 0 updated story from 2 items, 1 left unassigned. Cost 18¢.';
  assert.equal(
    formatDigestOutcome({
      ok: true,
      run,
      briefRun: { status: 'ok', costUsd: 0.12 },
    }),
    `${done} Brief written, 12¢.`,
  );
  assert.equal(
    formatDigestOutcome({
      ok: true,
      run,
      briefRun: { status: 'failed', error: 'truncated', costUsd: 0.09 },
    }),
    `${done} The brief failed (truncated) and cost 9¢; the previous brief stays.`,
  );
  assert.equal(
    formatDigestOutcome({
      ok: true,
      run,
      briefRun: {
        status: 'skipped',
        message: 'Brief skipped: $0.15 left today',
      },
    }),
    `${done} Brief skipped: $0.15 left today.`,
  );
  assert.equal(
    formatBriefOutcome({ ok: true, briefRun: { status: 'ok', costUsd: 0.1 } }),
    'Brief written, 10¢.',
  );
  assert.equal(
    formatBriefOutcome({ ok: false, error: 'nothing_to_retry' }),
    'There is no failed brief to retry.',
  );
  assert.equal(
    formatBriefOutcome({
      ok: false,
      error: 'model_error',
      briefRun: { status: 'failed', error: 'model_error', costUsd: 0 },
    }),
    'The brief failed (model_error); the previous brief stays.',
  );
});

test('costs read as cents, budgets as dollars', () => {
  assert.equal(formatUsdShort(0.18), '18¢');
  assert.equal(formatUsdShort(0.004), '<1¢');
  assert.equal(formatUsdShort(0), '0¢');
  assert.equal(formatUsdShort(1.4251), '$1.43');
  assert.equal(formatUsdShort(null), '—');
});
