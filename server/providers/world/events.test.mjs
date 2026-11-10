import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conditionFlag,
  conditionResult,
  liveFeatureView,
  monthlyCpiFlags,
  fxFlags,
} from './conditionEvents.js';

const source = 'https://example.org/data';
const now = new Date('2026-11-09T08:00:00Z');

test('flag transitions set and clear with dated event evidence and never emit observations', () => {
  const flag = conditionFlag('test', {
    iso3: 'IND',
    slot: 'C3',
    label: 'Red disaster alert',
    date: '2026-11-08',
    source,
  });
  const first = conditionResult([flag], null, now);
  assert.deepEqual(first.changes, [
    {
      iso3: 'IND',
      text: 'Flag set · Red disaster alert',
      kind: 'condition-flag',
      action: 'set',
    },
  ]);
  assert.equal(first.observations, undefined);
  assert.equal(first.data.events[0].stage, 'observed');
  assert.equal(first.data.events[0].eventTime, '2026-11-08');
  assert.deepEqual(first.data.events[0].sources, [source]);
  assert.equal(first.data.events[0].sets[0].status, 'set');

  const clear = conditionResult([], first.data, now);
  assert.equal(clear.data.flags.length, 0);
  assert.deepEqual(clear.changes, [
    {
      iso3: 'IND',
      text: 'Flag cleared · Red disaster alert',
      kind: 'condition-flag',
      action: 'cleared',
    },
  ]);
  assert.equal(clear.data.events.at(-1).stage, 'reversed');
  assert.equal(clear.data.events.at(-1).sets[0].status, 'cleared');
});

test('failed pulls show the last good time and aging flags show no recent data', () => {
  const flag = conditionFlag('live-gdelt', {
    iso3: 'IND',
    slot: 'C2',
    date: '2026-11-09T00:00:00.000Z',
    label: 'Reports',
    source,
  });
  const first = conditionResult([flag], null, now);
  const health = {
    lastGoodAt: now.toISOString(),
    staleSince: '2026-11-09T09:00:00.000Z',
  };
  const stale = liveFeatureView(
    'live-gdelt',
    first.data,
    health,
    new Date('2026-11-09T09:00:00Z'),
  );
  assert.equal(stale.flags[0].status, 'stale');
  assert.equal(stale.flags[0].lastGoodAt, health.lastGoodAt);
  assert.equal(stale.flags[0].staleSince, health.staleSince);
  const later = new Date('2026-11-12T01:00:00Z');
  const aged = liveFeatureView('live-gdelt', first.data, health, later);
  assert.equal(aged.flags[0].status, 'no-recent-data');
  const next = conditionResult([], first.data, later);
  assert.deepEqual(next.changes, []);
  assert.equal(next.data.inactiveFlags[0].status, 'no-recent-data');
  const beyondRetention = new Date('2026-11-16T00:00:00Z');
  assert.deepEqual(
    liveFeatureView('live-gdelt', first.data, health, beyondRetention).flags,
    [],
  );
  assert.deepEqual(
    liveFeatureView('live-gdelt', next.data, health, beyondRetention).flags,
    [],
  );
  assert.deepEqual(
    conditionResult([], next.data, beyondRetention).data.inactiveFlags,
    [],
  );
});

test('FX uses the inverse USD quote and ignores stale and incomplete windows', () => {
  const rows = [
    { date: '2026-10-08', quote: 'INR', rate: 80 },
    { date: '2026-11-07', quote: 'INR', rate: 100 },
    { date: '2026-10-08', quote: 'JPY', rate: 100 },
    { date: '2026-11-07', quote: 'JPY', rate: 120 },
    { date: '2026-11-01', quote: 'ABC', rate: 40 },
    { date: '2026-11-07', quote: 'ABC', rate: 100 },
    { date: '2026-09-29', quote: 'XYZ', rate: 40 },
    { date: '2026-10-29', quote: 'XYZ', rate: 100 },
  ];
  const flags = fxFlags(
    rows,
    { INR: ['IND'], JPY: ['JPN'], ABC: ['ABC'], XYZ: ['XYZ'] },
    now,
    source,
  );
  assert.deepEqual(
    flags.map(({ iso3, date, slot }) => [iso3, date, slot]),
    [['IND', '2026-11-07', 'C5']],
  );
  assert.match(flags[0].label, /20%/);
  assert.equal(flags[0].periodStart, '2026-10-08');
});

test('CPI requires the same calendar month one year earlier and uses a draft 20% threshold', () => {
  const flags = monthlyCpiFlags(
    [
      { iso3: 'ARG', period: '2025-09', value: 100 },
      { iso3: 'ARG', period: '2026-09', value: 120 },
      { iso3: 'IND', period: '2025-08', value: 100 },
      { iso3: 'IND', period: '2026-09', value: 145 },
    ],
    now,
    source,
  );
  assert.deepEqual(
    flags.map(({ iso3, slot, date }) => [iso3, slot, date]),
    [['ARG', 'C4', '2026-09']],
  );
  assert.match(flags[0].label, /20\.0%.*draft/i);
});
