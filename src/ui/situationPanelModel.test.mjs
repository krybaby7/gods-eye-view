import assert from 'node:assert/strict';
import test from 'node:test';
import {
  citedItems,
  degradedSources,
  filterRawItems,
  folderCounts,
  formatDigestLine,
  formatElapsed,
  formatSituationTime,
  itemDigestState,
  listOnlyCount,
  rawFilterOptions,
  refreshState,
  tabCounts,
  verificationLabel,
} from './situationPanelModel.js';

const NOW = Date.parse('2026-10-26T14:30:00Z');
const UTC = { timeZone: 'UTC' };
const item = (id, overrides = {}) => ({
  id,
  folder: 'reporting',
  perspective: 'international-wire',
  language: 'en',
  digestedAt: null,
  storyId: null,
  ...overrides,
});
const snapshot = (overrides = {}) => ({
  ready: true,
  stories: [
    { id: 'a', status: 'open', location: { lat: 1, lon: 1 } },
    { id: 'b', status: 'open', location: null },
    { id: 'c', status: 'closed', location: null },
  ],
  visibleStories: [
    { id: 'a', status: 'open' },
    { id: 'c', status: 'closed' },
  ],
  items: [
    item('1', { digestedAt: '2026-10-26T14:02:00Z', storyId: 'a' }),
    item('2', { digestedAt: '2026-10-26T14:02:00Z' }),
    item('3', { folder: 'official', perspective: 'us-mil' }),
    item('4', { folder: 'local', language: 'ar', perspective: 'palestinian' }),
  ],
  lastDigest: { id: 'run_1', status: 'ok', finishedAt: '2026-10-26T14:02:00Z' },
  budget: {
    dailyUsd: 2,
    spentTodayUsd: 0.58,
    remainingUsd: 1.42,
    lastRunCostUsd: 0.18,
  },
  digest: { running: false, disabledReason: null },
  ...overrides,
});

test('timestamps: clock today, day and clock otherwise, a dash when unknown', () => {
  assert.equal(formatSituationTime('2026-10-26T14:02:00Z', NOW, UTC), '14:02');
  assert.equal(
    formatSituationTime('2026-10-25T09:05:00Z', NOW, UTC),
    '25 Oct 09:05',
  );
  assert.equal(formatSituationTime(null, NOW, UTC), '—');
  assert.equal(formatSituationTime('soon', NOW, UTC), '—');
  assert.equal(formatElapsed(23_400), '0:23');
  assert.equal(formatElapsed(65_000), '1:05');
  assert.equal(formatElapsed(-5), '0:00');
});

test('the digest line reads time, stories, items, unassigned, cost and budget', () => {
  assert.equal(
    formatDigestLine(snapshot(), NOW, UTC),
    'Digest 14:02 · 2 stories from 2 items · 1 unassigned · last run 18¢ · budget $1.42 left',
  );
  // The brief that followed the digest shows its own cost beside it.
  assert.equal(
    formatDigestLine(
      snapshot({
        budget: {
          remainingUsd: 1.3,
          lastRunCostUsd: 0.18,
          lastBriefCostUsd: 0.12,
        },
      }),
      NOW,
      UTC,
    ),
    'Digest 14:02 · 2 stories from 2 items · 1 unassigned · last run 18¢ · brief 12¢ · budget $1.30 left',
  );
  assert.equal(
    formatDigestLine(
      snapshot({
        lastDigest: null,
        budget: { remainingUsd: 2, lastRunCostUsd: null },
      }),
      NOW,
      UTC,
    ),
    'No digest yet · 4 items collected · budget $2.00 left',
  );
  assert.equal(
    formatDigestLine({ ready: false }, NOW),
    'Loading the news feed…',
  );
});

