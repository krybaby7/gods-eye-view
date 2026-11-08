import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createIonImagery } from './imagery.js';
import * as imagery from './imagery.js';
import { createWorldTerrain, createKeylessTerrain } from './terrain.js';
import { createDefaultMapSources } from './defaultSources.js';

test('Google Satellite requires its own configured credentials', async () => {
  assert.equal(typeof imagery.createGoogleSatelliteImagery, 'function');
  const originalGoogle = Cesium.Google2DImageryProvider.fromUrl;
  const originalIon = Cesium.IonImageryProvider.fromAssetId;
  try {
    Cesium.Google2DImageryProvider.fromUrl = () =>
      assert.fail('an omitted key must not consume the SDK default');
    Cesium.IonImageryProvider.fromAssetId = () =>
      assert.fail('an omitted token must not consume the SDK default');
    await assert.rejects(
      imagery.createGoogleSatelliteImagery({
        googleApiKey: ' ',
        cesiumToken: ' ',
      }),
      /explicit Google Maps key or Cesium ion token/,
    );
  } finally {
    Cesium.Google2DImageryProvider.fromUrl = originalGoogle;
    Cesium.IonImageryProvider.fromAssetId = originalIon;
  }
});

test('Google Satellite prefers a direct key and keeps native attribution', async () => {
  assert.equal(typeof imagery.createGoogleSatelliteImagery, 'function');
  const originalGoogle = Cesium.Google2DImageryProvider.fromUrl;
  const originalIon = Cesium.IonImageryProvider.fromAssetId;
  const defaultKey = Cesium.GoogleMaps.defaultApiKey;
  const defaultToken = Cesium.Ion.defaultAccessToken;
  const provider = { credit: { html: 'Google native credit' } };
  const calls = [];
  try {
    Cesium.Google2DImageryProvider.fromUrl = async (options) => {
      calls.push(options);
      return provider;
    };
    Cesium.IonImageryProvider.fromAssetId = () =>
      assert.fail('the configured direct key takes precedence');
    const result = await imagery.createGoogleSatelliteImagery({
      googleApiKey: ' browser-fixture ',
      cesiumToken: 'ion-fixture',
    });
    assert.equal(result, provider);
    assert.equal(calls.length, 1);
    const { url, ...options } = calls[0];
    assert.ok(url instanceof Cesium.Resource);
    assert.equal(url.url, String(Cesium.GoogleMaps.mapTilesApiEndpoint));
    assert.deepEqual(url.credits, []);
    assert.deepEqual(options, {
      key: 'browser-fixture',
      mapType: 'satellite',
      language: 'en-US',
      region: 'EG',
    });
    assert.equal(Cesium.GoogleMaps.defaultApiKey, defaultKey);
    assert.equal(Cesium.Ion.defaultAccessToken, defaultToken);
  } finally {
    Cesium.Google2DImageryProvider.fromUrl = originalGoogle;
    Cesium.IonImageryProvider.fromAssetId = originalIon;
  }
});

test('direct Google Satellite returns native viewport copyrights as tile credits', async () => {
  const originalPost = Cesium.Resource.post;
  const originalFetchJson = Cesium.Resource.prototype.fetchJson;
  const endpoint = Cesium.GoogleMaps.mapTilesApiEndpoint;
  const endpointUrl = String(endpoint);
  const endpointCredits = endpoint.credits;
  const copyright = 'Imagery ©2026 Fixture imagery provider';
  let sessions = 0;
  let viewportRequests = 0;
  try {
    Cesium.Resource.post = async () => {
      sessions++;
      return JSON.stringify({
        session: 'fixture-session',
        expiry: '9999999999',
        tileWidth: 256,
        tileHeight: 256,
        imageFormat: 'jpeg',
      });
    };
    Cesium.Resource.prototype.fetchJson = async function () {
      assert.match(this.url, /tile\/v1\/viewport/);
      viewportRequests++;
      return { copyright };
    };
    const provider = await imagery.createGoogleSatelliteImagery({
      googleApiKey: 'browser-fixture',
    });
    assert.ok(provider instanceof Cesium.Google2DImageryProvider);
    assert.equal(
      provider.credit.html,
      Cesium.GoogleMaps.getDefaultCredit().html,
    );
    assert.equal(provider.credit.showOnScreen, true);
    const viewportCredits = await provider.getViewportCredits();
    assert.equal(viewportCredits.get(0)[0].html, copyright);
    const tileCredits = provider.getTileCredits(0, 0, 0);
    assert.ok(
      Array.isArray(tileCredits),
      'native copyrights must reach tile credits',
    );
    assert.equal(tileCredits.length, 1);
    assert.equal(tileCredits[0].html, copyright);
    assert.equal(sessions, 1);
    assert.equal(viewportRequests, provider.maximumLevel + 1);
    assert.equal(Cesium.GoogleMaps.mapTilesApiEndpoint, endpoint);
    assert.equal(String(endpoint), endpointUrl);
    assert.equal(endpoint.credits, endpointCredits);
  } finally {
    Cesium.Resource.post = originalPost;
    Cesium.Resource.prototype.fetchJson = originalFetchJson;
  }
});

