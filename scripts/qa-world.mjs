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

// The World Board has no row in the layers menu (piece 1.4): it is the
// application's own view, switched by code and by command. The test switches
// it as the command does, through the data manager, as a person's action.
async function toggleWorld() {
  await page.evaluate(() => {
    // Switching by code skips the click's delay, so the first turn's progress
    // can show and hide before a wait starts; note that it was shown.
    const progress = document.getElementById('world-progress');
    window.__worldProgressSeen = false;
    window.__worldProgressObserver?.disconnect();
    if (progress) {
      const note = () => {
        if (!progress.hidden) window.__worldProgressSeen = true;
      };
      window.__worldProgressObserver = new MutationObserver(note);
      window.__worldProgressObserver.observe(progress, {
        attributes: true,
        attributeFilter: ['hidden'],
      });
    }
    const manager = window.__godsEyeView.dataManager;
    manager.setEnabled('world', !manager.isEnabled('world'), {
      origin: 'user',
    });
  });
}
async function waitSettled(enabled) {
  await page.waitForFunction(
    (expected) => {
      const manager = window.__godsEyeView?.dataManager;
      return (
        manager &&
        manager.isEffectivelyEnabled('world') === expected &&
        manager
          .getAll()
          .every(
            (row) => !['enabling', 'disabling'].includes(row.lifecycleState),
          )
      );
    },
    wait,
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
/**
 * Opens the whole legend from its info button and checks that the popover
 * holds every mark and the full note, stays inside the window, and closes on
 * Escape with focus back on the button.
 */
async function legendPopover(legend, where) {
  await page.click('#frame-legend-whole');
  await page.waitForSelector('#frame-legend-popup:not([hidden])', wait);
  const popover = await page.evaluate(() => {
    const popup = document.getElementById('frame-legend-popup');
    const { left, top, right, bottom } = popup.getBoundingClientRect();
    return {
      text: popup.textContent.replace(/\s+/g, ' ').trim(),
      box: { left, top, right, bottom },
      inside:
        left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight,
      scrolls: popup.scrollHeight > popup.clientHeight + 1,
    };
  });
  await shot(`legend-popover-${legend.lens}-${where.replace(/[^\w]+/g, '-')}`);
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(
    () =>
      document.getElementById('frame-legend-popup').hidden &&
      document.activeElement?.id === 'frame-legend-whole',
  );
  assert.ok(
    popover.inside,
    `The ${legend.lens} legend's popover leaves the window at ${where}: ${JSON.stringify(popover.box)}`,
  );
  for (const part of [...legend.marks, legend.noteText].filter(Boolean))
    assert.ok(
      popover.text.includes(part.replace(/\s+/g, ' ')),
      `The ${legend.lens} legend's popover lacks "${part}" at ${where}: ${popover.text}`,
    );
  assert.ok(
    closed,
    `The ${legend.lens} legend's popover did not close on Escape with focus back at ${where}`,
  );
  return popover;
}

/**
 * The bottom bar's legend as drawn, read in the page: whether the bar draws
 * it at all, each part's boxes against the legend's own, what is left out,
 * and whether the info button shows. Null while the legend is hidden (the
 * World Board is off). It runs in the page, so it uses nothing from here.
 */
function readLegend() {
  const legendBox = document.getElementById('world-legend');
  if (!legendBox || legendBox.hidden) return null;
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
  const frame = legendBox.getBoundingClientRect();
  const within = (rect) =>
    rect.top >= frame.top - 1 &&
    rect.bottom <= frame.bottom + 1 &&
    rect.left >= frame.left - 1 &&
    rect.right <= frame.right + 1;
  const title = document.getElementById('world-legend-title');
  const ramp = legendBox.querySelector('.world-legend-ramp');
  const unknown = legendBox.querySelector('.world-legend-unknown');
  const stops = [...document.getElementById('world-legend-stops').children];
  const note = document.getElementById('world-legend-note');
  const marks = [title, ...stops, unknown].filter((node) =>
    node?.textContent.trim(),
  );
  const name = (node) =>
    node === ramp ? 'the ramp' : node.textContent.trim().slice(0, 40);
  const noteText = note.textContent.replace(/\s+/g, ' ').trim();
  const noteRects = [...note.getClientRects()];
  const drawn = shown(legendBox);
  // The parts the bar draws: the marks, the ramp where the lens has one, and
  // the note while it has a line.
  const parts = [...marks, ramp, ...(noteRects.length ? [note] : [])].filter(
    (node) => node && node.getClientRects().length > 0,
  );
  return {
    lens:
      document
        .querySelector('#world-lens-bar [aria-pressed="true"]')
        ?.getAttribute('data-world-lens') ?? null,
    drawn,
    away: legendBox.hasAttribute('data-away'),
    text: legendBox.textContent.replace(/\s+/g, ' ').trim(),
    width: Math.round(legendBox.clientWidth),
    dense: legendBox.hasAttribute('data-dense'),
    marks: marks.map((node) => node.textContent.trim()),
    // A part drawn in the bar lies whole inside the legend's box, or is not
    // drawn at all (the ramp included).
    partsCut: drawn
      ? parts
          .filter((node) => ![...node.getClientRects()].every(within))
          .map(name)
      : [],
    marksOut: drawn
      ? marks.filter((node) => !node.getClientRects().length).map(name)
      : [],
    // While the legend is in the bar, its title and Unknown key are whole.
    keysOut: drawn
      ? [title, unknown]
          .filter((node) => {
            const rects = [...node.getClientRects()];
            return !rects.length || !rects.every(within);
          })
          .map(name)
      : [],
    box: [frame.left, frame.top, frame.right, frame.bottom].map(Math.round),
    rects: [...marks, ramp, note].filter(Boolean).map((node) => ({
      part: name(node),
      rects: [...node.getClientRects()].map((rect) =>
        [rect.left, rect.top, rect.right, rect.bottom].map(
          (value) => Math.round(value * 10) / 10,
        ),
      ),
    })),
    noteText,
    noteWhole:
      !noteText ||
      (noteRects.length > 0 &&
        noteRects.every(within) &&
        note.scrollWidth <= note.clientWidth + 1),
    button: shown(document.getElementById('frame-legend-whole')),
  };
}

/**
 * The legend rule, on a legend read by readLegend: in the bar every part
 * shown is whole and the title and Unknown key are there, or the bar does not
 * draw the legend at all; whatever is left out or cut, the info button shows
 * and its popover, inside the window, holds the whole legend. With
 * `everyMarkFits`, the legend is in the bar and every lens but Ownership
 * keeps all its marks (true at the overlap step's sizes).
 */
async function checkLegend(legend, where, { everyMarkFits = false } = {}) {
  const about = `${legend.lens} legend at ${where}: ${JSON.stringify(legend)}`;
  if (everyMarkFits)
    assert.ok(legend.drawn, `The bar does not draw the ${about}`);
  if (!legend.drawn)
    assert.ok(
      legend.button,
      `The bar does not draw the ${legend.lens} legend and shows no button at ${where}`,
    );
  else {
    assert.deepEqual(legend.partsCut, [], `Parts are cut in the ${about}`);
    assert.deepEqual(
      legend.keysOut,
      [],
      `The title or Unknown key is not whole in the ${about}`,
    );
    assert.ok(
      !legend.marksOut.length || legend.button,
      `Marks are left out with no way to read them in the ${about}`,
    );
    assert.ok(
      legend.noteWhole || legend.button,
      `The note is cut with no way to read it in the ${about}`,
    );
    if (everyMarkFits && legend.lens !== 'ownership')
      assert.deepEqual(
        legend.marksOut,
        [],
        `Marks that should fit are left out of the ${about}`,
      );
  }
  return legend.button ? legendPopover(legend, where) : null;
}

/** Waits for the page's next two frames, so a fit the last change caused is drawn. */
async function nextRender() {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

/**
 * The legend at a window size once the bar has settled there: read when two
 * reads 250 ms apart agree.
 */
async function legendAt(width, height, label) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.waitForFunction(
    (width, height) => innerWidth === width && innerHeight === height,
    wait,
    width,
    height,
  );
  let legend;
  for (let tries = 0; tries < 20; tries += 1) {
    await nextRender();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const next = await page.evaluate(readLegend);
    if (tries && JSON.stringify(next) === JSON.stringify(legend)) break;
    legend = next;
  }
  // The legend itself is listed, so the popover a check adds to it is kept;
  // `window` is the window's size (`width` is the legend's).
  if (legend) Object.assign(legend, { window: `${width}×${height}`, label });
  report.legendSizes ??= [];
  report.legendSizes.push(legend ?? { window: `${width}×${height}`, label });
  await shot(`legend-${width}x${height}-${label}`);
  return legend;
}

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
          // The layers menu and the Presets menu float only while open; a
          // closed one is not drawn and is skipped.
          '#data-panel',
          '#frame-presets-menu',
          '#lens-bar',
          '#right-context-rail > [data-panel-id]',
          '#command-dock',
          // The original tools live in the top bar's menu (roadmap 1.5).
          '#frame-tools > .tools-panel',
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
          .filter(
            ({ right, left, bottom, top }) => right > left && bottom > top,
          );
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
          if (meet(panel, region))
            overlaps.push(`${panel.name} / ${region.name}`);
      }
      panels.forEach((a, i) =>
        panels.slice(i + 1).forEach((b) => {
          if (meet(a, b)) overlaps.push(`${a.name} / ${b.name}`);
        }),
      );
      // A part of the frame with the hidden attribute is not drawn, whatever
      // display its class gives it.
      const hiddenShown = [
        ...document.querySelectorAll(
          '.frame-region[hidden], .frame-region [hidden], #world-hover[hidden], #lens-bar[hidden]',
        ),
      ]
        .filter((element) => getComputedStyle(element).display !== 'none')
        .map((element) => element.id || element.className || element.tagName);
      return {
        today: document.body.dataset.today,
        sheet: document.body.dataset.sheet,
        globeWidth: Math.round(globe.right - globe.left),
        overlaps,
        hiddenShown,
        ...stable,
      };
    },
    { width, height },
  );
  data.legend = await page.evaluate(readLegend);
  report.frameLayouts ??= [];
  report.frameLayouts.push({ width, height, label, ...data });
  await shot(`frame-${width}x${height}-${label}`);
  assert.deepEqual(
    data.overlaps,
    [],
    `Overlap at ${width}×${height} (${label}, Today ${data.today}, sheet ${data.sheet})`,
  );
  assert.deepEqual(
    data.hiddenShown,
    [],
    `Hidden parts of the frame drawn at ${width}×${height} (${label})`,
  );
  // At these sizes every lens but Ownership fits whole in the bar.
  if (data.legend)
    data.legend.popover = await checkLegend(
      data.legend,
      `${width}×${height} (${label})`,
      { everyMarkFits: true },
    );
  assert.ok(
    data.globeWidth >= FRAME_GLOBE_MIN_WIDTH,
    `The globe is ${data.globeWidth} px at ${width}×${height} (${label}); it needs ${FRAME_GLOBE_MIN_WIDTH}`,
  );
  return data;
}

