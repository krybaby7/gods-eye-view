import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEnergyModel,
  commodity,
  maritimeRouter,
} from '../../../scripts/world-energy-model.mjs';

test('BACI filters the four HS families and keeps pipeline gas separate', () => {
  assert.deepEqual(
    ['270900', '271012', '271111', '270112', '271121', '271119', '271320'].map(
      commodity,
    ),
    [
      'crude oil',
      'refined products',
      'lng',
      'coal',
      'pipeline gas',
      undefined,
      undefined,
    ],
  );
});

test('maritime routing takes the shorter connected path and tags ordered crossings', () => {
  const line = (coordinates, pass) => ({
    geometry: { type: 'LineString', coordinates },
    properties: { pass },
  });
  const network = {
    features: [
      line([
        [54, 26],
        [57, 26],
      ]),
      line(
        [
          [57, 26],
          [100, 4],
        ],
        'malacca',
      ),
      line([
        [54, 26],
        [10, -50],
        [100, 4],
      ]),
    ],
  };
  const route = maritimeRouter(network)([54, 26], [100, 4]);
  assert.deepEqual(route.gates, ['chokepoint6', 'chokepoint5']);
  assert.deepEqual(route.coordinates, [
    [54, 26],
    [57, 26],
    [100, 4],
  ]);
});

test('dependency shares distinguish seaborne, land and unresolved volume', () => {
  const inputs = [
    { provider: 'QAT', dependent: 'JPN', item: 'lng', tonnes: 30, value: 60 },
    { provider: 'USA', dependent: 'JPN', item: 'lng', tonnes: 20, value: 30 },
    { provider: 'KAZ', dependent: 'JPN', item: 'lng', tonnes: 40, value: 10 },
    { provider: '???', dependent: 'JPN', item: 'lng', tonnes: 10, value: 5 },
    {
      provider: 'RUS',
      dependent: 'JPN',
      item: 'pipeline gas',
      tonnes: 1,
      value: 5,
    },
  ];
  const result = buildEnergyModel(inputs, {
    routeFor(provider) {
      if (provider === 'KAZ') return { mode: 'land' };
      if (provider === '???') return { mode: 'unknown' };
      return {
        mode: 'sea',
        gates: provider === 'QAT' ? ['chokepoint6'] : [],
        coordinates: [],
      };
    },
    references: [
      {
        routeId: 'hormuz',
        year: 2024,
        value: 1,
        commodity: 'lng',
        unit: 'bcf/d',
      },
    ],
  });
  const [row] = result.exposure.JPN;
  assert.deepEqual(row.shares, { seaborne: 0.6, all: 0.3 });
  assert.deepEqual(row.denominators, {
    seaborne: 50,
    all: 100,
    unknown: 10,
    unit: 'tonnes/year',
  });
  assert.equal(result.coverage.landFlows, 2);
  assert.equal(result.calibration.length, 1);
});

test('missing BACI tonnage switches the entire import group to declared trade value', () => {
  const result = buildEnergyModel(
    [
      {
        provider: 'QAT',
        dependent: 'IND',
        item: 'lng',
        tonnes: null,
        value: 25,
      },
      {
        provider: 'AUS',
        dependent: 'IND',
        item: 'lng',
        tonnes: 1_000,
        value: 75,
      },
    ],
    {
      routeFor: (provider) => ({
        mode: 'sea',
        gates: provider === 'QAT' ? ['chokepoint6'] : [],
        coordinates: [],
      }),
      references: [],
    },
  );
  assert.deepEqual(result.exposure.IND[0].shares, {
    seaborne: 0.25,
    all: 0.25,
  });
  assert.equal(result.exposure.IND[0].denominators.unit, 'thousand USD/year');
});

test('BACI quantity screening uses the median price for the full HS code and maps Taiwan', async () => {
  const build = await import('../../../scripts/build-world-energy-model.mjs');
  assert.equal(build.baciCountryIso('490', 'S19'), 'TWN');
  const rows = [
    { code: '270900', value: 600, tonnes: 1 },
    { code: '270900', value: 1200, tonnes: 2 },
    { code: '270900', value: 900, tonnes: 9 },
    { code: '271012', value: 150, tonnes: 1 },
    { code: '271012', value: 300, tonnes: 2 },
  ];
  const screened = build.screenBaciQuantities(rows);
  assert.equal(screened[2].tonnes, 1.5);
  assert.equal(screened[2].quantityReestimated, true);
  assert.equal(screened[3].tonnes, 1);
});

test('routing excludes Arctic and Kiel shortcut edges', () => {
  const start = [10, 54];
  const end = [13, 55];
  const detour = [8, 58];
  const line = (coordinates, pass) => ({
    geometry: { type: 'LineString', coordinates },
    properties: { pass },
  });
  for (const pass of ['kiel', 'bering', 'northwest', 'northeast']) {
    const route = maritimeRouter({
      features: [line([start, end], pass), line([start, detour, end])],
    })(start, end);
    assert.deepEqual(route.coordinates, [start, detour, end], pass);
  }
});

test('combined exposure uses energy-weighted shares over both denominators', () => {
  const model = buildEnergyModel(
    [
      { provider: 'AAA', dependent: 'BBB', item: 'lng', tonnes: 1e6, value: 1 },
      {
        provider: 'CCC',
        dependent: 'BBB',
        item: 'coal',
        tonnes: 1e6,
        value: 1,
      },
      { provider: 'DDD', dependent: 'BBB', item: 'lng', tonnes: 1e6, value: 1 },
    ],
    {
      routeFor: (from) =>
        from === 'DDD'
          ? { mode: 'land' }
          : {
              mode: 'sea',
              gates: from === 'AAA' ? ['chokepoint6'] : [],
              coordinates: [],
            },
      references: [],
    },
  );
  const [row] = model.energyExposure.BBB;
  assert.equal(row.item, 'lng');
  assert.equal(row.volume.value, 50);
  assert.deepEqual(row.shares, { seaborne: 0.675676, all: 0.403226 });
});