test('ion-only Google Satellite uses the satellite asset with an explicit token', async () => {
  assert.equal(typeof imagery.createGoogleSatelliteImagery, 'function');
  const originalGoogle = Cesium.Google2DImageryProvider.fromUrl;
  const originalGoogleIon = Cesium.Google2DImageryProvider.fromIonAssetId;
  const originalIon = Cesium.IonImageryProvider.fromAssetId;
  const defaultToken = Cesium.Ion.defaultAccessToken;
  const provider = { credit: { html: 'Ion native Google credit' } };
  const calls = [];
  try {
    Cesium.Google2DImageryProvider.fromUrl = () =>
      assert.fail('ion-only setup must not start a direct Google session');
    Cesium.Google2DImageryProvider.fromIonAssetId = () =>
      assert.fail('the installed Google helper ignores explicit ion tokens');
    Cesium.IonImageryProvider.fromAssetId = async (...args) => {
      calls.push(args);
      return provider;
    };
    assert.equal(
      await imagery.createGoogleSatelliteImagery({
        cesiumToken: ' ion-fixture ',
      }),
      provider,
    );
    assert.deepEqual(calls, [[3830182, { accessToken: 'ion-fixture' }]]);
    assert.equal(Cesium.Ion.defaultAccessToken, defaultToken);
  } finally {
    Cesium.Google2DImageryProvider.fromUrl = originalGoogle;
    Cesium.Google2DImageryProvider.fromIonAssetId = originalGoogleIon;
    Cesium.IonImageryProvider.fromAssetId = originalIon;
  }
});

test('a rejected direct Google Satellite session does not start an ion session', async () => {
  assert.equal(typeof imagery.createGoogleSatelliteImagery, 'function');
  const originalGoogle = Cesium.Google2DImageryProvider.fromUrl;
  const originalIon = Cesium.IonImageryProvider.fromAssetId;
  const denial = new Error('direct session denied');
  try {
    Cesium.Google2DImageryProvider.fromUrl = async () => {
      throw denial;
    };
    Cesium.IonImageryProvider.fromAssetId = () =>
      assert.fail('direct failure must use the registry fallback');
    await assert.rejects(
      imagery.createGoogleSatelliteImagery({
        googleApiKey: 'browser-fixture',
        cesiumToken: 'ion-fixture',
      }),
      (error) => error === denial,
    );
  } finally {
    Cesium.Google2DImageryProvider.fromUrl = originalGoogle;
    Cesium.IonImageryProvider.fromAssetId = originalIon;
  }
});

test('Google Satellite cancellation prevents construction and disposes a late provider', async () => {
  assert.equal(typeof imagery.createGoogleSatelliteImagery, 'function');
  const originalGoogle = Cesium.Google2DImageryProvider.fromUrl;
  const originalIon = Cesium.IonImageryProvider.fromAssetId;
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  try {
    Cesium.Google2DImageryProvider.fromUrl = () =>
      assert.fail('cancelled selection must not start a session');
    await assert.rejects(
      imagery.createGoogleSatelliteImagery({
        googleApiKey: 'browser-fixture',
        signal: alreadyAborted.signal,
      }),
      { name: 'AbortError' },
    );
    for (const credentials of [
      { googleApiKey: 'browser-fixture' },
      { cesiumToken: 'ion-fixture' },
    ]) {
      const controller = new AbortController();
      let destroyed = 0;
      const create = async () => {
        controller.abort();
        return {
          destroy: () => {
            destroyed++;
          },
        };
      };
      Cesium.Google2DImageryProvider.fromUrl = create;
      Cesium.IonImageryProvider.fromAssetId = create;
      await assert.rejects(
        imagery.createGoogleSatelliteImagery({
          ...credentials,
          signal: controller.signal,
        }),
        { name: 'AbortError' },
      );
      assert.equal(destroyed, 1);
    }
  } finally {
    Cesium.Google2DImageryProvider.fromUrl = originalGoogle;
    Cesium.IonImageryProvider.fromAssetId = originalIon;
  }
});

