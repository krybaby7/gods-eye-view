// The frame (roadmap 1.2): its own rules. Today folds and gives the globe the
// room, the sheet opens when the board has something to show, every change of
// layout asks the idle globe for a render, the globe's canvas keeps to its
// region, and the regions do not overlap at the three window sizes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { expandApplicationHtml } from '../../build/application-html.js';
import {
  FRAME_GLOBE_MIN_WIDTH,
  FRAME_NARROW_QUERY,
  FRAME_SHARED_QUERY,
  FRAME_PRESETS_STORAGE_KEY,
  FRAME_SHEET_TABS_SHOWN,
  FRAME_TODAY_OPEN_MIN_WIDTH,
  FRAME_TODAY_STORAGE_KEY,
  createFrame,
} from './frame.js';
import { worldSheetTabs } from './worldPanel.js';
import phase2 from '../layers/world/phase-2.js';
import phase3 from '../layers/world/phase-3.js';
import phase4 from '../layers/world/phase-4.js';
import phase5 from '../layers/world/phase-5.js';
import phase6 from '../layers/world/phase-6.js';

// The phases the app loads through Vite's glob; plain Node has none.
const phaseTabs = [phase2, phase3, phase4, phase5, phase6].flatMap(
  (phase) => phase.tabs ?? [],
);

const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');
const html = expandApplicationHtml(read('../../index.html'));
const frameCss = read('./styles/frame.css');
const foundation = read('./styles/foundation.css');

function ruleBody(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing rule ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

function fakeElement(id) {
  const node = new EventTarget();
  node.id = id;
  node.hidden = false;
  node.dataset = {};
  node.style = { setProperty() {}, removeProperty() {} };
  const attributes = new Map();
  node.setAttribute = (name, value) => attributes.set(name, String(value));
  node.getAttribute = (name) => attributes.get(name) ?? null;
  node.removeAttribute = (name) => {
    attributes.delete(name);
    if (name === 'hidden') node.hidden = false;
  };
  const classes = new Set();
  node.classList = {
    add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
    contains: (name) => classes.has(name),
    toggle: (name, force) =>
      (force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name),
  };
  node.children = [];
  node.replaceChildren = (...children) => {
    node.children = children;
  };
  node.append = (...children) => node.children.push(...children);
  node.querySelector = () => null;
  node.getBoundingClientRect = () => ({ width: 120, height: 26 });
  node.focus = () => {
    node.focused = true;
  };
  node.click = () => node.dispatchEvent(new Event('click'));
  return node;
}

function harness({ width = 1440, saved = {}, ids = [] } = {}) {
  const nodes = new Map();
  const document = {
    body: fakeElement('body'),
    getElementById(id) {
      if (!nodes.has(id) && !ids.includes(id)) return null;
      if (!nodes.has(id)) nodes.set(id, fakeElement(id));
      return nodes.get(id);
    },
    createElement: (tag) => fakeElement(tag),
  };
  const store = new Map(Object.entries(saved));
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  const renders = [];
  return {
    document,
    store,
    renders,
    node: (id) => document.getElementById(id),
    create: (options = {}) =>
      createFrame({
        document,
        window: { innerWidth: width },
        storage,
        requestRender: (reason) => renders.push(reason),
        now: () => new Date(2026, 10, 13, 9, 0),
        ...options,
      }),
  };
}

const FRAME_IDS = [
  'frame-today',
  'frame-today-fold',
  'frame-today-open',
  'world-character-sheet',
  'frame-date',
  'frame-board-status',
  'frame-refreshed',
  'world-refresh',
  'frame-gauges',
  'frame-top',
  'world-turn',
  'world-turn-changes',
  'frame-layers',
  'data-panel',
  'frame-presets',
  'lens-bar',
  'frame-zoom-out',
  'frame-zoom-in',
  'zoom-map-out',
  'zoom-map-in',
  'frame-voice',
];

function withObservers(t) {
  const mutations = [];
  globalThis.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
      mutations.push(this);
    }
    observe(target) {
      this.target = target;
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  const resizes = [];
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      resizes.push(this);
    }
    observe(target) {
      this.target = target;
    }
    disconnect() {}
  };
  t.after(() => {
    delete globalThis.MutationObserver;
    delete globalThis.ResizeObserver;
  });
  return { mutations, resizes };
}

