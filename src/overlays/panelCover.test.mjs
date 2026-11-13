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
  const app = readFileSync(new URL('../app/layers/world.js', import.meta.url), 'utf8');
  assert.match(app, /createPanelCover\(\)/);
});
