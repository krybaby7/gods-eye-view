import assert from 'node:assert/strict';
import test from 'node:test';

const anchors = { a: 0, b: 100 };
const asOf = '2026-06-30T23:59:59Z';

test('transforms, clamps and reverses scores while preserving legitimate zero', async () => {
  const { scoreIndicator } = await import('./scores.js');
  assert.equal(scoreIndicator({ anchors }, 0), 0);
  assert.equal(
    scoreIndicator({ anchors, direction: 'higher-is-worse' }, -5),
    100,
  );
  assert.equal(scoreIndicator({ anchors, transform: 'log10' }, 0), 0);
  assert.equal(
    scoreIndicator(
      { anchors, transform: 'log10', direction: 'higher-is-worse' },
      0,
    ),
    100,
  );
  assert.equal(scoreIndicator({ anchors, transform: 'log10' }, -1), null);
  assert.equal(
    scoreIndicator({ anchors: { a: 0, b: 2 }, transform: 'log10' }, 10),
    50,
  );
  assert.equal(
    scoreIndicator({ anchors: { a: 0, b: 2 }, transform: 'log10p1' }, 9),
    50,
  );
  assert.equal(scoreIndicator({ anchors }, null), null);
});

function indicator(slot, fields = {}) {
  return {
    id: slot,
    slot,
    section: slot.startsWith('C') ? 'condition' : 'strength',
    anchors,
    frequency: 'annual',
    staleAfterMonths: 18,
    source: 'worldbank',
    ...fields,
  };
}

function observation(id, value, period, fields = {}) {
  return {
    iso3: 'FIN',
    indicator: id,
    value,
    period,
    method: 'observed',
    retrievedAt: '2026-01-01T00:00:00Z',
    ...fields,
  };
}

const countries = [
  { iso3: 'FIN', name: 'Finland', kind: 'state' },
  { iso3: 'ALD', name: 'Åland', kind: 'territory', dataIso3: 'FIN' },
  { iso3: 'CYN', name: 'Northern Cyprus', kind: 'disputed' },
  { iso3: 'KOS', name: 'Kosovo', kind: 'state', aliases: { worldbank: 'XKX' } },
];

test('scores the newest period and vintage, tracking coverage and median annual age', async () => {
  const { scoreCountries } = await import('./scores.js');
  const registry = {
    countries,
    indicators: [
      indicator('S1'),
      indicator('S2'),
      indicator('S3', { frequency: 'monthly' }),
      indicator('C1', { criticalBelow: 5 }),
      indicator('C2'),
      indicator('C3'),
      indicator('C4'),
    ],
  };
  const newestVintage = observation('C1', 0, '2024', {
    retrievedAt: '2026-02-01T00:00:00Z',
  });
  const scored = scoreCountries(
    registry,
    [
      newestVintage,
      observation('C1', 90, '2024'),
      observation('C1', 80, '2023', { retrievedAt: asOf }),
      observation('C2', 0, '2022'),
      observation('C3', null, '2026'),
      observation('S1', 60, '2023'),
      observation('S2', 60, '2026', { method: 'source-forecast' }),
      observation('S3', 60, '2026-01'),
      observation('C2', 99, '2026', { iso3: 'CYN' }),
      observation('S1', 42, '2025', { iso3: 'XKX' }),
    ],
    asOf,
  );
  const { FIN, ALD, CYN, KOS } = scored;
  assert.deepEqual(FIN.condition, {
    score: 0,
    slot: 'C1',
    period: '2024',
    coverage: { known: 2, total: 4 },
  });
  assert.deepEqual(FIN.coverage, { known: 5, total: 7 });
  assert.equal(FIN.slots.C1.observation, newestVintage);
  assert.equal(FIN.slots.C1.critical, true);
  assert.equal(FIN.slots.C1.stale, false);
  assert.equal(FIN.slots.C2.stale, true);
  assert.equal(FIN.slots.S2.stale, false);
  assert.equal(FIN.slots.C3.score, null);
  assert.equal(FIN.dataAge, 2023);
  assert.equal(FIN.retrievedAt, newestVintage.retrievedAt);
  assert.deepEqual(ALD.slots, FIN.slots);
  assert.equal(CYN.condition.score, null);
  assert.equal(CYN.slots.C2.score, null);
  assert.equal(KOS.slots.S1.score, 42);
  assert.equal(
    scoreCountries(registry, [newestVintage], asOf).FIN.condition.score,
    null,
  );
  assert.equal(
    scoreCountries(registry, [newestVintage], '2026-07-01').FIN.slots.C1.stale,
    true,
  );
});

