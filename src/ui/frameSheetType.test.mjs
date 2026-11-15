// The Overview tab keeps its type inside the frame's sheet (roadmap 1.2 with
// pull request 27). The real Overview is rendered, placed under the sheet's
// real ancestors from the application's HTML, and every font declaration in
// the application's style sheets is resolved for each of its elements by the
// cascade: importance, specificity, then source order, with inheritance and a
// browser's own font for buttons. world-words.css arrives through a module
// import, so its place against style.css is not fixed; both orders must agree.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { expandApplicationHtml } from '../../build/application-html.js';
import { createFakeDocument } from '../testSupport/fakeDocument.mjs';
import { readStylesheet } from '../testSupport/readStylesheet.mjs';
import {
  ancestorsOf,
  customProperties,
  modelNode,
  resolveVars,
  rules,
  winners,
} from '../testSupport/cssCascade.mjs';
import { renderOverviewTab } from './worldOverview.js';
import { worldSheetTabs } from './worldPanel.js';
import phase2 from '../layers/world/phase-2.js';
import phase3 from '../layers/world/phase-3.js';
import phase4 from '../layers/world/phase-4.js';
import phase5 from '../layers/world/phase-5.js';
import phase6 from '../layers/world/phase-6.js';

// The phases the app loads, so each Overview line is a button to its tab.
const phaseTabs = [phase2, phase3, phase4, phase5, phase6].flatMap(
  (phase) => phase.tabs ?? [],
);

const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');
const appCss = readStylesheet(new URL('../../style.css', import.meta.url));
const wordsCss = read('./styles/world-words.css');
const html = expandApplicationHtml(read('../../index.html'));

const KEYWORDS = new Set(['inherit', 'unset', 'revert', 'revert-layer']);

function sizePx(token, parentSize) {
  const m = /^([\d.]+)(px|em|rem|%)$/.exec(token);
  assert.ok(m, `a font size the test cannot resolve: ${token}`);
  const n = Number(m[1]);
  return {
    px: n,
    em: n * parentSize,
    rem: n * 16,
    '%': (n / 100) * parentSize,
  }[m[2]];
}

/** Size and family from a font shorthand or longhand, given the parent's. */
function apply(decl, parent, vars) {
  const value = resolveVars(decl.value, vars).trim();
  if (KEYWORDS.has(value)) return { ...parent };
  if (value === 'initial') return { size: 16, family: 'serif' };
  if (decl.prop === 'font-size')
    return { ...parent, size: sizePx(value, parent.size) };
  if (decl.prop === 'font-family') return { ...parent, family: value };
  if (decl.prop === 'font') {
    const tokens = value.split(/\s+/);
    const at = tokens.findIndex((t) => /^[\d.]+(px|em|rem|%)(\/|$)/.test(t));
    assert.ok(at >= 0, `a font shorthand the test cannot read: ${value}`);
    return {
      size: sizePx(tokens[at].split('/')[0], parent.size),
      family: tokens
        .slice(at + 1)
        .join(' ')
        .replace(/^\/\s*\S+\s*/, ''),
    };
  }
  return { ...parent };
}

const FONT = {
  font: ['font-size', 'font-family'],
  'font-size': ['font-size'],
  'font-family': ['font-family'],
};

// A browser's own type: buttons and inputs do not inherit the page's font.
// The browser's origin loses to any author declaration, whatever its weight.
const UA_FONT = { size: 13.333, family: 'system-ui' };
const UA_CONTROLS = new Set(['button', 'input', 'select', 'textarea']);

function computeFonts(element, list, vars, parent) {
  const won = winners(element, list, FONT);
  const base = UA_CONTROLS.has(element.tag) ? UA_FONT : parent;
  const size = won['font-size']
    ? apply(won['font-size'].decl, parent, vars).size
    : base.size;
  const family = won['font-family']
    ? apply(won['font-family'].decl, parent, vars).family
    : base.family;
  return { size, family, by: won['font-size']?.selector ?? 'inherited' };
}

function sheetChain() {
  const chain = ancestorsOf(html, 'world-sheet-content');
  let parent = null;
  const nodes = [];
  for (const { tag, attrs } of chain) {
    const extra = new Map(attrs);
    // What the frame and the board set at run time on an open sheet.
    if (tag === 'body') {
      extra.set('class', `${extra.get('class') ?? ''} gev-frame`.trim());
      extra.set('data-today', 'open');
      extra.set('data-sheet', 'open');
    }
    if (extra.get('id') === 'world-character-sheet') extra.delete('hidden');
    parent = modelNode(tag, extra, parent);
    nodes.push(parent);
  }
  if (nodes[0].tag !== 'html')
    nodes.unshift((nodes[0].parent = modelNode('html', [], null)));
  return nodes;
}

