import test from 'node:test';
import assert from 'node:assert/strict';
import { countLayersOn, layerStateWords } from './layerStates.js';

const words = (layer) => layerStateWords(layer).words;

test('switching and uncertain lifecycles say so before anything else', () => {
  assert.equal(
    words({ lifecycleState: 'enabling', enabled: false }),
    'Switching on',
  );
  assert.equal(
    words({ lifecycleState: 'disabling', enabled: true }),
    'Switching off',
  );
  assert.equal(
    words({ enabled: true, lifecycleUncertain: true, stats: { count: 4 } }),
    'State uncertain',
  );
});

test('a layer that cannot work is marked not available, with its reason', () => {
  const omitted = layerStateWords({
    enabled: false,
    stats: { sourceUnavailable: true, error: 'source omitted in this build' },
  });
  assert.deepEqual(omitted, {
    words: 'Not available',
    na: true,
    reason: 'Source omitted in this build',
  });
  const keyless = layerStateWords({
    enabled: false,
    requiresKeyId: 'firms',
    stats: { keyRequired: true },
  });
  assert.equal(keyless.na, true);
  assert.equal(keyless.words, 'Needs a NASA FIRMS key');
  assert.equal(
    words({
      enabled: false,
      requiresKeyId: 'unknown-key',
      stats: { missingKey: true },
    }),
    'Needs a key',
  );
});

test('off rows read Off, and Search layers says it asks first', () => {
  assert.equal(words({ id: 'flights', enabled: false }), 'Off');
  assert.equal(
    words({ id: 'searches', enabled: false }),
    'Asks before it runs',
  );
});

test('on rows report what the layer itself says', () => {
  const on = (stats, extra = {}) => words({ enabled: true, stats, ...extra });
  assert.equal(
    on({ keyRequired: true }, { requiresKeyId: 'aisstream' }),
    'Waiting for an AISStream key',
  );
  assert.equal(on({ status: 'zoom-in' }), 'Zoom in to see');
  assert.equal(
    on({ status: 'idle', statusMessage: 'pick a city first' }),
    'Pick a city first',
  );
  assert.equal(on({ loading: true }), 'Loading');
  assert.equal(on({ fallback: true, count: 3 }), 'Backup feed');
  assert.equal(on({ degraded: true, count: 3 }), 'Having trouble');
  assert.equal(on({ partial: true, count: 3 }), 'Partly loaded');
  assert.equal(on({ status: 'error' }), 'Not available');
  assert.equal(on({ count: 12 }), 'Live');
  assert.equal(on({}), 'On', 'no claim of live without data');
});

test('stale rows name the local time of their last update', () => {
  const at = new Date(2026, 10, 16, 9, 5).getTime();
  assert.equal(
    words({ enabled: true, stats: { stale: true, lastUpdate: at } }),
    'Stale since 09:05',
  );
  assert.equal(words({ enabled: true, stats: { stale: true } }), 'Stale');
});

test('the on count only counts listed layers', () => {
  const layers = [
    { id: 'flights', enabled: true },
    { id: 'world', enabled: true },
    { id: 'radio', enabled: false },
  ];
  assert.equal(
    countLayersOn(layers, (id) => id !== 'world'),
    1,
  );
});