// The layers menu and the Presets menu (piece 1.4). Closed, neither is drawn
// and nothing of the layer list is over the globe. Open, each sits inside the
// window and clear of the bars, Today, the rail and the sheet; they float
// over the globe and may cover its other floating panels while open.
async function menusLayout(width, height, label) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const measure = (selector) =>
    page.evaluate((selector) => {
      const shown = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility === 'visible' &&
          element.getClientRects().length > 0
        );
      };
      const box = (element) => {
        const { left, top, right, bottom } = element.getBoundingClientRect();
        return { left, top, right, bottom };
      };
      const regions = [
        ['top bar', '#frame-top'],
        ['bottom bar', '#frame-bottom'],
        ['Today', '#frame-today'],
        ['rail', '#frame-rail'],
        ['sheet', '#frame-sheet'],
      ]
        .map(([name, regionSelector]) => [
          name,
          document.querySelector(regionSelector),
        ])
        .filter(([, element]) => shown(element))
        .map(([name, element]) => ({ name, ...box(element) }));
      const drawn = ['#data-panel', '#lens-bar', '#frame-presets-menu'].filter(
        (other) => shown(document.querySelector(other)),
      );
      const element = selector && document.querySelector(selector);
      return {
        today: document.body.dataset.today,
        sheet: document.body.dataset.sheet,
        regions,
        drawn,
        menu: element && shown(element) ? box(element) : null,
        window: { width: innerWidth, height: innerHeight },
      };
    }, selector);
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const problems = (data, name) => {
    const found = [];
    const { menu, regions } = data;
    if (!menu) return [`${name} is not drawn`];
    if (
      menu.left < 0 ||
      menu.top < 0 ||
      menu.right > data.window.width ||
      menu.bottom > data.window.height
    )
      found.push(`${name} leaves the window: ${JSON.stringify(menu)}`);
    for (const region of regions)
      if (
        Math.min(menu.right, region.right) - Math.max(menu.left, region.left) >
          1 &&
        Math.min(menu.bottom, region.bottom) - Math.max(menu.top, region.top) >
          1
      )
        found.push(`${name} / ${region.name}`);
    return found;
  };
  const result = { width, height, label };
  await settle();
  const closed = await measure(null);
  result.closed = closed.drawn;
  assert.deepEqual(
    closed.drawn,
    [],
    `With the menus closed, parts of the layer list are drawn at ${width}×${height} (${label})`,
  );

  await page.click('#frame-layers');
  await page.waitForSelector('#data-panel:not(.collapsed)', { visible: true });
  await settle();
  const layers = await measure('#data-panel');
  result.layers = layers;
  assert.equal(
    await page.$eval('#frame-layers', (node) =>
      node.getAttribute('aria-expanded'),
    ),
    'true',
  );
  await shot(`layers-menu-${width}x${height}-${label}`);
  await page.click('#layers-menu-close');
  await page.waitForSelector('#data-panel.collapsed', { hidden: true });

  await page.click('#frame-presets');
  await page.waitForSelector('#frame-presets-menu:not([hidden])', {
    visible: true,
  });
  await settle();
  const presets = await measure('#frame-presets-menu');
  result.presets = presets;
  await shot(`presets-menu-${width}x${height}-${label}`);
  await page.click('#frame-presets');
  await page.waitForSelector('#frame-presets-menu', { hidden: true });

  result.problems = [
    ...problems(layers, 'layers menu'),
    ...problems(presets, 'Presets menu'),
  ];
  report.menuLayouts ??= [];
  report.menuLayouts.push(result);
  assert.deepEqual(
    result.problems,
    [],
    `Menus at ${width}×${height} (${label}, Today ${layers.today}, sheet ${layers.sheet})`,
  );
  return result;
}

