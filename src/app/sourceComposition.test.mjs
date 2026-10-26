import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveCatalogSources,
  CATALOG_SOURCE_CONTRACTS,
} from './sourceComposition.js';
import { createApplicationCatalog } from './constructCatalog.js';
import { createSurfaceServices } from './surfaceServices.js';
import { createStandaloneLayerSources } from '../standalone/layerSources.js';
import { LayerLifecycle } from '../data/lifecycle.js';

function catalog(sources, t, sourceConfiguration) {
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  return createApplicationCatalog({
    sources,
    sourceConfiguration,
    signal: lifetime.signal,
    surface: createSurfaceServices({
      terrainSource: { getHeights: async () => [] },
      signal: lifetime.signal,
      eventTarget: null,
    }),
  });
}

test('every acquisition source can be omitted without losing catalog membership', (t) => {
  const baseline = catalog(createStandaloneLayerSources(), t);
  for (const name of Object.keys(CATALOG_SOURCE_CONTRACTS)) {
    const sources = createStandaloneLayerSources({ [name]: null });
    const actual = catalog(sources, t);
    assert.deepEqual(actual.metadata, baseline.metadata, name);
    for (const id of CATALOG_SOURCE_CONTRACTS[name].layers) {
      assert.equal(actual.getSourceAvailability(id).available, false, id);
    }
  }
});

test('cold keyless catalog rows share configuration reasons without initializing or acquiring', (t) => {
  let acquisitions = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    acquisitions++;
    throw new Error('Availability must not acquire a feed');
  });
  const actual = catalog(createStandaloneLayerSources(), t, {
    firms: false,
    vessels: false,
    localAdsb: false,
  });
  const manager = new LayerLifecycle(
    {},
    {
      getSourceAvailability: actual.getSourceAvailability,
    },
  );
  for (const layer of actual.layers) manager.register(layer);
  for (const id of ['local-firms', 'ais-live-vessels', 'local-adsb']) {
    const availability = actual.getSourceAvailability(id);
    assert.equal(availability.available, false, id);
    const row = manager.getAll().find((entry) => entry.id === id);
    assert.equal(row.stats.sourceUnavailable, true, id);
    assert.equal(row.stats.error, availability.reason, id);
    assert.equal(manager.layers.get(id).initialized, false, id);
  }
  assert.match(
    actual.getSourceAvailability('local-firms').reason,
    /FIRMS_MAP_KEY/,
  );
  assert.match(
    actual.getSourceAvailability('ais-live-vessels').reason,
    /AISSTREAM_API_KEY/,
  );
  assert.equal(acquisitions, 0);
});

test('provider availability is live and omitted providers cannot be revived by configuration', (t) => {
  let available = false;
  let reads = 0;
  const source = {
    getSnapshot() {
      throw new Error('Availability must not read a snapshot');
    },
    getSourceAvailability() {
      reads++;
      return {
        available,
        reason: available ? null : 'Provider not configured',
      };
    },
  };
  const actual = catalog(createStandaloneLayerSources({ firms: source }), t, {
    firms: false,
  });
  assert.equal(actual.getSourceAvailability('local-firms').available, false);
  available = true;
  assert.equal(actual.getSourceAvailability('local-firms').available, true);
  assert.equal(reads, 2);
  const absent = catalog(createStandaloneLayerSources({ firms: null }), t, {
    firms: true,
  });
  assert.equal(absent.getSourceAvailability('local-firms').available, false);
  assert.match(
    absent.getSourceAvailability('local-firms').reason,
    /data source not configured/,
  );
});

test('local receiver availability follows a connected device without selecting its mode', (t) => {
  const actual = catalog(createStandaloneLayerSources(), t, {
    localAdsb: false,
  });
  const layer = actual.get('local-adsb');
  const initial = layer.receiver.getState();
  let connected = false;
  t.mock.method(layer.receiver, 'getState', () => ({ ...initial, connected }));
  t.mock.method(layer.receiver, 'setMode', () => {
    throw new Error('Must not tune while checking availability');
  });
  assert.equal(actual.getSourceAvailability('local-adsb').available, false);
  connected = true;
  assert.equal(actual.getSourceAvailability('local-adsb').available, true);
});

