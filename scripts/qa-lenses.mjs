#!/usr/bin/env node
/**
 * Real-application Lenses acceptance with deterministic transport fixtures.
 *
 * Run against the keyless dev server:
 *   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node scripts/qa-lenses.mjs --url http://localhost:4181
 * For seven-layer Hazards rendering, use a separate fixture-only server with
 * FIRMS_MAP_KEY=qa-fixture, then add --full-hazards. Every FIRMS request is
 * intercepted; that placeholder is never sent to an upstream provider.
 * Use --skip-performance with a distinct --output to repeat behavior checks
 * without replacing a previously measured rendering-workload report.
 *
 * Fixtures supply map images, feed records and a populated wind/weather field.
 * The real catalog, lifecycle, rendering, UI and persistence remain in use.
 * Results describe this controlled workload, not live-provider or real-GPU QA.
 * TLS verification remains enabled. Evidence is written to qa-artifacts/lenses.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { LENSES } from '../src/lenses/catalog.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const appUrl = option('--url', 'http://localhost:4181');
const origin = new URL(appUrl).origin;
const fullHazards = args.includes('--full-hazards');
const performanceOnly = args.includes('--performance-only');
const skipPerformance = args.includes('--skip-performance');
assert.ok(
  !(performanceOnly && skipPerformance),
  '--performance-only and --skip-performance are mutually exclusive',
);
const evidence = path.resolve(
  root,
  option('--output', `qa-artifacts/lenses/${fullHazards ? 'full' : 'keyless'}`),
);
await fs.mkdir(evidence, { recursive: true });
const now = Date.now();
const observedAt = new Date(Math.floor(now / 60_000) * 60_000).toISOString();
const imagery = await fs.readFile(
  path.join(
    root,
    'node_modules/cesium/Build/Cesium/Assets/Textures/NaturalEarthII/0/0/0.jpg',
  ),
);
const missingImagery = await sharp({
  create: {
    width: 256,
    height: 256,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .png()
  .toBuffer();
const weatherImages = {
  radar: await sharp({
    create: {
      width: 512,
      height: 256,
      channels: 4,
      background: { r: 35, g: 180, b: 110, alpha: 0.25 },
    },
  })
    .png()
    .toBuffer(),
  lightning: await sharp({
    create: {
      width: 512,
      height: 256,
      channels: 4,
      background: { r: 245, g: 145, b: 30, alpha: 0.2 },
    },
  })
    .png()
    .toBuffer(),
};
const windGrid = { nx: 72, ny: 37, lo1: -180, la1: 90, dx: 5, dy: 5 };
const windCount = windGrid.nx * windGrid.ny;
const windValues = new Float32Array(windCount * 2);
for (let y = 0; y < windGrid.ny; y++) {
  for (let x = 0; x < windGrid.nx; x++) {
    const index = y * windGrid.nx + x;
    windValues[index] = 8 + Math.cos((y / 36) * Math.PI * 2) * 4;
    windValues[index + windCount] = Math.sin((x / 72) * Math.PI * 2) * 5;
  }
}
const windBytes = Buffer.from(windValues.buffer);
const tle = [
  'ISS (ZARYA)',
  '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9004',
  '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49814310 12345',
  '',
].join('\n');
const quakes = {
  type: 'FeatureCollection',
  features: Array.from({ length: 16 }, (_, index) => ({
    type: 'Feature',
    id: `qa-quake-${index}`,
    properties: {
      mag: 2.5 + (index % 4),
      place: 'Lenses QA fixture',
      time: now - index * 60_000,
      url: 'https://earthquake.usgs.gov/',
    },
    geometry: {
      type: 'Point',
      coordinates: [-101 + (index % 4) * 2, 27 + Math.floor(index / 4) * 2, 8],
    },
  })),
};
const fires = Array.from({ length: 32 }, (_, index) => ({
  lat: 29 + Math.floor(index / 8) * 0.18,
  lon: -99 + (index % 8) * 0.18,
  brightness: 330,
  frp: 25 + index,
  confidence: 'h',
  acqDate: observedAt.slice(0, 10),
  acqTime: observedAt.slice(11, 16).replace(':', ''),
  satellite: 'N',
  instrument: 'VIIRS',
  daynight: 'D',
}));
const perimeter = {
  stableId: 'qa-perimeter',
  name: 'Lenses fixture perimeter',
  acres: 1200,
  containedPct: 20,
  state: 'TX',
  category: 'WF',
  discoveredTime: now - 86_400_000,
  updatedTime: now,
  polygons: [
    [
      [
        [-98.4, 30.1],
        [-98, 30.1],
        [-98, 30.4],
        [-98.4, 30.1],
      ],
    ],
  ],
};
const cyclones = {
  schemaVersion: 1,
  source: 'NOAA NHC / CPHC fixture',
  attribution: 'QA fixture',
  coverage: 'Controlled Lenses workload',
  fetchedAt: now,
  stale: false,
  unavailable: false,
  reason: null,
  storms: [
    {
      id: 'al012026',
      name: 'QA Storm',
      classification: 'TS',
      basin: 'AL',
      position: { longitude: -91, latitude: 24 },
      positionAt: observedAt,
      issuedAt: observedAt,
      advisoryNumber: '1',
      windKt: 45,
      pressureHpa: 995,
      movement: { directionDegrees: 310, speedKt: 10 },
      advisoryUrl: 'https://www.nhc.noaa.gov/text/MIATCMAT1.shtml',
      outlookUrl: null,
      geometryStatus: 'pending',
      geometryAdvisoryNumber: null,
      forecastPoints: [],
      track: null,
      cone: null,
    },
  ],
};

const results = [];
const skipped = [];
const pageErrors = [];
const consoleErrors = [];
const networkErrors = [];
const transport = {
  fixtures: {},
  unexpectedExternal: [],
  apiRequests: [],
  cancelledInterceptions: [],
};
let performanceResult = null;
const pendingFixtureRequests = new Set();
const record = (name, passed, detail = null) => {
  results.push({ name, passed, detail });
  console.log(
    `[${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`,
  );
};
const check = async (name, operation) => {
  if (performanceOnly && !name.startsWith('Hazards frame-rate')) return;
  if (skipPerformance && name.startsWith('Hazards frame-rate')) {
    skipped.push({ name, reason: '--skip-performance' });
    console.log(`[SKIP] ${name} (--skip-performance)`);
    return;
  }
  try {
    await operation();
    record(name, true);
  } catch (error) {
    let state = null;
    try {
      state = await page.evaluate(() => ({
        url: location.href,
        storedLayers: localStorage.getItem('gev:layer-state:v2'),
        enabledLayers: window.__godsEyeView?.dataManager?.getEnabledLayerIds?.()
          ? [...window.__godsEyeView.dataManager.getEnabledLayerIds()]
          : null,
        lensStatuses: [
          ...document.querySelectorAll('#lens-bar .lens-button'),
        ].map((button) => ({
          id: button.dataset.lensId,
          status: button.dataset.status,
        })),
      }));
    } catch {
      /* Keep the original failed assertion if the page disappeared. */
    }
    record(name, false, { error: error.stack || String(error), state });
  }
};
const reply = (request, body, contentType = 'application/json', status = 200) =>
  request.respond({
    status,
    contentType,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: contentType === 'application/json' ? JSON.stringify(body) : body,
  });

