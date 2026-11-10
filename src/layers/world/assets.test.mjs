import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetCatalog,
  assetConnections,
  assetMarkers,
  assetClusterMembers,
  ownershipColor,
  ownershipLens,
  ownedAbroad,
  boardAssetScale,
  showAssetMarkers,
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

test('compact source markers retain their type, geometry and closed status', () => {
  const board = {
    features: {
      'wri-power': {
        markers: [['closed-1', 'Closed plant', 'FIN', 25, 60, 'closed']],
      },
    },
  };
  const [marker] = assetMarkers(board, 'regional');
  assert.equal(marker.closed, true);
  assert.equal(marker.type, 'power_plant');
  assert.deepEqual(marker.coordinates, [25, 60]);
});

test('missing sites share a distinct host-country marker without replacing real site coordinates', () => {
  const labelPoint = (iso3) =>
    iso3 === 'DEU' ? { lon: 10.6, lat: 51.3 } : null;
  const extra = { ...rows[2], id: 'missing-two', type: 'military_base' };
  const features = { 'curated-assets': { rows: [...rows, extra] } };
  const board = { ...snapshot, features };
  const markers = assetMarkers(board, 'global', labelPoint);
  const fallback = markers.find(({ id }) => id === 'fallback:DEU');
  assert.equal(fallback.approximate, true);
  assert.deepEqual(fallback.coordinates, [10.6, 51.3]);
  assert.deepEqual(
    assetClusterMembers(board, fallback.id).map(({ id }) => id),
    ['c', 'missing-two'],
  );
  assert.ok(
    markers.some(
      ({ id, approximate }) => id === 'cluster:global:DEU:fab' && !approximate,
    ),
  );
  assert.ok(!markers.some(({ id }) => id === 'f'));
});

test('ownership lines use host label points for an unknown site and identify military presence separately', () => {
  const labelPoint = (iso3) =>
    iso3 === 'DEU' ? { lon: 10.6, lat: 51.3 } : null;
  const verified = { ...rows[2], id: 'title', reviewed: true };
  const presence = {
    ...rows[5],
    id: 'presence',
    sendingCountry: 'CHN',
    locatedIn: 'DEU',
    status: 'operating',
  };
  const board = {
    ...snapshot,
    lens: 'ownership',
    selected: 'CHN',
    features: {
      'curated-assets': { rows: [...rows, verified, presence] },
    },
  };
  assert.deepEqual(
    assetConnections(board, labelPoint).map(
      ({ asset, coordinates, approximate, kind }) => [
        asset.id,
        coordinates,
        approximate,
        kind,
      ],
    ),
    [
      ['a', [10, 51], false, 'ownership'],
      ['c', [10.6, 51.3], true, 'ownership'],
      ['title', [10.6, 51.3], true, 'ownership'],
      ['presence', [10.6, 51.3], true, 'presence'],
    ],
  );
  assert.equal(
    ownedAbroad(board, 'CHN').some(({ id }) => id === 'presence'),
    false,
  );
});

test('ownership is limited to independently documented owners abroad', () => {
  assert.deepEqual(
    ownedAbroad(snapshot, 'CHN').map(({ id }) => id),
    ['a', 'c'],
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

test('a cluster is anchored to the member nearest its centre', () => {
  const central = { ...rows[1], id: 'middle', geometry: point(10.5, 51.5) };
  const board = {
    ...snapshot,
    features: { 'curated-assets': { rows: [...rows, central] } },
  };
  const markers = assetMarkers(board, 'global');
  const group = markers.find((marker) =>
    marker.members.some(({ id }) => id === 'a'),
  );
  assert.deepEqual(group.members.map(({ id }) => id).sort(), [
    'a',
    'b',
    'middle',
  ]);
  assert.deepEqual(group.coordinates, [10.5, 51.5]);
  assert.deepEqual(
    assetClusterMembers(board, group.id)
      .map(({ id }) => id)
      .sort(),
    ['a', 'b', 'middle'],
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
  assert.equal(markers.find((marker) => marker.id === 'e').owner, 'CHN');
  assert.equal(
    markers.find((marker) => marker.id === 'd'),
    undefined,
  );
});

test('only Ownership shows asset markers at board height, for its selected country', () => {
  assert.equal(showAssetMarkers(8_000_000, 'condition', 'CHN'), false);
  assert.equal(showAssetMarkers(2_000_000, 'energy', 'CHN'), false);
  assert.equal(showAssetMarkers(1_999_999, 'energy'), true);
  assert.equal(showAssetMarkers(8_000_000, 'ownership'), false);
  assert.equal(showAssetMarkers(8_000_000, 'ownership', 'CHN'), true);
  assert.equal(showAssetMarkers(1_000_000, 'ownership', 'CHN'), true);
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
    '2 documented owned assets abroad',
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