test('Google Satellite is available only with credentials and stays lazy at startup', async () => {
  const originalGoogle = Cesium.Google2DImageryProvider.fromUrl;
  const originalIon = Cesium.IonImageryProvider.fromAssetId;
  const provider = {};
  let reads = 0;
  try {
    Cesium.Google2DImageryProvider.fromUrl = async () => {
      reads++;
      return provider;
    };
    Cesium.IonImageryProvider.fromAssetId = async () => {
      reads++;
      return provider;
    };
    const sourceOf = (registry) =>
      registry.sources.find(
        ({ descriptor }) => descriptor.id === 'google-satellite',
      );
    const keyless = createDefaultMapSources();
    const absent = sourceOf(keyless);
    assert.ok(absent, 'Google Satellite must be registered');
    assert.equal(absent.available, false);
    assert.match(absent.unavailableReason, /GOOGLE_MAPS_API_KEY/);
    assert.match(absent.unavailableReason, /Cesium ion token/);
    assert.equal(keyless.defaultId, 'esri-imagery');
    for (const credentials of [
      { googleApiKey: 'browser-fixture' },
      { cesiumToken: 'ion-fixture' },
      { googleApiKey: 'browser-fixture', cesiumToken: 'ion-fixture' },
    ]) {
      const registry = createDefaultMapSources(credentials);
      const google = sourceOf(registry);
      const esri = registry.sources.find(
        ({ descriptor }) => descriptor.id === 'esri-imagery',
      );
      assert.equal(registry.defaultId, 'esri-imagery');
      assert.equal(google.descriptor.kind, 'google-satellite');
      assert.equal(google.descriptor.requiresIon, false);
      assert.equal(google.available, true);
      assert.equal(google.unavailableReason, null);
      assert.equal(google.terrain, esri.terrain);
      assert.equal(
        google.terrain.id,
        credentials.cesiumToken ? 'world' : 'keyless',
      );
      assert.equal(
        google.credit,
        undefined,
        'native provider credits are preserved',
      );
      assert.equal(google.constructionFallback.id, 'esri-imagery');
      assert.equal(google.tileFailureFallback.id, 'esri-imagery');
      assert.equal(google.tileFailureFallback.threshold, 2);
      assert.match(
        google.constructionFallback.message,
        /Google Satellite.*Esri/,
      );
      assert.match(
        google.tileFailureFallback.message,
        /Google Satellite.*Esri/,
      );
    }
    const photoreal = createDefaultMapSources({
      googleApiKey: 'browser-fixture',
      googleTileset: { show: true },
    });
    assert.equal(photoreal.defaultId, 'photoreal');
    assert.equal(reads, 0, 'registration must not create a billable session');
    assert.equal(await sourceOf(photoreal).imagery(), provider);
    assert.equal(reads, 1, 'explicit activation creates the session');
  } finally {
    Cesium.Google2DImageryProvider.fromUrl = originalGoogle;
    Cesium.IonImageryProvider.fromAssetId = originalIon;
  }
});

test('Esri uses Re:Earth without keys and preserves ion terrain when configured', async () => {
  const originalTerrain = Cesium.CesiumTerrainProvider.fromUrl;
  const originalResource = Cesium.IonResource.fromAssetId;
  const calls = [];
  try {
    Cesium.CesiumTerrainProvider.fromUrl = async (resource) => {
      calls.push(resource);
      return { resource };
    };
    Cesium.IonResource.fromAssetId = async () =>
      assert.fail('keyless mode must not acquire ion terrain');
    const keyless = createDefaultMapSources();
    const esri = keyless.sources.find(
      ({ descriptor }) => descriptor.id === 'esri-imagery',
    );
    assert.equal(esri.available, true);
    assert.equal(esri.terrain.id, 'keyless');
    assert.equal(esri.terrain.create, createKeylessTerrain);
    await esri.terrain.create();
    // A Resource, not a bare URL: the retry policy rides on it (terrainRetry.js).
    assert.equal(calls.length, 1);
    assert.ok(calls[0] instanceof Cesium.Resource);
    assert.equal(
      calls[0].url,
      'https://terrain.reearth.land/cesium-mesh/ellipsoid',
    );
    assert.equal(calls[0].retryAttempts, 3);
    assert.equal(typeof calls[0].retryCallback, 'function');
    assert.equal(
      keyless.sources.find(({ descriptor }) => descriptor.id === 'photoreal')
        .available,
      false,
    );
    for (const credentials of [
      { googleApiKey: 'test-key' },
      { cesiumToken: 'test-token' },
    ]) {
      const keyed = createDefaultMapSources({
        ...credentials,
        googleTileset: { show: true },
      });
      assert.equal(
        keyed.sources.find(({ descriptor }) => descriptor.id === 'photoreal')
          .available,
        true,
      );
      assert.equal(
        keyed.sources.find(({ descriptor }) => descriptor.id === 'esri-imagery')
          .terrain.id,
        credentials.cesiumToken ? 'world' : 'keyless',
      );
      const failedTileset = createDefaultMapSources(credentials);
      assert.equal(
        failedTileset.sources.find(
          ({ descriptor }) => descriptor.id === 'photoreal',
        ).available,
        false,
      );
    }
  } finally {
    Cesium.CesiumTerrainProvider.fromUrl = originalTerrain;
    Cesium.IonResource.fromAssetId = originalResource;
  }
});