/** Serve only transport fixtures; no layer implementation is replaced. */
async function intercept(request) {
  const url = new URL(request.url());
  const pathname = url.pathname;
  const hit = (name) => {
    transport.fixtures[name] = (transport.fixtures[name] || 0) + 1;
  };
  if (url.hostname === 'fonts.googleapis.com') {
    hit('fonts');
    return reply(request, '', 'text/css');
  }
  if (url.hostname === 'earthquake.usgs.gov') {
    hit('earthquakes');
    return reply(request, quakes);
  }
  if (url.hostname === 'terrain.reearth.land') {
    // Deliberately select the app's normal ellipsoid fallback for this fixture
    // workload; terrain geography is not part of lens behavior acceptance.
    hit('ellipsoid-fallback');
    return reply(
      request,
      { error: 'Fixture uses ellipsoid terrain' },
      'application/json',
      410,
    );
  }
  if (
    url.hostname === 'services.arcgisonline.com' ||
    url.hostname === 'tile.openstreetmap.org'
  ) {
    if (
      url.hostname === 'services.arcgisonline.com' &&
      /\/tile\/23\/0\/0$/.test(pathname)
    ) {
      // ArcGIS probes a missing tile to build its discard policy. Returning
      // the same opaque fixture here would classify every real tile missing.
      hit('imagery-missing-probe');
      return reply(request, missingImagery, 'image/png');
    }
    if (url.searchParams.get('f') === 'json') {
      hit('imagery-metadata');
      return reply(request, {
        currentVersion: 10.9,
        capabilities: 'Map,Tilemap,Query,Data',
        singleFusedMapCache: true,
        tileInfo: {
          rows: 256,
          cols: 256,
          dpi: 96,
          format: 'JPEG',
          compressionQuality: 75,
          origin: { x: -20037508.342787, y: 20037508.342787 },
          spatialReference: { wkid: 102100, latestWkid: 3857 },
          lods: Array.from({ length: 24 }, (_, level) => ({
            level,
            resolution: 156543.033928 / 2 ** level,
            scale: 591657527.591555 / 2 ** level,
          })),
        },
        fullExtent: {
          xmin: -20037508.342787,
          ymin: -20037508.342787,
          xmax: 20037508.342787,
          ymax: 20037508.342787,
          spatialReference: { wkid: 102100 },
        },
      });
    }
    hit('imagery-tile');
    return reply(request, imagery, 'image/jpeg');
  }
  if (
    ['tiles.openfreemap.org', 'tiles.dontgetflocked.com'].includes(url.hostname)
  ) {
    if (pathname.endsWith('.json') || pathname === '/planet') {
      hit('vector-metadata');
      return reply(request, {
        tilejson: '3.0.0',
        minzoom: 0,
        maxzoom: 14,
        bounds: [-180, -85, 180, 85],
        tiles: [`${url.origin}/qa/{z}/{x}/{y}.pbf`],
      });
    }
    hit('empty-vector-tile');
    return reply(request, Buffer.alloc(0), 'application/x-protobuf');
  }
  if (url.origin !== origin) {
    transport.unexpectedExternal.push(url.origin + pathname);
    return request.continue();
  }
  if (!pathname.startsWith('/api/')) return request.continue();
  transport.apiRequests.push(pathname);
  if (pathname === '/api/firms/status')
    return reply(request, {
      hasKey: fullHazards,
      count: fullHazards ? fires.length : null,
    });
  if (pathname === '/api/firms') {
    hit('firms');
    return fullHazards
      ? reply(request, { fires, stale: false, fetchedAt: now })
      : reply(request, { error: 'no_key' }, 'application/json', 503);
  }
  if (pathname === '/api/flights') {
    hit('flights');
    const seconds = Math.floor(Date.now() / 1000);
    return reply(request, {
      time: seconds,
      states: [
        [
          'aaa001',
          'QA001',
          'Fixture',
          seconds,
          seconds,
          -97.74,
          30.27,
          9000,
          false,
          230,
          90,
          0,
          null,
          9000,
          null,
          false,
          0,
        ],
      ],
    });
  }
  if (pathname === '/api/military') {
    hit('military');
    return reply(request, {
      ac: [
        {
          hex: 'bbb101',
          flight: 'MIL101',
          lat: 30.26,
          lon: -97.73,
          alt_baro: 28000,
          gs: 420,
          track: 270,
          t: 'F16',
          seen_pos: 0,
        },
      ],
      now: Date.now() / 1000,
    });
  }
  if (pathname.startsWith('/api/adsbdb/')) return reply(request, {});
  if (pathname === '/api/flights/track') return reply(request, { path: [] });
  if (pathname === '/api/military/track')
    return reply(request, { timestamp: Date.now() / 1000, trace: [] });
  if (pathname === '/api/vessels')
    return reply(request, {
      rows: [],
      status: 'missing-key',
      lastMessageAt: null,
    });
  if (pathname.startsWith('/api/celestrak/')) {
    hit('satellites');
    return reply(request, tle, 'text/plain');
  }
  if (pathname === '/api/launches') return reply(request, { results: [] });
  if (pathname === '/api/military-installations')
    return reply(request, {
      elements: [],
      saturated: false,
      cached: false,
      fetchedAt: now,
      source: 'OSM fixture',
    });
  if (pathname === '/api/fire-perimeters') {
    hit('perimeters');
    return reply(request, { rows: [perimeter] });
  }
  if (pathname === '/api/fire-perimeters/inciweb/index')
    return reply(request, []);
  if (pathname === '/api/cyclones') {
    hit('cyclones');
    return reply(request, cyclones);
  }
  if (pathname === '/api/wind/manifest') {
    hit('wind-manifest');
    const model = url.searchParams.get('model') || 'gfs';
    return reply(request, {
      model,
      grid: windGrid,
      gridUrl: `/api/wind/grid/${model}-qa.bin?model=${model}`,
      cycle: { runIso: observedAt, validIso: observedAt },
      source: 'Deterministic QA wind',
      fetchedAt: now,
      stale: false,
    });
  }
  if (pathname.startsWith('/api/wind/grid/')) {
    hit('wind-grid');
    return reply(request, windBytes, 'application/octet-stream');
  }
  if (pathname === '/api/weather/manifest') {
    hit('weather-manifest');
    const product = url.searchParams.get('product') || 'radar';
    return reply(request, {
      schemaVersion: 1,
      product,
      source: 'Deterministic QA weather',
      attribution: 'Fixture',
      bounds: { west: -180, south: -85, east: 180, north: 85 },
      times: [observedAt],
      latest: observedAt,
      tileSize: 256,
      maxLevel: 6,
      tilingScheme: 'geographic',
      fetchedAt: now,
      stale: false,
    });
  }
  if (pathname === '/api/weather/tile' || pathname === '/api/weather/image') {
    hit('weather-image');
    return reply(
      request,
      weatherImages[url.searchParams.get('product')] || weatherImages.radar,
      'image/png',
    );
  }
  if (pathname === '/api/cctv/sources') return reply(request, { sources: [] });
  if (pathname === '/api/cctv/health') return reply(request, { cameras: [] });
  if (pathname === '/api/radio/stations')
    return reply(request, {
      updatedAt: observedAt,
      stale: false,
      degraded: false,
      acceptedGeneration: 1,
      catalogInstance: 'lenses-qa',
      stations: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Lenses QA Radio',
          lat: 30.27,
          lon: -97.74,
          streamUrl: 'https://example.invalid/lenses-qa.mp3',
          homepage: null,
          tags: ['fixture'],
          languages: ['English'],
          state: 'Texas',
          country: 'United States',
          countryCode: 'US',
          metadataTrust: 'untrusted-community',
          codec: 'MP3',
          bitrate: 128,
        },
      ],
    });
  if (pathname === '/api/transit/feeds') return reply(request, { feeds: [] });
  if (pathname.startsWith('/api/gbfs/'))
    return reply(request, {
      last_updated: now / 1000,
      ttl: 60,
      data: { stations: [], bikes: [] },
    });
  if (pathname === '/api/tomtom/status')
    return reply(request, { hasKey: false, dailyCount: 0, budget: 6000 });
  if (pathname === '/api/local-receivers/aircraft')
    return reply(request, { configured: false, feeds: [], records: [] });
  if (pathname === '/api/terrain/heights')
    return reply(request, {
      results: (url.searchParams.get('points') || '').split(';').map((pair) => {
        const [lon, lat] = pair.split(',').map(Number);
        return { lon, lat, elevation: 150, geoid: -27, ellipsoid: 123 };
      }),
    });
  if (pathname === '/api/google/tiles-token')
    return reply(request, {}, 'application/json', 404);
  if (pathname === '/api/openai/hud-summary')
    return reply(request, { summary: 'Lenses fixture acceptance' });
  return request.continue();
}