// ── The Overview, rendered ──

const conditionRow = (slot, area, score, kind = 'measured') => ({
  slot,
  area,
  section: 'condition',
  score,
  words: { kind: { kind: score === null ? 'unknown' : kind }, trend: {} },
});

function renderedOverview() {
  const document = createFakeDocument();
  const sheetModel = {
    iso3: 'IND',
    name: 'India',
    disputed: false,
    condition: { score: 24, label: 'Society' },
    rows: [
      conditionRow('C1', 'Governing continuity', 55),
      conditionRow('C2', 'Security and control', 97, 'estimate'),
      conditionRow('C3', 'Essential services', 90),
      conditionRow('C4', 'Household security', 89, 'forecast'),
      conditionRow('C5', 'Fiscal and payment continuity', null),
      conditionRow('C6', 'Societal cooperation', 24),
    ],
  };
  const panel = renderOverviewTab({
    document,
    snapshot: { features: {}, countryIndex: [{ iso3: 'IND', name: 'India' }] },
    sheetModel,
    tabs: worldSheetTabs(phaseTabs).map(({ id, label }) => ({ id, label })),
    selectTab: () => {},
  });
  // Every line opens its tab, so the buttons' type is what is checked.
  assert.deepEqual(
    panel.children.map((line) => line.tagName),
    Array(6).fill('BUTTON'),
  );
  return panel;
}

/** Every element of the Overview that holds text, with its resolved type. */
function overviewType(list) {
  const vars = customProperties(list);
  const chain = sheetChain();
  let fonts = { size: 16, family: 'serif' };
  for (const node of chain) fonts = computeFonts(node, list, vars, fonts);
  const out = [];
  (function walk(fake, parentModel, parentFonts) {
    const node = modelNode(
      fake.tagName.toLowerCase(),
      fake.attributes,
      parentModel,
    );
    const own = computeFonts(node, list, vars, parentFonts);
    if (
      fake.childNodes.some((child) => child.nodeType === 3 && child.data.trim())
    )
      out.push({ classes: [...node.classes], tag: node.tag, ...own });
    for (const child of fake.children) walk(child, node, own);
  })(renderedOverview(), chain.at(-1), fonts);
  return out;
}

const MONO = /mono|consolas|courier|monospace/i;
// Reading text: the line's own sentence and a bar's name. Labels, periods,
// sources and a bar's figure are captions (12 px, nothing smaller).
const READING = ['world-overview-text', 'world-overview-bar-name'];

function checkScale(list, label) {
  const found = overviewType(list);
  assert.ok(
    found.some(({ tag }) => tag === 'span'),
    `${label}: Overview rendered`,
  );
  for (const item of found) {
    const name = `${label}: ${item.tag}.${item.classes.join('.')} (by ${item.by})`;
    assert.ok(item.size >= 12, `${name} is ${item.size}px, below 12`);
    if (item.classes.some((c) => READING.includes(c)))
      assert.ok(item.size >= 13, `${name} is reading text at ${item.size}px`);
    assert.doesNotMatch(item.family, MONO, `${name} is set in monospace`);
  }
  return found;
}

test('the Overview keeps its type scale inside the sheet, whichever style sheet loads last', () => {
  const app = rules(appCss);
  const words = rules(wordsCss);
  const before = checkScale([...words, ...app], 'words first');
  const after = checkScale([...app, ...words], 'words last');
  // The line buttons, their text and the bars render the same either way.
  assert.deepEqual(
    before.map(({ classes, size, family }) => ({ classes, size, family })),
    after.map(({ classes, size, family }) => ({ classes, size, family })),
  );
  const text = after.find(({ classes }) =>
    classes.includes('world-overview-text'),
  );
  assert.equal(text.size, 13);
  const title = after.find(({ classes }) =>
    classes.includes('world-overview-title'),
  );
  assert.equal(title.size, 12);
});

test('a sheet rule that reaches the line buttons is caught', () => {
  // Like the rule the review found (frame.css before round 2), but strong
  // enough to beat the line's own: the sheet's 14 px body type comes through.
  const reset = rules(
    `${appCss}
#world-character-sheet :is(button, input) { font: inherit; }`,
  );
  const found = overviewType([...rules(wordsCss), ...reset]);
  const text = found.find(({ classes }) =>
    classes.includes('world-overview-text'),
  );
  assert.equal(text.size, 14);
  // A rule that sets them in small monospace fails the scale check.
  const small = rules(
    `${appCss}
#world-sheet-body button { font: 600 10px/1.4 var(--font-mono); }`,
  );
  assert.throws(
    () => checkScale([...rules(wordsCss), ...small], 'small'),
    /below 12|monospace/,
  );
});