test('imagery and terrain pass their own ion token without relying on SDK defaults', async () => {
  const originalImagery = Cesium.IonImageryProvider.fromAssetId;
  const originalResource = Cesium.IonResource.fromAssetId;
  const originalTerrain = Cesium.CesiumTerrainProvider.fromUrl;
  const calls = [];
  const defaultToken = Cesium.Ion.defaultAccessToken;
  try {
    Cesium.IonImageryProvider.fromAssetId = async (id, options) => {
      calls.push({ kind: 'imagery', id, options });
      return { id };
    };
    Cesium.IonResource.fromAssetId = async (id, options) => {
      calls.push({ kind: 'resource', id, options });
      return { id };
    };
    Cesium.CesiumTerrainProvider.fromUrl = async (resource, options) => {
      calls.push({ kind: 'terrain', resource, options });
      return { id: 'terrain' };
    };
    await createIonImagery(Cesium.IonWorldImageryStyle.AERIAL, 'imagery-token');
    const result = await createWorldTerrain('terrain-token');
    assert.equal(calls[0].options.accessToken, 'imagery-token');
    assert.equal(calls[1].options.accessToken, 'terrain-token');
    assert.equal(calls[1].id, 1);
    assert.equal(calls[2].options.requestVertexNormals, true);
    assert.equal(result.provider.id, 'terrain');
    assert.equal(Cesium.Ion.defaultAccessToken, defaultToken);
  } finally {
    Cesium.IonImageryProvider.fromAssetId = originalImagery;
    Cesium.IonResource.fromAssetId = originalResource;
    Cesium.CesiumTerrainProvider.fromUrl = originalTerrain;
  }
});

test('cancellation after ion metadata prevents terrain construction', async () => {
  const originalResource = Cesium.IonResource.fromAssetId;
  const originalTerrain = Cesium.CesiumTerrainProvider.fromUrl;
  const controller = new AbortController();
  try {
    Cesium.IonResource.fromAssetId = async () => {
      controller.abort();
      return {};
    };
    Cesium.CesiumTerrainProvider.fromUrl = () =>
      assert.fail('cancelled terrain construction');
    await assert.rejects(
      createWorldTerrain('test-token', { signal: controller.signal }),
      { name: 'AbortError' },
    );
  } finally {
    Cesium.IonResource.fromAssetId = originalResource;
    Cesium.CesiumTerrainProvider.fromUrl = originalTerrain;
  }
});

test('credentialed source factories reject an omitted token instead of consuming an SDK default', async () => {
  assert.throws(
    () => createIonImagery(Cesium.IonWorldImageryStyle.AERIAL, ''),
    /explicit token/,
  );
  await assert.rejects(createWorldTerrain(' '), /explicit ion token/);
});

test('both Google 3D routes keep tiles drawing while draped imagery loads', async () => {
  const { createGoogleDirectTileset, createGoogleIonTileset } =
    await import('./google3d.js');
  const calls = [];
  const sdk = {
    createGooglePhotorealistic3DTileset: async (...args) => {
      calls.push(args);
      return 'direct';
    },
    IonResource: { fromAssetId: async (id, options) => ({ id, ...options }) },
    Cesium3DTileset: {
      fromUrl: async (...args) => {
        calls.push(args);
        return 'ion';
      },
    },
  };
  assert.equal(await createGoogleDirectTileset(sdk, 'key'), 'direct');
  assert.equal(await createGoogleIonTileset(sdk, 'token'), 'ion');
  assert.deepEqual(calls[0], [
    { key: 'key', onlyUsingWithGoogleGeocoder: true },
    { asynchronouslyLoadImagery: true, showCreditsOnScreen: true },
  ]);
  assert.equal(calls[1][0].id, 2275207);
  assert.equal(calls[1][0].accessToken, 'token');
  assert.equal(calls[1][1].asynchronouslyLoadImagery, true);
  assert.equal(calls[1][1].enableCollision, true);
});
