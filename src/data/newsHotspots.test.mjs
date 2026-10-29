import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceKm } from '../../server/providers/news/geocode.js';
import { assignHotspots } from '../../server/providers/news/hotspots.js';

const row = (name, lat, lon, precision, extra = {}) => ({
  name,
  lat,
  lon,
  precision,
  country: null,
  aliases: [],
  ...extra,
});
const gazetteer = [
  row('West Bank', 31.95, 35.25, 'region'),
  row('Hebron', 31.53, 35.1, 'city', {
    country: 'Palestinian Territories',
    hotspot: 'West Bank',
  }),
  row('Donbas', 48.0, 37.8, 'region'),
  row('Red Sea', 20.0, 38.5, 'water'),
  row('Venezuela', 6.42, -66.58, 'country', { country: 'Venezuela' }),
  row('Caracas', 10.48, -66.9, 'city', { country: 'Venezuela' }),
  row('Georgia (country)', 42.3, 43.4, 'country', { country: 'Georgia' }),
  row('Haifa', 32.79, 34.99, 'city', { country: 'Israel' }),
  row('Madrid', 40.4168, -3.7038, 'city', { country: 'Spain' }),
  row('Orphan Town', -30, 120, 'city'),
  row('Suva', -18.14, 178.44, 'city', { country: 'Fiji' }),
];

const story = (id, location, overrides = {}) => ({
  id,
  status: 'open',
  kind: 'event',
  location,
  ...overrides,
});
const placed = (name, row) => ({
  lat: row.lat,
  lon: row.lon,
  precision: row.precision,
  method: 'gazetteer',
  name,
});
const byName = (name) => gazetteer.find((entry) => entry.name === name);
const modelAt = (name, lat, lon) => ({
  lat,
  lon,
  precision: 'approximate',
  method: 'model',
  name,
});
const one = (location, overrides) =>
  assignHotspots([story('a', location, overrides)], gazetteer)[0].hotspot;

test('distanceKm is the great-circle distance on a 6371 km Earth', () => {
  assert.equal(distanceKm({ lat: 10, lon: 20 }, { lat: 10, lon: 20 }), 0);
  assert.ok(
    Math.abs(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }) - 10007.5) < 1,
  );
  // Across the antimeridian the short way round.
  assert.ok(
    Math.abs(
      distanceKm({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 }) - 111.2,
    ) < 0.5,
  );
});

test('rule 1: an explicit link joins the linked region, placed at that row', () => {
  assert.deepEqual(one(placed('Hebron', byName('Hebron'))), {
    key: 'region:West Bank',
    label: 'West Bank',
    kind: 'region',
    lat: 31.95,
    lon: 35.25,
  });
});

test('rule 2: a region row is its own bubble', () => {
  assert.deepEqual(one(placed('Donbas', byName('Donbas'))), {
    key: 'region:Donbas',
    label: 'Donbas',
    kind: 'region',
    lat: 48,
    lon: 37.8,
  });
});

test('rule 2: a water row is its own bubble', () => {
  assert.deepEqual(one(placed('Red Sea', byName('Red Sea'))), {
    key: 'water:Red Sea',
    label: 'Red Sea',
    kind: 'water',
    lat: 20,
    lon: 38.5,
  });
});

test('rule 3: a city joins its country, placed at the country row', () => {
  const [a, b] = assignHotspots(
    [
      story('a', placed('Caracas', byName('Caracas'))),
      story('b', placed('Venezuela', byName('Venezuela'))),
    ],
    gazetteer,
  );
  const expected = {
    key: 'country:Venezuela',
    label: 'Venezuela',
    kind: 'country',
    lat: 6.42,
    lon: -66.58,
  };
  assert.deepEqual(a.hotspot, expected);
  assert.deepEqual(b.hotspot, expected);
});

test('rule 3: the country label is the row country, not the row name', () => {
  const hotspot = one(placed('Georgia (country)', byName('Georgia (country)')));
  assert.equal(hotspot.key, 'country:Georgia');
  assert.equal(hotspot.label, 'Georgia');
  assert.equal(hotspot.lat, 42.3);
});

test('rule 3: with no country row the bubble sits at the stories average', () => {
  const stories = [
    story('a', placed('Haifa', byName('Haifa'))),
    story('b', modelAt('Near Haifa', 33.49, 34.99)),
  ];
  const [a, b] = assignHotspots(stories, gazetteer);
  assert.equal(a.hotspot.key, 'country:Israel');
  assert.equal(a.hotspot.kind, 'country');
  assert.ok(Math.abs(a.hotspot.lat - 33.14) < 0.01);
  assert.ok(Math.abs(a.hotspot.lon - 34.99) < 0.01);
  assert.deepEqual(a.hotspot, b.hotspot);
  assert.notEqual(a.hotspot, b.hotspot, 'each story owns its object');
});

test('the average counts open stories only, all of them when none are open', () => {
  const haifa = placed('Haifa', byName('Haifa'));
  const north = modelAt('Near Haifa', 33.49, 34.99);
  const mixed = assignHotspots(
    [story('a', haifa), story('b', north, { status: 'closed' })],
    gazetteer,
  );
  assert.equal(mixed[0].hotspot.lat, 32.79);
  assert.equal(mixed[1].hotspot.lat, 32.79);
  const allClosed = assignHotspots(
    [
      story('a', haifa, { status: 'closed' }),
      story('b', north, { status: 'closed' }),
    ],
    gazetteer,
  );
  assert.ok(Math.abs(allClosed[0].hotspot.lat - 33.14) < 0.01);
});

