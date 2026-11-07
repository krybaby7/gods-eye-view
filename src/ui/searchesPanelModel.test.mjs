import assert from 'node:assert/strict';
import test from 'node:test';
import {
  askDisabledReason,
  formatRunUsage,
  groupSearches,
  searchFindingSections,
} from './searchesPanelModel.js';

test('pinned searches stay first and the remaining groups follow latest activity', () => {
  const searches = [
    { id: 'old', label: 'Crypto', createdAt: '2026-11-05T08:00:00' },
    {
      id: 'today',
      label: 'Markets',
      createdAt: '2026-11-01T08:00:00',
      run: { finishedAt: '2026-11-07T09:00:00' },
    },
    { id: 'yesterday', label: 'Gold', createdAt: '2026-11-06T08:00:00' },
    {
      id: 'pinned',
      label: 'Copper',
      createdAt: '2026-11-01T08:00:00',
      pinned: true,
    },
  ];
  const now = new Date('2026-11-07T10:00:00');
  const groups = groupSearches(searches, '', now);
  assert.deepEqual(
    groups.map(({ label, searches }) => [label, searches.map(({ id }) => id)]),
    [
      ['Pinned', ['pinned']],
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
      ['Nov 5, 2026', ['old']],
    ],
  );
  assert.deepEqual(
    groupSearches(searches, ' mArK ', now)[0].searches.map(({ id }) => id),
    ['today'],
  );
});

test('Ask explains missing input, over-limit questions and unavailable Claude', () => {
  const ready = { installed: true, signedIn: true };
  assert.match(askDisabledReason('', ready), /question/i);
  assert.match(askDisabledReason('x'.repeat(501), ready), /500/);
  assert.match(
    askDisabledReason('Gold news?', { installed: false }),
    /install/i,
  );
  assert.match(
    askDisabledReason('Gold news?', { installed: true, signedIn: false }),
    /sign in/i,
  );
  assert.match(
    askDisabledReason('Gold news?', { ...ready, busy: true }),
    /busy/i,
  );
  assert.equal(
    askDisabledReason('Gold news?', {
      ...ready,
      disabledReason: 'Disabled by owner',
    }),
    'Disabled by owner',
  );
  assert.equal(askDisabledReason('Gold news?', ready), '');
});

test('run usage shows reported fields and omits unknowns', () => {
  assert.equal(
    formatRunUsage({
      agent: 'claude',
      usage: {
        durationMs: 62100,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      },
    }),
    'Claude · 1:02',
  );
  assert.equal(
    formatRunUsage({
      agent: 'claude',
      usage: {
        durationMs: 0,
        inputTokens: 1234,
        outputTokens: 12,
        costUsd: 0.0012,
      },
    }),
    'Claude · 0:00 · 1,234 input tokens · 12 output tokens · $0.0012',
  );
});

test('finding sections apply group and hotspot filters and separate list-only and earlier findings', () => {
  const mapped = {
    id: 'a',
    groupId: 'g1',
    location: {},
    hotspot: { key: 'place' },
  };
  const listOnly = { id: 'b', groupId: 'g1' };
  const earlier = { ...mapped, id: 'c' };
  const search = {
    run: { answer: { groups: [{ id: 'g1', label: 'Markets' }] } },
    findings: [mapped, listOnly, { ...mapped, id: 'd', groupId: 'g2' }],
    earlierFindings: [earlier],
  };
  const collect = (sections) =>
    sections.map(({ label, findings }) => [
      label,
      findings.map(({ id }) => id),
    ]);
  assert.deepEqual(collect(searchFindingSections(search, 'g1')), [
    ['Markets', ['a']],
    ['Not on the globe', ['b']],
    ['Earlier findings', ['c']],
  ]);
  assert.deepEqual(
    collect(searchFindingSections(search, 'g1', { key: 'place' })),
    [
      ['Markets', ['a']],
      ['Earlier findings', ['c']],
    ],
  );
});

test('history rows group by the latest attempted run even when it failed', () => {
  const search = {
    id: 'sr_failed',
    label: 'A search',
    status: 'failed',
    run: { finishedAt: '2026-11-05T05:00:00Z' },
    runs: [
      { finishedAt: '2026-11-05T05:00:00Z' },
      { finishedAt: '2026-11-07T05:00:00Z' },
    ],
  };
  assert.equal(
    groupSearches([search], '', new Date('2026-11-07T14:00:00Z'))[0].label,
    'Today',
  );
});

test('Today and Yesterday follow the browser calendar around local midnight', (t) => {
  const originalZone = process.env.TZ;
  process.env.TZ = 'Europe/Paris';
  t.after(() => {
    if (originalZone == null) delete process.env.TZ;
    else process.env.TZ = originalZone;
  });
  const searches = [
    { id: 'today', createdAt: '2026-10-25T23:15:00Z' },
    { id: 'yesterday', createdAt: '2026-10-25T22:50:00Z' },
  ];
  const now = new Date('2026-10-25T23:30:00Z');
  assert.deepEqual(
    groupSearches(searches, '', now).map(({ label, searches }) => [
      label,
      searches.map(({ id }) => id),
    ]),
    [
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
    ],
  );
});
