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