test('rule 4: a model-placed story takes its nearest row within 100 km', () => {
  const hotspot = one(modelAt('Toledo', 39.86, -4.02));
  assert.ok(
    distanceKm({ lat: 39.86, lon: -4.02 }, byName('Madrid')) > 60 &&
      distanceKm({ lat: 39.86, lon: -4.02 }, byName('Madrid')) < 80,
  );
  assert.equal(hotspot.key, 'country:Spain');
  assert.equal(hotspot.label, 'Spain');
  // No Spain row: placed at the stories' average, here the one story.
  assert.equal(hotspot.lat, 39.86);
  assert.equal(hotspot.lon, -4.02);
});

test('rule 4: a nearby region row applies rules 1 to 3 to that row', () => {
  const hotspot = one(modelAt('Somewhere near Hebron', 31.6, 35.15));
  assert.equal(hotspot.key, 'region:West Bank');
});

test('rule 5: a model-placed story with nothing within 100 km gets a place bubble', () => {
  const hotspot = one(modelAt('Wonsan', 39.15, 127.45));
  assert.deepEqual(hotspot, {
    key: 'place:wonsan',
    label: 'Wonsan',
    kind: 'place',
    lat: 39.15,
    lon: 127.45,
  });
  const [a, b] = assignHotspots(
    [
      story('a', modelAt('Wonsan', 39.1, 127.4)),
      story('b', modelAt('WŌNSAN', 39.2, 127.5)),
    ],
    gazetteer,
  );
  assert.equal(a.hotspot.key, 'place:wonsan');
  assert.equal(b.hotspot.key, 'place:wonsan');
  assert.equal(a.hotspot.label, 'Wonsan', 'label as the first story gave it');
  assert.deepEqual(a.hotspot, b.hotspot);
  assert.ok(Math.abs(a.hotspot.lat - 39.15) < 0.01);
  assert.ok(Math.abs(a.hotspot.lon - 127.45) < 0.01);
});

test('rule 5: no usable name gives a point key and an unnamed label', () => {
  for (const name of [null, '  ', '...']) {
    const hotspot = one(modelAt(name, 39.14, 127.46));
    assert.equal(hotspot.key, 'point:39.1,127.5');
    assert.equal(hotspot.label, 'Unnamed place');
    assert.equal(hotspot.kind, 'place');
  }
});

test('a gazetteer story whose row is gone is treated as model-placed', () => {
  const near = one(placed('Old Madrid', { ...byName('Madrid'), lat: 40.5 }));
  assert.equal(near.key, 'country:Spain');
  const lost = one(
    placed('Gone Town', { lat: -50, lon: -50, precision: 'city' }),
  );
  assert.equal(lost.key, 'place:gone town');
  assert.equal(lost.label, 'Gone Town');
});

test('rule 5: a city row with a null country is its own place bubble', () => {
  const hotspot = one(placed('Orphan Town', byName('Orphan Town')));
  assert.equal(hotspot.key, 'place:orphan town');
  assert.equal(hotspot.kind, 'place');
  assert.equal(hotspot.label, 'Orphan Town');
  // The same through rule 4.
  const nearby = one(modelAt('Nearby', -30.2, 120.1));
  assert.equal(nearby.key, 'place:nearby');
});

test('no location, or a development, belongs to no bubble', () => {
  const result = assignHotspots(
    [
      story('a', null),
      story('b', placed('Caracas', byName('Caracas')), { kind: 'development' }),
      story('c', undefined),
      story('d', { lat: NaN, lon: 3, name: 'x', method: 'model' }),
    ],
    gazetteer,
  );
  assert.deepEqual(
    result.map((s) => s.hotspot),
    [null, null, null, null],
  );
});

test('the average of stories either side of the antimeridian stays near it', () => {
  const [a, b] = assignHotspots(
    [
      story('a', modelAt('Taveuni', -16.9, 179.9)),
      story('b', modelAt('Taveuni', -16.9, -179.9)),
    ],
    gazetteer,
  );
  assert.equal(a.hotspot.key, 'place:taveuni');
  assert.ok(Math.abs(Math.abs(a.hotspot.lon) - 180) < 0.01, a.hotspot.lon);
  assert.ok(Math.abs(a.hotspot.lat + 16.9) < 0.01);
  assert.deepEqual(a.hotspot, b.hotspot);
});

test('hotspot coordinates are rounded to four decimals', () => {
  const hotspot = one(modelAt('Rounded', 12.345678, 45.678912));
  assert.deepEqual([hotspot.lat, hotspot.lon], [12.3457, 45.6789]);
});

test('input stories and gazetteer are not mutated', () => {
  const stories = [
    story('a', placed('Hebron', byName('Hebron'))),
    story('b', null),
  ];
  const before = JSON.stringify(stories);
  const gazetteerBefore = JSON.stringify(gazetteer);
  const result = assignHotspots(stories, gazetteer);
  assert.equal(JSON.stringify(stories), before);
  assert.equal(JSON.stringify(gazetteer), gazetteerBefore);
  assert.notEqual(result[0], stories[0]);
  assert.equal('hotspot' in stories[0], false);
  assert.equal(result[0].id, 'a');
});