// The Cameras and Weather detail panels, after their layers are switched on
// from the layers menu and the menu is closed: each panel drawn sits inside
// the window and clear of the bars, Today, the rail and the sheet. The run's
// fixtures answer the camera and weather feeds with nothing, so a panel that
// shows only with data may stay hidden; that is reported as not drawn, with
// its reason, and is not counted as a pass.
async function detailPanelsLayout(width, height, label) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const panels = [
    { name: 'Cameras', layerId: 'cctv', selector: '#cctv-panel' },
    {
      name: 'Weather',
      layerId: 'weather-cyclones',
      selector: '#weather-panel',
    },
  ];
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const openMenu = async () => {
    await page.click('#frame-layers');
    await page.waitForSelector('#data-panel:not(.collapsed)', {
      visible: true,
    });
  };
  const closeMenu = async () => {
    await page.click('#layers-menu-close');
    await page.waitForSelector('#data-panel.collapsed', { hidden: true });
  };
  // Switch a row on or off through its switch in the open menu.
  const setRow = (layerId, on) =>
    page.evaluate(
      ({ layerId, on }) => {
        const button = document.querySelector(
          `#data-panel [data-layer-id="${layerId}"] .data-toggle-btn`,
        );
        if (!button) return { found: false };
        const was = button.getAttribute('aria-checked') === 'true';
        if (button.disabled) return { found: true, disabled: true, on: was };
        if (was !== on) button.click();
        return { found: true, disabled: false, on: was, clicked: was !== on };
      },
      { layerId, on },
    );
  // One panel at a time: the right rail folds a panel it has no room for,
  // so two expanded at once would measure the rail's choice, not the panel.
  const result = { width, height, label, panels: [], problems: [] };
  try {
    for (const panel of panels) {
      let switched = false;
      let expanded = false;
      try {
        await openMenu();
        const row = await setRow(panel.layerId, true);
        switched = Boolean(row.clicked);
        await closeMenu();
        // A weather panel with entries shows itself; give it a moment.
        await page
          .waitForFunction(
            (selector) => !document.querySelector(selector)?.hidden,
            { timeout: 5000 },
            panel.selector,
          )
          .catch(() => {});
        expanded = await page.$eval(
          panel.selector,
          (node, id) => {
            if (node.hidden || !node.classList.contains('collapsed'))
              return false;
            node.querySelector(`[data-collapse-target="${id}"]`)?.click();
            return true;
          },
          panel.selector.slice(1),
        );
        await page
          .waitForFunction(
            (selector) =>
              !document
                .querySelector(selector)
                ?.classList.contains('collapsed'),
            { timeout: 3000 },
            panel.selector,
          )
          .catch(() => {});
        await settle();
        const data = await page.evaluate((selector) => {
          const shown = (element) => {
            if (!element) return false;
            const style = getComputedStyle(element);
            return (
              !element.hidden &&
              style.display !== 'none' &&
              style.visibility === 'visible' &&
              Number(style.opacity) > 0 &&
              element.getClientRects().length > 0
            );
          };
          const box = (element) => {
            const { left, top, right, bottom } =
              element.getBoundingClientRect();
            return { left, top, right, bottom };
          };
          const regions = [
            ['top bar', '#frame-top'],
            ['bottom bar', '#frame-bottom'],
            ['Today', '#frame-today'],
            ['rail', '#frame-rail'],
            ['sheet', '#frame-sheet'],
          ]
            .map(([name, regionSelector]) => [
              name,
              document.querySelector(regionSelector),
            ])
            .filter(([, element]) => shown(element))
            .map(([name, element]) => ({ name, ...box(element) }));
          const element = document.querySelector(selector);
          const style = element && getComputedStyle(element);
          return {
            today: document.body.dataset.today,
            sheet: document.body.dataset.sheet,
            regions,
            window: { width: innerWidth, height: innerHeight },
            exists: Boolean(element),
            hidden: Boolean(element?.hidden),
            className: element?.className || '',
            parent: element?.parentElement?.id || '',
            display: style?.display,
            visibility: style?.visibility,
            opacity: style?.opacity,
            box: shown(element) ? box(element) : null,
          };
        }, panel.selector);
        await shot(`detail-panel-${panel.layerId}-${width}x${height}-${label}`);
        result.today = data.today;
        result.sheet = data.sheet;
        result.panels.push({ name: panel.name, row, ...data });
        const { box } = data;
        if (!box) {
          // A panel that is not drawn cannot be measured, so the step fails:
          // it never passes without measuring each panel.
          result.problems.push(
            `${panel.name} panel is not drawn (hidden ${data.hidden}, display ${data.display})`,
          );
          continue;
        }
        if (
          box.left < 0 ||
          box.top < 0 ||
          box.right > data.window.width ||
          box.bottom > data.window.height
        )
          result.problems.push(
            `${panel.name} panel leaves the window: ${JSON.stringify(box)}`,
          );
        for (const region of data.regions)
          if (
            Math.min(box.right, region.right) -
              Math.max(box.left, region.left) >
              1 &&
            Math.min(box.bottom, region.bottom) -
              Math.max(box.top, region.top) >
              1
          )
            result.problems.push(`${panel.name} panel / ${region.name}`);
      } finally {
        // Leave the page as it was: the panel folded, the layer off again.
        if (expanded)
          await page
            .$eval(
              panel.selector,
              (node, id) => {
                if (!node.classList.contains('collapsed'))
                  node.querySelector(`[data-collapse-target="${id}"]`)?.click();
              },
              panel.selector.slice(1),
            )
            .catch(() => {});
        if (switched) {
          await openMenu();
          await setRow(panel.layerId, false);
          await closeMenu();
        }
      }
    }
  } finally {
    report.detailPanelLayouts ??= [];
    report.detailPanelLayouts.push(result);
  }
  assert.deepEqual(
    result.problems,
    [],
    `Detail panels at ${width}×${height} (${label}, Today ${result.today}, sheet ${result.sheet})`,
  );
  return result;
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
  // "Switch all off" leaves World on (World is the bottom bar's view, not a
  // row), so World goes off by the data manager, as the frame's World does.
  await page.evaluate(async () => {
    document.getElementById('clear-selected-layers').click();
    await window.__godsEyeView.dataManager.setEnabled('world', false, {
      origin: 'user',
    });
  });
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
      menusLayout,
      detailPanelsLayout,
      legendPopover,
      checkLegend,
      legendAt,
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
