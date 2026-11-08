#!/usr/bin/env node
/** Fixture-only World Board acceptance. Run with --fixtures [--url http://127.0.0.1:5183]. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { createFixtureWorld, installFixtures } from './qa-world.fixtures.mjs';

const args = process.argv.slice(2);
assert.ok(
  args.includes('--fixtures'),
  'Run with --fixtures against the World Board dev server.',
);
const urlIndex = args.indexOf('--url');
const url = new URL(
  urlIndex === -1 ? 'http://127.0.0.1:5183' : args[urlIndex + 1],
);
assert.ok(
  url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
  'World Board fixture QA requires a loopback HTTP dev server.',
);
url.searchParams.set('welcome', '0');
const evidence = fileURLToPath(
  new URL('../qa-artifacts/world/', import.meta.url),
);
const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-world-qa-'));
const world = createFixtureWorld(cache);
const report = {
  url: url.href,
  mode: 'Offline provider fixtures, real World Board service, temporary persisted state and software rendering with bundled Natural Earth imagery over ellipsoid terrain',
  checks: [],
  screenshots: [],
  lensSwitches: [],
  layouts: [],
  transport: {
    snapshots: 0,
    refreshes: 0,
    imageryTiles: 0,
    suppressedApis: [],
    suppressedHosts: [],
  },
  errors: [],
  console: [],
};
const toggle = '#data-toggles [data-layer-id="world"] .data-toggle-btn';
const lens = (id) => `#world-lens-bar [data-world-lens="${id}"]`;
const area = (id) => `#world-lens-bar [data-world-area="${id}"]`;
const tab = (id) => `[data-world-tab="${id}"]`;
const slot = (id) => `[data-world-slot="${id}"]`;
const wait = { timeout: 75_000, polling: 125 };
const desktop = { width: 1440, height: 900, deviceScaleFactor: 1 };
const fixtures = ['IND', 'CHN', 'GBR', 'KOS', 'PAK', 'SAH'];
let browser;
let page;

async function step(name, operation, { fatal = true } = {}) {
  try {
    await operation();
    report.checks.push({ name, passed: true });
    console.log('[PASS]', name);
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.stack });
    if (fatal) throw error;
    console.error(error);
  }
}

async function shot(name) {
  const filename = name + '.png';
  await page.screenshot({ path: path.join(evidence, filename) });
  report.screenshots.push(filename);
}

const text = (selector) =>
  page.$eval(selector, (element) => element.textContent.trim());

async function toggleWorld() {
  if (await page.$('#data-panel.collapsed')) {
    await page.click('[data-collapse-target="data-panel"]');
    await page.waitForSelector('#data-panel:not(.collapsed)', {
      visible: true,
    });
  }
  await page.click(toggle);
}
async function waitSettled(enabled) {
  await page.waitForFunction(
    (buttonSelector, expected) => {
      const manager = window.__godsEyeView?.dataManager;
      return (
        manager &&
        manager.isEffectivelyEnabled('world') === expected &&
        manager
          .getAll()
          .every(
            (row) => !['enabling', 'disabling'].includes(row.lifecycleState),
          ) &&
        document.querySelector(buttonSelector)?.getAttribute('aria-busy') !==
          'true'
      );
    },
    wait,
    toggle,
    enabled,
  );
}

async function camera(lon, lat, height) {
  await page.evaluate(
    ({ lon, lat, height }) => {
      const { viewer } = window.__godsEyeView;
      viewer.camera.cancelFlight();
      viewer.camera.setView({
        destination: window.worldQa.C.Cartesian3.fromDegrees(lon, lat, height),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      viewer.scene.requestRender();
    },
    { lon, lat, height },
  );
}

async function readGeometry() {
  return page.evaluate((countries) => {
    const { solid, hatch } = window.worldQa;
    return {
      batchesShown: [solid.show, hatch.show],
      countries: Object.fromEntries(
        countries.map((iso3) => {
          const id = `world:${iso3}:${iso3}:0`;
          const fill = solid.getGeometryInstanceAttributes(id);
          const stripe = hatch.getGeometryInstanceAttributes(id);
          return [
            iso3,
            {
              fill: Boolean(fill.show[0]),
              hatch: Boolean(stripe.show[0]),
              rgba: [...fill.color],
            },
          ];
        }),
      ),
      hatchAlpha: hatch.appearance.material.uniforms.stripe.alpha,
    };
  }, fixtures);
}

async function changeLens(selector, legend) {
  const result = await page.$eval(selector, async (button) => {
    const { viewer } = window.__godsEyeView;
    const { solid, hatch } = window.worldQa;
    const primitives = viewer.scene.groundPrimitives;
    const before = [
      ...solid.getGeometryInstanceAttributes('world:IND:IND:0').color,
    ];
    const painted = new Promise((resolve) => {
      const remove = viewer.scene.postRender.addEventListener(() => {
        const after = [
          ...solid.getGeometryInstanceAttributes('world:IND:IND:0').color,
        ];
        remove();
        resolve({
          before,
          after,
          milliseconds: Math.round(performance.now() - start),
          reused: primitives.contains(solid) && primitives.contains(hatch),
        });
      });
    });
    const start = performance.now();
    button.click();
    const updateMs = Math.round(performance.now() - start);
    return { ...(await painted), updateMs };
  });
  report.lensSwitches.push({ legend, ...result });
  assert.notDeepEqual(
    result.before,
    result.after,
    legend + ' did not recolour India',
  );
  assert.equal(result.reused, true);
  assert.equal(
    await page.$eval(selector, (button) => button.getAttribute('aria-pressed')),
    'true',
  );
  assert.equal(await text('#world-legend-title'), legend);
  assert.match(await text('#world-legend'), /Unknown or disputed/i);
}

async function pickCountry(lon, lat, iso3) {
  const handle = await page.waitForFunction(
    ({ lon, lat, iso3 }) => {
      const { C } = window.worldQa;
      const { scene } = window.__godsEyeView.viewer;
      const position = C.SceneTransforms.worldToWindowCoordinates(
        scene,
        C.Cartesian3.fromDegrees(lon, lat),
      );
      const canvas = scene.canvas.getBoundingClientRect();
      const x = Math.round(position.x + canvas.left);
      const y = Math.round(position.y + canvas.top);
      const id = scene.pick(position, 1, 1)?.id;
      if (
        id?.startsWith?.('world:' + iso3 + ':') &&
        document.elementFromPoint(x, y) === scene.canvas
      )
        return { x, y, id };
      scene.requestRender();
      return false;
    },
    { ...wait, timeout: 20_000 },
    { lon, lat, iso3 },
  );
  const point = await handle.jsonValue();
  await handle.dispose();
  await page.mouse.move(point.x, point.y);
  await page.waitForSelector('#world-hover:not([hidden])', { visible: true });
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(
    (expected) =>
      document.querySelector('#world-sheet-code')?.textContent === expected,
    wait,
    iso3,
  );
}

async function checkHatchPixels(filename) {
  const size = 36;
  const viewport = page.viewport();
  const { data, info } = await sharp(path.join(evidence, filename))
    .extract({
      left: Math.floor((viewport.width - size) / 2),
      top: Math.floor((viewport.height - size) / 2),
      width: size,
      height: size,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const phases = Array.from({ length: 9 }, () => ({ sum: 0, count: 0 }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // The shader measures y from the bottom. A repeated diagonal signal
      // distinguishes stripes from the country's semi-transparent base.
      const phase = phases[(x - y + size) % phases.length];
      const pixel = (y * size + x) * info.channels;
      phase.sum += (data[pixel] + data[pixel + 1] + data[pixel + 2]) / 3;
      phase.count++;
    }
  }
  report.hatchPixelMeans = phases.map(({ sum, count }) =>
    Math.round(sum / count),
  );
  assert.ok(
    Math.max(...report.hatchPixelMeans) - Math.min(...report.hatchPixelMeans) >=
      4,
    'The disputed country screenshot does not contain visible 9-pixel diagonal stripes.',
  );
}

async function checkRows(section, expected) {
  await page.click(tab(section));
  const rows = await page.$$eval('[data-world-slot]', (buttons) =>
    buttons.map((button) => ({
      slot: button.dataset.worldSlot,
      score: button.querySelector('.world-row-score').textContent,
      flags: [...button.querySelectorAll('.world-flag')].map(
        (flag) => flag.textContent,
      ),
    })),
  );
  assert.deepEqual(
    Object.fromEntries(rows.map(({ slot: id, score }) => [id, score])),
    Object.fromEntries(
      Object.entries(expected).map(([id, score]) => [
        id,
        score === null ? 'Unknown' : score + ' / 100',
      ]),
    ),
  );
  return rows;
}

async function layout(width, height) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const data = await page.evaluate(
    async ({ width, height }) => {
      const selectors = [
        '#title-bar',
        '#top-center-actions',
        '#data-panel',
        '#command-dock',
        '#right-context-rail > [data-panel-id]',
        '#world-lens-bar',
        '#world-legend',
      ];
      const elements = selectors.flatMap((selector) => [
        ...document.querySelectorAll(selector),
      ]);
      const clips = new Set(['hidden', 'clip', 'scroll', 'auto']);
      const readRects = () =>
        elements.flatMap((element) => {
          if (getComputedStyle(element).visibility !== 'visible') return [];
          let { left, top, right, bottom } = element.getBoundingClientRect();
          left = Math.max(0, left);
          top = Math.max(0, top);
          right = Math.min(innerWidth, right);
          bottom = Math.min(innerHeight, bottom);
          // The rail clips its scrollable contents to the available space.
          for (
            let parent = element.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            const style = getComputedStyle(parent);
            const bounds = parent.getBoundingClientRect();
            if (clips.has(style.overflowX)) {
              left = Math.max(left, bounds.left);
              right = Math.min(right, bounds.right);
            }
            if (clips.has(style.overflowY)) {
              top = Math.max(top, bounds.top);
              bottom = Math.min(bottom, bounds.bottom);
            }
          }
          return right > left && bottom > top
            ? [{ id: element.id, left, top, right, bottom }]
            : [];
        });
      // Responsive rail layout follows viewport resize in observers and frames.
      // Measure only after consecutive unchanged samples at the new size.
      const rects = await new Promise((resolve, reject) => {
        let previous;
        let stableSince;
        let samples = 0;
        let frame;
        const deadline = setTimeout(() => {
          cancelAnimationFrame(frame);
          reject(new Error(`HUD did not settle at ${width}×${height}`));
        }, 10_000);
        function sample(now) {
          if (innerWidth === width && innerHeight === height) {
            const current = readRects();
            const key = JSON.stringify(current);
            if (key !== previous) {
              previous = key;
              stableSince = now;
              samples = 0;
            }
            if (++samples >= 3 && now - stableSince >= 250) {
              clearTimeout(deadline);
              resolve(current);
              return;
            }
          } else {
            previous = undefined;
          }
          frame = requestAnimationFrame(sample);
        }
        frame = requestAnimationFrame(sample);
      });
      const overlaps = [];
      const world = rects.filter(({ id }) => id.startsWith('world-'));
      for (const a of world)
        for (const b of rects) {
          if (a === b) continue;
          if (
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
          ) {
            overlaps.push([a.id, b.id]);
          }
        }
      const chips = document.querySelector('#world-areas');
      const controls = [...document.querySelectorAll('#world-lens-bar button')];
      const scrollLeft = chips.scrollLeft;
      const clippedChips = [];
      const unreachable = [];
      function canReach(button) {
        const { left, top, width, height } = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(left + width / 2, top + height / 2),
        );
      }
      for (const button of controls) {
        if (!button.getClientRects().length) continue;
        if (chips.contains(button) && !canReach(button)) {
          clippedChips.push(button.textContent.trim());
          button.scrollIntoView({
            inline: 'nearest',
            block: 'nearest',
            behavior: 'instant',
          });
        }
        if (!canReach(button)) unreachable.push(button.textContent.trim());
      }
      chips.scrollLeft = scrollLeft;
      return { rects, overlaps, clippedChips, unreachable };
    },
    { width, height },
  );
  report.layouts.push({ width, height, ...data });
  await shot(`layout-${width}x${height}`);
  assert.deepEqual(data.overlaps, [], `HUD overlap at ${width}×${height}`);
  assert.deepEqual(
    data.unreachable,
    [],
    `Covered World Board controls at ${width}×${height}`,
  );
}

try {
  await fs.mkdir(evidence, { recursive: true });
  browser = await puppeteer.launch({
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      (await puppeteer.executablePath()),
    headless: true,
    protocolTimeout: 180_000,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  page = await browser.newPage();
  await page.setViewport(desktop);
  await installFixtures(page, url.origin, world, report);
  page.on('console', (message) => {
    if (message.type() === 'error' && report.console.length < 40)
      report.console.push(message.text());
  });
  page.on('pageerror', (error) =>
    report.errors.push(error.stack || error.message),
  );
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
  await page.evaluate(
    () => window.__godsEyeView.styleManager.initialRestorePromise,
  );
  await page.evaluate(() =>
    document.getElementById('clear-selected-layers').click(),
  );
  await waitSettled(false);
  await page.evaluate(async () => {
    const source = await (await fetch('/src/layers/world/geometry.js')).text();
    const specifier = source.match(
      /from\s+["']([^"']*cesium\.js[^"']*)["']/,
    )?.[1];
    if (!specifier)
      throw new Error('Vite did not resolve the World Board Cesium module.');
    const C = await import(specifier);
    const { viewer } = window.__godsEyeView;
    const imagery = await C.TileMapServiceImageryProvider.fromUrl(
      C.buildModuleUrl('Assets/Textures/NaturalEarthII'),
    );
    // The controlled base map avoids map-service metadata and tile discovery.
    // The World Board draws into the application's actual Cesium scene.
    viewer.terrainProvider = new C.EllipsoidTerrainProvider();
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(imagery);
    viewer.scene.requestRender();
    window.worldQa = { C };
  });
  await camera(82, 22, 9_000_000);
  await shot('layer-off-baseline');

  await step(
    'Enable World Board and persist the automatic first turn',
    async () => {
      await toggleWorld();
      await page.waitForSelector('#world-progress:not([hidden])', {
        visible: true,
      });
      await waitSettled(true);
      await camera(82, 22, 9_000_000);
      await page.waitForFunction(() => {
        const viewer = window.__godsEyeView?.viewer;
        if (!viewer || !window.worldQa) return false;
        const ground = viewer.scene.groundPrimitives;
        const batches = Array.from({ length: ground.length }, (_, i) =>
          ground.get(i),
        );
        const hatch = batches.find(
          (p) => p.appearance?.material?.type === 'GevWorldHatch',
        );
        const solid = batches.find(
          (p) =>
            p !== hatch &&
            p.ready &&
            p.getGeometryInstanceAttributes?.('world:IND:IND:0')?.color,
        );
        if (
          !solid ||
          !hatch?.ready ||
          !solid.getGeometryInstanceAttributes('world:IND:IND:0').show[0]
        )
          return false;
        Object.assign(window.worldQa, { solid, hatch });
        return document.querySelector('#world-turn')?.textContent === 'Turn 1';
      }, wait);
      const saved = await world.store.read();
      assert.deepEqual(
        saved.turns.map(({ number }) => number),
        [1],
      );
      assert.equal(saved.board.countries.KOS.slots.C1.observation.iso3, 'XKX');
      assert.equal(saved.board.countries.KOS.slots.C4.observation.iso3, 'UVK');
      assert.equal(Math.round(saved.board.countries.CHN.condition.score), 56);
      assert.equal(await text('#world-legend-title'), 'Condition');
      assert.equal(
        await page.$eval(lens('condition'), (node) =>
          node.getAttribute('aria-pressed'),
        ),
        'true',
      );
      await page.click('#world-turn');
      assert.match(
        await text('#world-turn-changes'),
        /World Bank loaded \d+ observations/,
      );
      await page.click('#world-turn');
      await shot('condition');
    },
  );

  await step(
    'Unknown and disputed fills use the visible Cesium hatch batch',
    async () => {
      const geometry = await readGeometry();
      assert.deepEqual(geometry.batchesShown, [true, true]);
      for (const id of ['IND', 'CHN', 'GBR', 'KOS']) {
        assert.equal(geometry.countries[id].fill, true, id);
        assert.equal(geometry.countries[id].hatch, false, id);
      }
      for (const id of ['PAK', 'SAH']) {
        assert.equal(geometry.countries[id].fill, false, id);
        assert.equal(geometry.countries[id].hatch, true, id);
      }
      assert.ok(geometry.hatchAlpha > 0);
      await camera(-13, 25, 5_000_000);
      await shot('disputed-hatching');
      await camera(82, 22, 9_000_000);
      await checkHatchPixels('disputed-hatching.png');
    },
    { fatal: false },
  );

  await step(
    'All lenses recolour the same geometry and update the legend',
    async () => {
      await changeLens(lens('strength'), 'Strength · Economy');
      assert.equal(
        await page.$$eval('[data-world-area]', (nodes) => nodes.length),
        12,
      );
      await changeLens(area('S3'), 'Strength · Government');
      await changeLens(lens('data-age'), 'Data age');
      assert.match(await text('#world-legend'), /8\+ years old.*Current year/s);
      await shot('data-age');
      await changeLens(lens('condition'), 'Condition');
    },
  );

  await step(
    'Pick India and verify Condition, Strength and the score explanation',
    async () => {
      await pickCountry(81.7, 21.2, 'IND');
      assert.equal(await text('#world-sheet-name'), 'India');
      assert.match(await text('#world-hover'), /Weakest bar.*24 \/ 100.*2024/s);
      assert.match(await text('#world-coverage'), /17 of 18.*2026-11-08/);
      assert.match(await text('#world-hp-label'), /Weakest bar.*24 \/ 100/);
      const condition = await checkRows('condition', {
        C1: 24,
        C2: 67,
        C3: 82,
        C4: 86,
        C5: 58,
        C6: null,
      });
      assert.deepEqual(condition[0].flags, ['Weakest', 'Stale']);
      assert.deepEqual(condition[5].flags, ['Unknown']);
      await page.click(slot('C1'));
      const why = await text('#world-why-C1');
      assert.match(why, /GOV_WGI_PV\.SC.*2024.*Raw value\s*24/s);
      assert.match(
        why,
        /100 × clip\(\(x − 0\) ÷ \(100 − 0\), 0, 1\).*Draft anchors/s,
      );
      assert.match(
        await page.$eval('#world-why-C1 a', (a) => a.href),
        /^https:\/\//,
      );
      await shot('india-condition-why');
      const strength = await checkRows('strength', {
        S1: 86,
        S2: 63,
        S3: 64,
        S4: 66,
        S5: 52,
        S6: 50,
        S7: 34,
        S8: 77,
        S9: 68,
        S10: 56,
        S11: 25,
        S12: 60,
      });
      assert.ok(strength[10].flags.includes('Low conf.'));
      await shot('india-strength');
    },
  );

  await step('Picking Scotland selects the whole UK group', async () => {
    await camera(-3.8, 56.5, 5_000_000);
    await pickCountry(-3.8, 56.5, 'GBR');
    assert.equal(await text('#world-sheet-name'), 'United Kingdom');
    const board = await world.snapshot();
    assert.deepEqual(
      [
        ...board.countryIndex.find(({ iso3 }) => iso3 === 'GBR').shapeIds,
      ].sort(),
      ['ENG', 'GBR', 'NIR', 'SCT', 'WLS'],
    );
    await shot('uk-selected-from-scotland');
    await camera(82, 22, 9_000_000);
    await pickCountry(81.7, 21.2, 'IND');
  });

  await step(
    'Refresh writes turn 2 and shows its code-generated change list',
    async () => {
      await page.click('#world-refresh');
      await page.waitForFunction(
        () => document.querySelector('#world-turn')?.textContent === 'Turn 2',
        wait,
      );
      const saved = await world.store.read();
      assert.deepEqual(
        saved.turns.map(({ number }) => number),
        [1, 2],
      );
      const [change] = saved.turns[1].changes;
      assert.equal(saved.turns[1].changes.length, 1);
      assert.equal(change.iso3, 'IND');
      assert.match(change.text, /C1 24\/100 → 37\/100, value 24 → 37/);
      assert.equal(await text('#world-since-turn li'), change.text);
      await page.click('#world-turn');
      assert.equal(await text('#world-turn-changes li'), change.text);
      await shot('turn-2');
      await page.click('#world-turn');
      assert.equal(report.transport.refreshes, 1);
    },
  );

  await step(
    'Zoom hides the fills and returning restores the original batches',
    async () => {
      await camera(82, 22, 2_500_000);
      await page.waitForFunction(
        () => !window.worldQa.solid.show && !window.worldQa.hatch.show,
        wait,
      );
      assert.equal((await readGeometry()).hatchAlpha, 0);
      await shot('zoom-detail');
      await camera(82, 22, 9_000_000);
      await page.waitForFunction(() => {
        const { solid, hatch } = window.worldQa;
        return (
          solid.show &&
          hatch.show &&
          solid.getGeometryInstanceAttributes('world:IND:IND:0').color[3] ===
            140
        );
      }, wait);
      assert.ok((await readGeometry()).hatchAlpha > 0);
    },
  );

  await step(
    'HUD keeps controls clear on desktop and narrow screens',
    async () => {
      await page.click(lens('strength'));
      await layout(1440, 900);
      await layout(1280, 800);
      await layout(390, 844);
      await page.setViewport(desktop);
    },
  );

  await step(
    'Disable and re-enable without extra turns or new geometry',
    async () => {
      await toggleWorld();
      await waitSettled(false);
      await page.waitForFunction(
        () =>
          document.querySelector('#world-lens-bar').hidden &&
          document.querySelector('#world-legend').hidden &&
          document.querySelector('#world-character-sheet').hidden &&
          !window.worldQa.solid.show &&
          !window.worldQa.hatch.show,
        wait,
      );
      await shot('layer-off');
      await toggleWorld();
      await waitSettled(true);
      await camera(82, 22, 9_000_000);
      await page.waitForFunction(
        () =>
          !document.querySelector('#world-lens-bar').hidden &&
          window.worldQa.solid.show &&
          window.worldQa.hatch.show,
        wait,
      );
      assert.deepEqual(
        (await world.store.read()).turns.map(({ number }) => number),
        [1, 2],
      );
      assert.deepEqual(report.errors, []);
    },
  );
} catch (error) {
  console.error(error);
  report.failure = error.stack;
  if (page) {
    report.diagnostics = await page
      .evaluate(() => {
        const { viewer, dataManager } = window.__godsEyeView ?? {};
        const ground = viewer?.scene.groundPrimitives;
        return {
          ready: Boolean(viewer),
          enabled: dataManager?.isEffectivelyEnabled('world'),
          height: viewer?.camera.positionCartographic.height,
          webgl: viewer?.scene.context.depthTexture,
          loading: document.querySelector('#world-progress')?.textContent,
          turn: document.querySelector('#world-turn')?.textContent,
          primitives: Array.from(
            { length: ground?.length ?? 0 },
            (_, index) => {
              const primitive = ground.get(index);
              return {
                type: primitive.constructor.name,
                ready: primitive.ready,
                show: primitive.show,
                material: primitive.appearance?.material?.type,
              };
            },
          ),
        };
      })
      .catch(() => null);
    await shot('failure').catch(() => {});
  }
} finally {
  await browser?.close();
  await world.whenIdle();
  await fs.rm(cache, { recursive: true, force: true });
  await fs.writeFile(
    path.join(evidence, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(`Evidence: ${evidence}`);
  if (report.failure || report.checks.some(({ passed }) => !passed))
    process.exitCode = 1;
}
