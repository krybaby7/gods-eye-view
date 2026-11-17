// A hidden part of the frame is not shown (decision 32: a control with
// nothing behind it is not shown). The browser's own [hidden] rule loses to
// any author display rule, so each element of the frame's template, and each
// part the frame or the board hides at run time, is given the hidden
// attribute and its display is resolved over the application's real style
// sheets by the cascade model.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { expandApplicationHtml } from '../../build/application-html.js';
import {
  htmlNodes,
  modelNode,
  rules,
  winners,
} from '../testSupport/cssCascade.mjs';
import { readStylesheet } from '../testSupport/readStylesheet.mjs';

const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');
const html = expandApplicationHtml(read('../../index.html'));
const frameHtml = read('./templates/frame.html');
const menuHtml = read('./templates/layers-menu.html');
// style.css, then the sheets the board's modules import.
const sheets = [
  readStylesheet(new URL('../../style.css', import.meta.url)),
  read('./styles/world-words.css'),
  ...readdirSync(new URL('./styles/', import.meta.url))
    .filter((name) => /^world-phase-\d+\.css$/.test(name))
    .sort()
    .map((name) => read(`./styles/${name}`)),
];

const DISPLAY = { display: ['display'] };

/** The display a hidden element ends up with, and the rule that sets it. */
function hiddenDisplay(node, list) {
  const shown = { ...node, attrs: new Map(node.attrs).set('hidden', '') };
  const won = winners(shown, list, DISPLAY).display;
  return won
    ? { display: won.decl.value.trim(), by: won.selector }
    : { display: 'none', by: 'the browser' };
}

/** The page as the frame runs it: the body carries the frame's state. */
function framePage({ menuOpen = false } = {}) {
  const nodes = htmlNodes(html);
  const body = nodes.find(({ tag }) => tag === 'body');
  body.classes.add('gev-frame');
  body.attrs.set('class', [...body.classes].join(' '));
  body.attrs.set('data-today', 'open');
  body.attrs.set('data-sheet', 'open');
  if (menuOpen) {
    // The layers menu open, so that its closed state's own display: none
    // does not hide its parts for them.
    const menu = nodes.find((node) => node.id === 'data-panel');
    menu.classes.delete('collapsed');
    menu.attrs.set('class', [...menu.classes].join(' '));
  }
  return nodes;
}

// Parts the frame and the board make at run time and hide: a sheet tab put
// under More, a closed "Why this number", and the layers menu's preset
// chips, Presets menu rows and their k/n counts.
function runtimeParts(nodes) {
  const byId = (id) => nodes.find((node) => node.id === id);
  const presetsRow = byId('frame-presets-menu');
  const chips = nodes.find(
    (node) =>
      node.parent === byId('lens-bar') && node.classes.has('lens-buttons'),
  );
  const menuRow = nodes.find(
    (node) => node.parent === presetsRow && node.classes.has('lens-buttons'),
  );
  assert.ok(chips && menuRow, 'both preset rows are in the page');
  const presetParts = (parent, id) => {
    const button = modelNode(
      'button',
      [
        ['class', 'lens-button panel-surface-control is-partial'],
        ['id', `${id}-button`],
      ],
      parent,
    );
    const count = modelNode(
      'span',
      [
        ['class', 'lens-count'],
        ['id', `${id}-count`],
      ],
      button,
    );
    return [button, count];
  };
  // The layers menu's columns, group blocks and a row's parts, as
  // layerPanel.js builds them inside #data-toggles.
  const toggles = byId('data-toggles');
  assert.ok(toggles, 'the layer list is in the page');
  const column = modelNode(
    'div',
    [
      ['class', 'lcol'],
      ['id', 'menu-lcol'],
    ],
    toggles,
  );
  const block = modelNode(
    'section',
    [
      ['class', 'lgroup-block'],
      ['id', 'menu-lgroup-block'],
    ],
    column,
  );
  const row = modelNode(
    'div',
    [
      ['class', 'data-toggle-row lrow'],
      ['id', 'menu-row'],
    ],
    block,
  );
  const top = modelNode(
    'div',
    [
      ['class', 'data-toggle-top'],
      ['id', 'menu-row-top'],
    ],
    row,
  );
  const rowParts = [
    column,
    block,
    top,
    modelNode(
      'div',
      [
        ['class', 'data-toggle-left'],
        ['id', 'menu-row-left'],
      ],
      top,
    ),
    modelNode(
      'div',
      [
        ['class', 'data-toggle-right'],
        ['id', 'menu-row-right'],
      ],
      top,
    ),
  ];
  return [
    ...rowParts,
    ...presetParts(chips, 'menu-preset'),
    ...presetParts(menuRow, 'bar-preset'),
    modelNode(
      'button',
      [
        ['class', 'panel-surface-control world-control'],
        ['role', 'tab'],
        ['id', 'world-tab-assets'],
      ],
      byId('world-sheet-tabs'),
    ),
    modelNode(
      'div',
      [
        ['class', 'world-why'],
        ['id', 'world-why-C1'],
      ],
      byId('world-sheet-content'),
    ),
  ];
}

