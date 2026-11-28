import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boardSearchGroups,
  isLocalityQuery,
  boardPlaceFromGeocode,
} from './boardSearchModel.js';

const model = {
  countries: {
    AAA: { name: 'Indian Ocean Example', kind: 'country' },
    IND: { name: 'India', kind: 'country' },
    BRA: { name: 'Brazil', kind: 'country' },
    XXX: { name: 'Disputed territory', kind: 'disputed' },
  },
  cities: {
    austin: {
      name: 'Austin',
      viewBounds: {
        southwest: { lat: 30.1, lng: -97.95 },
        northeast: { lat: 30.52, lng: -97.55 },
      },
      pois: [{ name: 'Sample landmark', lat: 30, lon: -98 }],
    },
  },
  availableLayers: new Set(['weather-radar', 'military-installations', 'cctv']),
  availableCommands: new Set(['menu:sources', 'menu:today', 'preset:hazards']),
};

test('known countries use their stored identity and exclude disputed territory', () => {
  const [{ label, rows }] = boardSearchGroups('ind', model);
  assert.equal(label, 'Countries');
  assert.equal(rows[0].label, 'India');
  assert.deepEqual(rows[0].target, { kind: 'country', iso3: 'IND' });
  assert.deepEqual(boardSearchGroups('disputed', model), []);
  assert.equal(boardSearchGroups('India', model)[0].rows[0].target.iso3, 'IND');
});

test('city suggestions use broad bounds and leave out bundled landmarks', () => {
  const [{ label, rows }] = boardSearchGroups('austin', model);
  assert.equal(label, 'Places');
  assert.equal(rows[0].target.kind, 'place');
  assert.ok(rows[0].target.lat > 30.1 && rows[0].target.lat < 30.52);
  assert.deepEqual(boardSearchGroups('sample landmark', model), []);
});

test('available weather and menu choices are grouped and sensitive routes are absent', () => {
  const groups = boardSearchGroups('a', model);
  assert.deepEqual(
    groups.map(({ label }) => label),
    ['Countries', 'Places', 'Layers', 'Presets', 'Menu'],
  );
  assert.ok(
    groups
      .flatMap(({ rows }) => rows)
      .some(({ label }) => /rain radar/i.test(label)),
  );
  assert.deepEqual(boardSearchGroups('military', model), []);
  assert.deepEqual(boardSearchGroups('search layers', model), []);
});

test('only city-shaped text can request the explicit lookup', () => {
  assert.ok(isLocalityQuery('São Paulo, Brazil'));
  for (const query of [
    '40.71, -74.00',
    '7 Main St',
    'https://example.com',
    'Military air base',
    'Search Layers with Claude',
    '',
  ])
    assert.equal(isLocalityQuery(query), false, query);
});

test('keyless replies accept broad locality and country types and reject precise results', () => {
  const city = {
    name: 'Example City',
    label: 'Example City',
    lat: 10,
    lng: 20,
    types: ['locality', 'political'],
  };
  assert.equal(boardPlaceFromGeocode(city)?.kind, 'place');
  assert.equal(
    boardPlaceFromGeocode({ ...city, types: ['country', 'political'] })?.kind,
    'country',
  );
  assert.equal(
    boardPlaceFromGeocode({ ...city, types: ['street_address'] }),
    null,
  );
  assert.equal(
    boardPlaceFromGeocode({
      ...city,
      types: ['point_of_interest', 'establishment'],
    }),
    null,
  );
  assert.equal(boardPlaceFromGeocode({ ...city, lat: NaN }), null);
});