test('a split route apportions reported tonnage and gates once', () => {
  const model = buildEnergyModel(
    [
      {
        provider: 'SAU',
        dependent: 'JPN',
        item: 'crude oil',
        tonnes: 1e6,
        value: 1,
      },
    ],
    {
      routeFor: () => [
        { share: 0.75, mode: 'sea', gates: ['chokepoint6'], coordinates: [] },
        { share: 0.25, mode: 'sea', gates: [], coordinates: [] },
      ],
      references: [],
    },
  );
  assert.equal(model.exposure.JPN[0].shares.all, 0.75);
  assert.equal(model.rows[0].volume.value, 1e6);
  assert.equal(model.rows[0].gateShares.chokepoint6, 0.75);
});

test('energy port resolution rejects missing routes and respects transit and mainland rules', async () => {
  const { routesFor } =
    await import('../../../scripts/build-world-energy-model.mjs');
  const row = (iso, direction, port, coordinates, share) => ({
    iso,
    direction,
    port,
    coordinates,
    share,
    product: 'crude oil',
    ...(iso === 'KAZ' && { shareBasis: 'all exports' }),
  });
  const line = (coordinates) => ({
    geometry: { type: 'LineString', coordinates },
    properties: {},
  });
  const ports = { features: [] };
  const origin = [37.65, 44.66];
  const terminal = [69.8, 22.5];
  const rows = [
    row('KAZ', 'export', 'CPC', origin, 0.81),
    row('IND', 'import', 'Sikka', terminal, null),
  ];
  const route = routesFor(
    { features: [line([origin, terminal])] },
    ports,
    rows,
  );
  assert.deepEqual(
    route('KAZ', 'IND', 'crude oil').map(({ mode, share }) => [mode, share]),
    [
      ['sea', 0.81],
      ['unknown', 0.19],
    ],
  );
  assert.equal(route('FRA', 'BRA', 'crude oil').mode, 'unknown');
  assert.equal(route('MYS', 'IDN', 'crude oil').mode, 'unknown');
  assert.equal(route('FRA', 'DEU', 'crude oil').mode, 'land');
  assert.throws(
    () =>
      routesFor({ features: [line([origin, terminal])] }, ports, [
        row('IRN', 'export', 'Bad anchor', [-20, -55], null),
      ]),
    /Bad anchor/,
  );
});

test('energy board summary drops bilateral detail while a country receives only its rows', async () => {
  const { compactEnergyModel, energyDetail } =
    await import('./dependencies.js');
  const row = (provider, dependent, value) => ({
    id: provider + '/' + dependent + '/coal',
    provider,
    dependent,
    route: ['chokepoint6'],
    volume: { unit: 'tonnes/year', value },
  });
  const rows = Array.from({ length: 5 }, (_, i) => row('AAA', String(i), i));
  const model = {
    mode: 'modelled',
    rows,
    exposure: { 0: [{}] },
    energyExposure: {},
    importTonnes: { 0: { coal: 10 } },
    paths: { 'AAA/0/coal': [[1, 2]] },
  };
  const summary = compactEnergyModel(model);
  assert.equal(summary.rows.length, 4);
  assert.equal(summary.exposure, undefined);
  assert.equal(summary.importTonnes, undefined);
  const detail = energyDetail(model, '0');
  assert.deepEqual(detail.rows, [rows[0]]);
  assert.deepEqual(detail.paths, { 'AAA/0/coal': [[1, 2]] });
  assert.deepEqual(detail.importTonnes, { coal: 10 });
});

test('source correction limits rerouting to the declared Malaysia to China crude volume', async () => {
  const { applyBaciOriginOverride } =
    await import('../../../scripts/build-world-energy-model.mjs');
  const malaysia = {
    provider: 'MYS',
    dependent: 'CHN',
    item: 'crude oil',
    tonnes: 14,
    reportedTonnes: 14,
    baciDeclaredTonnes: 13,
  };
  const iran = {
    provider: 'IRN',
    dependent: 'CHN',
    item: 'crude oil',
    tonnes: 3,
    reportedTonnes: 3,
  };
  const other = {
    provider: 'IRQ',
    dependent: 'CHN',
    item: 'crude oil',
    tonnes: 83,
    reportedTonnes: 83,
  };
  const { adjusted, correction } = applyBaciOriginOverride(
    [malaysia, iran, other],
    { share: 0.11 },
  );
  assert.equal(correction.reroutedTonnes, 8);
  assert.equal(adjusted[0].provider, 'MYS');
  assert.equal(adjusted[0].tonnes, 14);
  assert.equal(adjusted[0].baciDeclaredTonnes, 13);
  assert.equal(adjusted[0].routeOriginAdjustment.share, 8 / 14);
  assert.equal(adjusted[1], iran);
});

test('a sourced land volume is retained while routing remaining bilateral crude by sea', () => {
  const model = buildEnergyModel(
    [
      {
        provider: 'RUS',
        dependent: 'CHN',
        item: 'crude oil',
        tonnes: 100,
        value: 100,
        landShare: 0.4,
      },
    ],
    {
      routeFor: () => ({
        mode: 'sea',
        gates: ['chokepoint5'],
        coordinates: [],
      }),
      references: [],
    },
  );
  assert.deepEqual(model.exposure.CHN[0].shares, { all: 0.6, seaborne: 1 });
  assert.equal(model.importTonnes.CHN['crude oil'], 100);
  assert.equal(model.coverage.landFlows, 1);
});
