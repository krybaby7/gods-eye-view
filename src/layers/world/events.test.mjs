import assert from 'node:assert/strict';
import test from 'node:test';
import {
  startLiveTimers,
  flagLabels,
  liveFlags,
  liveFlagNotes,
} from './events.js';

test('saved per-million UCDP flags remain hidden until raw totals are available', () => {
  const flags = [
    { sourceId: 'live-ucdp-saved', iso3: 'IND', slot: 'C2', label: 'old rate' },
    {
      sourceId: 'live-ucdp-saved',
      iso3: 'IND',
      slot: 'C2',
      label: 'draft flag',
      recordedDeaths: 25,
    },
    {
      sourceId: 'live-gdelt',
      iso3: 'IND',
      slot: 'C2',
      label: 'reported event',
    },
  ];
  const snapshot = { features: { test: { flags } } };
  assert.deepEqual(liveFlags(snapshot, 'IND', 'C2'), flags.slice(1));
});

function timerHarness() {
  let time = 0;
  let timer;
  return {
    clock: () => time,
    setTimer: (callback, delay) => (
      (timer = { callback, at: time + delay }),
      1
    ),
    clearTimer: () => {
      timer = undefined;
    },
    pending: () => timer,
    async step() {
      const next = timer;
      timer = undefined;
      time = next.at;
      await next.callback();
    },
  };
}

test('timed feeds defer while a turn is busy and advance without a new turn', async () => {
  const clock = timerHarness();
  let snapshot = { progress: true, turn: { number: 1, sources: [] } };
  const seen = [];
  const controller = new AbortController();
  const dispose = startLiveTimers({
    ...clock,
    signal: controller.signal,
    snapshot: () => snapshot,
    feeds: { first: 10, second: 10 },
    retryMs: 5,
    refresh: async (id) => {
      seen.push(id);
      return true;
    },
  });
  await clock.step();
  assert.deepEqual(seen, []);
  snapshot = { ...snapshot, progress: false };
  await clock.step();
  assert.deepEqual(seen, ['first']);
  snapshot = { progress: true, turn: { number: 1, sources: [] } };
  await clock.step();
  snapshot = {
    progress: false,
    turn: { number: 1, sources: [] },
  };
  await clock.step();
  assert.deepEqual(seen, ['first', 'second']);
  controller.abort();
  assert.equal(clock.pending(), undefined);
  dispose();
});

test('fixture mode installs no timer and draft labels include source and date', () => {
  const clock = timerHarness();
  const dispose = startLiveTimers({
    ...clock,
    fixtures: true,
    refresh() {
      assert.fail('Fixture scheduled a request');
    },
  });
  assert.equal(clock.pending(), undefined);
  dispose();
  const snapshot = {
    features: {
      source: {
        flags: [
          {
            iso3: 'IND',
            slot: 'C5',
            label: 'In debt distress',
            date: '2026-03',
            sourceName: 'IMF DSA',
            reviewed: false,
          },
        ],
      },
    },
  };
  assert.deepEqual(flagLabels(snapshot, 'IND', 'C5'), [
    'In debt distress · IMF DSA · 2026-03 · Draft, not yet reviewed',
  ]);
  assert.deepEqual(flagLabels(snapshot, 'IND', 'C3'), []);
});

test('a skipped scoped check backs off and lets the next overdue feed run', async () => {
  const clock = timerHarness();
  const snapshot = { progress: false, turn: { number: 2, sources: [] } };
  const seen = [];
  const dispose = startLiveTimers({
    ...clock,
    snapshot: () => snapshot,
    feeds: { first: 100, second: 100 },
    retryMs: 5,
    refresh: async (id) => {
      seen.push(id);
      return true;
    },
  });
  for (let i = 0; i < 2; i += 1) await clock.step();
  assert.deepEqual(seen, ['first', 'second']);
  await clock.step();
  assert.equal(clock.pending().at, 200);
  await clock.step();
  assert.deepEqual(seen, ['first', 'second', 'first']);
  dispose();
});

test('two nearby feeds retain rejected ticks without blocking one another', async () => {
  const clock = timerHarness();
  const snapshot = { progress: null, turn: { number: 2 } };
  const calls = [];
  let rejectFirst = true;
  const dispose = startLiveTimers({
    ...clock,
    snapshot: () => snapshot,
    feeds: { first: 100, second: 102 },
    retryMs: 5,
    refresh: async (id) => {
      calls.push([id, clock.clock()]);
      if (id !== 'first' || !rejectFirst) return true;
      rejectFirst = false;
      return false;
    },
  });
  for (let i = 0; i < 3; i++) await clock.step();
  assert.deepEqual(calls, [
    ['first', 100],
    ['second', 105],
    ['first', 110],
  ]);
  dispose();
});

test('dated stale, expired and cleared flags keep separate labels and evidence', () => {
  const base = {
    iso3: 'CAN',
    label: 'Protest reports',
    evidence: 'news-derived, low confidence',
    sourceName: 'GDELT',
    rule: '5 events from 3 source domains in 72 hours',
    ruleReviewed: false,
  };
  const snapshot = {
    features: {
      feed: {
        flags: [
          {
            ...base,
            status: 'stale',
            staleSince: '2026-11-09T15:00:00Z',
            lastGoodAt: '2026-11-09T14:00:00Z',
          },
        ],
        inactiveFlags: [
          { ...base, status: 'no-recent-data' },
          { ...base, status: 'cleared' },
        ],
      },
    },
  };
  const labels = flagLabels(snapshot, 'CAN');
  assert.equal(labels.length, 2);
  assert.match(
    labels[0],
    /stale since 2026-11-09T15:00:00Z.*last good 2026-11-09T14:00:00Z.*news-derived, low confidence.*5 events.*Draft/i,
  );
  assert.match(labels[1], /no recent data/i);
  assert.deepEqual(
    liveFlagNotes(liveFlags(snapshot, 'CAN').at(-1))[0],
    'Cleared',
  );
});
