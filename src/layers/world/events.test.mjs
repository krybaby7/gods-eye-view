import assert from 'node:assert/strict';
import test from 'node:test';
import { startLiveTimers, flagLabels } from './events.js';

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

test('timed feeds defer while a turn is busy and advance only after their own source turn', async () => {
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
    turn: { number: 2, sources: [{ id: 'first' }] },
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
