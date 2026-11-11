import assert from 'node:assert/strict';
import test from 'node:test';
import energyModel from '../../../public/world/curated/energy-dependencies.json' with { type: 'json' };

test('opening a legacy board with the old energy model keeps obsolete detail off the wire', async () => {
  const { compactEnergyModel, energyDetail } =
    await import('./dependencies.js');
  const model = {
    mode: 'modelled',
    period: '2024',
    rows: [{ dependent: 'SAU', shares: { all: 1 } }],
    exposure: { SAU: [{ shares: { all: 1 } }] },
    paths: { old: [1, 2, 3] },
  };
  assert.deepEqual(compactEnergyModel(model), {
    mode: 'pending',
    period: '2024',
    label: 'Refresh to rebuild energy exposure',
    rebuildRequired: true,
  });
  assert.deepEqual(energyDetail(model, 'SAU'), { rebuildRequired: true });
});
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

test('missing BACI tonnage is estimated without switching shares to trade value', async () => {
  const { screenBaciQuantities } =
    await import('../../../scripts/build-world-energy-model.mjs');
  const result = buildEnergyModel(
    screenBaciQuantities([
      {
        provider: 'QAT',
        dependent: 'IND',
        item: 'lng',
        code: '271111',
        tonnes: null,
        value: 30,
      },
      {
        provider: 'AUS',
        dependent: 'IND',
        item: 'lng',
        code: '271111',
        tonnes: 1_000,
        value: 120,
      },
    ]),
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
    seaborne: 0.2,
    all: 0.2,
  });
  assert.equal(result.exposure.IND[0].denominators.unit, 'tonnes/year');
  assert.equal(
    result.rows.find(({ provider }) => provider === 'QAT').quantityEstimated,
    true,
  );
});

test('BACI screening weights each HS median by tonnes and corrects only cheap outliers', async () => {
  const build = await import('../../../scripts/build-world-energy-model.mjs');
  assert.equal(build.baciCountryIso('490', 'S19'), 'TWN');
  const rows = [
    { code: '270900', value: 6_000, tonnes: 10_000 },
    { code: '270900', value: 100, tonnes: 1_000 },
    { code: '270900', value: 10, tonnes: 1 },
    { code: '270900', value: 10, tonnes: 1 },
    { code: '270900', value: 20, tonnes: 100 },
    { code: '271012', value: 150, tonnes: 1_000 },
    { code: '271012', value: 300, tonnes: 2_000 },
  ];
  const screened = build.screenBaciQuantities(rows);
  assert.equal(screened[0].tonnes, 10_000);
  assert.equal(screened[1].tonnes, 100 / 0.6);
  assert.equal(screened[1].quantityReestimated, true);
  assert.equal(screened[2].tonnes, 1);
  assert.equal(screened[4].tonnes, 100);
  assert.equal(screened[5].tonnes, 1_000);
});