test('the frame is a template of five regions, listed for the build', () => {
  for (const id of [
    'frame-top',
    'frame-today',
    'frame-rail',
    'frame-sheet',
    'frame-bottom',
  ])
    assert.match(html, new RegExp(`id="${id}"[^>]*class="frame-region`), id);
  // The board's parts live in the frame now, once each.
  for (const id of [
    'world-lens-bar',
    'world-legend',
    'world-refresh',
    'world-turn',
    'world-turn-changes',
    'world-progress',
    'world-character-sheet',
    'world-sheet-tabs',
  ]) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} appears once`);
  }
  const sheet =
    html.match(/<aside id="frame-sheet"[\s\S]*?<\/aside>/)?.[0] ?? '';
  assert.match(
    sheet,
    /id="world-character-sheet"/,
    'the country sheet is in the right column',
  );
  // Content first: the tabs come straight after the head, before the body.
  assert.ok(
    sheet.indexOf('id="world-sheet-tabs"') <
      sheet.indexOf('id="world-sheet-body"'),
  );
  assert.ok(
    sheet.indexOf('id="world-sheet-content"') <
      sheet.indexOf('id="world-sheet-extra"'),
  );
  const context = read('./templates/context.html');
  assert.doesNotMatch(
    context,
    /world-character-sheet|world-lens-bar|world-legend/,
  );
});

test('Today starts open on a wide window, folds to the rail and asks for a render', (t) => {
  withObservers(t);
  const h = harness({ ids: FRAME_IDS });
  const frame = h.create();
  t.after(() => frame.destroy());
  assert.equal(h.document.body.dataset.today, 'open');
  assert.equal(
    h.node('frame-today-fold').getAttribute('aria-expanded'),
    'true',
  );
  h.renders.length = 0;
  h.node('frame-today-fold').click();
  assert.equal(h.document.body.dataset.today, 'folded');
  assert.deepEqual(
    h.renders,
    ['frame-today'],
    'folding asks the idle globe for a render',
  );
  assert.equal(
    h.store.get(FRAME_TODAY_STORAGE_KEY),
    'folded',
    'the choice is remembered',
  );
  assert.equal(
    h.node('frame-today-open').focused,
    true,
    'focus moves to the rail',
  );
  h.node('frame-today-open').click();
  assert.equal(h.document.body.dataset.today, 'open');
  // The globe takes the room: its left edge is the column's width or the rail's.
  assert.match(
    ruleBody(frameCss, "body.gev-frame[data-today='folded']"),
    /--frame-left: var\(--frame-rail\);/,
  );
  assert.match(
    ruleBody(frameCss, 'body.gev-frame'),
    /--frame-left: var\(--frame-today\);/,
  );
});

test('Today starts folded on a narrow window and a remembered choice wins', (t) => {
  withObservers(t);
  const narrow = harness({
    width: FRAME_TODAY_OPEN_MIN_WIDTH - 1,
    ids: FRAME_IDS,
  });
  const a = narrow.create();
  t.after(() => a.destroy());
  assert.equal(narrow.document.body.dataset.today, 'folded');
  const remembered = harness({
    saved: { [FRAME_TODAY_STORAGE_KEY]: 'folded' },
    ids: FRAME_IDS,
  });
  const b = remembered.create();
  t.after(() => b.destroy());
  assert.equal(remembered.document.body.dataset.today, 'folded');
});

test('the sheet opens and closes with the board, and each change asks for a render', (t) => {
  const { mutations } = withObservers(t);
  const h = harness({ ids: FRAME_IDS });
  const sheet = h.node('world-character-sheet');
  sheet.hidden = true;
  const frame = h.create();
  t.after(() => frame.destroy());
  assert.equal(h.document.body.dataset.sheet, 'closed');
  const observer = mutations.find((item) => item.target === sheet);
  assert.ok(observer, 'the frame watches the sheet');
  h.renders.length = 0;
  sheet.hidden = false;
  observer.callback();
  assert.equal(h.document.body.dataset.sheet, 'open');
  assert.deepEqual(h.renders, ['frame-sheet']);
  observer.callback();
  assert.deepEqual(h.renders, ['frame-sheet'], 'no change, no render');
  sheet.hidden = true;
  observer.callback();
  assert.equal(h.document.body.dataset.sheet, 'closed');
  assert.deepEqual(h.renders, ['frame-sheet', 'frame-sheet']);
  assert.match(
    ruleBody(frameCss, "body.gev-frame[data-sheet='open']"),
    /--frame-right: var\(--frame-sheet\);/,
  );
});

test('a resize of the globe region asks for a render too', (t) => {
  const { resizes } = withObservers(t);
  const h = harness({ ids: [...FRAME_IDS, 'cesiumContainer'] });
  const frame = h.create();
  t.after(() => frame.destroy());
  const globe = resizes.find(
    (item) => item.target === h.node('cesiumContainer'),
  );
  h.renders.length = 0;
  globe.callback();
  assert.deepEqual(h.renders, ['frame-resize']);
});

test('the globe draws only inside its region, so nothing on it reaches under the frame', () => {
  const globe = ruleBody(
    frameCss,
    'body.gev-frame :is(#cesiumContainer, #world-overlay-root)',
  );
  assert.match(
    globe,
    /inset: var\(--frame-top\) var\(--frame-right\) var\(--frame-bottom\)\s+var\(--frame-left\);/,
  );
  assert.match(globe, /width: auto;/);
  // Cockpit, recording, the clean view and embedding give the window back.
  assert.match(
    frameCss,
    /body\.gev-frame:is\(\.cockpit-mode, \.recording-mode, \.ui-clean-view, \.ui-embed\) \{\n  --frame-top: 0px;/,
  );
});

test('the top bar shows the date, the refresh day and only the gauges the board holds', (t) => {
  withObservers(t);
  const h = harness({ ids: FRAME_IDS });
  let snapshot = { enabled: false };
  const listeners = new Set();
  const world = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const frame = h.create({ world });
  t.after(() => frame.destroy());
  assert.equal(h.node('frame-date').textContent, 'Fri 13 Nov 2026');
  assert.equal(h.node('frame-board-status').hidden, true, 'no board, no turn');
  assert.equal(h.node('world-refresh').hidden, true);
  assert.equal(h.node('frame-gauges').hidden, true);
  // Switching the board on: its loading line can be read before it is on,
  // while Refresh, which would do nothing yet, stays away.
  snapshot = { enabled: false, loading: true };
  for (const listener of listeners) listener();
  assert.equal(h.node('frame-board-status').hidden, false);
  assert.equal(h.node('world-refresh').hidden, true);
  snapshot = { enabled: false, error: 'The World Board could not load.' };
  for (const listener of listeners) listener();
  assert.equal(h.node('frame-board-status').hidden, false);
  snapshot = { enabled: false };
  for (const listener of listeners) listener();
  assert.equal(h.node('frame-board-status').hidden, true);
  snapshot = {
    enabled: true,
    turn: { number: 2, endedAt: '2026-03-04T12:00:00Z', changes: [] },
    features: {
      fred: {
        series: {
          MCOILBRENTEU: [
            { month: '2026-01', value: 100 },
            { month: '2026-02', value: 110 },
          ],
        },
      },
    },
  };
  for (const listener of listeners) listener();
  assert.equal(h.node('frame-board-status').hidden, false);
  assert.equal(h.node('frame-refreshed').textContent, 'Refreshed 4 Mar');
  const gauges = h.node('frame-gauges');
  assert.equal(gauges.hidden, false);
  assert.deepEqual(
    gauges.children.map((node) => node.dataset.gauge),
    ['oil'],
    'food and alerts are not held, so not shown',
  );
});

test('the bottom bar opens the layers, shows or hides the presets and zooms', (t) => {
  withObservers(t);
  const h = harness({ ids: FRAME_IDS });
  const collapse = fakeElement('collapse');
  const dataPanel = h.node('data-panel');
  dataPanel.classList.add('collapsed');
  dataPanel.querySelector = () => collapse;
  let toggled = 0;
  collapse.addEventListener('click', () => toggled++);
  let zoomed = '';
  h.node('zoom-map-in').addEventListener('click', () => (zoomed += 'in'));
  h.node('zoom-map-out').addEventListener('click', () => (zoomed += 'out'));
  h.node('frame-voice').hidden = true;
  const frame = h.create();
  t.after(() => frame.destroy());
  assert.equal(h.node('frame-layers').getAttribute('aria-expanded'), 'false');
  h.node('frame-layers').click();
  assert.equal(toggled, 1, 'Layers uses the layer list’s own disclosure');
  assert.equal(h.node('lens-bar').hidden, false, 'presets show by default');
  h.node('frame-presets').click();
  assert.equal(h.node('lens-bar').hidden, true);
  assert.equal(h.node('frame-presets').getAttribute('aria-expanded'), 'false');
  assert.equal(h.store.get(FRAME_PRESETS_STORAGE_KEY), 'hidden');
  h.node('frame-zoom-in').click();
  h.node('frame-zoom-out').click();
  assert.equal(zoomed, 'inout');
  assert.equal(
    h.node('frame-voice').hidden,
    true,
    'no voice control, no voice button',
  );
});

test('the voice button shows only when the voice control exists, and uses it', (t) => {
  withObservers(t);
  const h = harness({
    ids: [...FRAME_IDS, 'gev-voice-button', 'gev-voice-control'],
  });
  let pressed = 0;
  h.node('gev-voice-button').addEventListener('click', () => pressed++);
  h.node('gev-voice-control').dataset.status = 'idle';
  h.node('frame-voice').hidden = true;
  const frame = h.create();
  t.after(() => frame.destroy());
  assert.equal(h.node('frame-voice').hidden, false);
  assert.equal(h.node('frame-voice').getAttribute('aria-pressed'), 'false');
  h.node('frame-voice').click();
  assert.equal(pressed, 1);
});

test('destroy hands the window back and asks for a render', (t) => {
  withObservers(t);
  const h = harness({ ids: FRAME_IDS });
  const frame = h.create();
  assert.equal(h.document.body.classList.contains('gev-frame'), true);
  frame.destroy();
  assert.equal(h.document.body.classList.contains('gev-frame'), false);
  assert.equal(h.document.body.dataset.today, undefined);
  assert.equal(h.renders.at(-1), 'frame-destroy');
});

// Nothing overlaps at 1280x720, 1440x900 and 1920x1080: the regions follow
// from the tokens, with the narrower columns below 1366 px. This is the
// arithmetic; the same three sizes are measured in a real browser, with the
// original floating panels, by the step "The frame’s regions and the original
// panels do not overlap at three window sizes" in scripts/qa-world.phase-1.mjs
// (run by `node scripts/qa-world.mjs --fixtures`).
function token(name, css = foundation) {
  return Number(css.match(new RegExp(`${name}: (\\d+)px;`))?.[1]);
}

function regions(width, height, { today, sheet }) {
  const narrow = width < 1366;
  const media =
    frameCss.match(
      /@media \(max-width: 1365px\) \{\s*:root \{([\s\S]*?)\}/,
    )?.[1] ?? '';
  const bar = token('--frame-bar');
  const status = token('--frame-status');
  const todayWidth = narrow
    ? token('--frame-today', media)
    : token('--frame-today');
  const sheetWidth = narrow
    ? token('--frame-sheet', media)
    : token('--frame-sheet');
  const left = today === 'open' ? todayWidth : token('--frame-rail');
  const right = sheet ? sheetWidth : 0;
  const list = [
    { name: 'top bar', x: 0, y: 0, w: width, h: bar },
    { name: 'bottom bar', x: 0, y: height - bar, w: width, h: bar },
    {
      name: today === 'open' ? 'Today' : 'rail',
      x: 0,
      y: bar,
      w: left,
      h: height - 2 * bar,
    },
    {
      name: 'globe',
      x: left,
      y: bar,
      w: width - left - right,
      h: height - 2 * bar - status,
    },
    {
      name: 'status line',
      x: left,
      y: height - bar - status,
      w: width - left - right,
      h: status,
    },
  ];
  if (sheet)
    list.push({
      name: 'sheet',
      x: width - right,
      y: bar,
      w: right,
      h: height - 2 * bar,
    });
  return list;
}

test('nothing overlaps at 1280x720, 1440x900 and 1920x1080, open or folded, with or without a sheet', () => {
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ]) {
    for (const today of ['open', 'folded']) {
      for (const sheet of [false, true]) {
        const list = regions(width, height, { today, sheet });
        const area = list.reduce((sum, rect) => sum + rect.w * rect.h, 0);
        assert.equal(
          area,
          width * height,
          `the regions tile ${width}x${height} exactly`,
        );
        for (const [i, a] of list.entries()) {
          assert.ok(
            a.w > 0 && a.h > 0,
            `${a.name} has room at ${width}x${height}`,
          );
          for (const b of list.slice(i + 1)) {
            const overlap =
              a.x < b.x + b.w &&
              b.x < a.x + a.w &&
              a.y < b.y + b.h &&
              b.y < a.y + a.h;
            assert.equal(
              overlap,
              false,
              `${a.name} and ${b.name} overlap at ${width}x${height}`,
            );
          }
        }
        const globe = list.find(({ name }) => name === 'globe');
        assert.ok(
          globe.w >= FRAME_GLOBE_MIN_WIDTH,
          `the globe keeps at least ${FRAME_GLOBE_MIN_WIDTH} px at ${width}x${height} (${globe.w})`,
        );
      }
    }
  }
});

test('Today folds when the window narrows to a phone, without remembering it', (t) => {
  withObservers(t);
  const listeners = [];
  const query = {
    matches: false,
    addEventListener: (type, listener) => listeners.push(listener),
  };
  const h = harness({
    ids: FRAME_IDS,
    saved: { [FRAME_TODAY_STORAGE_KEY]: 'open' },
  });
  const frame = h.create({
    window: {
      innerWidth: 1440,
      matchMedia: (text) =>
        text === FRAME_NARROW_QUERY
          ? query
          : { matches: false, addEventListener() {} },
    },
  });
  t.after(() => frame.destroy());
  assert.equal(h.document.body.dataset.today, 'open');
  h.renders.length = 0;
  query.matches = true; // as a real MediaQueryList does before it fires
  for (const listener of listeners) listener({ matches: true });
  assert.equal(h.document.body.dataset.today, 'folded', 'narrowing folds it');
  assert.deepEqual(h.renders, ['frame-today']);
  assert.equal(
    h.store.get(FRAME_TODAY_STORAGE_KEY),
    'open',
    'the choice is kept for wide windows',
  );
  // Loading already narrow folds it too, whatever was remembered.
  const narrow = harness({
    ids: FRAME_IDS,
    saved: { [FRAME_TODAY_STORAGE_KEY]: 'open' },
  });
  const b = narrow.create({
    window: {
      innerWidth: 390,
      matchMedia: () => ({ matches: true, addEventListener() {} }),
    },
  });
  t.after(() => b.destroy());
  assert.equal(narrow.document.body.dataset.today, 'folded');
  // On a phone an open Today covers the globe instead of squeezing it.
  assert.match(
    frameCss,
    /@media \(max-width: 720px\)[\s\S]*body\.gev-frame\[data-today='open'\] \{\s*--frame-left: 0px;/,
  );
});

test('below the shared width Today and the sheet take turns, and a remembered open does not win', (t) => {
  const { mutations } = withObservers(t);
  const shared = { matches: true, listeners: [] };
  shared.addEventListener = (type, listener) => shared.listeners.push(listener);
  const media = (text) =>
    text === FRAME_SHARED_QUERY
      ? shared
      : { matches: false, addEventListener() {} };
  // Loading with a sheet open and Today remembered open: Today folds.
  const h = harness({
    ids: [...FRAME_IDS, 'world-sheet-close'],
    saved: { [FRAME_TODAY_STORAGE_KEY]: 'open' },
  });
  const sheet = h.node('world-character-sheet');
  const frame = h.create({ window: { innerWidth: 900, matchMedia: media } });
  t.after(() => frame.destroy());
  assert.equal(h.document.body.dataset.sheet, 'open');
  assert.equal(h.document.body.dataset.today, 'folded');
  assert.equal(h.store.get(FRAME_TODAY_STORAGE_KEY), 'open', 'not remembered');
  // Opening Today closes the sheet.
  let closed = 0;
  h.node('world-sheet-close').addEventListener('click', () => {
    closed++;
    sheet.hidden = true;
    mutations.find((item) => item.target === sheet).callback();
  });
  h.node('frame-today-open').click();
  assert.equal(closed, 1);
  assert.equal(h.document.body.dataset.today, 'open');
  assert.equal(h.document.body.dataset.sheet, 'closed');
  // Opening the sheet folds Today.
  sheet.hidden = false;
  mutations.find((item) => item.target === sheet).callback();
  assert.equal(h.document.body.dataset.today, 'folded');
  // On a wide window both stay open.
  shared.matches = false;
  h.node('frame-today-open').click();
  assert.equal(closed, 1, 'a wide window keeps the sheet');
  assert.equal(h.document.body.dataset.today, 'open');
  assert.equal(h.document.body.dataset.sheet, 'open');
  // Narrowing with both open folds Today.
  shared.matches = true;
  for (const listener of shared.listeners) listener({ matches: true });
  assert.equal(h.document.body.dataset.today, 'folded');
  // The shared width is where Today, the sheet and a usable globe still fit.
  const max = Number(FRAME_SHARED_QUERY.match(/(\d+)px/)[1]);
  const media1365 =
    frameCss.match(
      /@media \(max-width: 1365px\) \{\s*:root \{([\s\S]*?)\}/,
    )?.[1] ?? '';
  assert.equal(
    max + 1,
    token('--frame-today', media1365) +
      token('--frame-sheet', media1365) +
      FRAME_GLOBE_MIN_WIDTH,
  );
});

function fakeTab({ id, label }, selected = false) {
  const node = fakeElement(`world-tab-${id}`);
  node.setAttribute('role', 'tab');
  node.setAttribute('aria-selected', String(selected));
  node.dataset.worldTab = id;
  node.textContent = label;
  return node;
}

test('the sheet shows Overview, Condition, Strength and Relations, the rest under More', (t) => {
  const { mutations } = withObservers(t);
  const h = harness({
    ids: [
      ...FRAME_IDS,
      'world-sheet-tabs',
      'frame-sheet-more',
      'frame-sheet-more-menu',
    ],
  });
  const list = h.node('world-sheet-tabs');
  // The board's own list, with the phases the app loads; Overview is chosen,
  // as when a country opens.
  list.children = worldSheetTabs(phaseTabs).map((tab, i) =>
    fakeTab(tab, i === 0),
  );
  const frame = h.create();
  t.after(() => frame.destroy());
  assert.equal(FRAME_SHEET_TABS_SHOWN, 4);
  const shown = () =>
    list.children
      .filter((node) => !node.hidden)
      .map((node) => node.textContent);
  assert.deepEqual(shown(), ['Overview', 'Condition', 'Strength', 'Relations']);
  const more = h.node('frame-sheet-more');
  const menu = h.node('frame-sheet-more-menu');
  assert.equal(more.hidden, false);
  assert.equal(more.textContent, 'More ›');
  // Appendix D lists Exposure, Assets, People, News and Stakes here. News and
  // Stakes have no tab until they are built (decision 32); Leverage is phase
  // 2's own.
  assert.deepEqual(
    menu.children.map((item) => item.textContent),
    ['Exposure', 'Leverage', 'Assets', 'People'],
  );
  // Opening More and choosing a tab clicks the board's own tab.
  const assets = list.children.find(
    (node) => node.dataset.worldTab === 'assets',
  );
  let chosen = '';
  assets.addEventListener('click', () => (chosen = 'assets'));
  more.click();
  assert.equal(menu.hidden, false);
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  menu.children.find((item) => item.dataset.frameTab === 'assets').click();
  assert.equal(chosen, 'assets');
  assert.equal(menu.hidden, true, 'the menu closes');
  // The board selects it: More takes its name, so the choice stays in view,
  // and the four tabs in the bar stay as they were.
  list.children[0].setAttribute('aria-selected', 'false');
  assets.setAttribute('aria-selected', 'true');
  mutations.find((item) => item.target === list).callback();
  assert.equal(more.textContent, 'Assets ›');
  assert.equal(more.dataset.selected, 'true');
  assert.deepEqual(shown(), ['Overview', 'Condition', 'Strength', 'Relations']);
  assert.equal(
    menu.children
      .find((item) => item.dataset.frameTab === 'assets')
      .getAttribute('aria-current'),
    'true',
  );
  // The board focuses the tab it selects (arrow keys, an Overview line); a
  // tab under More cannot take focus, so More takes it, a shown tab keeps it.
  more.focused = false;
  assets.focus();
  assert.equal(more.focused, true);
  assert.equal(assets.focused, undefined);
  list.children[1].focus();
  assert.equal(list.children[1].focused, true);
  // Back to a tab in the bar: More is plain again.
  assets.setAttribute('aria-selected', 'false');
  list.children[1].setAttribute('aria-selected', 'true');
  mutations.find((item) => item.target === list).callback();
  assert.equal(more.textContent, 'More ›');
  assert.equal(more.dataset.selected, 'false');
  // Four tabs or fewer: no More at all.
  list.children = list.children.slice(0, 4);
  mutations.find((item) => item.target === list).callback();
  assert.equal(more.hidden, true);
  // A tab that left More takes its own focus again.
  more.focused = false;
  assets.focus();
  assert.equal(assets.focused, true);
  assert.equal(more.focused, false);
});
