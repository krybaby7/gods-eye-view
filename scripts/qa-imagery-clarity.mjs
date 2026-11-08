#!/usr/bin/env node
/**
 * Matched, nadir Esri / Google satellite captures and a credential-free
 * controller-switch regression. Start the Vite dev server before running.
 * No Google clarity conclusion is made by this harness: it records evidence.
 * Full viewport screenshots retain the application's native attribution.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const args = new Set(process.argv.slice(2));
if (args.has('--help')) {
  console.log(`Usage: node scripts/qa-imagery-clarity.mjs [--headful] [--google-approved]

Default: credential-safe Esri baseline plus synthetic provider-switch checks.
--google-approved permits configured Google satellite requests for this run.
Use it only after the user explicitly approves Google API usage. It does not
configure an account, provide credentials, or authorize Google 3D / Places.

QA_BASE_URL                 Vite dev server (default http://localhost:4173)
QA_SHOTS_DIR                Output (default qa-shots/imagery-clarity)
QA_SETTLE_TIMEOUT_MS         Per-capture bound (default 30000; max 120000)
PUPPETEER_EXECUTABLE_PATH    Optional installed Chrome executable

Captures: Giza 29.9792,31.1342 at 3 km and Cairo 30.0444,31.2357 at 15 km;
1440x900 viewport, DPR 1, heading 0, pitch -90, roll 0, identical render and
sharpen controls. report.json includes corner/center ellipsoid rays, actual
canvas pixels, tile loading and stable rendered frames. Missing credentials
or withheld approval produce explicit pending Google results. No keys, URLs
containing credentials, browser logs, or raw request errors are written.`);
  process.exit(0);
}

const allowedArgs = new Set(['--headful', '--google-approved']);
if ([...args].some((arg) => !allowedArgs.has(arg))) {
  console.error('Unknown argument. Run with --help for supported options.');
  process.exit(1);
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const shotsDir =
  process.env.QA_SHOTS_DIR ||
  path.join(repoRoot, 'qa-shots', 'imagery-clarity');
let base;
try {
  base = new URL(process.env.QA_BASE_URL || 'http://localhost:4173');
  if (!['http:', 'https:'].includes(base.protocol))
    throw new Error('Invalid protocol');
} catch {
  console.error(
    'QA_BASE_URL must be a valid HTTP or HTTPS app URL. Its value is suppressed.',
  );
  process.exit(1);
}
// Never carry query-string credentials or basic-auth credentials into evidence.
base.username = '';
base.password = '';
base.search = '';
base.hash = '';
const requestedTimeout = Number(process.env.QA_SETTLE_TIMEOUT_MS || 30_000);
const settleTimeout = Number.isFinite(requestedTimeout)
  ? Math.max(1_000, Math.min(120_000, requestedTimeout))
  : 30_000;
const googleApproved = args.has('--google-approved');
const sites = [
  { id: 'giza', lat: 29.9792, lon: 31.1342, height: 3_000 },
  { id: 'cairo', lat: 30.0444, lon: 31.2357, height: 15_000 },
];
fs.mkdirSync(shotsDir, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  setup: {
    statusAvailable: false,
    googleConfigured: false,
    ionConfigured: false,
  },
  googleApproved,
  captures: [],
  comparisons: [],
  syntheticSwitch: { status: 'pending' },
  checks: [],
  diagnostics: {
    pageErrorCount: 0,
    consoleErrorCount: 0,
    blockedPaidRequests: 0,
    failedRequests: { terrain: 0, imagery: 0, localAsset: 0, other: 0 },
  },
  conclusion:
    'Google imagery clarity is pending; no provider improvement has been established.',
  redaction:
    'Only credential-presence booleans and allowlisted numerical/state evidence are recorded. Browser logs, provider URLs and raw errors are omitted.',
};
let browser;
let page;
let network;
let stage = 'setup-status';
const traffic = {
  esri: { requests: 0, successfulTileResponses: 0, failedTileResponses: 0 },
  google: { requests: 0, successfulTileResponses: 0, failedTileResponses: 0 },
};
const check = (name, passed) => {
  report.checks.push({ name, passed: Boolean(passed) });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}`);
};
const writeReport = () =>
  fs.writeFileSync(
    path.join(shotsDir, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
const tileCategory = (url) => {
  if (
    /arcgisonline\.com$/.test(url.hostname) &&
    /\/MapServer\/tile\//i.test(url.pathname)
  )
    return 'esri';
  if (
    (/googleapis\.com$/.test(url.hostname) &&
      /\/2dtiles\//i.test(url.pathname)) ||
    (/cesium\.com$/.test(url.hostname) && /\/tile\//i.test(url.pathname)) ||
    (/google\.com$/.test(url.hostname) && /\/vt\b/.test(url.pathname))
  )
    return 'google';
  return null;
};
const nearNumbers = (left, right, tolerance) => {
  if (typeof left === 'number' && typeof right === 'number')
    return Math.abs(left - right) <= tolerance;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return left === right;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        nearNumbers(left[key], right[key], tolerance),
    )
  );
};
const allowGoogleSatellite = (allowed) =>
  network.send('Network.setBlockedURLs', {
    urls: [
      `${base.origin}/api/google/*`,
      `${base.origin}/api/openai/*`,
      // Always block startup 3D. Explicit approval covers satellite imagery.
      '*://tile.googleapis.com/v1/3dtiles/*',
      ...(allowed
        ? []
        : [
            '*://tile.googleapis.com/*',
            '*://maps.googleapis.com/*',
            '*://api.cesium.com/*',
          ]),
    ],
  });

try {
  // This is the first network action. Retain two presence booleans only;
  // even the setup payload's account links and environment names are discarded.
  const response = await fetch(new URL('/api/setup/status', base), {
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Setup status unavailable');
  const payload = await response.json();
  if (!Array.isArray(payload.keys)) throw new Error('Setup status unavailable');
  report.setup = {
    statusAvailable: true,
    googleConfigured:
      payload.keys.find((key) => key.id === 'google-maps')?.set === true,
    ionConfigured:
      payload.keys.find((key) => key.id === 'cesium-ion')?.set === true,
  };
  console.log(
    `Setup presence: Google=${report.setup.googleConfigured}; Cesium ion=${report.setup.ionConfigured}`,
  );
  stage = 'browser-launch';
  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath());
  if (!executablePath || !fs.existsSync(executablePath))
    throw new Error('Chrome unavailable');
  browser = await puppeteer.launch({
    headless: args.has('--headful') ? false : 'new',
    executablePath,
    args: [
      ...(process.platform === 'darwin'
        ? ['--use-angle=metal', '--enable-gpu']
        : ['--use-gl=angle', '--use-angle=swiftshader']),
      '--no-sandbox',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });
  page = await browser.newPage();
  await page.bringToFront();
  await page.setViewport(report.viewport);
  page.on('pageerror', () => {
    report.diagnostics.pageErrorCount += 1;
  });
  page.on('console', (message) => {
    if (message.type() === 'error') report.diagnostics.consoleErrorCount += 1;
  });
  // Fetch interception stalls Cesium's quantized-mesh worker transforms in
  // the installed Chromium. Native URL blocking protects paid APIs without
  // intercepting worker loads or harmless Google Fonts / credit assets.
  network = await page.createCDPSession();
  await network.send('Network.enable');
  await allowGoogleSatellite(false);
  page.on('request', (request) => {
    const category = tileCategory(new URL(request.url()));
    if (category) traffic[category].requests += 1;
  });
  page.on('response', (response) => {
    const category = tileCategory(new URL(response.url()));
    if (category) {
      const field = response.ok()
        ? 'successfulTileResponses'
        : 'failedTileResponses';
      traffic[category][field] += 1;
    }
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (
      ['tile.googleapis.com', 'maps.googleapis.com', 'api.cesium.com'].includes(
        url.hostname,
      ) &&
      request.failure()?.errorText === 'net::ERR_BLOCKED_BY_CLIENT'
    )
      report.diagnostics.blockedPaidRequests += 1;
    const category =
      url.hostname === 'terrain.reearth.land'
        ? 'terrain'
        : tileCategory(url)
          ? 'imagery'
          : url.origin === base.origin
            ? 'localAsset'
            : 'other';
    report.diagnostics.failedRequests[category] += 1;
  });
  // A fresh browser has no durable operator state. Pin the same rendering
  // mode before app boot and suppress the unrelated first-run launcher.
  await page.evaluateOnNewDocument(() =>
    localStorage.setItem('gev-map-render-quality', 'sharp'),
  );
  stage = 'app-boot';
  const app = new URL(base);
  app.searchParams.set('welcome', '0');
  app.hash =
    'v=2&lat=29.9792&lon=31.1342&alt=3000&heading=0&pitch=-90&roll=0&style=normal&bloom=0&sharpen=0&si=49&map=esri-imagery&l=&cr=0&sc=0';
  await page.goto(app.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => window.__godsEyeView?.viewer && window.__godsEyeView?.styleManager,
    { timeout: 60_000 },
  );
  // The app intentionally suspends its viewer for a hidden tab. Screenshot
  // capture also foregrounds Chromium, but that is too late for tile settling.
  await page.bringToFront();
  await page.waitForFunction(
    () => !document.hidden && window.__godsEyeView.viewer.useDefaultRenderLoop,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    () =>
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 60_000 },
  );
  await page.evaluate(async () => {
    document.querySelector('[data-key-setup-close]')?.click();
    const gev = window.__godsEyeView;
    await gev.styleManager.applyVisualState({
      style: 'normal',
      bloom: { enabled: false },
      sharpen: { enabled: false, intensity: 49 },
      scope: { enabled: false },
    });
    gev.viewer.trackedEntity = undefined;
    gev.viewer.selectedEntity = undefined;
    gev.styleManager.orbitController?.stop?.();
    const viewer = gev.viewer;
    window.__imageryClarityQa = {
      progress: 0,
      peakProgress: 0,
      progressEvents: 0,
      providerErrors: 0,
      renderErrors: 0,
      removeError: null,
    };
    const qa = window.__imageryClarityQa;
    qa.removeRenderError = viewer.scene.renderError.addEventListener(() => {
      qa.renderErrors += 1;
    });
    qa.removeProgress =
      viewer.scene.globe.tileLoadProgressEvent.addEventListener((pending) => {
        qa.progress = pending;
        qa.peakProgress = Math.max(qa.peakProgress, pending);
        qa.progressEvents += 1;
      });
    qa.controls = () => {
      const { mapStack, ...controls } = gev.styleManager.getControlState();
      return {
        ...controls,
        detailMode:
          document.getElementById('map-render-quality')?.value || null,
        resolutionScale: viewer.resolutionScale,
        useBrowserRecommendedResolution: viewer.useBrowserRecommendedResolution,
        globeMaximumScreenSpaceError:
          viewer.scene.globe.maximumScreenSpaceError,
        scope: {
          pressed:
            document
              .getElementById('scope-toggle')
              ?.getAttribute('aria-pressed') || null,
          feather:
            document.getElementById('scope-feather-slider')?.value || null,
        },
        cameraControls: Object.fromEntries(
          [
            'enableInputs',
            'enableTranslate',
            'enableZoom',
            'enableRotate',
            'enableTilt',
            'enableLook',
          ].map((key) => [key, viewer.scene.screenSpaceCameraController[key]]),
        ),
      };
    };
    qa.pose = () => {
      const camera = viewer.camera;
      const vector = (value) => ({ x: value.x, y: value.y, z: value.z });
      return {
        position: vector(camera.positionWC),
        direction: vector(camera.directionWC),
        up: vector(camera.upWC),
        heading: camera.heading,
        pitch: camera.pitch,
        roll: camera.roll,
      };
    };
    qa.readyTiles = () => {
      // Diagnostic only: public tilesLoaded remains the settling contract.
      const layer = gev.mapStackController._imageryLayer;
      const tiles = viewer.scene.globe._surface?._tilesToRender || [];
      return tiles.filter((tile) =>
        tile.data?.imagery?.some(
          (entry) => entry.readyImagery?.imageryLayer === layer,
        ),
      ).length;
    };
  });

  const activate = async (id) =>
    page.evaluate(async (sourceId) => {
      const gev = window.__godsEyeView;
      const qa = window.__imageryClarityQa;
      qa.removeError?.();
      qa.providerErrors = 0;
      qa.peakProgress = qa.progress;
      qa.progressEvents = 0;
      await gev.styleManager._setMapStack(sourceId, { syncShare: false });
      qa.removeError =
        gev.mapStackController._activeImageryProvider?.errorEvent?.addEventListener(
          () => {
            qa.providerErrors += 1;
          },
        );
      gev.viewer.scene.requestRender();
      return gev.mapStackController.getActiveId() === sourceId;
    }, id);

  const settle = async () =>
    page.evaluate(
      (timeoutMs) =>
        new Promise((resolve) => {
          const gev = window.__godsEyeView;
          const qa = window.__imageryClarityQa;
          const scene = gev.viewer.scene;
          const started = performance.now();
          let stableFrames = 0;
          let stableSince = null;
          let renderedFrames = 0;
          let lastSignature = '';
          let finished = false;
          let remove;
          let pump;
          const finish = (settled) => {
            if (finished) return;
            finished = true;
            remove?.();
            clearInterval(pump);
            clearTimeout(timer);
            resolve({
              settled,
              timedOut: !settled,
              elapsedMs: Math.round(performance.now() - started),
              stableFrames,
              continuouslyStableMs:
                stableSince === null
                  ? 0
                  : Math.round(performance.now() - stableSince),
              renderedFrames,
              documentVisible: !document.hidden,
              useDefaultRenderLoop: gev.viewer.useDefaultRenderLoop,
              tilesLoaded: scene.globe.tilesLoaded,
              pendingTileCount: qa.progress,
              peakPendingTileCount: qa.peakProgress,
              tileProgressEvents: qa.progressEvents,
              providerErrorCount: qa.providerErrors,
              renderErrorCount: qa.renderErrors,
              tileLoadQueues: [
                '_tileLoadQueueHigh',
                '_tileLoadQueueMedium',
                '_tileLoadQueueLow',
              ].map((key) => scene.globe._surface?.[key]?.length ?? null),
              pendingTerrainStates:
                scene.globe._surface?._tileLoadQueueHigh
                  ?.slice(0, 4)
                  .map((tile) => tile.data?.terrainState ?? null) || [],
              renderedTilesWithActiveImagery: qa.readyTiles(),
            });
          };
          remove = scene.postRender.addEventListener(() => {
            renderedFrames += 1;
            const signature = JSON.stringify({
              pose: qa.pose(),
              ready: qa.readyTiles(),
              source: gev.mapStackController.getActiveId(),
            });
            const loaded =
              scene.globe.tilesLoaded === true &&
              qa.progress === 0 &&
              gev.mapStackController.getState().status !== 'switching' &&
              qa.readyTiles() > 0;
            if (loaded && signature === lastSignature) {
              stableFrames += 1;
              stableSince ??= performance.now();
            } else {
              stableFrames = 0;
              stableSince = null;
            }
            lastSignature = signature;
            if (
              stableFrames >= 3 &&
              stableSince !== null &&
              performance.now() - stableSince >= 1_000
            )
              finish(true);
          });
          const timer = setTimeout(() => finish(false), timeoutMs);
          pump = setInterval(() => scene.requestRender(), 100);
          scene.requestRender();
        }),
      settleTimeout,
    );

  const metrics = async () =>
    page.evaluate(() => {
      const gev = window.__godsEyeView;
      const viewer = gev.viewer;
      const qa = window.__imageryClarityQa;
      const canvas = viewer.canvas;
      const rect = canvas.getBoundingClientRect();
      const sample = (name, x, y) => {
        const point = { x, y };
        const ray = viewer.camera.getPickRay(point);
        // pickEllipsoid intersects this camera ray with the WGS84 ellipsoid;
        // terrain height and provider mesh differences cannot alter the footprint.
        const hit = viewer.camera.pickEllipsoid(
          point,
          viewer.scene.globe.ellipsoid,
        );
        const cartographic = hit
          ? viewer.scene.globe.ellipsoid.cartesianToCartographic(hit)
          : null;
        const vector = (value) =>
          value ? { x: value.x, y: value.y, z: value.z } : null;
        return {
          name,
          canvasPoint: point,
          ray: {
            origin: vector(ray?.origin),
            direction: vector(ray?.direction),
          },
          ellipsoidHit: cartographic
            ? {
                latitude: (cartographic.latitude * 180) / Math.PI,
                longitude: (cartographic.longitude * 180) / Math.PI,
                height: cartographic.height,
              }
            : null,
        };
      };
      const rays = [
        sample('northwest', 0, 0),
        sample('northeast', rect.width, 0),
        sample('southeast', rect.width, rect.height),
        sample('southwest', 0, rect.height),
        sample('center', rect.width / 2, rect.height / 2),
      ];
      const hits = rays
        .slice(0, 4)
        .map((ray) => ray.ellipsoidHit)
        .filter(Boolean);
      const credits = document.getElementById('cesium-credits');
      // Cesium absolutely positions this child; its caller-owned parent can
      // legitimately have a zero-size box while the credits are visibly drawn.
      const visibleCredits =
        credits?.querySelector('.cesium-widget-credits') || credits;
      const creditRect = visibleCredits?.getBoundingClientRect();
      return {
        activeSource: gev.mapStackController.getActiveId(),
        camera: qa.pose(),
        groundCoverage: {
          method: 'camera corner and center rays intersect WGS84 ellipsoid',
          rays,
          rectangleDegrees:
            hits.length === 4
              ? {
                  west: Math.min(...hits.map((hit) => hit.longitude)),
                  east: Math.max(...hits.map((hit) => hit.longitude)),
                  south: Math.min(...hits.map((hit) => hit.latitude)),
                  north: Math.max(...hits.map((hit) => hit.latitude)),
                }
              : null,
        },
        canvas: {
          cssWidth: rect.width,
          cssHeight: rect.height,
          width: canvas.width,
          height: canvas.height,
          drawingBufferWidth: viewer.scene.drawingBufferWidth,
          drawingBufferHeight: viewer.scene.drawingBufferHeight,
          devicePixelRatio,
        },
        controls: qa.controls(),
        attribution: {
          text: credits?.innerText?.trim() || '',
          visible: Boolean(
            creditRect &&
            creditRect.width > 0 &&
            creditRect.height > 0 &&
            creditRect.left >= 0 &&
            creditRect.top >= 0 &&
            creditRect.right <= innerWidth &&
            creditRect.bottom <= innerHeight,
          ),
        },
      };
    });

  const capture = async (site, provider, restoredPose = null) => {
    stage = `${site.id}-${provider}`;
    await page.bringToFront();
    const selected = await activate(provider);
    await page.evaluate(
      ({ target, saved }) => {
        const viewer = window.__godsEyeView.viewer;
        viewer.camera.cancelFlight();
        viewer.camera.setView({
          destination:
            saved?.position ||
            viewer.camera.position.constructor.fromDegrees(
              target.lon,
              target.lat,
              target.height,
            ),
          orientation: saved
            ? { direction: saved.direction, up: saved.up }
            : { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        });
        viewer.scene.requestRender();
      },
      { target: site, saved: restoredPose },
    );
    // Chrome's Windows headless compositor can defer its first presented
    // frame despite a visible document and a running Cesium render loop.
    // Prime presentation, discard this image, then require actual loaded tiles
    // and stable postRender frames before writing the evidence screenshot.
    await page.screenshot({ type: 'png', fullPage: false });
    const loading = await settle();
    const evidence = await metrics();
    const loaded =
      selected &&
      evidence.activeSource === provider &&
      loading.settled &&
      loading.renderedTilesWithActiveImagery > 0 &&
      loading.providerErrorCount === 0;
    const screenshot = `${site.id}-${provider}${loaded ? '' : '-incomplete'}.png`;
    // Preserve all native credits: no canvas-only crop, CSS hiding or overlays.
    await page.screenshot({
      path: path.join(shotsDir, screenshot),
      type: 'png',
      fullPage: false,
    });
    const result = {
      site,
      provider,
      status: loaded ? 'loaded' : 'incomplete',
      screenshot,
      loading,
      traffic: { ...traffic[provider === 'esri-imagery' ? 'esri' : 'google'] },
      ...evidence,
    };
    report.captures.push(result);
    check(
      `${site.id}: ${provider} is loaded after stable rendered frames`,
      loaded,
    );
    check(
      `${site.id}: native attribution stays visible`,
      evidence.attribution.visible && Boolean(evidence.attribution.text),
    );
    check(
      `${site.id}: actual canvas is 1440x900 at DPR 1`,
      evidence.canvas.width === 1440 &&
        evidence.canvas.height === 900 &&
        evidence.canvas.devicePixelRatio === 1,
    );
    return result;
  };

  const configured =
    report.setup.googleConfigured || report.setup.ionConfigured;
  const googleAvailable = await page.evaluate(() =>
    window.__godsEyeView.mapStackController.isStackAvailable(
      'google-satellite',
    ),
  );
  for (const site of sites) {
    await allowGoogleSatellite(false);
    const baseline = await capture(site, 'esri-imagery');
    if (
      googleApproved &&
      configured &&
      googleAvailable &&
      baseline.status === 'loaded'
    ) {
      await allowGoogleSatellite(true);
      const candidate = await capture(
        site,
        'google-satellite',
        baseline.camera,
      );
      const { position: beforePosition, ...beforeOrientation } =
        baseline.camera;
      const { position: afterPosition, ...afterOrientation } = candidate.camera;
      const sameCamera =
        nearNumbers(beforePosition, afterPosition, 0.0001) &&
        nearNumbers(beforeOrientation, afterOrientation, 1e-10);
      const sameCoverage =
        Boolean(
          baseline.groundCoverage.rectangleDegrees &&
          candidate.groundCoverage.rectangleDegrees,
        ) &&
        nearNumbers(
          baseline.groundCoverage.rectangleDegrees,
          candidate.groundCoverage.rectangleDegrees,
          1e-9,
        );
      const sameRendering =
        JSON.stringify(baseline.controls) ===
          JSON.stringify(candidate.controls) &&
        JSON.stringify(baseline.canvas) === JSON.stringify(candidate.canvas);
      const googleLoaded =
        candidate.status === 'loaded' &&
        candidate.traffic.successfulTileResponses > 0 &&
        /google/i.test(candidate.attribution.text);
      check(
        `${site.id}: live Google tiles and Google attribution were observed`,
        googleLoaded,
      );
      check(
        `${site.id}: Google comparison has identical camera, ground rectangle and rendering`,
        sameCamera && sameCoverage && sameRendering,
      );
      report.comparisons.push({
        site: site.id,
        status:
          googleLoaded && sameCamera && sameCoverage && sameRendering
            ? 'ready-for-visual-review'
            : 'incomplete',
        googleActuallyLoaded: googleLoaded,
        sameCamera,
        sameCoverage,
        sameRendering,
        conclusion:
          'Matched captures are evidence for visual review; no imagery improvement is inferred automatically.',
      });
    } else {
      const reason = !configured
        ? 'Google and Cesium credentials are absent'
        : !googleApproved
          ? 'Explicit Google API approval has not been supplied'
          : !googleAvailable
            ? 'Configured Google satellite source is unavailable'
            : 'Esri baseline has not settled';
      report.comparisons.push({
        site: site.id,
        status: 'pending',
        googleActuallyLoaded: false,
        reason,
      });
      console.log(`[PENDING] ${site.id}: live Google comparison — ${reason}`);
    }
  }
  await allowGoogleSatellite(false);
  await activate('esri-imagery');
  stage = 'synthetic-switch';
  report.syntheticSwitch = await page.evaluate(async () => {
    const gev = window.__godsEyeView;
    const viewer = gev.viewer;
    const controller = gev.mapStackController;
    const qa = window.__imageryClarityQa;
    const id = 'google-satellite';
    const originalSource = controller._sources.get(id);
    const originalIndex = controller._registry.sources.findIndex(
      (source) => source.descriptor.id === id,
    );
    const originalCache = controller._imageryProviders.get(id);
    const saved = {
      selected: viewer.selectedEntity,
      tracked: viewer.trackedEntity,
      pose: qa.pose(),
    };
    const osm = controller._sources.get('osm');
    const renderFrames = () =>
      new Promise((resolve) => {
        let frames = 0;
        const finish = (passed) => {
          remove();
          clearTimeout(timer);
          clearInterval(pump);
          resolve(passed);
        };
        const remove = viewer.scene.postRender.addEventListener(() => {
          if (++frames >= 3) finish(true);
        });
        const timer = setTimeout(() => finish(false), 3_000);
        const pump = setInterval(() => viewer.scene.requestRender(), 40);
        viewer.scene.requestRender();
      });
    const provider = await osm.imagery({ signal: controller._abort.signal });
    const fixtureTile = document.createElement('canvas');
    fixtureTile.width = 256;
    fixtureTile.height = 256;
    const context = fixtureTile.getContext('2d');
    context.fillStyle = '#526657';
    context.fillRect(0, 0, 256, 256);
    context.strokeStyle = '#879c81';
    context.strokeRect(1, 1, 254, 254);
    provider.requestImage = () => Promise.resolve(fixtureTile);
    const fixture = {
      ...osm,
      descriptor: {
        ...(originalSource?.descriptor || {}),
        id,
        label: 'Synthetic Google satellite (OSM fixture)',
        kind: 'imagery',
      },
      available: true,
      unavailableReason: null,
      imagery: async () => provider,
      terrain: controller._sources.get('esri-imagery').terrain,
      credit: 'Synthetic switch test — OpenStreetMap fixture imagery',
    };
    delete fixture.constructionFallback;
    delete fixture.tileFailureFallback;
    controller._sources.set(id, fixture);
    if (originalIndex < 0) controller._registry.sources.push(fixture);
    else controller._registry.sources[originalIndex] = fixture;
    controller._imageryProviders.delete(id);
    const overlay = controller._createImageryLayer(provider);
    overlay.show = false;
    viewer.imageryLayers.add(overlay);
    const source = new viewer.dataSourceDisplay.defaultDataSource.constructor(
      'qa-imagery-preserved-source',
    );
    source.entities.add({ id: 'qa-imagery-source-entity' });
    await viewer.dataSources.add(source);
    const entity = viewer.entities.add({
      id: 'qa-imagery-selected-and-tracked',
    });
    // An entity without a moving position establishes selected/tracked IDs
    // without introducing a tracking-camera animation into this switch test.
    viewer.selectedEntity = entity;
    viewer.trackedEntity = entity;
    await renderFrames();
    const list = (collection) =>
      Array.from({ length: collection.length }, (_, index) =>
        collection.get(index),
      );
    const before = {
      viewer,
      dataSources: viewer.dataSources,
      dataSourceRefs: list(viewer.dataSources),
      entities: viewer.entities,
      entityRefs: [...viewer.entities.values],
      dataManager: gev.dataManager,
      dataLayerRefs: [...gev.dataManager.layers.entries()],
      imageryLayers: viewer.imageryLayers,
      overlays: list(viewer.imageryLayers).filter(
        (layer) => layer !== controller._imageryLayer,
      ),
      selected: viewer.selectedEntity,
      tracked: viewer.trackedEntity,
      camera: qa.pose(),
      controls: qa.controls(),
    };
    try {
      await controller.setStack(id, { silent: true });
      const switchRendered = await renderFrames();
      const active = controller.getActiveId();
      const navigationControls = [
        'north-up-view',
        'tilt-map-view',
        'zoom-map-out',
        'zoom-map-in',
      ].map((buttonId) => {
        const button = document.getElementById(buttonId);
        const rect = button?.getBoundingClientRect();
        const center = rect
          ? document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            )
          : null;
        return {
          id: buttonId,
          semanticButton:
            button?.tagName === 'BUTTON' && button.type === 'button',
          labeled: Boolean(button?.getAttribute('aria-label')),
          enabled: Boolean(button && !button.disabled),
          visibleAndUnobscured: Boolean(
            rect &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight &&
            (center === button || button.contains(center)),
          ),
        };
      });
      const after = {
        sameViewer: gev.viewer === before.viewer,
        sameDataSourceCollection: viewer.dataSources === before.dataSources,
        sameDataSources:
          before.dataSourceRefs.every(
            (value, index) => viewer.dataSources.get(index) === value,
          ) && viewer.dataSources.length === before.dataSourceRefs.length,
        sameEntityCollection: viewer.entities === before.entities,
        sameEntities:
          before.entityRefs.every(
            (value, index) => viewer.entities.values[index] === value,
          ) && viewer.entities.values.length === before.entityRefs.length,
        sameDataManager: gev.dataManager === before.dataManager,
        sameDataLayers:
          before.dataLayerRefs.every(
            ([key, value]) => gev.dataManager.layers.get(key) === value,
          ) && gev.dataManager.layers.size === before.dataLayerRefs.length,
        sameImageryCollection: viewer.imageryLayers === before.imageryLayers,
        preservedOverlayLayers: before.overlays.every((value) =>
          viewer.imageryLayers.contains(value),
        ),
        sameSelectedEntity: viewer.selectedEntity === before.selected,
        sameTrackedEntity: viewer.trackedEntity === before.tracked,
        sameCamera: JSON.stringify(qa.pose()) === JSON.stringify(before.camera),
        sameControls:
          JSON.stringify(qa.controls()) === JSON.stringify(before.controls),
        switchRendered,
        navigationControlsUsable: navigationControls.every(
          (button) =>
            button.semanticButton &&
            button.labeled &&
            button.enabled &&
            button.visibleAndUnobscured,
        ),
      };
      return {
        status:
          active === id && Object.values(after).every(Boolean)
            ? 'passed'
            : 'failed',
        synthetic: true,
        googleActuallyLoaded: false,
        fixtureImagery:
          'OpenStreetMap provider with local canvas fixture tiles; no network imagery',
        activeSource: active,
        selectedId: viewer.selectedEntity?.id || null,
        trackedId: viewer.trackedEntity?.id || null,
        navigationControls,
        preservation: after,
      };
    } finally {
      await controller.setStack('esri-imagery', { silent: true });
      viewer.selectedEntity = saved.selected;
      viewer.trackedEntity = saved.tracked;
      viewer.entities.remove(entity);
      viewer.dataSources.remove(source, true);
      viewer.imageryLayers.remove(overlay, true);
      if (originalSource) controller._sources.set(id, originalSource);
      else controller._sources.delete(id);
      if (originalIndex < 0)
        controller._registry.sources.splice(
          controller._registry.sources.indexOf(fixture),
          1,
        );
      else controller._registry.sources[originalIndex] = originalSource;
      controller._imageryProviders.delete(id);
      if (originalCache) controller._imageryProviders.set(id, originalCache);
      provider.destroy?.();
      viewer.camera.setView({
        destination: saved.pose.position,
        orientation: { direction: saved.pose.direction, up: saved.pose.up },
      });
      viewer.scene.requestRender();
    }
  });
  check(
    'synthetic Google switch preserves viewer, data, overlays, entities, camera and controls',
    report.syntheticSwitch.status === 'passed',
  );
  stage = 'source-tray';
  await page.bringToFront();
  await page.screenshot({ type: 'png', fullPage: false });
  const restoredEsriLoading = await settle();
  await page.evaluate(() =>
    window.__godsEyeView.styleManager.setPanelCollapsed(
      'control-panel',
      false,
      { persist: false, syncShare: false },
    ),
  );
  await page.waitForFunction(
    () =>
      document
        .getElementById('control-panel-toggle')
        ?.getAttribute('aria-expanded') === 'true',
    { timeout: 5_000 },
  );
  report.sourceTray = await page.evaluate(() => {
    const panel = document.getElementById('control-panel-popover');
    const rect = panel.getBoundingClientRect();
    return {
      insideViewport:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= innerWidth &&
        rect.bottom <= innerHeight,
      sources: [...document.querySelectorAll('.map-stack-chip')].map(
        (button) => ({
          id: button.dataset.stackId,
          label: button.getAttribute('aria-label'),
          semanticButton: button.tagName === 'BUTTON',
          pressed: button.getAttribute('aria-pressed'),
          ariaDisabled: button.getAttribute('aria-disabled'),
        }),
      ),
    };
  });
  const googleChip = report.sourceTray.sources.find(
    (source) => source.id === 'google-satellite',
  );
  report.sourceTray.restoredEsriLoading = restoredEsriLoading;
  check(
    'source tray retains Google satellite and truthful keyless availability after fixture teardown',
    restoredEsriLoading.settled &&
      report.sourceTray.insideViewport &&
      googleChip?.semanticButton &&
      googleChip.pressed === 'false' &&
      (configured || googleChip.ariaDisabled === 'true') &&
      report.sourceTray.sources
        .filter((source) => source.pressed === 'true')
        .map((source) => source.id)
        .join() === 'esri-imagery',
  );
  report.sourceTray.screenshot = 'source-tray.png';
  await page.screenshot({
    path: path.join(shotsDir, report.sourceTray.screenshot),
    type: 'png',
    fullPage: false,
  });
  if (
    report.comparisons.every(
      (comparison) => comparison.status === 'ready-for-visual-review',
    )
  ) {
    report.conclusion =
      'Loaded Google and Esri captures have matched camera, ground coverage and rendering. Visual assessment is required; no provider improvement is claimed.';
  }
  stage = 'complete';
} catch (error) {
  const errorKind =
    ['TypeError', 'ReferenceError', 'TimeoutError', 'TargetCloseError'].find(
      (kind) =>
        error?.name === kind || String(error?.message || '').startsWith(kind),
    ) || 'Error';
  const localFrame = String(error?.stack || '').match(
    /qa-imagery-clarity\.mjs:(\d+):(\d+)/,
  );
  report.runError = {
    stage,
    errorKind,
    harnessLine: localFrame ? Number(localFrame[1]) : null,
    message:
      'Harness stopped at this stage. Raw errors and request URLs are suppressed.',
  };
  check(`harness reaches completion (stopped at ${stage})`, false);
} finally {
  if (page && !page.isClosed()) {
    await page
      .evaluate(() => {
        window.__imageryClarityQa?.removeProgress?.();
        window.__imageryClarityQa?.removeError?.();
        window.__imageryClarityQa?.removeRenderError?.();
        delete window.__imageryClarityQa;
      })
      .catch(() => {});
  }
  await browser?.close().catch(() => {});
  writeReport();
}
const failures = report.checks.filter((entry) => !entry.passed).length;
console.log(
  `Imagery QA: ${report.checks.length - failures} passed; ${failures} failed; ${report.comparisons.filter((entry) => entry.status === 'pending').length} Google comparisons pending.`,
);
console.log(
  'Evidence saved to the imagery-clarity output directory (report.json and full-viewport screenshots).',
);
process.exitCode = failures ? 1 : 0;
