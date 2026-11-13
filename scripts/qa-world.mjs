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
const hardware = args.includes('--hardware');
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
url.searchParams.set('world-fixtures', '1');
const evidence = fileURLToPath(
  new URL(
    hardware ? '../qa-artifacts/world-hardware/' : '../qa-artifacts/world/',
    import.meta.url,
  ),
);
// Phase modules default-export async (context) and may export fixtureAdapters.
const phaseFiles = (
  await fs.readdir(path.dirname(fileURLToPath(import.meta.url)))
)
  .filter((name) => /^qa-world\.phase-.*\.mjs$/.test(name))
  .sort();
const phaseChecks = await Promise.all(
  phaseFiles.map((name) => import(new URL(name, import.meta.url))),
);
const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-world-qa-'));
const world = createFixtureWorld(
  cache,
  Object.assign({}, ...phaseChecks.map((phase) => phase.fixtureAdapters)),
);
const report = {
  url: url.href,
  mode: `Offline provider fixtures, real World Board service, temporary persisted state and ${hardware ? 'requested hardware' : 'software'} rendering with bundled Natural Earth imagery over ellipsoid terrain`,
  rendering: {
    requested: hardware ? 'hardware' : 'software',
    renderer: null,
    hardwareTimingValid: false,
  },
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

// The frame's sheet shows its first four tabs and puts the rest under
// "More ›", so a later tab is chosen from that menu, as a person would.
async function selectTab(id) {
  const shown = await page.$eval(tab(id), (node) => !node.hidden);
  if (shown) {
    await page.click(tab(id));
    return;
  }
  await page.click('#frame-sheet-more');
  await page.waitForSelector('#frame-sheet-more-menu:not([hidden])', wait);
  await page.click(`#frame-sheet-more-menu [data-frame-tab="${id}"]`);
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute('aria-selected') ===
      'true',
    wait,
    tab(id),
  );
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
      if (!position) return false;
      // An asset or portrait at the country label can cover the nominal point.
      for (const [dx, dy] of [
        [0, 0],
        [16, 0],
        [-16, 0],
        [0, 16],
        [0, -16],
        [24, 14],
        [-24, 14],
        [24, -14],
        [-24, -14],
      ]) {
        const probe = new C.Cartesian2(position.x + dx, position.y + dy);
        const x = Math.round(probe.x + canvas.left);
        const y = Math.round(probe.y + canvas.top);
        const id = scene.pick(probe, 1, 1)?.id;
        if (
          id?.startsWith?.('world:' + iso3 + ':') &&
          document.elementFromPoint(x, y) === scene.canvas
        )
          return { x, y, id };
      }
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
  // The camera looks at the centre of the globe's canvas, which the frame
  // insets from the window's edges, so sample there rather than mid-window.
  const canvas = await page.evaluate(() => {
    const { left, top, width, height } =
      window.__godsEyeView.viewer.scene.canvas.getBoundingClientRect();
    return { left, top, width, height };
  });
  const { data, info } = await sharp(path.join(evidence, filename))
    .extract({
      left: Math.floor(canvas.left + (canvas.width - size) / 2),
      top: Math.floor(canvas.top + (canvas.height - size) / 2),
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
  await selectTab(section);
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
      // On a phone the lens row in the frame's bottom bar scrolls sideways,
      // like the area chips: a button is reachable once scrolled into view.
      const lenses = document.querySelector('#world-lens-bar .frame-seg');
      const controls = [...document.querySelectorAll('#world-lens-bar button')];
      const scrollLeft = chips.scrollLeft;
      const lensScrollLeft = lenses?.scrollLeft ?? 0;
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
        if (
          (chips.contains(button) || lenses?.contains(button)) &&
          !canReach(button)
        ) {
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
      if (lenses) lenses.scrollLeft = lensScrollLeft;
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

/** The globe keeps at least this width beside Today and the sheet (frame.js). */
const FRAME_GLOBE_MIN_WIDTH = 460;

/**
 * Measure the frame's regions and the original floating panels in the real
 * page at one window size, once the layout has settled. Fails on any overlap
 * between two regions, between a region and a panel, or between two panels,
 * and on a globe narrower than FRAME_GLOBE_MIN_WIDTH.
 */
async function frameLayout(width, height, label) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const data = await page.evaluate(
    async ({ width, height }) => {
      const shown = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility === 'visible' &&
          Number(style.opacity) > 0 &&
          element.getClientRects().length > 0
        );
      };
      const box = (name, element) => {
        const { left, top, right, bottom } = element.getBoundingClientRect();
        return { name, left, top, right, bottom };
      };
      const read = () => {
        const regions = [
          ['top bar', '#frame-top'],
          ['bottom bar', '#frame-bottom'],
          ['Today', '#frame-today'],
          ['rail', '#frame-rail'],
          ['sheet', '#frame-sheet'],
        ]
          .map(([name, selector]) => [name, document.querySelector(selector)])
          .filter(([, element]) => shown(element))
          .map(([name, element]) => box(name, element));
        const panels = [
          '#data-panel',
          '#right-context-rail > [data-panel-id]',
          '#command-dock',
          '#globe-navigation',
          '#lens-bar',
          '#key-setup-chip',
          '#world-hover',
        ]
          .flatMap((selector) => [...document.querySelectorAll(selector)])
          .filter(shown)
          .map((element) =>
            box(
              element.id ||
                element.dataset.panelId ||
                element.className ||
                'panel',
              element,
            ),
          )
          .filter(({ right, left, bottom, top }) => right > left && bottom > top);
        const globe = box('globe', document.getElementById('cesiumContainer'));
        return { regions, panels, globe };
      };
      const stable = await new Promise((resolve, reject) => {
        let previous;
        let since;
        let samples = 0;
        let frame;
        const deadline = setTimeout(() => {
          cancelAnimationFrame(frame);
          reject(new Error(`The frame did not settle at ${width}×${height}`));
        }, 10_000);
        function sample(now) {
          if (innerWidth === width && innerHeight === height) {
            const current = read();
            const key = JSON.stringify(current);
            if (key !== previous) {
              previous = key;
              since = now;
              samples = 0;
            }
            if (++samples >= 3 && now - since >= 250) {
              clearTimeout(deadline);
              resolve(current);
              return;
            }
          } else previous = undefined;
          frame = requestAnimationFrame(sample);
        }
        frame = requestAnimationFrame(sample);
      });
      const overlaps = [];
      const meet = (a, b) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      const { regions, panels, globe } = stable;
      regions.forEach((a, i) =>
        regions.slice(i + 1).forEach((b) => {
          if (meet(a, b)) overlaps.push(`${a.name} / ${b.name}`);
        }),
      );
      for (const a of regions)
        if (meet(a, globe)) overlaps.push(`${a.name} / globe`);
      for (const panel of panels) {
        for (const region of regions)
          if (meet(panel, region)) overlaps.push(`${panel.name} / ${region.name}`);
      }
      panels.forEach((a, i) =>
        panels.slice(i + 1).forEach((b) => {
          if (meet(a, b)) overlaps.push(`${a.name} / ${b.name}`);
        }),
      );
      return {
        today: document.body.dataset.today,
        sheet: document.body.dataset.sheet,
        globeWidth: Math.round(globe.right - globe.left),
        overlaps,
        ...stable,
      };
    },
    { width, height },
  );
  report.frameLayouts ??= [];
  report.frameLayouts.push({ width, height, label, ...data });
  await shot(`frame-${width}x${height}-${label}`);
  assert.deepEqual(
    data.overlaps,
    [],
    `Overlap at ${width}×${height} (${label}, Today ${data.today}, sheet ${data.sheet})`,
  );
  assert.ok(
    data.globeWidth >= FRAME_GLOBE_MIN_WIDTH,
    `The globe is ${data.globeWidth} px at ${width}×${height} (${label}); it needs ${FRAME_GLOBE_MIN_WIDTH}`,
  );
  return data;
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
      ...(!hardware
        ? [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ]
        : []),
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
  report.rendering.renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
  });
  // Unknown and software renderers cannot substantiate hardware timings.
  report.rendering.hardwareTimingValid = Boolean(
    hardware &&
    report.rendering.renderer &&
    !/swiftshader|software|llvmpipe|softpipe/i.test(report.rendering.renderer),
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

  // Modules execute in filename order and share this browser state.
  for (const { default: runPhase } of phaseChecks) {
    await runPhase({
      assert,
      page,
      world,
      report,
      step,
      shot,
      text,
      camera,
      toggleWorld,
      waitSettled,
      readGeometry,
      checkHatchPixels,
      changeLens,
      pickCountry,
      checkRows,
      layout,
      frameLayout,
      lens,
      area,
      tab,
      selectTab,
      slot,
      wait,
      desktop,
    });
  }
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
