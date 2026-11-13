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
function framePage() {
  const nodes = htmlNodes(html);
  const body = nodes.find(({ tag }) => tag === 'body');
  body.classes.add('gev-frame');
  body.attrs.set('class', [...body.classes].join(' '));
  body.attrs.set('data-today', 'open');
  body.attrs.set('data-sheet', 'open');
  return nodes;
}

// Parts the frame and the board make at run time and hide: a sheet tab put
// under More, and a closed "Why this number".
function runtimeParts(nodes) {
  const byId = (id) => nodes.find((node) => node.id === id);
  return [
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
  const nodes = framePage();
  const frameIds = new Set(
    [...frameHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]),
  );
  // The frame's own elements, and #lens-bar, which its Presets button hides.
  const targets = [
    ...nodes.filter((node) => frameIds.has(node.id) || node.id === 'lens-bar'),
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
