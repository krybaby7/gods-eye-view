#!/usr/bin/env node
/** Board search exercises only synthetic transport under the locked fixture runner. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';
import { createDenyProxy } from '../src/tooling/qaLookProxy.mjs';
import { createFixtureWorld, installFixtures } from './qa-world.fixtures.mjs';
import { nominatimToGeocodeResult } from '../src/nominatimGeocode.js';

const urlIndex = process.argv.indexOf('--url');
assert.ok(urlIndex !== -1, 'Use --url with the keyless fixture runner');
const url = new URL(process.argv[urlIndex + 1]);
assert.equal(url.protocol, 'http:');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.href, url.origin + '/');
url.search = '?welcome=0&world-fixtures=1';
const out = path.resolve(
  process.env.GEV_LOOK_OUT || 'qa-artifacts/board-search',
);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-board-search-'));
const wait = { timeout: 75000, polling: 125 };
const views = [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
];
const report = {
  errors: [],
  transport: {
    snapshots: 0,
    refreshes: 0,
    imageryTiles: 0,
    suppressedApis: [],
    suppressedHosts: [],
    boardGeocodeQueries: [],
  },
};
const world = createFixtureWorld(path.join(temporary, 'world'));
const lookupCity = 'Vila Verde';
const lookupLandmark = 'Quiet Museum';
const emptyLookup = 'Morwenby';
const unavailableLookup = 'Riverrun';

function boardGeocode(query) {
  if (query === emptyLookup)
    return { body: { status: 'ZERO_RESULTS', results: [] } };
  if (query === unavailableLookup)
    return { status: 503, body: { error: 'Place lookup unavailable' } };
  const hit =
    query === lookupCity
      ? { name: query, lat: '41.65', lon: '-8.43', addresstype: 'town' }
      : {
          name: query,
          lat: '41.50',
          lon: '-8.32',
          class: 'tourism',
          type: 'museum',
        };
  return { body: { status: 'OK', results: [nominatimToGeocodeResult(hit)] } };
}

const proxy = await createDenyProxy(url.origin);
let browser;
let page;
let stage = 'browser startup';
try {
  await fs.mkdir(out, { recursive: true });
  browser = await puppeteer.launch({
    headless: true,
    userDataDir: path.join(temporary, 'profile'),
    protocolTimeout: 180000,
    args: [
      '--no-sandbox',
      '--disable-quic',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      `--proxy-server=${proxy.address}`,
      '--proxy-bypass-list=<-loopback>',
    ],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await installFixtures(page, url.origin, world, report, {
    strict: true,
    boardGeocode,
  });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(url.href, {
    waitUntil: 'domcontentloaded',
    timeout: wait.timeout,
  });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.viewer &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    wait,
  );
  stage = 'park the fixture globe';
  await page.evaluate(async () => {
    const { viewer, styleManager } = window.__godsEyeView;
    await styleManager.initialRestorePromise;
    const source = await (await fetch('/src/layers/world/geometry.js')).text();
    const specifier = source.match(
      /from\s+["']([^"']*cesium\.js[^"']*)["']/,
    )?.[1];
    if (!specifier) throw new Error('Cesium fixture module not resolved');
    const C = await import(specifier);
    const imagery = await C.TileMapServiceImageryProvider.fromUrl(
      C.buildModuleUrl('Assets/Textures/NaturalEarthII'),
    );
    viewer.terrainProvider = new C.EllipsoidTerrainProvider();
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(imagery);
    viewer.camera.cancelFlight();
    viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(82, 22, 9_000_000),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    viewer.scene.requestRender();
  });
  await page.waitForFunction(() => {
    const layer =
      window.__godsEyeView?.dataManager?.layers.get('world')?.module;
    const snapshot = layer?.getSnapshot();
    return snapshot?.enabled && !snapshot.loading && snapshot.countries.IND;
  }, wait);

  const field = '#frame-search-input';
  const option = '#frame-search-list [role="option"]';
  const status = '#frame-search-status';
  const { keyboard } = page;
  async function type(query) {
    await page.click(field);
    await keyboard.down('Control');
    await keyboard.press('KeyA');
    await keyboard.up('Control');
    await keyboard.type(query);
  }

  stage = 'group discovery and three viewport captures';
  await type('a');
  await page.waitForSelector(option, { ...wait, visible: true });
  const groups = await page.$$eval(
    '#frame-search-list [role="group"]',
    (nodes) => nodes.map((node) => node.getAttribute('aria-label')),
  );
  assert.deepEqual(groups, [
    'Countries',
    'Places',
    'Layers',
    'Presets',
    'Menu',
  ]);
  assert.deepEqual(report.transport.boardGeocodeQueries, []);
  await keyboard.press('ArrowDown');
  const active = await page.$eval(field, (node) =>
    node.getAttribute('aria-activedescendant'),
  );
  assert.ok(active?.startsWith('frame-search-option-country-'));
  assert.equal(
    await page.$eval(`#${active}`, (node) =>
      node.getAttribute('aria-selected'),
    ),
    'true',
  );
  for (const [width, height] of views) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const target = await page.$eval('#frame-search-popup', (node) =>
      node.getBoundingClientRect().toJSON(),
    );
    assert.ok(
      target.left >= 0 &&
        target.right <= width &&
        target.top >= 0 &&
        target.bottom <= height,
    );
    const crop = { ...target, top: 0 };
    const stem = path.join(out, `after-${width}x${height}-board-search`);
    await captureLookImage(page, stem + '.png', stem + '-detail.png', crop, {
      width,
      height,
    });
    console.log(`[PASS] search groups fit ${width}×${height}`);
  }
  await keyboard.press('Escape');
  assert.equal(
    await page.$eval(field, (node) => node.getAttribute('aria-expanded')),
    'false',
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'frame-search-input',
  );
  console.log(
    '[PASS] search groups, keyboard selection and Escape retain control focus',
  );

  stage = '390px keyboard and layout';
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await type('Austin');
  await page.waitForSelector(option, { ...wait, visible: true });
  const narrow = await page.evaluate(() => {
    const rect = (id) => document.getElementById(id).getBoundingClientRect();
    return {
      fieldWidth: rect('frame-search-input').width,
      fieldLeft: rect('frame-search-input').left,
      fieldRight: rect('frame-search-input').right,
      popupWidth: rect('frame-search-popup').width,
      popupLeft: rect('frame-search-popup').left,
      popupRight: rect('frame-search-popup').right,
    };
  });
  assert.ok(narrow.fieldWidth > 100 && narrow.popupWidth > 200);
  assert.ok(narrow.fieldLeft >= 0 && narrow.fieldRight <= 390);
  assert.ok(narrow.popupLeft >= 0 && narrow.popupRight <= 390);
  await keyboard.press('ArrowDown');
  assert.equal(
    await page.$eval(field, (node) =>
      node.getAttribute('aria-activedescendant'),
    ),
    'frame-search-option-place-austin',
  );
  await keyboard.press('Escape');
  assert.equal(
    await page.$eval(field, (node) => node.getAttribute('aria-expanded')),
    'false',
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'frame-search-input',
  );
  assert.deepEqual(report.transport.boardGeocodeQueries, []);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  console.log(
    '[PASS] autocomplete fits and retains keyboard controls at 390px',
  );

  stage = 'local country and city';
  await type('India');
  await page.waitForSelector('#frame-search-option-country-IND', wait);
  await keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      document.activeElement?.id === 'world-sheet-name' &&
      document.getElementById('world-sheet-name')?.textContent === 'India',
    wait,
  );
  assert.deepEqual(report.transport.boardGeocodeQueries, []);
  await page.click('#world-sheet-close');
  await type('Austin');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('#frame-search-list [role="option"]')].some(
        (node) => node.textContent === 'Austin',
      ),
    wait,
  );
  await page.click('#frame-search-option-place-austin');
  async function waitForCity(lat, lng) {
    await page.waitForFunction(
      (lat, lng) => {
        const camera = window.__godsEyeView.viewer.camera.positionCartographic;
        return (
          camera.height > 210_000 &&
          camera.height < 230_000 &&
          Math.abs((camera.latitude * 180) / Math.PI - lat) < 1 &&
          Math.abs((camera.longitude * 180) / Math.PI - lng) < 1
        );
      },
      wait,
      lat,
      lng,
    );
  }
  await waitForCity(30.3, -97.75);
  assert.deepEqual(report.transport.boardGeocodeQueries, []);
  console.log(
    '[PASS] local countries open the country Sheet and bundled cities use city-scale views',
  );

  stage = 'local controls';
  await type('rain radar');
  await page.waitForSelector('#frame-search-option-layer-weather-radar', wait);
  const layerControl = '[data-layer-id="weather-radar"] button.data-toggle-btn';
  const layerBefore = await page.$eval(layerControl, (node) =>
    node.getAttribute('aria-checked'),
  );
  await keyboard.press('Enter');
  await page.waitForFunction(
    (selector) => document.activeElement.matches(selector),
    wait,
    layerControl,
  );
  assert.equal(
    await page.$eval(layerControl, (node) => node.getAttribute('aria-checked')),
    layerBefore,
  );
  await keyboard.press('Escape');
  await type('hazards and weather');
  await page.waitForSelector('#frame-search-option-preset-hazards', wait);
  const preset = '#frame-presets-menu [data-lens-id="hazards"]';
  const presetBefore = await page.$eval(preset, (node) =>
    node.getAttribute('aria-pressed'),
  );
  await keyboard.press('Enter');
  await page.waitForFunction(
    (selector) => document.activeElement.matches(selector),
    wait,
    preset,
  );
  assert.equal(
    await page.$eval(preset, (node) => node.getAttribute('aria-pressed')),
    presetBefore,
  );
  await keyboard.press('Escape');
  await type('data sources');
  await page.waitForSelector('#frame-search-option-menu-sources', wait);
  await keyboard.press('Enter');
  await page.waitForSelector('#frame-menu-sources', { ...wait, visible: true });
  await keyboard.press('Escape');
  assert.deepEqual(report.transport.boardGeocodeQueries, []);
  console.log(
    '[PASS] layer, preset and menu matches open existing controls without enabling providers',
  );

  stage = 'unavailable menu result';
  await type('display');
  await page.waitForSelector('#frame-search-option-menu-display', wait);
  await page.$eval('#frame-menu-item-display', (node) => {
    node.hidden = true;
  });
  await keyboard.press('Enter');
  assert.equal(
    await page.$eval(status, (node) => node.textContent),
    'This board result is no longer available.',
  );
  assert.equal(await page.$eval(field, (node) => node.value), 'display');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'frame-search-input',
  );
  await page.$eval('#frame-menu-item-display', (node) => {
    node.hidden = false;
  });
  assert.deepEqual(report.transport.boardGeocodeQueries, []);
  console.log(
    '[PASS] a menu result removed before activation reports availability and preserves focus',
  );

  stage = 'deliberate locality lookup';
  await type('search layers');
  assert.equal(await page.$$(option).then((nodes) => nodes.length), 0);
  assert.match(
    await page.$eval('#searches-panel h2', (node) => node.textContent),
    /Search Layers with Claude/u,
  );
  await type('7 Main Street');
  assert.equal(
    await page.$eval(status, (node) => node.textContent),
    'No board matches.',
  );
  await keyboard.press('Enter');
  assert.deepEqual(report.transport.boardGeocodeQueries, []);
  await type(lookupCity);
  assert.match(
    await page.$eval(status, (node) => node.textContent),
    /Press Enter to look up this place/u,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(report.transport.boardGeocodeQueries, []);
  await keyboard.press('Enter');
  await waitForCity(41.65, -8.43);
  assert.deepEqual(report.transport.boardGeocodeQueries, [lookupCity]);
  await type(lookupLandmark);
  await keyboard.press('Enter');
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector).textContent ===
      'No city or country found.',
    wait,
    status,
  );
  await type(emptyLookup);
  await keyboard.press('Enter');
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector).textContent ===
      'No city or country found.',
    wait,
    status,
  );
  assert.equal(await page.$eval(field, (node) => node.value), emptyLookup);
  await type(unavailableLookup);
  await keyboard.press('Enter');
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector).textContent ===
      'Place lookup is unavailable. Try again.',
    wait,
    status,
  );
  assert.equal(
    await page.$eval(field, (node) => node.value),
    unavailableLookup,
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'frame-search-input',
  );
  assert.deepEqual(report.transport.boardGeocodeQueries, [
    lookupCity,
    lookupLandmark,
    emptyLookup,
    unavailableLookup,
  ]);
  assert.ok(
    report.transport.suppressedApis.every(
      (name) => !/searches|geocode/u.test(name),
    ),
  );
  assert.equal(report.transport.refreshes, 0);
  assert.deepEqual(report.errors, []);
  console.log(
    '[PASS] only intentional Enter reaches the synthetic keyless route and precise results are rejected',
  );
} catch (error) {
  report.failureStage = stage;
  report.failure = error.message;
  if (page) {
    await page
      .screenshot({ path: path.join(out, 'failure.png') })
      .catch(() => {});
  }
  throw error;
} finally {
  try {
    await browser?.close();
    await proxy.close();
    report.proxy = proxy.totals;
    await fs.writeFile(
      path.join(out, 'board-search-report.json'),
      JSON.stringify(report, null, 2),
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