/** Limit Fetch interception to fixture URLs. Pausing every request through
 * Page.setRequestInterception stalls Cesium's geometry-worker imports on the
 * system Chromium used here, even when the handler immediately continues. */
async function fixtureRequests(
  targetPage,
  handler = intercept,
  extraPatterns = [],
) {
  const client = await targetPage.createCDPSession();
  const cancelledRequests = new Map();
  client.on('Network.loadingFailed', (event) => {
    if (event.canceled) cancelledRequests.set(event.requestId, event);
  });
  await client.send('Network.enable');
  const patterns = [
    `${origin}/api/*`,
    ...[
      'fonts.googleapis.com',
      'earthquake.usgs.gov',
      'terrain.reearth.land',
      'services.arcgisonline.com',
      'tile.openstreetmap.org',
      'tiles.openfreemap.org',
      'tiles.dontgetflocked.com',
    ].map((host) => `https://${host}/*`),
    ...extraPatterns,
  ];
  client.on('Fetch.requestPaused', (event) => {
    let handled = false;
    const request = {
      url: () => event.request.url,
      continue: () => {
        handled = true;
        return client.send('Fetch.continueRequest', {
          requestId: event.requestId,
        });
      },
      respond: (options) => {
        handled = true;
        return client.send('Fetch.fulfillRequest', {
          requestId: event.requestId,
          responseCode: options.status || 200,
          responseHeaders: [
            {
              name: 'Content-Type',
              value: options.contentType || 'application/octet-stream',
            },
            ...Object.entries(options.headers || {}).map(([name, value]) => ({
              name,
              value: String(value),
            })),
          ],
          body: Buffer.from(options.body || '').toString('base64'),
        });
      },
    };
    const operation = Promise.resolve()
      .then(() => handler(request))
      .catch(async (error) => {
        // Reload can cancel a paused request before its fulfill command reaches
        // the browser. Accept only a cancellation proven by its Network ID;
        // unrelated protocol failures and every actual pageerror stay fatal.
        if (/Invalid InterceptionId/.test(error.message) && event.networkId) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          const cancelled = cancelledRequests.get(event.networkId);
          if (cancelled?.errorText === 'net::ERR_ABORTED') {
            transport.cancelledInterceptions.push({
              url: event.request.url,
              networkId: event.networkId,
              canceled: cancelled.canceled,
              errorText: cancelled.errorText,
              protocolError: error.message,
            });
            return;
          }
        }
        pageErrors.push(`fixture ${event.request.url}: ${error.message}`);
        if (!handled)
          void client
            .send('Fetch.failRequest', {
              requestId: event.requestId,
              errorReason: 'Failed',
            })
            .catch(() => {});
      });
    pendingFixtureRequests.add(operation);
    void operation.then(
      () => pendingFixtureRequests.delete(operation),
      (error) => {
        pendingFixtureRequests.delete(operation);
        pageErrors.push(`fixture adapter: ${error.message}`);
      },
    );
  });
  await client.send('Fetch.enable', {
    patterns: patterns.map((urlPattern) => ({
      urlPattern,
      requestStage: 'Request',
    })),
  });
}