test('all acquisition sources may be absent, and enable fails before initializing or fetching', async (t) => {
  const actual = catalog({}, t);
  assert.equal(actual.layers.length, 30);
  const manager = new LayerLifecycle(
    {},
    { getSourceAvailability: actual.getSourceAvailability },
  );
  for (const layer of actual.layers) manager.register(layer);
  for (const { layers: ids } of Object.values(CATALOG_SOURCE_CONTRACTS)) {
    for (const id of ids) {
      assert.equal(await manager.setEnabled(id, true), false, id);
      assert.equal(manager.layers.get(id).initialized, false, id);
      const row = manager.getAll().find((entry) => entry.id === id);
      assert.equal(row.enabled, false);
      assert.equal(row.stats.status, 'unavailable');
      assert.match(row.stats.error, /data source not configured/);
    }
  }
});

test('configured sources retain identity; invalid implementations never become unavailable silently', () => {
  const source = { getSnapshot: async () => [] };
  assert.equal(
    resolveCatalogSources({ earthquakes: source }).sources.earthquakes,
    source,
  );
  for (const name of Object.keys(CATALOG_SOURCE_CONTRACTS)) {
    assert.throws(
      () => resolveCatalogSources({ [name]: {} }),
      /Invalid catalog source/,
    );
  }
  const missing = resolveCatalogSources({}).sources.earthquakes;
  assert.throws(() => missing.getSnapshot(), { code: 'unavailable' });
});

test('standalone defaults allow exact replacements and explicit removal, and reject typos', () => {
  const source = { getSnapshot: async () => [] };
  const sources = createStandaloneLayerSources({
    flights: source,
    military: null,
  });
  assert.equal(sources.flights, source);
  assert.equal(sources.military, null);
  assert.equal(typeof sources.cctv.getCatalog, 'function');
  assert.throws(
    () => createStandaloneLayerSources({ fligts: source }),
    /Unknown source/,
  );
});

test('empty Street Level uses the shared unavailable lifecycle without initialization', async (t) => {
  const actual = catalog({}, t);
  const manager = new LayerLifecycle(
    {},
    { getSourceAvailability: actual.getSourceAvailability },
  );
  manager.register(actual.get('street-level'));
  assert.equal(await manager.setEnabled('street-level', true), false);
  assert.equal(manager.layers.get('street-level').initialized, false);
  const row = manager.getAll()[0];
  assert.equal(row.stats.status, 'unavailable');
  assert.equal(row.stats.error, 'No street-level imagery providers configured');
  assert.equal(await manager.setEnabled('street-level', false), true);
  const configured = catalog(createStandaloneLayerSources(), t);
  assert.equal(
    configured.get('street-level').getSourceAvailability().available,
    true,
  );
});

test('availability lookup accepts frozen layers and uses their display names', () => {
  const composition = resolveCatalogSources({});
  const layers = Object.values(CATALOG_SOURCE_CONTRACTS)
    .flatMap(({ layers }) => layers)
    .map((id) =>
      Object.freeze({
        id,
        name: id === 'fire-perimeters' ? 'Fire perimeters' : id,
      }),
    );
  const lookup = composition.createAvailabilityLookup(layers);
  assert.equal(
    lookup('fire-perimeters').reason,
    'Fire perimeters: data source not configured',
  );
  assert.equal(Object.hasOwn(layers[0], 'getSourceAvailability'), false);
  const manager = new LayerLifecycle({}, { getSourceAvailability: lookup });
  manager.register(layers.find(({ id }) => id === 'fire-perimeters'));
  assert.equal(
    manager.getAll()[0].stats.error,
    'Fire perimeters: data source not configured',
  );
});

test('absent military acquisition does not poll, suppress flights, or erase supplied classification', async (t) => {
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetches++;
    throw new Error('Unexpected fallback acquisition');
  });
  const actual = catalog(createStandaloneLayerSources({ military: null }), t);
  const registry = actual.militaryRegistry;
  assert.equal(actual.getSourceAvailability('flights').available, true);
  assert.equal(registry.isMilitaryLayerActive(), false);
  assert.equal(registry.isMilitaryIcao('abc123'), false);
  registry.registerMilitaryIcaos([' ABC123 ']);
  await registry.refreshMilitaryRegistryIfStale();
  assert.equal(registry.isMilitaryIcao('abc123'), true);
  assert.equal(registry.isMilitaryIcao('def456'), false);
  const manager = new LayerLifecycle(
    {},
    { getSourceAvailability: actual.getSourceAvailability },
  );
  manager.register(actual.get('military'));
  assert.equal(await manager.setEnabled('military', true), false);
  assert.equal(registry.isMilitaryLayerActive(), false);
  assert.equal(fetches, 0);
});