test('slot aggregation uses weighted coverage and the oldest available period', async () => {
  const { scoreCountries } = await import('./scores.js');
  const registry = {
    countries,
    indicators: [
      indicator('S1', { id: 'a', weight: 3 }),
      indicator('S1', { id: 'b' }),
      indicator('S1', { id: 'c' }),
      indicator('S1', { id: 'd' }),
    ],
  };
  const rows = [observation('a', 80, '2025'), observation('b', 40, '2024')];
  const { FIN } = scoreCountries(registry, rows, asOf);
  assert.deepEqual(FIN.slots.S1.coverage, { known: 2, total: 4 });
  assert.equal(FIN.slots.S1.period, '2024');
  assert.equal(FIN.slots.S1.score, 70);
  assert.equal(FIN.dataAge, 2024.5);
  assert.equal(
    scoreCountries(registry, rows.slice(0, 1), asOf).FIN.slots.S1.score,
    null,
  );
});

test('keeps one stored score per period for a trend, and none from one period', async () => {
  const { scoreCountries } = await import('./scores.js');
  const registry = {
    countries,
    indicators: [
      indicator('C1'),
      indicator('C2'),
      indicator('S1'),
      indicator('S1', { id: 'S1b' }),
    ],
  };
  const { FIN } = scoreCountries(
    registry,
    [
      observation('C1', 40, '2021'),
      observation('C1', 55, '2023', { method: 'source-estimate' }),
      observation('C1', 50, '2023', { retrievedAt: '2025-01-01T00:00:00Z' }),
      observation('C1', 70, '2024', { method: 'source-forecast' }),
      observation('C2', 30, '2024'),
      observation('S1', 10, '2022'),
      observation('S1', 20, '2023'),
      observation('S1b', 20, '2023'),
    ],
    asOf,
  );
  assert.deepEqual(FIN.slots.C1.history, [
    { period: '2021', score: 40, method: 'observed' },
    { period: '2023', score: 55, method: 'source-estimate' },
    { period: '2024', score: 70, method: 'source-forecast' },
  ]);
  assert.equal(FIN.slots.C1.score, 70);
  assert.equal('history' in FIN.slots.C2, false);
  // A slot that mixes several figures is never given a trend.
  assert.equal('history' in FIN.slots.S1, false);
});

test('history keeps the newest twelve periods in order, with gaps, months and aliases', async () => {
  const { scoreCountries } = await import('./scores.js');
  const registry = {
    countries,
    indicators: [indicator('C1'), indicator('C2', { frequency: 'monthly' })],
  };
  const years = Array.from({ length: 14 }, (_, i) => String(2000 + i * 2));
  const { FIN, KOS } = scoreCountries(
    registry,
    [
      // Out of order on purpose; every second year is missing.
      ...years.reverse().map((year, i) => observation('C1', i, year)),
      observation('C2', 10, '2026-09'),
      observation('C2', 20, '2026-10'),
      observation('C1', 30, '2020', { iso3: 'XKX' }),
      observation('C1', 35, '2024', { iso3: 'XKX' }),
    ],
    asOf,
  );
  const periods = FIN.slots.C1.history.map(({ period }) => period);
  assert.equal(periods.length, 12);
  assert.deepEqual(periods, [
    '2004',
    '2006',
    '2008',
    '2010',
    '2012',
    '2014',
    '2016',
    '2018',
    '2020',
    '2022',
    '2024',
    '2026',
  ]);
  assert.equal(FIN.slots.C1.history.at(-1).score, FIN.slots.C1.score);
  assert.deepEqual(
    FIN.slots.C2.history.map(({ period }) => period),
    ['2026-09', '2026-10'],
  );
  // Kosovo's figures are published under the World Bank's XKX code.
  assert.deepEqual(
    KOS.slots.C1.history.map(({ period, score }) => [period, score]),
    [
      ['2020', 30],
      ['2024', 35],
    ],
  );
});

test('a saved board gains history only where the stored reading still matches', async () => {
  const { scoreCountries, withStoredHistory } = await import('./scores.js');
  const registry = { countries, indicators: [indicator('C1')] };
  const rows = [observation('C1', 40, '2017'), observation('C1', 55, '2025')];
  const saved = scoreCountries(registry, rows, asOf);
  delete saved.FIN.slots.C1.history;
  const restored = withStoredHistory(saved, registry, rows, asOf);
  assert.equal(restored.FIN.slots.C1.history.length, 2);
  assert.equal(restored.FIN.slots.C1.score, saved.FIN.slots.C1.score);
  assert.equal('history' in saved.FIN.slots.C1, false);
  // A saved score that no longer matches the observations keeps no history.
  const changed = structuredClone(saved);
  changed.FIN.slots.C1.score = 12;
  assert.equal(
    'history' in withStoredHistory(changed, registry, rows, asOf).FIN.slots.C1,
    false,
  );
  // Without a usable date or registry, the saved board is left as it is.
  assert.equal(withStoredHistory(saved, registry, rows, undefined), saved);
  assert.equal(withStoredHistory(saved, {}, rows, asOf), saved);
});
