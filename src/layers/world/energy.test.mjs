import test from 'node:test';
import assert from 'node:assert/strict';
import {
  energyColor,
  energyGates,
  dependencyRows,
  gateReferences,
  netEnergyImports,
  gaugeRatio,
  energyLens,
  chokepointExposure,
} from './energy.js';

const rows = [
  {
    dependent: 'JPN',
    provider: 'SAU',
    route: ['chokepoint6'],
    shares: { all: 0.3, seaborne: 0.5 },
  },
  {
    dependent: 'KOR',
    provider: 'SAU',
    route: ['chokepoint6'],
    shares: { all: 0.6, seaborne: 0.7 },
  },
];
const snapshot = {
  features: { 'energy-dependencies': { rows, mode: 'fixture' } },
};

test('structural gates exist with unknown traffic when permission is absent', () => {
  const gates = energyGates({
    features: { portwatch: { mode: 'permission-required', gates: [] } },
  });
  assert.equal(gates.find(({ id }) => id === 'chokepoint6').status, 'unknown');
  assert.match(gates.find(({ id }) => id === 'chokepoint10').proxy, /Øresund/);
  assert.equal(
    gates.find(({ id }) => id === 'eia-dardanelles').reference,
    'dardanelles',
  );
  assert.equal(
    gates.some(({ id }) => id === 'chokepoint3'),
    false,
  );
});

test('gate rankings and country lens use all-import shares, unknown remains hatched', () => {
  assert.deepEqual(
    dependencyRows(snapshot, { gate: 'chokepoint6' }).map(
      ({ dependent }) => dependent,
    ),
    ['KOR', 'JPN'],
  );
  assert.equal(dependencyRows(snapshot, { provider: 'SAU' }).length, 2);
  assert.ok(energyColor({ iso3: 'JPN' }, snapshot));
  assert.equal(energyColor({ iso3: 'CAN' }, snapshot), null);
});

test('gate reference picks the latest per commodity without merging fiscal and calendar periods', () => {
  const data = {
    features: {
      'eia-chokepoints': {
        rows: [
          {
            routeId: 'panama',
            commodity: 'oil',
            year: 2024,
            period: 'FY2024',
            value: 2,
          },
          {
            routeId: 'panama',
            commodity: 'oil',
            year: 2025,
            period: 'FY2025',
            value: 2.3,
          },
        ],
      },
    },
  };
  assert.equal(
    gateReferences(data, { reference: 'panama' })[0].period,
    'FY2025',
  );
});

test('net imports retain the underlying raw value and year', () => {
  const slots = {
    S7: {
      observation: {
        indicator: 'energy.net_imports_pct',
        period: '2022',
        value: -18,
      },
    },
  };
  assert.deepEqual(netEnergyImports({ countries: { CAN: { slots } } }, 'CAN'), {
    value: -18,
    period: '2022',
  });
});

test('daily gauges compare the latest count with the matched seven-day baseline', () => {
  const dataTo = '2026-11-01';
  const gate = {
    baseline7: 50,
    ratio7: 0.4,
    days: [{ date: dataTo, counts: { total: 5 } }],
  };
  assert.equal(gaugeRatio(gate, dataTo), 0.1);
  assert.equal(gaugeRatio(gate, '2026-11-02'), null);
});

test('hover explains exposure and labels unknown instead of describing condition', () => {
  const countries = {
    JPN: { iso3: 'JPN', name: 'Japan' },
    CAN: { iso3: 'CAN', name: 'Canada' },
  };
  const state = {
    ...snapshot,
    countries,
    lens: 'energy',
    lenses: [energyLens],
  };
  assert.equal(
    energyLens.hover(countries.JPN, state),
    '30% of all imports · synthetic fixture',
  );
  assert.equal(
    energyLens.hover(countries.CAN, state),
    'Energy exposure · Unknown',
  );
});

test('modelled lens names the gate, main product and energy volume and skips minor importers', () => {
  const gate = 'chokepoint6';
  const crossing = (volume, share) => ({
    gate,
    item: 'crude oil',
    volume: { value: volume, unit: 'PJ/year' },
    shares: { all: share },
  });
  const model = {
    features: {
      'energy-dependencies': {
        mode: 'modelled',
        rows,
        energyExposure: {
          JPN: [crossing(80, 0.4)],
          KOR: [crossing(50, 0.9)],
          GMB: [crossing(4, 0.8)],
          USA: [],
        },
        energyImports: { JPN: 200, KOR: 56, GMB: 5, USA: 90 },
        minorImporterFloor: 10,
      },
    },
  };
  assert.match(
    energyLens.hover({ iso3: 'JPN' }, model),
    /Strait of Hormuz.*40%.*80 PJ\/year.*crude oil/,
  );
  assert.match(energyLens.hover({ iso3: 'USA' }, model), /0% of all imports/);
  assert.match(energyLens.hover({ iso3: 'GMB' }, model), /Minor importer/i);
  assert.equal(energyColor({ iso3: 'GMB' }, model), null);
  assert.equal(energyColor({ iso3: 'CAN' }, model), null);
  assert.deepEqual(
    chokepointExposure(model, gate).map(({ dependent }) => dependent),
    ['JPN', 'KOR'],
  );
});
