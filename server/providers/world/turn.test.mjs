import assert from 'node:assert/strict';
import test from 'node:test';

const startedAt = '2026-11-08T10:00:00Z';
const endedAt = '2026-11-08T10:00:05Z';
const sources = [
  { id: 'worldbank', status: 'loaded', checked: true, count: 10 },
  { id: 'imf', status: 'skipped', checked: false, count: 0 },
  {
    id: 'vdem',
    status: 'failed',
    checked: true,
    count: 0,
    error: 'request timed out',
  },
];

test('records first-load counts and source failures in source order', async () => {
  const { createTurn } = await import('./turn.js');
  const turn = createTurn({
    number: 1,
    startedAt,
    endedAt,
    sources,
    previous: null,
    countries: {},
    newObservations: 10,
  });
  assert.equal(turn.number, 1);
  assert.equal(turn.startedAt, startedAt);
  assert.equal(turn.endedAt, endedAt);
  assert.deepEqual(turn.sources, sources);
  assert.equal(turn.newObservations, 10);
  assert.ok(turn.changes.every(({ iso3 }) => iso3 === null));
  assert.match(turn.changes[0].text, /World Bank.*10/);
  assert.match(turn.changes[1].text, /IMF.*skipped/i);
  assert.match(turn.changes[2].text, /V-Dem.*request timed out/i);
});

test('reports revised readings and ignores changes to retrieval time alone', async () => {
  const { createTurn } = await import('./turn.js');
  const country = (value, retrievedAt) => ({
    iso3: 'FIN',
    name: 'Finland',
    slots: {
      C1: { score: 100, period: '2025', observation: { value, retrievedAt } },
    },
    condition: { score: 100, slot: 'C1' },
  });
  const previous = { FIN: country(101, startedAt) };
  const options = {
    number: 2,
    startedAt,
    endedAt,
    sources: [],
    previous,
    newObservations: 1,
  };
  const revised = createTurn({
    ...options,
    countries: { FIN: country(102, endedAt) },
  });
  assert.deepEqual(
    revised.changes.map(({ iso3 }) => iso3),
    ['FIN'],
  );
  assert.match(revised.changes[0].text, /Finland.*C1.*101.*102/);
  const same = createTurn({
    ...options,
    countries: { FIN: country(101, endedAt) },
  });
  assert.deepEqual(
    same.changes.map(({ iso3 }) => iso3),
    [null],
  );
  assert.match(same.changes[0].text, /No country changes/);
});