test('cached BACI cargo regressions retain real cargoes and correct the Thai crude outlier', () => {
  const { quantityAudit } = energyModel;
  const find = (provider, dependent, code) =>
    quantityAudit.cargoes.find(
      (row) =>
        row.provider === provider &&
        row.dependent === dependent &&
        row.code === code,
    );
  const coal = find('IDN', 'CHN', '270119');
  const refined = find('MEX', 'USA', '271000');
  const crude = find('ARE', 'THA', '270900');
  assert.equal((coal.declaredTonnes / 1e6).toFixed(1), '49.6');
  assert.equal(coal.tonnes, coal.declaredTonnes);
  assert.equal((refined.declaredTonnes / 1e6).toFixed(1), '10.7');
  assert.equal(refined.tonnes, refined.declaredTonnes);
  assert.equal((crude.declaredTonnes / 1e6).toFixed(1), '151.7');
  assert.ok(crude.tonnes > 24e6 && crude.tonnes < 27e6);
  assert.equal(crude.quantityReestimated, true);
  assert.equal(energyModel.coverage.quantitiesEstimated, 189);
  assert.ok(
    Object.values(energyModel.exposure)
      .flat()
      .every(({ denominators }) => denominators.unit === 'tonnes/year'),
  );
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
  assert.notEqual(route('FRA', 'BRA', 'crude oil').mode, 'land'); // French Guiana
  assert.equal(route('MYS', 'IDN', 'crude oil').mode, 'unknown');
  assert.equal(route('FRA', 'DEU', 'crude oil').mode, 'land');
  assert.equal(route('MYS', 'THA', 'crude oil').mode, 'land');
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

test('bilateral port and passage shares use only the displayed seaborne volume', () => {
  const model = buildEnergyModel(
    [
      {
        provider: 'RUS',
        dependent: 'CHN',
        item: 'crude oil',
        tonnes: 100,
        landShare: 0.4,
      },
    ],
    {
      routeFor: () => [
        {
          share: 0.6,
          mode: 'sea',
          gates: [],
          ports: ['Kozmino'],
          coordinates: [],
        },
        {
          share: 0.2,
          mode: 'sea',
          gates: ['chokepoint5'],
          ports: ['Novorossiysk'],
          coordinates: [],
        },
        { share: 0.2, mode: 'unknown' },
      ],
      references: [],
    },
  );
  const [row] = model.rows;
  assert.equal(row.volume.value, 48);
  assert.equal(model.routeShareBasis, 'seaborne');
  assert.deepEqual(
    row.portSplits.map(({ share }) => share),
    [0.75, 0.25],
  );
  assert.equal(row.gateShares.chokepoint5, 0.25);
  assert.deepEqual(model.exposure.CHN[0].shares, { seaborne: 0.25, all: 0.12 });
});

test('a landlocked trade partner alone is insufficient evidence for land routing', async () => {
  const { routesFor } =
    await import('../../../scripts/build-world-energy-model.mjs');
  const routes = routesFor({ features: [] }, { features: [] });
  assert.equal(routes('MNG', 'CHN', 'coal').mode, 'land');
  assert.equal(routes('MNG', 'JPN', 'coal').mode, 'unknown');
  assert.equal(routes('USA', 'CHE', 'refined products').mode, 'unknown');
  assert.equal(routes('KAZ', 'RUS', 'crude oil').mode, 'land');
});

test('coastal imports can use the nearest ocean network node without a gazetteer port', async () => {
  const { routesFor } =
    await import('../../../scripts/build-world-energy-model.mjs');
  const origin = [-17.8, 14.5];
  const nearBanjul = [-17.3, 13.4];
  const routes = routesFor(
    {
      features: [
        {
          geometry: { type: 'LineString', coordinates: [origin, nearBanjul] },
          properties: {},
        },
      ],
    },
    { features: [] },
    [
      {
        iso: 'SEN',
        direction: 'export',
        product: 'refined products',
        port: 'Dakar',
        coordinates: origin,
        share: null,
      },
    ],
  );
  const route = routes('SEN', 'GMB', 'refined products');
  assert.equal(route.mode, 'land');
  const oceanRoutes = routesFor(
    {
      features: [
        {
          geometry: { type: 'LineString', coordinates: [origin, nearBanjul] },
          properties: {},
        },
      ],
    },
    { features: [] },
    [
      {
        iso: 'CPV',
        direction: 'export',
        product: 'refined products',
        port: 'Source terminal',
        coordinates: origin,
        share: null,
      },
    ],
  );
  const [ocean] = oceanRoutes('CPV', 'GMB', 'refined products');
  assert.equal(ocean.mode, 'sea');
  assert.equal(ocean.approximate, true);
  assert.match(ocean.ports[1], /approximate network port/i);
  assert.deepEqual(ocean.coordinates.at(-1), nearBanjul);
});

test('fallback ports choose the capital landmass and skip ports on overseas polygons', async () => {
  const { routesFor } =
    await import('../../../scripts/build-world-energy-model.mjs');
  const nearPortugal = [-9.1333, 38.7];
  const azores = [-25.67, 37.73];
  const origin = [-17.8, 14.5];
  const routes = routesFor(
    {
      features: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [origin, azores, [-9.2, 38.7]],
          },
          properties: {},
        },
      ],
    },
    {
      features: [
        {
          geometry: { coordinates: azores },
          properties: { name: 'Ponta Delgada' },
        },
        {
          geometry: { coordinates: nearPortugal },
          properties: { name: 'Lisbon' },
        },
      ],
    },
    [
      {
        iso: 'SEN',
        direction: 'export',
        product: 'lng',
        port: 'Dakar',
        coordinates: origin,
        share: null,
      },
    ],
  );
  assert.deepEqual(routes('SEN', 'PRT', 'lng')[0].ports, ['Dakar', 'Lisbon']);
});