test('Refresh: idle, running with elapsed time, disabled with the reason', () => {
  assert.deepEqual(refreshState(snapshot(), NOW), {
    running: false,
    disabled: false,
    label: 'Refresh',
    reason: null,
    reasonCode: null,
  });
  const running = refreshState(
    snapshot({ digest: { running: true, startedAt: '2026-10-26T14:29:37Z' } }),
    NOW,
  );
  assert.equal(running.label, 'Digesting… 0:23');
  assert.equal(running.disabled, true);
  assert.equal(
    refreshState(
      snapshot({
        digest: {
          running: true,
          phase: 'brief',
          startedAt: '2026-10-26T14:29:37Z',
        },
      }),
      NOW,
    ).label,
    'Writing brief… 0:23',
  );
  for (const [code, pattern] of [
    ['no_key', /PERPLEXITY_API_KEY/],
    ['over_budget', /budget is used up/],
    ['nothing_new', /Nothing new/],
    ['in_flight', /running/],
  ]) {
    const state = refreshState(
      snapshot({ digest: { disabledReason: code } }),
      NOW,
    );
    assert.equal(state.disabled, true, code);
    assert.match(state.reason, pattern, code);
  }
  assert.equal(refreshState({ ready: false }, NOW).disabled, true);
});

test('counts: tabs follow the category filter, folders include zeros, list-only stories', () => {
  assert.deepEqual(tabCounts(snapshot()), { stories: 1, raw: 4 });
  assert.deepEqual(folderCounts(snapshot().items), {
    reporting: 2,
    official: 1,
    local: 1,
    'armed-group': 0,
    verification: 0,
    humanitarian: 0,
    analysis: 0,
  });
  assert.equal(listOnlyCount(snapshot().stories), 1);
  // A development has no pin even with a place, so it is list-only too.
  assert.equal(
    listOnlyCount([
      ...snapshot().stories,
      {
        id: 'd',
        status: 'open',
        kind: 'development',
        location: { lat: 1, lon: 1 },
      },
    ]),
    2,
  );
});

test('raw feed filters by folder, perspective and language', () => {
  const items = snapshot().items;
  assert.deepEqual(
    filterRawItems(items, { folder: 'reporting' }).map((i) => i.id),
    ['1', '2'],
  );
  assert.deepEqual(
    filterRawItems(items, { folder: 'local', language: 'ar' }).map((i) => i.id),
    ['4'],
  );
  assert.deepEqual(
    filterRawItems(items, { perspective: 'us-mil' }).map((i) => i.id),
    ['3'],
  );
  assert.deepEqual(
    filterRawItems(items, { folder: 'local', language: 'en' }),
    [],
  );
  assert.deepEqual(rawFilterOptions(items), {
    perspectives: ['international-wire', 'palestinian', 'us-mil'],
    languages: ['ar', 'en'],
  });
});

test('item markers: not yet digested, unassigned after digest, assigned', () => {
  const [assigned, unassigned, fresh] = snapshot().items;
  assert.equal(itemDigestState(assigned), 'assigned');
  assert.equal(itemDigestState(unassigned), 'unassigned');
  assert.equal(itemDigestState(fresh), 'not-digested');
});

test('degraded sources name the reason; cited items come from items then snapshots', () => {
  const degraded = degradedSources([
    { name: 'Middle East Eye', health: { degraded: true, blocked: true } },
    {
      name: 'Al Masirah',
      health: { degraded: true, error: 'preview markup not found' },
    },
    { name: 'IRNA', health: { degraded: false } },
    {
      name: 'US Central Command',
      health: {
        degraded: true,
        stale: true,
        quiet: true,
        newestItemAt: '2026-02-05T17:47:00.000Z',
      },
    },
    { name: 'Ynetnews', health: { degraded: true, stale: true } },
  ]);
  assert.equal(degraded.text, '4 sources degraded');
  assert.equal(
    degraded.detail,
    'Middle East Eye: blocked\nAl Masirah: preview markup not found\nUS Central Command: nothing new since 2026-02-05\nYnetnews: stale',
  );
  assert.equal(degradedSources([]).text, '');
  const story = { itemIds: ['x', '1', 'gone'] };
  assert.deepEqual(
    citedItems(
      story,
      [item('1')],
      [item('x', { title: 'kept after retention' })],
    ).map((i) => i.id),
    ['x', '1'],
  );
  assert.equal(verificationLabel('participant-claim'), 'Participant claim');
  assert.equal(verificationLabel('nonsense'), 'Reported');
});
