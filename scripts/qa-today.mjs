#!/usr/bin/env node
/** Today exercises only the synthetic snapshots under the locked fixture runner. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';
import { createDenyProxy } from '../src/tooling/qaLookProxy.mjs';
import { createFixtureWorld, installFixtures } from './qa-world.fixtures.mjs';

const urlIndex = process.argv.indexOf('--url');
assert.ok(urlIndex !== -1, 'Use --url with the keyless fixture runner');
const url = new URL(process.argv[urlIndex + 1]);
assert.equal(url.protocol, 'http:');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.href, url.origin + '/');
url.search = '?welcome=0&world-fixtures=1';
const out = path.resolve(process.env.GEV_LOOK_OUT || 'qa-artifacts/today');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-today-'));
const wait = { timeout: 75000, polling: 125 };
const views = [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
];
const day = (index) => `2026-11-0${9 - index}T10:00:00Z`;
// Invented outlets and ordinary invented headlines: no real reporting.
const outlets = [
  ['fixture-gazette', 'Fixture Gazette', 'https://gazette.invalid'],
  ['sample-courier', 'Sample Courier', 'https://courier.invalid'],
  ['example-ledger', 'Example Ledger', 'https://ledger.invalid'],
];
const located = {
  id: 'fixture-event',
  title: 'Fixture Harbour ferry terminal closed after a strike nearby.',
  summary:
    'Invented fixture summary: the ferry terminal in Fixture Harbour stayed closed for the day.',
  whatsNew: 'Invented fixture update: a third outlet reported the closure.',
  category: 'armed-conflict',
  kind: 'event',
  place: { name: 'Fixture Harbour' },
  location: { lat: 19.1, lon: 72.9, precision: 'city', method: 'gazetteer' },
  itemIds: outlets.map(([id]) => `event-${id}`),
};
const unlocated = {
  id: 'fixture-development',
  title: 'Fixture assembly scheduled a second reading of a library bill.',
  summary:
    'Invented fixture summary: the assembly set a date for the second reading.',
  whatsNew: '',
  category: 'elections-governance',
  kind: 'development',
  place: { name: 'India' },
  location: null,
  itemIds: outlets.slice(0, 2).map(([id]) => `development-${id}`),
};
const fillers = [
  'Fixture councils published the annual parks report.',
  'Fixture schools began the new term.',
  'A fixture consultation opened on housing policy.',
  'Fixture libraries extended weekend hours.',
].map((title, index) => ({
  id: `fixture-filler-${index}`,
  title,
  summary: title,
  whatsNew: '',
  category: 'elections-governance',
  kind: 'development',
  place: null,
  location: null,
  itemIds: [`filler-${index}`],
}));
const news = {
  revision: 'today-fixture',
  theater: {
    id: 'world',
    name: 'World affairs',
    categories: [
      { id: 'armed-conflict', label: 'Armed conflict' },
      { id: 'elections-governance', label: 'Governance' },
    ],
  },
  sources: outlets.map(([id, name]) => ({ id, name })),
  items: [
    ...outlets.map(([id, , home]) => ({
      id: `event-${id}`,
      title: located.title,
      sourceId: id,
      url: `${home}/fixture-event`,
      publishedAt: day(0),
    })),
    ...outlets.slice(0, 2).map(([id, , home]) => ({
      id: `development-${id}`,
      title: unlocated.title,
      sourceId: id,
      url: `${home}/fixture-development`,
      publishedAt: day(1),
    })),
    ...fillers.map((story, index) => ({
      id: `filler-${index}`,
      title: story.title,
      sourceId: outlets[0][0],
      url: `${outlets[0][2]}/fixture-filler-${index}`,
      publishedAt: day(index + 2),
    })),
  ],
  stories: [located, unlocated, ...fillers].map((story, index) => ({
    ...story,
    status: 'open',
    updatedAt: day(index),
  })),
};
const report = {
  errors: [],
  transport: {
    snapshots: 0,
    refreshes: 0,
    imageryTiles: 0,
    suppressedApis: [],
    suppressedHosts: [],
  },
};

const usedEndpoints = () => ({
  news: report.transport.todayNewsReplies ?? 0,
  world: report.transport.snapshots,
  refresh: report.transport.refreshes,
  detail: [...(report.transport.todayWorldDetails ?? [])],
});
let showAlert = false;
const baseWorld = createFixtureWorld(path.join(temporary, 'world'));
const world = {
  ...baseWorld,
  async snapshot(options) {
    const snapshot = await baseWorld.snapshot(options);
    if (!showAlert) return snapshot;
    return {
      ...snapshot,
      features: {
        ...snapshot.features,
        'live-gdacs': {
          flags: [
            {
              id: 'fixture-country-alert',
              iso3: 'IND',
              sourceId: 'live-gdacs',
              date: '2026-11-09',
              status: 'active',
            },
          ],
        },
      },
    };
  },
};
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
    todayNews: news,
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
    return (
      snapshot?.enabled &&
      snapshot.visible &&
      !snapshot.loading &&
      snapshot.countries.IND
    );
  }, wait);

  async function capture(state) {
    for (const [width, height] of views) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      const layout = await page.$eval('#frame-today', (node) => ({
        box: node.getBoundingClientRect().toJSON(),
        overflow: node.scrollWidth > node.clientWidth + 1,
      }));
      assert.ok(layout.box.left >= 0 && layout.box.right <= width);
      assert.ok(layout.box.top >= 0 && layout.box.bottom <= height);
      assert.ok(!layout.overflow);
      const stem = path.join(out, `after-${width}x${height}-today-${state}`);
      await captureLookImage(
        page,
        `${stem}.png`,
        `${stem}-crop.png`,
        layout.box,
        { width, height },
      );
      console.log(`[PASS] Today ${state} fits at ${width}×${height}`);
    }
  }

  stage = 'empty Today and next step';
  await page.waitForSelector('#frame-today-empty:not([hidden])', wait);
  await capture('empty');
  const emptyTransport = usedEndpoints();
  await page.click('#frame-today-next');
  await page.waitForSelector('#frame-menu-sources:not([hidden])', wait);
  assert.deepEqual(usedEndpoints(), emptyTransport);
  console.log(
    '[PASS] empty state opens Data sources without a provider request',
  );

  stage = 'enable the synthetic digest';
  await page.click('#frame-war-switch');
  await page.waitForSelector('#frame-today-list:not([hidden])', wait);
  await page.click('#frame-menu-sources [data-menu-close="true"]');

  const alertRow = '[data-today-item="alert:fixture-country-alert"]';
  const eventRow = '[data-today-item="story:world:fixture-event"]';
  const developmentRow = '[data-today-item="story:world:fixture-development"]';
  const rowCount = () =>
    page.$$eval('#frame-today-list > li', (nodes) => nodes.length);
  const rowIds = () =>
    page.$$eval('#frame-today-list button', (nodes) =>
      nodes.map((node) => node.dataset.todayItem),
    );
  const selectedStory = () =>
    page.evaluate(
      () =>
        window.__godsEyeView.dataManager.layers.get('news').module.getSnapshot()
          .selectedStoryId,
    );
  const openedStory = () =>
    page.evaluate(() => ({
      title: document.getElementById('frame-today-story-title').textContent,
      summary: document.getElementById('frame-today-story-summary').textContent,
      fresh: document.getElementById('frame-today-story-new').textContent,
      freshHidden: document.getElementById('frame-today-story-new').hidden,
      links: [...document.querySelectorAll('#frame-today-story-sources a')].map(
        (link) => [link.textContent, link.href, link.target, link.rel],
      ),
    }));
  const sourceLinks = (story, count) =>
    outlets
      .slice(0, count)
      .map(([, name, home]) => [
        name,
        `${home}/${story}`,
        '_blank',
        'noopener noreferrer',
      ])
      .sort((a, b) => a[0].localeCompare(b[0]));
  await page.waitForSelector(eventRow, wait);
  assert.equal(await rowCount(), 5);
  assert.deepEqual((await rowIds()).slice(0, 2), [
    'story:world:fixture-event',
    'story:world:fixture-development',
  ]);
  assert.deepEqual(
    await page.$eval(eventRow, (row) =>
      [...row.children].map((part) => part.textContent),
    ),
    [
      located.title,
      'Fixture Harbour · 9 Nov 2026, 10:00 UTC',
      'Example Ledger · Fixture Gazette · Sample Courier',
      'Reported by 3 outlets',
    ],
  );
  console.log(
    '[PASS] a located conflict event and an unlocated development lead under their own titles',
  );

  stage = 'populate a synthetic country alert';
  showAlert = true;
  await page.evaluate(async () => {
    const data = window.__godsEyeView.dataManager;
    await data.setEnabled('world', false, { origin: 'user' });
    await data.setEnabled('world', true, { origin: 'user' });
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll('#frame-today-list > li').length === 5 &&
      !document.getElementById('frame-today-more').hidden,
    wait,
  );
  assert.ok(!(await page.$(alertRow)));
  await page.click('#frame-today-more');
  assert.equal(await rowCount(), 7);
  assert.equal((await rowIds()).at(-1), 'alert:fixture-country-alert');
  await page.click('#frame-today-more');
  assert.equal(await rowCount(), 5);
  // The alert ranks seventh; keep the list open so the steps below reach it.
  await page.click('#frame-today-more');
  console.log(
    '[PASS] stories rank before the country alert and More reveals the remaining rows',
  );

  stage = 'open the located story';
  const beforeOpening = usedEndpoints();
  await page.click(eventRow);
  await page.waitForSelector('#frame-today-story:not([hidden])', wait);
  await page.waitForFunction(
    () => document.activeElement.id === 'frame-today-story-title',
    wait,
  );
  const event = await openedStory();
  assert.equal(event.title, located.title);
  assert.equal(event.summary, located.summary);
  assert.equal(event.freshHidden, false);
  assert.equal(event.fresh, `New: ${located.whatsNew}`);
  assert.deepEqual(event.links, sourceLinks('fixture-event', 3));
  assert.equal(await selectedStory(), 'fixture-event');
  assert.deepEqual(usedEndpoints(), beforeOpening);
  console.log(
    '[PASS] the opened story shows its summary, what is new and every source link, and the news layer selects it',
  );
  await capture('story');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#frame-today-story[hidden]', wait);
  assert.equal(await selectedStory(), null);
  console.log('[PASS] closing the story clears the news selection it made');

  stage = 'open the unlocated story placed in a country';
  await page.click(developmentRow);
  await page.waitForSelector('#frame-today-story:not([hidden])', wait);
  const development = await openedStory();
  assert.equal(development.title, unlocated.title);
  assert.equal(development.summary, unlocated.summary);
  assert.equal(development.freshHidden, true);
  assert.deepEqual(development.links, sourceLinks('fixture-development', 2));
  assert.equal(await selectedStory(), 'fixture-development');
  await page.waitForFunction(() => {
    const height =
      window.__godsEyeView.viewer.camera.positionCartographic.height;
    return height > 5_400_000 && height < 5_600_000;
  }, wait);
  assert.deepEqual(usedEndpoints(), beforeOpening);
  await page.click('#frame-today-story-close');
  await page.waitForSelector('#frame-today-story[hidden]', wait);
  assert.equal(await selectedStory(), null);
  console.log(
    '[PASS] an unlocated story in a country frames that country and closes cleanly',
  );

  stage = 'open the country alert';
  const beforeCountry = usedEndpoints();
  await page.click(alertRow);
  await page.waitForFunction(
    () =>
      document.querySelector('#world-sheet-name')?.textContent === 'India' &&
      document.body.dataset.sheet === 'open',
    wait,
  );
  // The existing Overview reads the local diplomacy projection once. The cached
  // stories and country activation never ask for snapshots, news or refreshes.
  assert.deepEqual(usedEndpoints(), {
    ...beforeCountry,
    detail: [...beforeCountry.detail, { country: 'IND', lens: 'diplomacy' }],
  });
  console.log(
    '[PASS] cached stories open offline; the Country Sheet reads only its saved diplomacy projection',
  );

  await capture('filled');

  stage = 'narrow country focus and close';
  await page.click('#world-sheet-close');
  await page.setViewport({ width: 1100, height: 720, deviceScaleFactor: 1 });
  await page.waitForFunction(
    () => document.body.dataset.today === 'open',
    wait,
  );
  await page.click(alertRow);
  await page.waitForFunction(
    () =>
      document.body.dataset.today === 'folded' &&
      document.activeElement.id === 'world-sheet-name',
    wait,
  );
  await page.click('#world-sheet-close');
  await page.waitForFunction(
    () => document.activeElement.id === 'frame-today-open',
    wait,
  );
  await page.click('#frame-today-open');
  await page.click(alertRow);
  await page.waitForFunction(
    () => document.activeElement.id === 'world-sheet-name',
    wait,
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () =>
      document.body.dataset.sheet === 'closed' &&
      document.activeElement.id === 'frame-today-open',
    wait,
  );
  await page.click('#frame-today-open');
  console.log(
    '[PASS] pointer close and Escape restore folded Today focus after opening the country sheet',
  );

  await page.click('#frame-menu');
  await page.click('#frame-menu-item-sources');
  await page.waitForSelector('#frame-war-switch:checked', wait);
  await page.click('#frame-war-switch');
  await page.waitForFunction(
    () => document.querySelectorAll('#frame-today-list > li').length === 1,
    wait,
  );
  assert.ok(await page.$(alertRow));
  assert.equal(report.transport.refreshes, 0);
  assert.deepEqual(report.errors, []);
  console.log(
    '[PASS] switching War Monitor off keeps the country alert and starts no refresh',
  );
} catch (error) {
  report.failureStage = stage;
  report.failure = error.message;
  if (page) {
    report.failureState = await page
      .evaluate(() => {
        const { viewer, dataManager } = window.__godsEyeView ?? {};
        const world = dataManager?.layers.get('world')?.module.getSnapshot();
        return {
          height: viewer?.camera.positionCartographic?.height,
          ready: Boolean(world?.countries?.IND),
          enabled: world?.enabled,
          visible: world?.visible,
          loading: world?.loading,
          worldError: world?.error,
          frameToday: document.body.dataset.today,
          frameSheet: document.body.dataset.sheet,
          active: document.activeElement?.id,
        };
      })
      .catch(() => null);
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
      path.join(out, 'today-report.json'),
      JSON.stringify(report, null, 2),
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
