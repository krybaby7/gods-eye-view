import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPortWatch,
  createPortWatchAdapter,
  shiftDay,
} from './portwatch.js';
import { parseFred, shouldCheck as checkFred } from './fred.js';
import { readEnergyReference, dependencyShares } from '../dependencies.js';

import { loadWorldRegistry } from '../registry.js';
import { worldAdapters } from '../refreshRegistry.js';

const end = '2026-10-31';
const id = 'chokepoint6';
const gate = { id, name: 'Strait of Hormuz', coordinates: [56, 26] };
function sampleDays() {
  return Array.from({ length: 400 }, (_, i) => ({
    id,
    date: shiftDay(end, i - 399),
    counts: { total: i >= 387 ? 3 : 60 },
  }));
}

test('PortWatch separates low traffic from a corroborated disruption', () => {
  const days = sampleDays();
  const build = (samples, events = []) =>
    buildPortWatch({ metadata: [gate], days: samples, events, dataTo: end })
      .gates[0];
  assert.equal(build(days).status, 'reduced');
  assert.equal(build(days).ratio7, 0.05);
  assert.equal(build(days).ratio28, (15 * 60 + 13 * 3) / (28 * 60));
  const event = {
    id: 'Hormuz event',
    from: '2026-10-01',
    to: null,
    gates: [id],
  };
  assert.equal(build(days, [event]).status, 'disrupted');
  assert.equal(build(days, [{ ...event, to: '2026-10-30' }]).status, 'reduced');
  assert.equal(
    build(days, [{ ...event, gates: ['chokepoint60'] }]).status,
    'reduced',
  );
  assert.notEqual(
    build(days.filter((d) => d.date !== shiftDay(end, -12))).status,
    'reduced',
  );
  assert.equal(build(days.filter((d) => d.date !== end)).status, 'unknown');
});

test('PortWatch refuses automated traffic requests without owner permission', async () => {
  const adapter = createPortWatchAdapter(() => false);
  const result = await adapter.fetchObservations({
    fetchImpl: () => assert.fail('Unexpected automated extraction'),
  });
  assert.equal(result.data.mode, 'permission-required');
});

test('PortWatch paginates initial data and revises overlapping days without reloading metadata', async () => {
  const calls = [];
  const response = (attributes, exceededTransferLimit = false) =>
    new Response(
      JSON.stringify({
        features: attributes.map((value) => ({ attributes: value })),
        exceededTransferLimit,
      }),
    );
  const adapter = createPortWatchAdapter(() => true);
  const now = new Date('2026-11-02T00:00:00Z');
  let revising = false;
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (url.pathname.includes('chokepoints_database'))
      return response([{ portid: id, portname: gate.name, lon: 56, lat: 26 }]);
    if (url.pathname.includes('disruptions_database')) return response([]);
    if (url.searchParams.has('outStatistics')) return response([{ maxd: end }]);
    const row = {
      portid: id,
      date: end,
      n_total: revising ? 9 : 3,
      n_tanker: 2,
      capacity: 900,
    };
    if (revising) return response([row]);
    return url.searchParams.get('resultOffset') === '0'
      ? response([{ ...row, date: shiftDay(end, -1) }], true)
      : response([row]);
  };
  const first = await adapter.fetchObservations({ fetchImpl, now });
  assert.equal(first.data.gates[0].days.length, 2);
  assert.equal(first.data.gates[0].days.at(-1).counts.tanker, 2);
  assert.ok(!('capacity' in first.data.gates[0].days.at(-1)));
  assert.ok(
    calls.some((url) =>
      new URL(url).searchParams.get('where')?.includes(shiftDay(end, -399)),
    ),
  );
  calls.length = 0;
  revising = true;
  const next = await adapter.fetchObservations({
    fetchImpl,
    now,
    data: first.data,
  });
  assert.equal(next.data.gates[0].days.at(-1).counts.total, 9);
  assert.ok(!calls.some((url) => url.includes('chokepoints_database')));
  assert.ok(
    calls.some((url) =>
      new URL(url).searchParams.get('where')?.includes(shiftDay(end, -13)),
    ),
  );
});

test('monthly FRED values remain in their source units and missing cells are omitted', () => {
  const series = parseFred(
    'observation_date,MCOILBRENTEU,MCOILWTICO,PNGASEUUSDM\n2026-06-01,81.25,.,12\n2026-07-01,,76.6,13.2\n',
  );
  assert.deepEqual(series.MCOILBRENTEU, [{ month: '2026-06', value: 81.25 }]);
  assert.deepEqual(series.MCOILWTICO, [{ month: '2026-07', value: 76.6 }]);
});

test('curated EIA data includes checked draft rows and actual Panama periods', async () => {
  const reference = await readEnergyReference();
  assert.equal(reference.rows.length, 90);
  assert.ok(
    reference.rows.every((row) => row.sourceUrl && row.reviewed === false),
  );
  assert.equal(
    reference.rows.find((row) => row.routeId === 'panama' && row.year === 2025)
      .period,
    'FY2025',
  );
});

test('dependency shares use separate positive denominators and never exceed one', () => {
  assert.deepEqual(
    dependencyShares({ crossing: 30, seaborne: 60, total: 100 }),
    { seaborne: 0.5, all: 0.3 },
  );
  assert.deepEqual(
    dependencyShares({ crossing: 30, seaborne: null, total: 20 }),
    { seaborne: null, all: null },
  );
});

test('registers all four energy source rows with active adapters', async () => {
  const { sources } = await loadWorldRegistry();
  for (const id of [
    'portwatch',
    'eia-chokepoints',
    'fred',
    'energy-dependencies',
  ]) {
    assert.equal(sources.filter((source) => source.id === id).length, 1);
    assert.equal(typeof worldAdapters[id].fetchObservations, 'function');
  }
});

test('FRED can check after a new day within the same release month', () => {
  const lastCheckedAt = '2026-11-01T01:00:00Z';
  assert.equal(
    checkFred({ lastCheckedAt, now: new Date('2026-11-01T23:00:00Z') }),
    false,
  );
  assert.equal(
    checkFred({ lastCheckedAt, now: new Date('2026-11-02T01:00:00Z') }),
    true,
  );
});

test('rolling revisions preserve verified status transitions older than the recomputable window', () => {
  const history = [{ date: '2026-09-15', status: 'reduced' }];
  const { gates } = buildPortWatch({
    metadata: [gate],
    days: sampleDays(),
    events: [],
    dataTo: end,
    previousGates: [{ id, history }],
  });
  assert.deepEqual(gates[0].history[0], history[0]);
  assert.equal(gates[0].history.at(-1).status, 'reduced');
});