test('multiport allocation preserves national supply and bilateral demand while favoring nearby ports', async () => {
  const { routesFor } =
    await import('../../../scripts/build-world-energy-model.mjs');
  const coords = [
    [-5, 45],
    [-2, 45],
    [0, 45],
    [3, 45],
    [5, 45],
  ];
  const rows = [
    ['RUS', 'export', 'West terminal', coords[0], 0.2],
    ['FRA', 'import', 'West destination', coords[1], null],
    ['RUS', 'export', 'Centre terminal', coords[2], 0.3],
    ['JPN', 'import', 'East destination', coords[3], null],
    ['RUS', 'export', 'East terminal', coords[4], 0.5],
  ].map(([iso, direction, port, coordinates, share]) => ({
    iso,
    direction,
    port,
    coordinates,
    share,
    product: 'lng',
  }));
  const routes = routesFor(
    {
      features: [
        {
          geometry: { type: 'LineString', coordinates: coords },
          properties: {},
        },
      ],
    },
    { features: [] },
    rows,
  );
  const destinations = [
    { provider: 'RUS', dependent: 'FRA', item: 'lng', tonnes: 80 },
    { provider: 'RUS', dependent: 'JPN', item: 'lng', tonnes: 20 },
  ];
  const fitted = routes.fit(destinations);
  const origins = destinations.map(({ provider, dependent, item }) =>
    fitted.routeFor(provider, dependent, item),
  );
  for (const column of origins) {
    assert.ok(
      Math.abs(column.reduce((sum, route) => sum + route.share, 0) - 1) < 1e-9,
    );
  }
  for (const [port, target] of [
    ['West terminal', 20],
    ['Centre terminal', 30],
    ['East terminal', 50],
  ]) {
    const allocated = origins.reduce(
      (sum, column, index) =>
        sum +
        (column.find(({ ports }) => ports[0] === port)?.share ?? 0) *
          destinations[index].tonnes,
      0,
    );
    assert.ok(Math.abs(allocated - target) < 0.0001, port);
  }
  assert.ok(origins[0][0].share > origins[1][0].share);
  assert.ok(origins[1][2].share > origins[0][2].share);
});

test('fallback rejects named island ports even when the island is absent from the boundary pack', async () => {
  const { routesFor } =
    await import('../../../scripts/build-world-energy-model.mjs');
  const thursdayIsland = [142.218964, -10.585556];
  const broome = [122.209187, -18.0025];
  const origin = [150, -25];
  const routes = routesFor(
    {
      features: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [origin, thursdayIsland, [122.2, -18.2]],
          },
          properties: {},
        },
      ],
    },
    {
      features: [
        {
          geometry: { coordinates: thursdayIsland },
          properties: { name: 'Thursday Island' },
        },
        { geometry: { coordinates: broome }, properties: { name: 'Broome' } },
      ],
    },
    [
      {
        iso: 'NZL',
        direction: 'export',
        product: 'lng',
        port: 'Source terminal',
        coordinates: origin,
        share: null,
      },
    ],
  );
  assert.deepEqual(routes('NZL', 'AUS', 'lng')[0].ports, [
    'Source terminal',
    'Broome',
  ]);
});

