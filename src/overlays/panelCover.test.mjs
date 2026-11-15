// Overlap 2.1 (c): the World Board's country codes (LBY, IRN, EGY, TZA, IDN at
// 1440x900) showed through the translucent panels. They are Cesium billboards
// under every panel, so the fix hides a code while its box sits under chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PANEL_COVER_REFRESH_MS,
  PANEL_COVER_SELECTORS,
  boxUnderRects,
  createPanelCover,
} from './panelCover.js';

function element(rect, { hidden = false, visible = true } = {}) {
  return {
    hidden,
    checkVisibility: () => visible,
    getBoundingClientRect: () => rect,
  };
}

test('a code box under a panel is covered, one beside it is not', () => {
  const rects = [{ left: 52, top: 340, right: 332, bottom: 672 }];
  assert.equal(boxUnderRects(200, 400, rects, 27, 12), true);
  assert.equal(boxUnderRects(340, 400, rects, 27, 12), true, 'the box edge counts, not only its centre');
  assert.equal(boxUnderRects(380, 400, rects, 27, 12), false);
  assert.equal(boxUnderRects(Number.NaN, 400, rects), false);
});

test('the cover measures shown chrome only, throttles, and bumps its revision on change', () => {
  let clock = 0;
  let panelRect = { left: 1052, top: 266, width: 176, height: 222 };
  const shown = element(panelRect);
  const elements = [
    shown,
    element({ left: 0, top: 0, width: 400, height: 400 }, { hidden: true }),
    element({ left: 0, top: 0, width: 400, height: 400 }, { visible: false }),
    element({ left: 0, top: 0, width: 0, height: 0 }),
  ];
  let selector = '';
  const cover = createPanelCover({
    documentRef: {
      querySelectorAll(query) {
        selector = query;
        return elements;
      },
    },
    now: () => clock,
  });
  const first = cover.refresh();
  assert.equal(selector, PANEL_COVER_SELECTORS.join(', '));
  assert.equal(cover.covers(1100, 300), true);
  assert.equal(cover.covers(200, 200), false, 'hidden, invisible and empty chrome cover nothing');

  shown.getBoundingClientRect = () => ({ left: 1052, top: 266, width: 176, height: 60 });
  clock += PANEL_COVER_REFRESH_MS - 1;
  assert.equal(cover.refresh(), first, 'no new measurement inside the throttle window');
  clock += 1;
  const second = cover.refresh();
  assert.notEqual(second, first, 'a panel that moved bumps the revision');
  assert.equal(cover.covers(1100, 400), false);
  clock += PANEL_COVER_REFRESH_MS;
  assert.equal(cover.refresh(), second, 'unchanged chrome keeps the revision');
  void panelRect;
});

test('the cover lists every panel surface, the board chrome and the status line', () => {
  for (const selector of [
    '#left-panel-stack > [data-panel-id]',
    '#right-context-rail > [data-panel-id]',
    '.world-board-hud:not(#world-hover)',
    '#intel-hud.active .hud-status',
    '#title-bar',
    '#command-dock',
  ]) {
    assert.ok(PANEL_COVER_SELECTORS.includes(selector), selector);
  }
});

test('the board hides its country codes under the cover, wired from the app layer', () => {
  const geometry = readFileSync(new URL('../layers/world/geometry.js', import.meta.url), 'utf8');
  assert.match(geometry, /cullLabels\(camera, cover = null\)/);
  assert.match(geometry, /cover\.covers\(/);
  const layer = readFileSync(new URL('../layers/world/index.js', import.meta.url), 'utf8');
  assert.match(layer, /geometry\.cullLabels\(camera, cover\)/);
  assert.match(layer, /cover\?\.watch\?\.\(requestRender, lifecycle\.signal\)/, 'a layout change asks for a frame');
  const app = readFileSync(new URL('../app/layers/world.js', import.meta.url), 'utf8');
  assert.match(app, /createPanelCover\(\)/);
});

// The frame (roadmap 1.2) closes the three gaps the costume-off review found.
function canvasDocument(canvasRect, elements) {
  const canvas = element(canvasRect);
  return {
    canvas,
    documentRef: {
      getElementById: (id) => (id === 'cesiumContainer' ? canvas : null),
      querySelectorAll: () => elements,
    },
  };
}

test('rects are measured in the canvas’s own space, where Cesium puts the codes', () => {
  // The globe region starts 340 px in and 52 px down: Today and the top bar.
  const { documentRef } = canvasDocument(
    { left: 340, top: 52, width: 1100, height: 770 },
    [element({ left: 352, top: 64, width: 280, height: 300 })],
  );
  const cover = createPanelCover({ documentRef, now: () => 0 });
  cover.refresh();
  assert.equal(
    cover.covers(20, 20),
    true,
    'the layer list starts 12 px into the canvas',
  );
  assert.equal(
    cover.covers(360, 70),
    false,
    'viewport coordinates would wrongly hit it',
  );
});

test('watch asks for a frame when chrome or the globe region resizes, and invalidate skips the throttle', (t) => {
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      observers.push(this);
    }
    observe(target) {
      this.targets.push(target);
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  t.after(() => delete globalThis.ResizeObserver);
  const panel = element({ left: 400, top: 100, width: 200, height: 200 });
  const { documentRef, canvas } = canvasDocument(
    { left: 340, top: 52, width: 1100, height: 770 },
    [panel],
  );
  const windowRef = new EventTarget();
  let clock = 0;
  const cover = createPanelCover({ documentRef, windowRef, now: () => clock });
  const controller = new AbortController();
  let frames = 0;
  cover.watch(() => frames++, controller.signal);
  const [observer] = observers;
  assert.ok(observer.targets.includes(canvas), 'the globe region is watched');
  assert.ok(observer.targets.includes(panel), 'each panel is watched');

  const first = cover.refresh();
  // The panel folds inside the throttle window: the observer clears the wait.
  panel.getBoundingClientRect = () => ({
    left: 400,
    top: 100,
    width: 200,
    height: 40,
  });
  clock += 10;
  observer.callback();
  assert.equal(frames, 1, 'a size change asks the idle globe for a frame');
  assert.notEqual(
    cover.refresh(),
    first,
    'and the next frame measures at once',
  );

  windowRef.dispatchEvent(new Event('resize'));
  assert.equal(frames, 2, 'a window resize does too');

  controller.abort();
  assert.equal(observer.disconnected, true);
  windowRef.dispatchEvent(new Event('resize'));
  assert.equal(frames, 2, 'nothing after the board is switched off');
});

test('turning in place or resizing the globe re-culls the codes, not only moving', () => {
  const geometry = readFileSync(
    new URL('../layers/world/geometry.js', import.meta.url),
    'utf8',
  );
  const cull = geometry.slice(
    geometry.indexOf('cullLabels(camera'),
    geometry.indexOf('occluder.cameraPosition'),
  );
  assert.match(
    cull,
    /equalsEpsilon\(\s*camera\.directionWC,\s*previousDirection/,
  );
  assert.match(cull, /equalsEpsilon\(\s*camera\.upWC,\s*previousUp/);
  assert.match(cull, /width === previousWidth/);
  assert.match(cull, /height === previousHeight/);
});