const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath());
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  protocolTimeout: 180_000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
await fixtureRequests(page);
page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && consoleErrors.length < 100)
    consoleErrors.push(`${message.text()} [${message.location().url || ''}]`);
});
page.on('response', (response) => {
  if (
    response.status() >= 400 &&
    !response.url().includes('terrain.reearth.land')
  )
    networkErrors.push({ status: response.status(), url: response.url() });
});
page.on('requestfailed', (request) =>
  networkErrors.push({
    url: request.url(),
    error: request.failure()?.errorText,
  }),
);
const selector = (id) => `#lens-bar .lens-button[data-lens-id="${id}"]`;
async function waitSettled() {
  await page.waitForFunction(
    () => {
      const manager = window.__godsEyeView?.dataManager;
      return (
        manager &&
        manager
          .getAll()
          .every(
            (row) => !['enabling', 'disabling'].includes(row.lifecycleState),
          ) &&
        document
          .getElementById('clear-selected-layers')
          ?.getAttribute('aria-busy') !== 'true' &&
        [...document.querySelectorAll('#lens-bar .lens-button')].every(
          (button) => button.getAttribute('aria-busy') !== 'true',
        )
      );
    },
    { timeout: 60_000, polling: 100 },
  );
}
async function snapshot() {
  return page.evaluate(async () => {
    const entry = document.querySelector(
      'script[type="module"][src*="/src/main.js"]',
    );
    const { application } = await import(entry.src);
    const { catalog } = application.getComponents().data;
    const manager = window.__godsEyeView.dataManager;
    return {
      layers: manager.getAll().map((row) => ({
        id: row.id,
        enabled: manager.isEffectivelyEnabled(row.id),
        available:
          catalog.getSourceAvailability?.(row.id)?.available !== false &&
          row.stats?.keyRequired !== true,
        availability: catalog.getSourceAvailability?.(row.id) || null,
        stats: {
          count: row.stats?.count,
          status: row.stats?.status,
          error: row.stats?.error,
          loading: row.stats?.loading,
        },
        ...(['wind', 'weather-radar', 'weather-lightning'].includes(row.id)
          ? {
              diagnostics: manager.layers.get(row.id).module.getDiagnostics?.(),
            }
          : {}),
      })),
      lenses: [...document.querySelectorAll('#lens-bar .lens-button')].map(
        (button) => ({
          id: button.dataset.lensId,
          status: button.dataset.status,
          title: button.title,
          disabled: button.disabled,
          text: button.textContent,
        }),
      ),
      style: window.__godsEyeView.styleManager.activeStyle,
    };
  });
}
async function clear() {
  await page.evaluate(() =>
    document.getElementById('clear-selected-layers').click(),
  );
  await waitSettled();
}
async function click(id) {
  await page.click(selector(id));
  await waitSettled();
}
async function shot(name) {
  await page.screenshot({ path: path.join(evidence, `${name}.png`) });
  const bar = await page.$('#lens-bar');
  if (bar)
    await bar.screenshot({ path: path.join(evidence, `${name}-bar.png`) });
}
async function settleFrames(count = 2) {
  return page.evaluate(
    (wanted) =>
      new Promise((resolve, reject) => {
        const scene = window.__godsEyeView.viewer.scene;
        let frames = 0;
        let raf;
        let timer;
        const remove = scene.postRender.addEventListener(() => {
          if (++frames < wanted) return;
          remove();
          cancelAnimationFrame(raf);
          clearTimeout(timer);
          resolve();
        });
        const request = () => {
          scene.requestRender();
          raf = requestAnimationFrame(request);
        };
        timer = setTimeout(() => {
          remove();
          cancelAnimationFrame(raf);
          reject(
            new Error(
              `Only ${frames}/${wanted} resize-settling frames rendered`,
            ),
          );
        }, 15000);
        request();
      }),
    count,
  );
}
async function measureFrames(durationMs = 6000) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const scene = window.__godsEyeView.viewer.scene;
        let frames = 0;
        let raf = null;
        const began = performance.now();
        const remove = scene.postRender.addEventListener(() => {
          frames++;
        });
        const request = () => {
          scene.requestRender();
          raf = requestAnimationFrame(request);
        };
        request();
        setTimeout(() => {
          cancelAnimationFrame(raf);
          remove();
          const elapsedMs = performance.now() - began;
          resolve({ frames, elapsedMs, fps: frames / (elapsedMs / 1000) });
        }, duration);
      }),
    durationMs,
  );
}