test('the rebuilt calibration carries source notes through the board and detail API', async () => {
  const { compactEnergyModel, energyDetail } =
    await import('./dependencies.js');
  for (const calibration of [
    compactEnergyModel(energyModel).calibration,
    energyDetail(energyModel, null).calibration,
  ]) {
    for (const routeId of ['hormuz', 'malacca']) {
      const row = calibration.find(
        (entry) => entry.routeId === routeId && entry.commodity === 'oil',
      );
      assert.match(
        row.dataNote.text,
        /China’s reported Malaysian crude treated as Iranian/,
      );
      assert.match(row.dataNote.sourceUrl, /^https:\/\/www\.eia\.gov\//);
    }
    const row = calibration.find(
      (entry) => entry.routeId === 'dardanelles' && entry.commodity === 'oil',
    );
    assert.match(row.dataNote.text, /4\.8 Mt.*30 Mt/);
    const malaccaLNG = calibration.find(
      (entry) => entry.routeId === 'malacca' && entry.commodity === 'lng',
    );
    assert.equal(
      malaccaLNG.dataNote?.text,
      'US LNG to Asia is routed via Panama in this model. In 2024 much of it went round the Cape of Good Hope and through Malacca.',
    );
    assert.match(malaccaLNG.dataNote.sourceUrl, /^https:\/\/www\.shell\.com\//);
  }
});

test('trivial-exporter fact compares each top-ten dependent with the whole gate total in PJ', async () => {
  const { default: checkEnergy } =
    await import('../../../scripts/world-fact-checks/energy.mjs');
  const gate = 'chokepoint6';
  const transit = (value) => [
    {
      gate,
      item: 'lng',
      shares: { all: 0.5, seaborne: 0.5 },
      volume: { value, unit: 'PJ/year' },
    },
  ];
  const board = {
    features: {
      'energy-dependencies': {
        mode: 'modelled',
        minorImporterFloor: 10,
        energyImports: { CHN: 20_000, SAU: 50, GMB: 8 },
        energyExposure: {
          CHN: transit(10_000),
          SAU: transit(25),
          GMB: transit(4),
        },
      },
    },
  };
  const facts = await checkEnergy({ board, getDetail: async () => ({}) });
  const fact = facts.find(({ id }) => id === 'energy-trivial-exporter-imports');
  assert.equal(fact.pass, false);
  assert.deepEqual(
    fact.found.trivial.map(({ country, gateTotal }) => [country, gateTotal]),
    [['SAU', 10_029]],
  );
});

test('land borders only use touching polygons at least a third of each country’s largest', async () => {
  const { routesFor } =
    await import('../../../scripts/build-world-energy-model.mjs');
  const routes = routesFor({ features: [] }, { features: [] });
  for (const [from, to] of [
    ['MYS', 'THA'],
    ['ARE', 'OMN'],
    ['ARE', 'SAU'],
    ['DEU', 'DNK'],
    ['CMR', 'GNQ'],
    ['GAB', 'GNQ'],
  ]) {
    assert.equal(
      routes(from, to, 'refined products').mode,
      'land',
      from + '/' + to,
    );
  }
  for (const [from, to] of [
    ['FRA', 'BRA'],
    ['GBR', 'IRL'],
    ['RUS', 'LTU'],
    ['AGO', 'COG'],
  ]) {
    assert.equal(
      routes.adjacent(from, to, 'refined products'),
      false,
      from + '/' + to,
    );
  }
});

test('published Indonesian import routes use curated terminals on Java', () => {
  const { rows, routePorts } = energyModel;
  for (const [id, port] of [
    ['SAU/IDN/crude oil', 'Cilacap Refinery Terminal'],
    ['SGP/IDN/refined products', 'Tanjung Priok Fuel Terminal'],
    ['USA/IDN/lng', 'West Java LNG'],
    ['AUS/IDN/coal', 'Cigading Coal Terminal'],
  ]) {
    assert.equal(rows.find((row) => row.id === id)?.volume.value > 0, true, id);
    assert.equal(routePorts[id]?.[1], port, id);
  }
});

test('British refined products to Ireland appear as a seaborne route', () => {
  const row = energyModel.rows.find(
    ({ id }) => id === 'GBR/IRL/refined products',
  );
  assert.ok(row?.volume.value > 1.8e6);
  assert.equal(energyModel.routePorts[row.id]?.length, 2);
});

test('manual Refresh replaces the cached round 4 Energy model', async () => {
  const { createWorldService } = await import('./index.js');
  const source = 'energy-dependencies';
  const oldModel = {
    mode: 'modelled',
    period: '2024',
    rows: [],
    energyExposure: {},
    calibration: [{ routeId: 'malacca', commodity: 'lng', modelled: 8.333 }],
  };
  let state = {
    board: { countries: {}, features: { [source]: oldModel } },
    observations: [],
    turns: [{ number: 1 }],
    lastCheckedAt: { [source]: '2026-11-10T12:00:00Z' },
    sourceVersions: { [source]: 5 },
  };
  let upstreamRequests = 0;
  const service = createWorldService({
    loadRegistry: async () => ({
      countries: [],
      indicators: [],
      sources: [{ id: source }],
    }),
    store: {
      read: async () => state,
      write: async (next) => {
        state = next;
      },
    },
    fetchImpl: async () => {
      upstreamRequests++;
      throw new Error('Bundled Energy refresh must not fetch upstream');
    },
  });
  assert.deepEqual(
    (await service.snapshot()).features[source].calibration,
    oldModel.calibration,
  );
  await service.refresh();
  await service.whenIdle();
  const refreshed = await service.snapshot();
  assert.equal(refreshed.turn.sources[0].rederived, true);
  assert.deepEqual(
    refreshed.features[source].calibration,
    energyModel.calibration,
  );
  assert.equal(state.sourceVersions[source], 6);
  assert.equal(upstreamRequests, 0);
});
