import test from 'node:test';
import assert from 'node:assert/strict';
import { lensStatus, planLensClick } from './rules.js';

const air = Object.freeze({
  id: 'air',
  layerIds: Object.freeze(['flights', 'military', 'local-adsb']),
});
const conflict = Object.freeze({
  id: 'conflict',
  layerIds: Object.freeze(['military', 'installations', 'fires']),
});
const lenses = Object.freeze([air, conflict]);
const row = (id, enabled = false, available = true) => ({
  id,
  enabled,
  available,
});
const rows = (enabled = [], unavailable = []) =>
  ['flights', 'military', 'local-adsb', 'installations', 'fires'].map((id) =>
    row(id, enabled.includes(id), !unavailable.includes(id)),
  );

test('lens status distinguishes off, partial and on from the supplied effective intent', () => {
  assert.deepEqual(lensStatus(air, rows()), {
    status: 'off',
    enabledCount: 0,
    availableCount: 3,
  });
  assert.deepEqual(lensStatus(air, rows(['military'])), {
    status: 'partial',
    enabledCount: 1,
    availableCount: 3,
  });
  assert.deepEqual(lensStatus(air, rows(air.layerIds)), {
    status: 'on',
    enabledCount: 3,
    availableCount: 3,
  });
});

test('missing and unavailable layers do not count toward an available lens', () => {
  assert.deepEqual(
    lensStatus(air, rows(['flights', 'military'], ['local-adsb'])),
    {
      status: 'on',
      enabledCount: 2,
      availableCount: 2,
    },
  );
  assert.deepEqual(
    lensStatus(air, rows(['flights', 'local-adsb'], ['local-adsb'])),
    {
      status: 'partial',
      enabledCount: 1,
      availableCount: 2,
    },
  );
  assert.deepEqual(lensStatus(air, [row('flights')]), {
    status: 'off',
    enabledCount: 0,
    availableCount: 1,
  });
});

test('no available layers means unavailable, even if an unavailable layer was enabled', () => {
  assert.deepEqual(lensStatus(air, rows(air.layerIds, air.layerIds)), {
    status: 'unavailable',
    enabledCount: 0,
    availableCount: 0,
  });
  assert.deepEqual(lensStatus(air, []), {
    status: 'unavailable',
    enabledCount: 0,
    availableCount: 0,
  });
});

test('clicking an off lens enables precisely its available layers in catalog order', () => {
  assert.deepEqual(planLensClick(air, lenses, rows([], ['local-adsb'])), [
    { layerId: 'flights', enabled: true },
    { layerId: 'military', enabled: true },
  ]);
});

test('clicking a partial lens completes it without toggling an already-on layer', () => {
  assert.deepEqual(
    planLensClick(conflict, lenses, rows(['military', 'fires'])),
    [{ layerId: 'installations', enabled: true }],
  );
});

test('clicking an on lens disables its layers without changing unrelated layers', () => {
  assert.deepEqual(planLensClick(air, lenses, rows(air.layerIds)), [
    { layerId: 'flights', enabled: false },
    { layerId: 'military', enabled: false },
    { layerId: 'local-adsb', enabled: false },
  ]);
});

test('another fully-on lens protects a shared layer when one lens turns off', () => {
  assert.deepEqual(
    planLensClick(air, lenses, rows([...air.layerIds, ...conflict.layerIds])),
    [
      { layerId: 'flights', enabled: false },
      { layerId: 'local-adsb', enabled: false },
    ],
  );
});

test('a partial lens does not protect its shared layers', () => {
  assert.deepEqual(
    planLensClick(air, lenses, rows([...air.layerIds, 'fires'])),
    [
      { layerId: 'flights', enabled: false },
      { layerId: 'military', enabled: false },
      { layerId: 'local-adsb', enabled: false },
    ],
  );
});

test('a lens on across all available layers still protects shared layers', () => {
  assert.deepEqual(
    planLensClick(
      air,
      lenses,
      rows([...air.layerIds, 'installations'], ['fires']),
    ),
    [
      { layerId: 'flights', enabled: false },
      { layerId: 'local-adsb', enabled: false },
    ],
  );
});

test('unavailable layers are omitted from every change, including an off plan', () => {
  assert.deepEqual(
    planLensClick(air, lenses, rows(air.layerIds, ['local-adsb'])),
    [
      { layerId: 'flights', enabled: false },
      { layerId: 'military', enabled: false },
    ],
  );
  assert.deepEqual(planLensClick(air, lenses, rows([], air.layerIds)), []);
  assert.deepEqual(planLensClick(air, lenses, []), []);
});

test('all protected layers produce no changes and the current lens never protects itself', () => {
  const first = { id: 'first', layerIds: ['shared'] };
  const second = { id: 'second', layerIds: ['shared'] };
  const shared = [row('shared', true)];
  assert.deepEqual(planLensClick(first, [first, second], shared), []);
  assert.deepEqual(planLensClick(first, [first], shared), [
    { layerId: 'shared', enabled: false },
  ]);
});

test('fresh effective intent makes a rapid second click reverse the first', () => {
  const snapshot = rows();
  const first = planLensClick(air, lenses, snapshot);
  assert.ok(first.every(({ enabled }) => enabled));
  for (const change of first)
    snapshot.find(({ id }) => id === change.layerId).enabled = change.enabled;
  assert.deepEqual(
    planLensClick(air, lenses, snapshot),
    first.map(({ layerId }) => ({ layerId, enabled: false })),
  );
});

test('manual layer changes, restoration and clear need no lens-owned state', () => {
  const restored = rows(air.layerIds);
  assert.equal(lensStatus(air, restored).status, 'on');
  restored.find(({ id }) => id === 'flights').enabled = false;
  assert.equal(lensStatus(air, restored).status, 'partial');
  assert.deepEqual(planLensClick(air, lenses, restored), [
    { layerId: 'flights', enabled: true },
  ]);
  for (const layer of restored) layer.enabled = false;
  assert.equal(lensStatus(air, restored).status, 'off');
  assert.equal(lensStatus(conflict, restored).status, 'off');
});

test('status and click planning never mutate the catalog or supplied snapshots', () => {
  const snapshot = Object.freeze(rows(air.layerIds).map(Object.freeze));
  const before = JSON.stringify(snapshot);
  lensStatus(air, snapshot);
  const changes = planLensClick(air, lenses, snapshot);
  changes[0].enabled = true;
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(planLensClick(air, lenses, snapshot)[0].enabled, false);
});
