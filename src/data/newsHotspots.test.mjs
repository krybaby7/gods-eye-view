import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOTSPOT_NEAR_KM,
  assignHotspots,
} from '../../server/providers/news/hotspots.js';

// A small hand gazetteer: not world.json, so the rules are tested alone.
const row = (name, lat, lon, precision, country, extra = {}) => ({
  name,
  lat,
  lon,
  precision,
  country,
  aliases: [],
  ...extra,
});
const gazetteer = [
  row('West Bank', 31.95, 35.25, 'region', 'Palestine'),
  row('Hebron', 31.53, 35.1, 'city', 'Palestine', { hotspot: 'West Bank' }),
  row('Donbas', 48.5, 38.4, 'region', 'Ukraine'),
  row('Red Sea', 20, 38.5, 'water', 'Regional Waters'),
  row('Venezuela', 7.1, -66.2, 'country', 'Venezuela'),
  row('Caracas', 10.5, -66.92, 'city', 'Venezuela'),
  row('Georgia (country)', 42.2, 43.5, 'country', 'Georgia'),
  row('Tbilisi', 41.72, 44.79, 'city', 'Georgia'),
  row('Vienna', 48.21, 16.37, 'city', 'Austria'),
  row('Graz', 47.07, 15.44, 'city', 'Austria'),
  row('Spain', 40.2, -3.6, 'country', 'Spain'),
  row('Madrid', 40.42, -3.7, 'city', 'Spain'),
  row('Nowhere Atoll', -5, -150, 'site', null),
];

let serial = 0;
const story = (location, extra = {}) => ({
  id: `st_${++serial}`,
  title: 'A story',
  kind: 'event',
  status: 'open',
  location,
  ...extra,
});
const matched = (name) => {
  const hit = gazetteer.find((entry) => entry.name === name);
  return {
    lat: hit.lat,
    lon: hit.lon,
    precision: hit.precision,
    method: 'gazetteer',
    name,
  };
};
const model = (name, lat, lon) => ({
  lat,
  lon,
  precision: 'approximate',
  method: 'model',
  name,
});
const hotspotOf = (...stories) =>
  assignHotspots(stories, gazetteer).map((entry) => entry.hotspot);

test('rule 1: an explicit link joins the linked region, placed at its row', () => {
  assert.deepEqual(hotspotOf(story(matched('Hebron'))), [
    {
      key: 'region:West Bank',
      label: 'West Bank',
      kind: 'region',
      lat: 31.95,
      lon: 35.25,
    },
  ]);
});

test('rule 2: a region or water row is its own bubble', () => {
  assert.deepEqual(
    hotspotOf(story(matched('Donbas')), story(matched('Red Sea'))),
    [
      {
        key: 'region:Donbas',
        label: 'Donbas',
        kind: 'region',
        lat: 48.5,
        lon: 38.4,
      },
      {
        key: 'water:Red Sea',
        label: 'Red Sea',
        kind: 'water',
        lat: 20,
        lon: 38.5,
      },
    ],
  );
});

test('rule 3: a city joins its country, placed at the country row', () => {
  const [caracas, venezuela] = hotspotOf(
    story(matched('Caracas')),
    story(matched('Venezuela')),
  );
  const expected = {
    key: 'country:Venezuela',
    label: 'Venezuela',
    kind: 'country',
    lat: 7.1,
    lon: -66.2,
  };
  assert.deepEqual(caracas, expected);
  assert.deepEqual(venezuela, expected);
  // The label is the row's country label, not the row's own name.
  const [tbilisi] = hotspotOf(story(matched('Tbilisi')));
  assert.equal(tbilisi.key, 'country:Georgia');
  assert.equal(tbilisi.label, 'Georgia');
  assert.deepEqual([tbilisi.lat, tbilisi.lon], [42.2, 43.5]);
});

test('rule 3: without a country row the bubble sits at its stories’ average', () => {
  const [vienna, graz] = hotspotOf(
    story(matched('Vienna')),
    story(matched('Graz')),
  );
  assert.equal(vienna.key, 'country:Austria');
  assert.deepEqual(vienna, graz);
  assert.ok(Math.abs(vienna.lat - 47.64) < 0.02, String(vienna.lat));
  assert.ok(Math.abs(vienna.lon - 15.9) < 0.02, String(vienna.lon));
});

test('rule 4: a model-placed story takes its nearest row within 100 km', () => {
  assert.equal(HOTSPOT_NEAR_KM, 100);
  // Toledo, Spain: Madrid is about 70 km away.
  const [toledo] = hotspotOf(story(model('Toledo', 39.86, -4.02)));
  assert.equal(toledo.key, 'country:Spain');
  assert.deepEqual([toledo.lat, toledo.lon], [40.2, -3.6]);
  // A model point near Hebron follows Hebron's link.
  const [nearHebron] = hotspotOf(story(model('Dura', 31.51, 35.03)));
  assert.equal(nearHebron.key, 'region:West Bank');
});

test('rule 5: nothing near gives a place bubble that one name shares', () => {
  const [first, second, other] = hotspotOf(
    story(model('Wonsan', 39.15, 127.44)),
    story(model('  wonsan ', 39.17, 127.42)),
    story(model('Cebu', 10.3, 123.9)),
  );
  assert.equal(first.key, 'place:wonsan');
  assert.equal(first.kind, 'place');
  assert.equal(first.label, 'Wonsan');
  assert.deepEqual(first, second, 'one name, one bubble at the average');
  assert.ok(Math.abs(first.lat - 39.16) < 0.001);
  assert.ok(Math.abs(first.lon - 127.43) < 0.001);
  assert.equal(other.key, 'place:cebu');
  const [unnamed] = hotspotOf(story(model(null, 12.345, -45.678)));
  assert.deepEqual(unnamed, {
    key: 'point:12.3,-45.7',
    label: 'Unnamed place',
    kind: 'place',
    lat: 12.345,
    lon: -45.678,
  });
});

test('a row with no country label falls through to a place bubble', () => {
  const [atoll] = hotspotOf(story(matched('Nowhere Atoll')));
  assert.equal(atoll.key, 'place:nowhere atoll');
  assert.equal(atoll.label, 'Nowhere Atoll');
});

test('a gazetteer match whose row is gone is treated as model-placed', () => {
  const [gone] = hotspotOf(
    story({ ...matched('Madrid'), name: 'Old Madrid row' }),
  );
  assert.equal(gone.key, 'country:Spain');
  const [far] = hotspotOf(
    story({
      lat: -30,
      lon: 60,
      precision: 'city',
      method: 'gazetteer',
      name: 'Lost City',
    }),
  );
  assert.equal(far.key, 'place:lost city');
});

test('stories without a location and developments belong to no bubble', () => {
  const unplaced = story(null);
  const development = story(matched('Caracas'), { kind: 'development' });
  const result = assignHotspots([unplaced, development], gazetteer);
  assert.equal(Object.hasOwn(result[0], 'hotspot'), false);
  assert.equal(Object.hasOwn(result[1], 'hotspot'), false);
});

test('grouping is pure: stories are copied, never changed', () => {
  const input = story(matched('Hebron'));
  const before = structuredClone(input);
  const [output] = assignHotspots([input], gazetteer);
  assert.deepEqual(input, before);
  assert.notEqual(output, input);
  assert.equal(output.id, input.id);
  assert.deepEqual(assignHotspots([], gazetteer), []);
  assert.deepEqual(
    assignHotspots([input], null)[0].hotspot.key,
    'place:hebron',
  );
});
