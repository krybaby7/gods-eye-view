import test from 'node:test';
import assert from 'node:assert/strict';
import { LENSES } from './catalog.js';
import { createApplicationCatalog } from '../app/constructCatalog.js';
import { createSurfaceServices } from '../app/surfaceServices.js';

test('the seven lenses have unique ids and the ordered hotkeys 1 through 7', () => {
  assert.deepEqual(
    LENSES.map(({ id }) => id),
    ['air', 'sea', 'space', 'conflict', 'hazards', 'city', 'signals'],
  );
  assert.deepEqual(
    LENSES.map(({ hotkey }) => hotkey),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(new Set(LENSES.map(({ id }) => id)).size, LENSES.length);
  assert.equal(new Set(LENSES.map(({ hotkey }) => hotkey)).size, LENSES.length);
  for (const lens of LENSES) {
    assert.ok(lens.label && lens.icon, lens.id);
    assert.equal(new Set(lens.layerIds).size, lens.layerIds.length, lens.id);
  }
});

test('every lens layer is registered in the real application catalog', (t) => {
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const catalog = createApplicationCatalog({
    sources: {},
    signal: lifetime.signal,
    surface: createSurfaceServices({
      terrainSource: { getHeights: async () => [] },
      signal: lifetime.signal,
      eventTarget: null,
    }),
  });
  for (const lens of LENSES) {
    for (const id of lens.layerIds)
      assert.ok(catalog.get(id), `${lens.id}: ${id}`);
  }
});

test('lens membership preserves the owner decisions and shared layers', () => {
  const byId = Object.fromEntries(LENSES.map((lens) => [lens.id, lens]));
  assert.deepEqual(byId.air.layerIds, ['flights', 'military', 'local-adsb']);
  assert.deepEqual(byId.sea.layerIds, [
    'ais-live-vessels',
    'telegeography-submarine-cables',
  ]);
  assert.deepEqual(byId.space.layerIds, ['satellites', 'rocket-launches']);
  assert.deepEqual(byId.conflict.layerIds, [
    'military',
    'military-installations',
    'local-firms',
  ]);
  assert.deepEqual(byId.hazards.layerIds, [
    'earthquakes',
    'weather-cyclones',
    'local-firms',
    'fire-perimeters',
    'weather-radar',
    'weather-lightning',
    'wind',
  ]);
  assert.deepEqual(byId.city.layerIds, [
    'traffic',
    'transit',
    'bikeshare',
    'cctv',
    'alpr-cameras',
  ]);
  assert.deepEqual(byId.signals.layerIds, ['radio', 'cctv']);
  const assigned = new Set(LENSES.flatMap(({ layerIds }) => layerIds));
  for (const id of [
    'news',
    'street-level',
    'directions',
    'recent-imagery',
    'local-datacenters',
    'local-dams',
    'weather-satellite',
    'military-awareness',
    'bhote-koshi-2026',
    'bhote-koshi-locator',
  ])
    assert.equal(assigned.has(id), false, id);
});

test('the lens catalog and its nested memberships are frozen', () => {
  assert.ok(Object.isFrozen(LENSES));
  for (const lens of LENSES) {
    assert.ok(Object.isFrozen(lens), lens.id);
    assert.ok(Object.isFrozen(lens.layerIds), lens.id);
    assert.throws(() => lens.layerIds.push('another'), TypeError);
  }
  assert.throws(() => LENSES.push({ id: 'another' }), TypeError);
  assert.throws(() => {
    LENSES[0].label = 'Another';
  }, TypeError);
});
