import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CITY_HOTSPOTS,
  CITY_MIN_POPULATION,
  HOTSPOTS,
  PLACE_RENAMES,
  TOWNS,
  buildWorldGazetteer,
} from '../../scripts/build-world-gazetteer.mjs';
import { resolvePlace } from '../../server/providers/news/geocode.js';

// A tiny Natural Earth: a few countries and places, and a province for
// every province-based hotspot, so the script's rules run without a download.
const country = (a3, name, lat, lon) => ({
  ADM0_A3: a3,
  TYPE: 'Sovereign country',
  SOVEREIGNT: name,
  ADMIN: name,
  NAME: name,
  NAME_LONG: name,
  LABEL_Y: lat,
  LABEL_X: lon,
});
let id = 0;
const place = (a3, name, population, lat, lon, extra = {}) => ({
  NE_ID: ++id,
  FEATURECLA: 'Populated place',
  ADM0_A3: a3,
  ADM1NAME: extra.adm1 ?? null,
  NAME: name,
  NAMEASCII: name,
  NAME_EN: name,
  POP_MAX: population,
  LATITUDE: lat,
  LONGITUDE: lon,
  ...extra,
});
const ne = {
  countries: [
    country('ESP', 'Spain', 40.2, -3.6),
    country('USA', 'United States of America', 39.5, -98.5),
    country('PSX', 'Palestine', 31.9, 35.2),
    country('UKR', 'Ukraine', 49.0, 31.4),
  ],
  places: [
    place('ESP', 'Madrid', 6_000_000, 40.42, -3.7, {
      FEATURECLA: 'Admin-0 capital',
    }),
    place('ESP', 'Testville', 450_000, 41.0, -1.0),
    place('ESP', 'Smallville', 200_000, 38.0, -2.0),
    place('USA', 'Toledo', 469_924, 41.67, -83.58, { adm1: 'Ohio' }),
    // A Natural Earth erratum: the English name is another place's.
    place('ESP', 'Oujda', 409_391, 34.69, -1.91, {
      NE_ID: 1159149507,
      NAME_EN: 'Taza',
    }),
    place('PSX', 'Gaza City', 505_700, 31.53, 34.445),
    // A Natural Earth Rafah: the hand-written town duplicates it.
    place('PSX', 'Rafah', 350_000, 31.29, 34.25),
  ],
  provinces: HOTSPOTS.filter((spot) => spot.provinces).flatMap((spot) => {
    const [a3, ...names] = spot.provinces;
    return names.map((name) => ({
      adm0_a3: a3,
      name,
      latitude: 0,
      longitude: 0,
    }));
  }),
};
const cities = (gazetteer) =>
  gazetteer
    .filter(
      (row) =>
        row.precision === 'city' &&
        !row.prompt &&
        !TOWNS.some((town) => town.name === row.name),
    )
    .map((row) => row.name)
    .sort();

test('cities of 300,000 or more join the gazetteer (1 million before)', () => {
  assert.equal(CITY_MIN_POPULATION, 300_000);
  const before = buildWorldGazetteer(ne, { cityMinPopulation: 1_000_000 });
  const after = buildWorldGazetteer(ne);
  assert.deepEqual(cities(before.gazetteer), []);
  // (Natural Earth's Rafah, which shares a town's name, is checked below.)
  assert.deepEqual(cities(after.gazetteer), [
    'Gaza City',
    'Oujda',
    'Testville',
    'Toledo, Ohio',
  ]);
  // Capitals and countries are listed in the digest prompt; nothing else.
  for (const row of after.gazetteer.filter((entry) => entry.prompt))
    assert.ok(['country', 'city'].includes(row.precision), row.name);
  assert.equal(
    after.gazetteer.find((row) => row.name === 'Madrid').prompt,
    true,
  );
});

test('hand-written towns resolve, and CITY_HOTSPOTS links whichever row has the name', () => {
  const { gazetteer, log } = buildWorldGazetteer(ne);
  const row = (name) => gazetteer.find((entry) => entry.name === name);
  assert.equal(resolvePlace('Hebron', gazetteer)?.name, 'Hebron');
  assert.equal(resolvePlace('Khan Yunis', gazetteer)?.name, 'Khan Younis');
  assert.equal(resolvePlace('Bakhmut', gazetteer)?.name, 'Bakhmut');
  assert.equal(row('Hebron').hotspot, 'West Bank');
  assert.equal(row('Bakhmut').hotspot, 'Donbas');
  // A Natural Earth city takes its link too.
  assert.equal(row('Gaza City').hotspot, 'Gaza Strip');
  // Rows without a link carry none.
  assert.equal(Object.hasOwn(row('Testville'), 'hotspot'), false);
  assert.equal(Object.hasOwn(row('Marib'), 'hotspot'), false);
  // A link whose city is not a row here is logged, not silently lost.
  assert.ok(log.unlinked.includes('Donetsk → Donbas: no row has this name'));
  // Every link target is a hotspot row.
  const hotspots = new Set(HOTSPOTS.map((spot) => spot.name));
  for (const target of Object.keys(CITY_HOTSPOTS))
    assert.ok(hotspots.has(target), target);
});

test('a hand-written town that duplicates a Natural Earth row is logged and dropped', () => {
  const { gazetteer, log } = buildWorldGazetteer(ne);
  assert.deepEqual(log.duplicateTowns, [
    'Rafah: already Rafah (city), prune it from TOWNS',
  ]);
  const rafah = gazetteer.filter((row) => row.name === 'Rafah');
  assert.equal(rafah.length, 1);
  assert.equal(rafah[0].lat, 31.29, 'the Natural Earth row is kept');
  assert.equal(rafah[0].hotspot, 'Gaza Strip');
});

test('a row whose Natural Earth English name is wrong is renamed by NE_ID', () => {
  const { gazetteer } = buildWorldGazetteer(ne);
  assert.equal(PLACE_RENAMES.get(1159149507), 'Oujda');
  const row = gazetteer.find((entry) => entry.name === 'Oujda');
  assert.ok(row, 'the renamed row exists');
  assert.ok(!row.aliases.includes('Taza'), 'the wrong English name is gone');
  assert.equal(resolvePlace('Taza', gazetteer), null);
  assert.equal(resolvePlace('Oujda', gazetteer)?.name, 'Oujda');
});

test('a namesake renamed by hand loses the bare spelling', () => {
  const { gazetteer } = buildWorldGazetteer(ne);
  assert.equal(resolvePlace('Toledo', gazetteer), null);
  assert.equal(resolvePlace('Toledo, Ohio', gazetteer)?.name, 'Toledo, Ohio');
});

test('TOWNS: about 40 to 60 conflict towns, each placed and sourced', () => {
  assert.ok(TOWNS.length >= 40 && TOWNS.length <= 60, String(TOWNS.length));
  for (const town of TOWNS) {
    assert.ok(town.ref, town.name);
    assert.ok(
      Math.abs(town.at[0]) <= 90 && Math.abs(town.at[1]) <= 180,
      town.name,
    );
  }
  assert.equal(
    new Set(TOWNS.map((town) => town.name)).size,
    TOWNS.length,
    'one row per town',
  );
});
