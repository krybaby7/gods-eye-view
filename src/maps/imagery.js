import * as Cesium from 'cesium';

// Attribution and service rights are documented in DATA_SOURCES.md.
export const ESRI_ATTRIBUTION_HTML =
  '<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a>';

export function createOsmImagery() {
  return new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
    credit: '© OpenStreetMap contributors',
  });
}

export function createEsriImagery() {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    {
      credit:
        'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      enablePickFeatures: false,
    },
  );
}

export function createIonImagery(style, accessToken) {
  accessToken = String(accessToken || '').trim();
  if (!accessToken) throw new Error('Ion imagery requires an explicit token');
  return Cesium.IonImageryProvider.fromAssetId(style, { accessToken });
}

/** Start a Google Satellite session only when this source is selected. */
export async function createGoogleSatelliteImagery({
  googleApiKey = '',
  cesiumToken = '',
  signal,
} = {}) {
  signal?.throwIfAborted();
  const key = String(googleApiKey || '').trim();
  const ionToken = String(cesiumToken || '').trim();
  if (!key && !ionToken)
    throw new Error(
      'Google Satellite requires an explicit Google Maps key or Cesium ion token',
    );
  const provider = await (key
    ? Cesium.Google2DImageryProvider.fromUrl({
        key,
        mapType: 'satellite',
        language: 'en-US',
        region: 'EG',
        // Cesium 1.138 omits viewport copyrights when Resource.credits is undefined.
        url: new Cesium.Resource({
          url: String(Cesium.GoogleMaps.mapTilesApiEndpoint),
          credits: [],
        }),
      })
    : // The installed Google2D.fromIonAssetId helper ignores accessToken.
      createIonImagery(3830182, ionToken));
  if (signal?.aborted) {
    if (typeof provider.destroy === 'function' && !provider.isDestroyed?.())
      provider.destroy();
    signal.throwIfAborted();
  }
  return provider;
}
