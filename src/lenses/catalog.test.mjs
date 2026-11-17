import test from 'node:test';
import assert from 'node:assert/strict';
import { LENSES } from './catalog.js';
import { LAYER_GROUPS, LAYERS_WITHOUT_ROWS, layerRowFor } from './groups.js';
import {
  APPLICATION_LAYER_METADATA,
  createApplicationCatalog,
} from '../app/constructCatalog.js';
import { createSurfaceServices } from '../app/surfaceServices.js';
import { LayerLifecycle } from '../data/lifecycle.js';
import { ContextControls } from '../ui/contextControls.js';
import { planLensClick } from './rules.js';

function spaceContext(t) {
  const manager = new LayerLifecycle({});
  for (const id of ['satellites', 'rocket-launches']) {
    manager.register({
      id,
      name: id,
      init: async () => true,
      enable: async () => true,
      update: async () => true,
      disable: async () => true,
      destroy: async () => true,
    });
  }
  manager.finalizeRegistrations(
    [...manager.layers.keys()].map((id) => ({
      id,
      disposition: 'enabled-only',
    })),
  );
  const controls = new ContextControls({
    elements: {},
    installations: {},
    actions: {
      getCockpit: () => null,
      claimVisualAuthority() {},
      showToast() {},
      setClearBusy() {},
      syncDetection() {},
      scheduleLayout() {},
      refreshRadio() {},
      setPanelCollapsed() {},
    },
  });
  controls.connect(manager);
  t.after(async () => {
    controls.stop();
    controls.disconnect();
    await manager.destroyAll();
  });
  const space = LENSES.find(({ id }) => id === 'space');
  const click = () => {
    const layers = manager.getAll().map((layer) => ({
      ...layer,
      available: true,
      enabled: manager.isEffectivelyEnabled(layer.id),
    }));
    return Promise.all(
      planLensClick(space, LENSES, layers).map(({ layerId, enabled }) =>
        manager.setEnabled(layerId, enabled, { origin: 'user' }),
      ),
    );
  };
  return { manager, controls, click };
}

test('the eight presets follow the menu chips, with hotkeys 1 through 8', () => {
  assert.deepEqual(
    LENSES.map(({ label }) => label),
    [
      'Air',
      'Sea',
      'Space',
      'Hazards and weather',
      'Security',
      'Infrastructure',
      'City',
      'Tools',
    ],
  );
  assert.deepEqual(
    LENSES.map(({ hotkey }) => hotkey),
    [1, 2, 3, 4, 5, 6, 7, 8],
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

test('a preset switches exactly its menu group, never a panel tool, the War Monitor or a rowless layer', () => {
  for (const lens of LENSES) {
    const entry = LAYER_GROUPS.find(({ id }) => id === lens.id);
    assert.ok(entry, lens.id);
    assert.deepEqual(
      lens.layerIds,
      entry.rows.filter((row) => !row.opensPanel).map((row) => row.id),
      lens.id,
    );
  }
  const assigned = LENSES.flatMap(({ layerIds }) => layerIds);
  assert.equal(
    new Set(assigned).size,
    assigned.length,
    'no layer in two presets',
  );
  for (const id of ['searches', 'news', ...LAYERS_WITHOUT_ROWS])
    assert.equal(assigned.includes(id), false, id);
});

test('every catalog layer has exactly one row or is named as rowless', () => {
  const rows = LAYER_GROUPS.flatMap((entry) => entry.rows.map(({ id }) => id));
  assert.equal(new Set(rows).size, rows.length, 'a layer appears in one row');
  const catalogIds = APPLICATION_LAYER_METADATA.map(({ id }) => id);
  for (const id of catalogIds)
    assert.ok(
      rows.includes(id) !== LAYERS_WITHOUT_ROWS.includes(id),
      `${id} must have a row or be listed as rowless, not both`,
    );
  for (const id of [...rows, ...LAYERS_WITHOUT_ROWS])
    assert.ok(catalogIds.includes(id), `${id} is not a catalog layer`);
  for (const id of rows) assert.equal(layerRowFor(id).row.id, id);
  assert.equal(layerRowFor('world'), null);
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

test('Space captures the existing Context baseline before its satellite enable intent', async (t) => {
  const { manager, controls, click } = spaceContext(t);
  const pending = click();
  assert.deepEqual(
    [...controls._contextSessionSnapshot.enabledLayerIds],
    [],
    'this lens satellite intent must not become a pre-entry layer to restore',
  );
  assert.deepEqual(await pending, [true, true]);
  assert.deepEqual(
    new Set(manager.getEnabledLayerIds()),
    new Set(['satellites', 'rocket-launches']),
  );
});

test('Space turns both layers off after the existing Context restoration settles', async (t) => {
  const { manager, controls, click } = spaceContext(t);
  assert.deepEqual(await click(), [true, true]);
  await controls._waitForContextLayerSettlement();
  assert.equal(controls.getContextModeState().mode, 'space-missions');
  await click();
  await controls._waitForContextLayerSettlement();
  assert.deepEqual([...manager.getEnabledLayerIds()], []);
  assert.equal(controls.getContextModeState().mode, null);
});