function hiddenFailures(list) {
  const nodes = framePage({ menuOpen: true });
  const frameIds = new Set(
    [...`${frameHtml}${menuHtml}`.matchAll(/\sid="([^"]+)"/g)].map(
      (match) => match[1],
    ),
  );
  // The frame's own elements and the layers menu's.
  const targets = [
    ...nodes.filter((node) => frameIds.has(node.id)),
    ...runtimeParts(nodes),
  ];
  assert.ok(targets.length > 40, `found ${targets.length} frame elements`);
  return targets
    .map((node) => ({ id: node.id, ...hiddenDisplay(node, list) }))
    .filter(({ display }) => display !== 'none');
}

test('every part of the frame that is hidden stays hidden, whatever its display rule', () => {
  for (const order of [sheets, [...sheets.slice(1), sheets[0]]]) {
    const list = order.flatMap((css) => rules(css));
    assert.deepEqual(hiddenFailures(list), []);
  }
});

test('a display rule that beats the browser’s [hidden] is caught', () => {
  // The fault the review found: .frame-iconbtn set inline-flex and nothing
  // gave the hidden voice and refresh buttons back their display: none.
  const list = sheets.flatMap((css) => rules(css));
  const withoutGuard = list.filter(
    (rule) => !rule.selectors.some((selector) => selector.includes('[hidden]')),
  );
  const failures = hiddenFailures(withoutGuard).map(({ id }) => id);
  for (const id of [
    'world-refresh',
    'world-turn',
    'frame-voice',
    // The legend's info button and its popover have display rules of their
    // own (an icon button and a grid), so they too rest on the guard.
    'frame-legend-whole',
    'frame-legend-popup',
    // The layers menu's list and the parts built inside it at run time.
    'data-toggles',
    'menu-lcol',
    'menu-lgroup-block',
    'menu-row-top',
    'menu-row-left',
    'menu-row-right',
  ])
    assert.ok(failures.includes(id), `${id} would show while hidden`);
});

test('the legend’s info button and popover are among the parts checked', () => {
  const list = sheets.flatMap((css) => rules(css));
  const nodes = framePage();
  for (const id of ['frame-legend-whole', 'frame-legend-popup']) {
    const node = nodes.find((candidate) => candidate.id === id);
    assert.ok(node, `${id} is in the frame`);
    assert.equal(hiddenDisplay(node, list).display, 'none');
  }
});

test('the layers menu shows only while open, and its hidden parts stay hidden', () => {
  const list = sheets.flatMap((css) => rules(css));
  const nodes = framePage();
  const menu = nodes.find((node) => node.id === 'data-panel');
  assert.ok(menu.classes.has('collapsed'), 'the menu starts closed');
  const display = (node) =>
    winners(node, list, DISPLAY).display?.decl.value.trim() ?? 'block';
  assert.equal(display(menu), 'none');
  const open = { ...menu, classes: new Set([...menu.classes]) };
  open.classes.delete('collapsed');
  open.attrs = new Map(menu.attrs).set('class', [...open.classes].join(' '));
  assert.equal(display(open), 'flex');
  // Switch all off, the opener the Search layers row uses, and the panel's
  // own disclosure are hidden in the template and stay so.
  for (const node of nodes.filter(
    (candidate) =>
      candidate.id === 'clear-selected-layers' ||
      candidate.classes.has('search-layers-shortcut') ||
      candidate.classes.has('panel-collapse-btn'),
  ))
    if (node.attrs.has('hidden'))
      assert.equal(hiddenDisplay(node, list).display, 'none', node.id);
});

test('the Tools panel’s View heading goes with its controls while a scene plays', () => {
  // Scene playback hides #globe-navigation (recording.css); its group, and so
  // its heading, must not stand over nothing.
  const list = sheets.flatMap((css) => rules(css));
  const nodes = framePage();
  const body = nodes.find(({ tag }) => tag === 'body');
  const group = nodes.find((node) => node.id === 'frame-group-view');
  assert.ok(group, 'the View group is in the frame');
  const display = () =>
    winners(group, list, DISPLAY).display?.decl.value.trim() ?? 'block';
  assert.notEqual(display(), 'none', 'shown while no scene plays');
  body.classes.add('scene-playback-mode');
  body.attrs.set('class', [...body.classes].join(' '));
  assert.equal(display(), 'none');
});
