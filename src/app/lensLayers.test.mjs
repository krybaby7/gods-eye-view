import test from 'node:test';
import assert from 'node:assert/strict';
import { lensLayerSnapshots } from './lensLayers.js';

test('lens snapshots read catalog availability and effective intent without activating layers', () => {
  const layers = [
    { id: 'flights', enabled: false, stats: {} },
    { id: 'local-adsb', enabled: false, stats: {} },
  ];
  const reads = [];
  const manager = {
    getAll: () => layers,
    isEffectivelyEnabled: (id) => id === 'flights',
    setEnabled() {
      assert.fail('availability must not enable a layer');
    },
  };
  const catalog = {
    getSourceAvailability(id) {
      reads.push(id);
      return id === 'local-adsb'
        ? { available: false, reason: 'Connect a local receiver' }
        : { available: true };
    },
  };
  const snapshots = lensLayerSnapshots(manager, catalog);
  assert.deepEqual(reads, ['flights', 'local-adsb']);
  assert.equal(snapshots[0].enabled, true);
  assert.equal(snapshots[1].available, false);
  assert.equal(snapshots[1].reason, 'Connect a local receiver');
  assert.equal(layers[0].enabled, false);
  assert.equal(Object.hasOwn(layers[1], 'available'), false);
});

test('lens snapshots share key and source guidance while keeping stale and empty feeds available', () => {
  const manager = {
    getAll: () => [
      {
        id: 'local-firms',
        requiresKeyId: 'firms',
        stats: { keyRequired: true },
      },
      {
        id: 'missing',
        stats: { sourceUnavailable: true, error: 'Source omitted' },
      },
      { id: 'stale', stats: { stale: true, count: 3 } },
      { id: 'empty', stats: { count: 0 } },
    ],
    isEffectivelyEnabled: () => false,
  };
  const snapshots = lensLayerSnapshots(manager, {});
  assert.equal(snapshots[0].available, false);
  assert.match(snapshots[0].reason, /FIRMS_MAP_KEY/);
  assert.equal(snapshots[1].available, false);
  assert.equal(snapshots[1].reason, 'Source omitted');
  assert.equal(snapshots[2].available, true);
  assert.equal(snapshots[3].available, true);
});
