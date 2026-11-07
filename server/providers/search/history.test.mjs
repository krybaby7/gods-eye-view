import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRunSnapshot, compareRuns, listSearchDays } from './history.js';

const search = {
  id: 'sr_history',
  createdAt: '2026-11-03T10:00:00Z',
  status: 'failed',
  runs: [
    {
      id: 'ask',
      status: 'ok',
      finishedAt: '2026-11-04T09:00:00Z',
      findingIds: ['a', 'b'],
    },
    {
      id: 'update',
      status: 'ok',
      finishedAt: '2026-11-05T09:00:00Z',
      findingIds: ['b', 'c'],
    },
    {
      id: 'fail',
      status: 'failed',
      finishedAt: '2026-11-06T01:00:00+03:00',
      findingIds: [],
    },
  ],
  findings: [
    { id: 'a', firstRunId: 'ask' },
    { id: 'b', firstRunId: 'ask', lastSeenAt: '2026-11-05T09:00:00Z' },
    { id: 'c', firstRunId: 'update' },
  ],
  sources: [
    { id: 's1', firstRunId: 'ask' },
    { id: 's2', firstRunId: 'update' },
  ],
};

test('past day excludes later findings and rewinds recency', () => {
  assert.equal(buildRunSnapshot(search, { asOf: '2026-11-02' }), null);
  const snapshot = buildRunSnapshot(search, { asOf: '2026-11-04' });
  assert.equal(snapshot.run.id, 'ask');
  assert.equal(snapshot.status, 'ready');
  assert.deepEqual(
    snapshot.findings.map((f) => [f.id, f.fresh]),
    [
      ['a', true],
      ['b', true],
    ],
  );
  assert.equal(snapshot.findings[1].lastSeenAt, '2026-11-04T09:00:00Z');
  assert.deepEqual(snapshot.earlierFindings, []);
  assert.deepEqual(
    snapshot.sources.map((s) => s.id),
    ['s1'],
  );
  assert.deepEqual(
    snapshot.runs.map((r) => r.id),
    ['ask'],
  );
  assert.equal(search.findings[1].lastSeenAt, '2026-11-05T09:00:00Z');
});

test('current projection retains the last answer after an update failure', () => {
  const snapshot = buildRunSnapshot(search);
  assert.equal(snapshot.run.id, 'update');
  assert.equal(snapshot.runs.at(-1).id, 'fail');
  assert.deepEqual(
    snapshot.findings.map((f) => [f.id, f.fresh]),
    [
      ['b', false],
      ['c', true],
    ],
  );
  assert.deepEqual(
    snapshot.earlierFindings.map((f) => f.id),
    ['a'],
  );
  assert.equal(buildRunSnapshot(search, { runId: 'missing' }), null);
  assert.equal(buildRunSnapshot(search, { runId: 'fail' }).run.id, 'fail');
});

test('history days use UTC and run changes compare finding IDs', () => {
  assert.deepEqual(listSearchDays([search, search]), [
    '2026-11-05',
    '2026-11-04',
  ]);
  const changes = compareRuns(search, 'ask', 'update');
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(changes).map(([key, values]) => [
        key,
        values.map((f) => f.id),
      ]),
    ),
    { added: ['c'], seenAgain: ['b'], notSeenSince: ['a'] },
  );
  assert.equal(compareRuns(search, 'missing', 'update'), null);
  assert.equal(compareRuns(search, 'ask', 'fail'), null);
});

test('comparison does not show recency from runs after the target', () => {
  const later = {
    ...search,
    runs: [
      ...search.runs,
      {
        id: 'later',
        status: 'ok',
        finishedAt: '2026-11-08T09:00:00Z',
        findingIds: ['a', 'b'],
      },
    ],
    findings: search.findings.map((finding) => ({
      ...finding,
      lastSeenAt: '2026-11-08T09:00:00Z',
    })),
  };
  const changes = compareRuns(later, 'ask', 'update');
  assert.equal(changes.notSeenSince[0].lastSeenAt, '2026-11-04T09:00:00Z');
  assert.equal(changes.seenAgain[0].lastSeenAt, '2026-11-05T09:00:00Z');
});