try {
  await page.goto(`${appUrl}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.dataManager &&
      document.querySelectorAll('#lens-bar .lens-button').length === 7,
    { timeout: 60_000 },
  );
  await clear();
  await shot('lens-off');
  await check(
    'bar is the first left-rail child and all seven named buttons are mounted',
    async () => {
      const state = await page.evaluate(() => ({
        first: document.getElementById('left-panel-stack').firstElementChild.id,
        buttons: [...document.querySelectorAll('#lens-bar .lens-button')].map(
          (button) => button.textContent,
        ),
      }));
      assert.equal(state.first, 'lens-bar');
      for (const lens of LENSES)
        assert.ok(state.buttons.some((text) => text.includes(lens.label)));
    },
  );
  await check(
    'desktop displays all seven buttons and the last button accepts pointer input',
    async () => {
      const geometry = await page.evaluate(() => {
        const row = document.querySelector('#lens-bar .lens-buttons');
        const button = row.querySelector('[data-lens-id="signals"]');
        const box = button.getBoundingClientRect();
        const point = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return {
          rowWidth: row.clientWidth,
          rowScroll: row.scrollWidth,
          lastPointerReachable: point?.closest?.('.lens-button') === button,
          hit: point?.id || point?.className,
        };
      });
      assert.ok(
        geometry.rowScroll <= geometry.rowWidth + 1,
        JSON.stringify(geometry),
      );
      assert.ok(geometry.lastPointerReachable, JSON.stringify(geometry));
    },
  );

  await page.evaluate(() => {
    window.__gevLensQaRequests = [];
    window.__gevLensQaStopRequests =
      window.__godsEyeView.dataManager.subscribeVisibilityRequests((change) =>
        window.__gevLensQaRequests.push({
          layerId: change.layerId,
          enabled: change.enabled,
          origin: change.origin,
        }),
      );
  });
  for (const lens of LENSES) {
    await check(
      `${lens.label}: click enables exactly its available layers, then disables them`,
      async () => {
        await clear();
        const before = await snapshot();
        const wanted = lens.layerIds
          .filter((id) => before.layers.find((row) => row.id === id)?.available)
          .sort();
        const unavailable = lens.layerIds.filter(
          (id) => !before.layers.find((row) => row.id === id)?.available,
        );
        await page.evaluate(() => {
          window.__gevLensQaRequests = [];
        });
        await click(lens.id);
        const requests = await page.evaluate(() => window.__gevLensQaRequests);
        assert.ok(
          !requests.some((request) => unavailable.includes(request.layerId)),
          `Unavailable layer was probed: ${JSON.stringify(requests)}`,
        );
        assert.ok(
          wanted.every((id) =>
            requests.some(
              (request) =>
                request.layerId === id &&
                request.enabled &&
                request.origin === 'user',
            ),
          ),
          JSON.stringify(requests),
        );
        const enabled = await snapshot();
        assert.deepEqual(
          enabled.layers
            .filter((row) => row.enabled)
            .map((row) => row.id)
            .sort(),
          wanted,
        );
        assert.equal(
          enabled.lenses.find((row) => row.id === lens.id).status,
          wanted.length ? 'on' : 'unavailable',
        );
        await click(lens.id);
        const after = await snapshot();
        assert.deepEqual(
          after.layers.filter((row) => row.enabled).map((row) => row.id),
          [],
        );
      },
    );
  }
  await page.evaluate(() => {
    window.__gevLensQaStopRequests();
    delete window.__gevLensQaStopRequests;
    delete window.__gevLensQaRequests;
  });

  await check(
    'missing AIS key and absent local receiver are skipped and explained',
    async () => {
      await clear();
      await click('air');
      await click('sea');
      const state = await snapshot();
      assert.equal(
        state.layers.find((row) => row.id === 'local-adsb').enabled,
        false,
      );
      assert.equal(
        state.layers.find((row) => row.id === 'ais-live-vessels').enabled,
        false,
      );
      assert.match(
        state.lenses.find((row) => row.id === 'sea').title,
        /AISSTREAM|key/i,
      );
      assert.match(
        state.lenses.find((row) => row.id === 'air').title,
        /receiver/i,
      );
      await shot('lens-missing-key');
    },
  );

  await check(
    'rapid second click reverses in-flight layer intent',
    async () => {
      await clear();
      await page.evaluate(() => {
        const button = document.querySelector('#lens-bar [data-lens-id="air"]');
        button.click();
        button.click();
      });
      await waitSettled();
      const state = await snapshot();
      assert.ok(state.layers.every((row) => !row.enabled));
      assert.equal(state.lenses.find((row) => row.id === 'air').status, 'off');
    },
  );

  await check(
    'a fully on Conflict lens protects military when Air is switched off',
    async () => {
      await clear();
      await click('air');
      await click('conflict');
      await click('air');
      const state = await snapshot();
      assert.equal(
        state.layers.find((row) => row.id === 'military').enabled,
        true,
      );
      assert.equal(
        state.layers.find((row) => row.id === 'flights').enabled,
        false,
      );
      assert.equal(
        state.lenses.find((row) => row.id === 'conflict').status,
        'on',
      );
    },
  );

  await check(
    'expert row creates partial status; lens click completes it',
    async () => {
      await clear();
      await click('air');
      await shot('lens-on');
      await page.evaluate(() => {
        const panel = document.getElementById('data-panel');
        if (panel.classList.contains('collapsed'))
          panel.querySelector('.panel-collapse-btn').click();
        panel
          .querySelector('[data-layer-id="flights"] .data-toggle-btn')
          .click();
      });
      await waitSettled();
      assert.equal(
        (await snapshot()).lenses.find((row) => row.id === 'air').status,
        'partial',
      );
      await shot('lens-partial');
      await click('air');
      assert.equal(
        (await snapshot()).lenses.find((row) => row.id === 'air').status,
        'on',
      );
    },
  );

  await check('a partial Conflict lens does not protect military', async () => {
    await clear();
    await click('air');
    await click('conflict');
    await page.evaluate(() =>
      document
        .querySelector(
          '#data-toggles [data-layer-id="military-installations"] .data-toggle-btn',
        )
        .click(),
    );
    await waitSettled();
    assert.equal(
      (await snapshot()).lenses.find((row) => row.id === 'conflict').status,
      'partial',
    );
    await click('air');
    assert.equal(
      (await snapshot()).layers.find((row) => row.id === 'military').enabled,
      false,
    );
  });

  await check(
    'reload restores layer choices and derives lens status without lens storage',
    async () => {
      await clear();
      await click('air');
      const expected = (await snapshot()).layers
        .filter((row) => row.enabled)
        .map((row) => row.id)
        .sort();
      await page.waitForFunction(
        (wanted) => {
          const stored = JSON.parse(
            localStorage.getItem('gev:layer-state:v2') || 'null',
          );
          return (
            stored &&
            JSON.stringify([...stored.l].sort()) === JSON.stringify(wanted)
          );
        },
        { timeout: 5000 },
        expected,
      );
      // Authored share URLs take precedence over local preferences. Clear the
      // fragment and reload in the same task so a pending share debounce cannot
      // write an earlier snapshot between these two navigation operations.
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.evaluate(() => {
          history.replaceState(null, '', `${location.origin}/?welcome=0`);
          location.reload();
        }),
      ]);
      await page.waitForFunction(
        () =>
          window.__godsEyeView?.dataManager &&
          document.querySelector('#lens-bar .lens-button[data-lens-id="air"]')
            ?.dataset.status === 'on',
        { timeout: 60_000 },
      );
      await waitSettled();
      assert.deepEqual(
        (await snapshot()).layers
          .filter((row) => row.enabled)
          .map((row) => row.id)
          .sort(),
        expected,
      );
      const keys = await page.evaluate(() =>
        Object.keys(localStorage).filter((key) => /lens/i.test(key)),
      );
      assert.deepEqual(keys, []);
    },
  );

  await check(
    'Shift+Digit1..7 controls lenses without changing visual style, including AZERTY',
    async () => {
      for (const lens of LENSES) {
        await clear();
        const before = await snapshot();
        await page.evaluate(
          (digit) =>
            document.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: String(digit),
                code: `Digit${digit}`,
                shiftKey: true,
                bubbles: true,
              }),
            ),
          lens.hotkey,
        );
        await waitSettled();
        const after = await snapshot();
        assert.equal(after.style, before.style);
        assert.equal(
          after.lenses.find((row) => row.id === lens.id).status,
          'on',
        );
      }
    },
  );

  await check(
    'plain digits 1..7 still select all seven visual styles',
    async () => {
      await clear();
      const styles = [
        'normal',
        'retro',
        'surveillance',
        'thermal',
        'anime',
        'noir',
        'snow',
      ];
      for (let index = 0; index < styles.length; index++) {
        await page.evaluate(
          (digit) =>
            document.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: String(digit),
                code: `Digit${digit}`,
                bubbles: true,
              }),
            ),
          index + 1,
        );
        await page.waitForFunction(
          (style) => window.__godsEyeView.styleManager.activeStyle === style,
          {},
          styles[index],
        );
      }
      await page.evaluate(() =>
        window.__godsEyeView.styleManager.setStyle('normal'),
      );
    },
  );

  await check(
    'form fields ignore both plain and Shift-held digit shortcuts',
    async () => {
      await clear();
      const before = await snapshot();
      await page.evaluate(() => {
        const field = document.createElement('input');
        document.body.append(field);
        field.focus();
        field.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: '2',
            code: 'Digit2',
            shiftKey: true,
            bubbles: true,
          }),
        );
        field.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: '2',
            code: 'Digit2',
            bubbles: true,
          }),
        );
        field.remove();
      });
      await waitSettled();
      assert.equal((await snapshot()).style, before.style);
      assert.ok((await snapshot()).layers.every((row) => !row.enabled));
    },
  );

  await check('Clear Layers leaves every available lens off', async () => {
    await click('city');
    await click('signals');
    await clear();
    const state = await snapshot();
    assert.ok(state.layers.every((row) => !row.enabled));
    assert.ok(
      state.lenses.every((row) => ['off', 'unavailable'].includes(row.status)),
    );
  });

  await check(
    'Cyber theme preserves bar and narrow screens scroll within the row',
    async () => {
      await page.evaluate(() =>
        window.__godsEyeView.styleManager.setHudLayout('cyber'),
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.uiTheme === 'cyber',
      );
      await settleFrames();
      await shot('lens-cyber');
      const desktopCyber = await page.evaluate(() => {
        const row = document.querySelector('#lens-bar .lens-buttons');
        const button = row.querySelector('[data-lens-id="signals"]');
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return {
          rowWidth: row.clientWidth,
          rowScroll: row.scrollWidth,
          lastPointerReachable: hit?.closest?.('.lens-button') === button,
          hit: hit?.id || hit?.className,
        };
      });
      assert.ok(
        desktopCyber.rowScroll <= desktopCyber.rowWidth + 1,
        JSON.stringify(desktopCyber),
      );
      assert.ok(
        desktopCyber.lastPointerReachable,
        JSON.stringify(desktopCyber),
      );
      for (const viewport of [
        { width: 720, height: 480 },
        { width: 390, height: 600 },
      ]) {
        await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
        await page.evaluate(() =>
          window.__godsEyeView.styleManager.setPanelCollapsed(
            'data-panel',
            false,
            { explicit: true },
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        await settleFrames();
        await page.focus(selector('signals'));
        await page.evaluate(() => {
          const row = document.querySelector('#lens-bar .lens-buttons');
          row.scrollLeft = row.scrollWidth;
        });
        const geometry = await page.evaluate(() => {
          const bar = document.getElementById('lens-bar');
          const row = bar.querySelector('.lens-buttons');
          const button = bar.querySelector('[data-lens-id="signals"]');
          const rect = bar.getBoundingClientRect();
          const control = button.getBoundingClientRect();
          const hit = document.elementFromPoint(
            control.left + control.width / 2,
            control.top + control.height / 2,
          );
          return {
            visible: rect.width > 0 && rect.height > 0,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            viewport: innerWidth,
            viewportHeight: innerHeight,
            documentWidth: document.documentElement.scrollWidth,
            rowWidth: row.clientWidth,
            rowScroll: row.scrollWidth,
            overflow: getComputedStyle(row).overflowX,
            minControlHeight: Math.min(
              ...[...row.querySelectorAll('button')].map(
                (item) => item.getBoundingClientRect().height,
              ),
            ),
            lastPointerReachable: hit?.closest?.('.lens-button') === button,
            hit: hit
              ? { id: hit.id, tag: hit.tagName, className: hit.className }
              : null,
            control: {
              left: control.left,
              right: control.right,
              top: control.top,
              bottom: control.bottom,
            },
          };
        });
        await shot(`lens-narrow-${viewport.width}`);
        assert.ok(geometry.visible);
        assert.ok(geometry.minControlHeight >= 49, JSON.stringify(geometry));
        assert.ok(
          geometry.left >= 0 && geometry.right <= geometry.viewport + 1,
          JSON.stringify(geometry),
        );
        assert.ok(
          geometry.top >= 0 && geometry.bottom <= geometry.viewportHeight,
          JSON.stringify(geometry),
        );
        assert.ok(
          geometry.documentWidth <= geometry.viewport + 1,
          JSON.stringify(geometry),
        );
        assert.ok(['auto', 'scroll'].includes(geometry.overflow));
        assert.ok(geometry.lastPointerReachable, JSON.stringify(geometry));
      }
      await page.setViewport({
        width: 1366,
        height: 900,
        deviceScaleFactor: 1,
      });
      await page.evaluate(() => {
        window.__godsEyeView.styleManager.setHudLayout('tactical');
        window.__godsEyeView.styleManager.setStyle('normal');
      });
    },
  );

  await check(
    'Hazards frame-rate comparison records populated fixture coverage',
    async () => {
      await page.setViewport({
        width: 1366,
        height: 900,
        deviceScaleFactor: 1,
      });
      await page.evaluate(async () => {
        const app = window.__godsEyeView;
        app.styleManager.setHudLayout('tactical');
        app.styleManager.setStyle('normal');
        await app.mapStackController.setStack('osm');
        const camera = app.viewer.camera;
        camera.cancelFlight();
        camera.setView({
          destination: camera.position.constructor.fromDegrees(
            -97.7431,
            30.2672,
            1200000,
          ),
          orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        });
      });
      await clear();
      await settleFrames();
      const baseline = await measureFrames();
      await click('hazards');
      const waitReady = () =>
        page.waitForFunction(
          () => {
            const manager = window.__godsEyeView.dataManager;
            const wind = manager.layers.get('wind').module;
            const diagnostics = wind.getDiagnostics();
            const primitives = window.__godsEyeView.viewer.scene.primitives;
            const shown = [];
            for (let index = 0; index < primitives.length; index++) {
              const primitive = primitives.get(index);
              if (
                primitive.show &&
                primitive.appearance?.material?.type === 'GevWindStreamline'
              )
                shown.push(primitive);
            }
            const visibleReady =
              diagnostics.renderMode === 'gpu-streamlines'
                ? shown.length > 0 &&
                  shown.every((primitive) => primitive.ready) &&
                  diagnostics.gpu.visibleVertexCount > 0 &&
                  !diagnostics.gpu.error
                : diagnostics.painted > 0;
            window.__godsEyeView.viewer.scene.requestRender();
            return (
              !wind.getStats().loading &&
              diagnostics.particleCount > 0 &&
              (diagnostics.renderMode !== 'gpu-streamlines' ||
                diagnostics.gpu.ready) &&
              visibleReady &&
              ['weather-radar', 'weather-lightning'].every((id) => {
                const layer = manager.layers.get(id).module;
                const stats = layer.getStats();
                return (
                  !stats.loading &&
                  stats.count > 0 &&
                  !stats.error &&
                  layer.getDiagnostics().loadedTiles > 0
                );
              })
            );
          },
          {
            timeout: args.includes('--diagnose-wind') ? 10000 : 60000,
            polling: 200,
          },
        );
      try {
        await waitReady();
      } catch (error) {
        const diagnostics = await page.evaluate(() => {
          const app = window.__godsEyeView;
          const wind = app.dataManager.layers.get('wind').module;
          const cells = [];
          const primitives = app.viewer.scene.primitives;
          for (let index = 0; index < primitives.length; index++) {
            const primitive = primitives.get(index);
            if (primitive.appearance?.material?.type === 'GevWindStreamline')
              cells.push({
                show: primitive.show,
                ready: primitive.ready,
                state: primitive._state,
              });
          }
          return {
            scene: {
              mode: app.viewer.scene.mode,
              globeShow: app.viewer.scene.globe.show,
              primitivesShow: primitives.show,
              defaultLoop: app.viewer.useDefaultRenderLoop,
              documentHidden: document.hidden,
              terrain: app.viewer.terrainProvider.constructor.name,
              frameNumber: app.viewer.scene.frameState?.frameNumber,
              globeTilesLoaded: app.viewer.scene.globe.tilesLoaded,
            },
            stats: wind.getStats(),
            diagnostics: wind.getDiagnostics(),
            primitives: {
              total: cells.length,
              shown: cells.filter((cell) => cell.show).length,
              shownReady: cells.filter((cell) => cell.show && cell.ready)
                .length,
              hiddenPending: cells.filter((cell) => !cell.show && !cell.ready)
                .length,
              firstShown: cells.find((cell) => cell.show),
            },
            weather: ['weather-radar', 'weather-lightning'].map((id) => ({
              id,
              stats: app.dataManager.layers.get(id).module.getStats(),
              diagnostics: app.dataManager.layers
                .get(id)
                .module.getDiagnostics(),
            })),
          };
        });
        console.log('WIND_READINESS_DIAGNOSTIC', JSON.stringify(diagnostics));
        if (args.includes('--diagnose-engine')) {
          console.log(
            'ENGINE_DIAGNOSTIC',
            JSON.stringify(
              await page.evaluate(async () => {
                const source = await (
                  await fetch('/src/maps/imagery.js')
                ).text();
                const moduleUrl = source.match(
                  /from\s+["']([^"']*cesium\.js[^"']*)["']/,
                )?.[1];
                if (!moduleUrl)
                  return {
                    error: 'Cesium module URL unavailable',
                    source: source.slice(0, 250),
                  };
                const C = await import(moduleUrl);
                const race = (promise) =>
                  Promise.race([
                    Promise.resolve(promise),
                    new Promise((resolve) =>
                      setTimeout(() => resolve('pending-after-3000ms'), 3000),
                    ),
                  ]);
                const transfer = await race(
                  C.TaskProcessor._canTransferArrayBuffer,
                );
                const bitmap = await race(
                  C.Resource.supportsImageBitmapOptions(),
                );
                const workerUrl = C.buildModuleUrl(
                  'Workers/transferTypedArrayTest.js',
                );
                const worker = await new Promise((resolve) => {
                  const value = new Worker(workerUrl, { type: 'module' });
                  const done = (result) => {
                    clearTimeout(timer);
                    value.terminate();
                    resolve(result);
                  };
                  const timer = setTimeout(
                    () => done({ status: 'timeout' }),
                    3000,
                  );
                  value.onerror = (event) =>
                    done({ status: 'error', message: event.message });
                  value.onmessage = (event) =>
                    done({ status: 'message', value: event.data.array?.[0] });
                  value.postMessage({ array: new Int8Array([99]) });
                });
                return {
                  hardwareConcurrency: navigator.hardwareConcurrency,
                  transfer,
                  bitmap,
                  workerUrl,
                  worker,
                };
              }),
            ),
          );
        }
        throw error;
      }
      await settleFrames();
      const state = await snapshot();
      const ids = LENSES.find((lens) => lens.id === 'hazards').layerIds;
      const layers = state.layers.filter((row) => ids.includes(row.id));
      assert.equal(
        layers.filter((row) => row.enabled).length,
        fullHazards ? 7 : 6,
      );
      const wind = layers.find((row) => row.id === 'wind');
      assert.equal(wind.stats.count, windCount);
      assert.equal(
        layers.find((row) => row.id === 'weather-cyclones').stats.count,
        1,
      );
      assert.equal(
        layers.find((row) => row.id === 'fire-perimeters').stats.count,
        1,
      );
      assert.ok(
        layers
          .filter((row) => row.enabled)
          .every((row) => !row.stats.error && !row.stats.loading),
        JSON.stringify(layers),
      );
      assert.equal(
        layers.find((row) => row.id === 'earthquakes').stats.count,
        quakes.features.length,
      );
      if (fullHazards)
        assert.equal(
          layers.find((row) => row.id === 'local-firms').stats.count,
          fires.length,
        );
      const hazards = await measureFrames();
      const pairedSamples = [{ baseline, hazards }];
      if (baseline.fps > 0 && hazards.fps < baseline.fps * 0.85) {
        // Recheck a material drop with fresh matched pairs, rather than making
        // a trimming recommendation from one software-rendered interval.
        for (let repeat = 0; repeat < 2; repeat++) {
          await clear();
          await settleFrames();
          const nextBaseline = await measureFrames();
          await click('hazards');
          await waitReady();
          await settleFrames();
          pairedSamples.push({
            baseline: nextBaseline,
            hazards: await measureFrames(),
          });
        }
      }
      const median = (values) =>
        [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const medianBaselineFps = median(
        pairedSamples.map((sample) => sample.baseline.fps),
      );
      const medianHazardsFps = median(
        pairedSamples.map((sample) => sample.hazards.fps),
      );
      const actualView = await page.evaluate(() => {
        const app = window.__godsEyeView;
        const camera = app.viewer.camera;
        const wind = app.dataManager.layers.get('wind').module;
        const shown = [];
        for (
          let index = 0;
          index < app.viewer.scene.primitives.length;
          index++
        ) {
          const primitive = app.viewer.scene.primitives.get(index);
          if (
            primitive.show &&
            primitive.appearance?.material?.type === 'GevWindStreamline'
          )
            shown.push(primitive);
        }
        return {
          width: innerWidth,
          height: innerHeight,
          style: app.styleManager.activeStyle,
          hud: document.documentElement.dataset.uiTheme || 'tactical',
          mapStack: app.mapStackController.getActiveId(),
          windReadiness: {
            visibleCells: shown.length,
            visibleReadyCells: shown.filter((primitive) => primitive.ready)
              .length,
            globalReady: wind.getDiagnostics().gpu.ready,
            globalLoading: wind.getStats().loading,
          },
          weatherLoadedTiles: ['weather-radar', 'weather-lightning'].map(
            (id) => ({
              id,
              loadedTiles: app.dataManager.layers
                .get(id)
                .module.getDiagnostics().loadedTiles,
            }),
          ),
          camera: {
            longitude: camera.positionCartographic.longitude,
            latitude: camera.positionCartographic.latitude,
            height: camera.positionCartographic.height,
            heading: camera.heading,
            pitch: camera.pitch,
            roll: camera.roll,
          },
        };
      });
      performanceResult = {
        workload:
          'transport fixtures; system Chromium SwiftShader; forced matched render demand',
        viewport: actualView,
        baseline,
        hazards,
        pairedSamples,
        medianBaselineFps,
        medianHazardsFps,
        dropPercent: medianBaselineFps
          ? (1 - medianHazardsFps / medianBaselineFps) * 100
          : null,
        enabledLayers: layers.filter((row) => row.enabled).map((row) => row.id),
        layers,
        fixtures: {
          earthquakes: quakes.features.length,
          cyclone: 1,
          firePerimeter: 1,
          windGrid: windCount,
          weatherImagery: 2,
          firms: fullHazards ? fires.length : 'unavailable: no key',
        },
      };
      console.log('HAZARDS_FPS', JSON.stringify(performanceResult));
      assert.ok(baseline.frames > 0 && hazards.frames > 0);
      await shot('hazards-on');
    },
  );
  await check(
    'unavailable-state screenshot uses the real lens factory with explicitly synthetic source metadata',
    async () => {
      const fixturePage = await browser.newPage();
      await fixturePage.setViewport({
        width: 720,
        height: 480,
        deviceScaleFactor: 1,
      });
      await fixtureRequests(
        fixturePage,
        (request) => {
          const url = new URL(request.url());
          if (url.pathname !== '/qa-lens-status-fixture') {
            return intercept(request);
          }
          return reply(
            request,
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic unavailable lens status</title><link rel="stylesheet" href="/style.css"></head><body><p style="position:fixed;top:15px;left:20px;color:white;font:14px sans-serif">Synthetic status fixture: every source unavailable</p><div id="left-panel-stack"><section id="lens-bar" class="panel-collapsible active" data-panel-id="lens-bar" data-panel-fixed aria-label="Data lenses"><div data-panel-surface><div class="lens-buttons" data-panel-body data-rail-scroller role="group" aria-label="Data lenses"></div></div></section></div><script type="module">import { LENSES } from '/src/lenses/catalog.js'; import { createLensBar } from '/src/ui/lensBar.js'; const layers = [...new Set(LENSES.flatMap(lens => lens.layerIds))].map(id => ({id,name:id,enabled:false,available:false,reason:'Synthetic unavailable source fixture'})); createLensBar({container:document.getElementById('lens-bar'),getLayers:()=>layers,setEnabled:()=>{throw new Error('Disabled fixture issued a layer action');}});</script></body></html>`,
            'text/html',
          );
        },
        [`${origin}/qa-lens-status-fixture`],
      );
      try {
        await fixturePage.goto(`${origin}/qa-lens-status-fixture`, {
          waitUntil: 'networkidle0',
        });
        await fixturePage.waitForFunction(
          () =>
            document.querySelectorAll('#lens-bar .lens-button:disabled')
              .length === 7,
        );
        await fixturePage.screenshot({
          path: path.join(evidence, 'lens-unavailable-fixture.png'),
        });
        await (
          await fixturePage.$('#lens-bar')
        ).screenshot({
          path: path.join(evidence, 'lens-unavailable-fixture-bar.png'),
        });
      } finally {
        await fixturePage.close();
      }
    },
  );
  let fixtureDrainTimeout;
  try {
    await Promise.race([
      (async () => {
        while (pendingFixtureRequests.size) {
          await Promise.allSettled([...pendingFixtureRequests]);
        }
      })(),
      new Promise((_, reject) => {
        fixtureDrainTimeout = setTimeout(
          () => reject(new Error('Fixture handlers did not settle within 5s')),
          5000,
        );
      }),
    ]);
  } catch (error) {
    pageErrors.push(error.message);
  } finally {
    clearTimeout(fixtureDrainTimeout);
  }
  record(
    'no uncaught application errors',
    pageErrors.length === 0,
    pageErrors.length ? pageErrors : null,
  );
} catch (error) {
  record('harness completed', false, error.stack || String(error));
  try {
    console.log(
      'BOOT_DIAGNOSTICS',
      JSON.stringify({
        consoleErrors,
        networkErrors,
        pageErrors,
        document: await page.evaluate(() => ({
          title: document.title,
          readyState: document.readyState,
          text: document.body?.textContent?.slice(0, 1500),
        })),
      }),
    );
    await shot('failure');
  } catch {
    /* Preserve the primary failure if the page itself has closed. */
  }
} finally {
  const summary = {
    generatedAt: new Date().toISOString(),
    appUrl,
    fullHazards,
    performanceOnly,
    skipPerformance,
    mode: 'deterministic transport fixtures; live provider access and hardware GPU not verified',
    results,
    skipped,
    passed: results.filter((row) => row.passed).length,
    failed: results.filter((row) => !row.passed).length,
    performance: performanceResult,
    pageErrors,
    consoleErrors,
    networkErrors,
    transport,
  };
  await fs.writeFile(
    path.join(evidence, 'report.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  await browser.close();
  console.log(
    `RESULT: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped.length} skipped`,
  );
  console.log(`Evidence: ${evidence}`);
  process.exitCode = summary.failed ? 1 : 0;
}
