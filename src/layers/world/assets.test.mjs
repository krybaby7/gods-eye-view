import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetCatalog,
  assetMarkers,
  assetClusterMembers,
  ownershipColor,
  ownershipLens,
  ownedAbroad,
  boardAssetScale,
} from './assets.js';

const point = (lon, lat) => ({ type: 'Point', coordinates: [lon, lat] });
const known = {
  actor: 'Verified owner',
  country: 'CHN',
  share: 1,
  verified: true,
};
const rows = [
  {
    id: 'a',
    type: 'fab',
    locatedIn: 'DEU',
    name: 'A',
    geometry: point(10, 51),
    owners: [known],
  },
  {
    id: 'b',
    type: 'fab',
    locatedIn: 'DEU',
    name: 'B',
    geometry: point(11, 52),
    owners: [],
  },
  {
    id: 'c',
    type: 'fab',
    locatedIn: 'DEU',
    name: 'C',
    geometry: null,
    reviewed: false,
    owners: [known],
  },
  {
    id: 'd',
    type: 'fab',
    locatedIn: 'FRA',
    name: 'D',
    geometry: point(8, 50),
    operator: 'Chinese group',
    owners: [],
  },
  {
    id: 'e',
    type: 'fab',
    locatedIn: 'CHN',
    name: 'E',
    geometry: point(110, 30),
    owners: [known],
  },
  {
    id: 'f',
    type: 'military_base',
    locatedIn: 'GIB',
    name: 'F',
    geometry: null,
    sendingCountry: 'GBR',
    owners: [],
  },
];
const snapshot = {
  features: {
    'curated-assets': { rows, nuclearBadges: [{ countryCode: 'CHN' }] },
  },
};

test('ownership is limited to independently documented owners abroad', () => {
  assert.deepEqual(
    ownedAbroad(snapshot, 'CHN').map(({ id }) => id),
    ['a'],
  );
  assert.equal(
    ownershipColor({ iso3: 'FRA' }, { ...snapshot, selected: 'CHN' }),
    null,
  );
  assert.ok(ownershipColor({ iso3: 'DEU' }, { ...snapshot, selected: 'CHN' }));
  assert.equal(ownershipColor({ iso3: 'DEU' }, snapshot), null);
  assert.equal(
    ownershipColor({ iso3: 'DEU' }, { ...snapshot, selected: 'GBR' }),
    null,
  );
  assert.equal(assetCatalog(snapshot).nuclearBadges[0].countryCode, 'CHN');
  assert.equal(assetCatalog(snapshot).byId.get('f').locatedIn, 'GIB');
});

test('high globe view aggregates a same-type host group at an actual member position', () => {
  const markers = assetMarkers(snapshot, 'global');
  const group = markers.find((marker) =>
    marker.members.some(({ id }) => id === 'a'),
  );
  assert.deepEqual(group.members.map(({ id }) => id).sort(), ['a', 'b']);
  assert.ok(
    group.members.some(
      ({ geometry }) =>
        geometry.coordinates.toString() === group.coordinates.toString(),
    ),
  );
  assert.deepEqual(
    assetClusterMembers(snapshot, group.id)
      .map(({ id }) => id)
      .sort(),
    ['a', 'b'],
  );
  assert.ok(
    !markers.some((marker) =>
      marker.members.some(({ id }) => ['c', 'f'].includes(id)),
    ),
  );
});

test('ownership selection keeps its verified overseas markers individually pickable', () => {
  const markers = assetMarkers(
    { ...snapshot, lens: 'ownership', selected: 'CHN' },
    'global',
  );
  assert.deepEqual(
    markers.find((marker) => marker.id === 'a').members.map(({ id }) => id),
    ['a'],
  );
  assert.equal(markers.find((marker) => marker.id === 'a').owner, 'CHN');
  assert.equal(markers.find((marker) => marker.id === 'd').owner, null);
});

test('asset aggregation has a dead band near the global threshold', () => {
  assert.equal(boardAssetScale(11_000_000, 'regional'), 'global');
  assert.equal(boardAssetScale(9_500_000, 'global'), 'global');
  assert.equal(boardAssetScale(9_500_000, 'regional'), 'regional');
  assert.equal(boardAssetScale(8_500_000, 'global'), 'regional');
});

test('ownership hover preserves the disputed-territory and missing-country fallbacks', () => {
  const selected = { ...snapshot, selected: 'CHN' };
  assert.equal(
    ownershipLens.hover({ iso3: 'DEU' }, selected),
    '1 documented owned asset abroad',
  );
  assert.equal(
    ownershipLens.hover({ iso3: 'FRA' }, selected),
    'Ownership · Unknown',
  );
  assert.equal(
    ownershipLens.hover({ iso3: 'DEU', kind: 'disputed' }, selected),
    undefined,
  );
  assert.equal(ownershipLens.hover(null, selected), undefined);
});
