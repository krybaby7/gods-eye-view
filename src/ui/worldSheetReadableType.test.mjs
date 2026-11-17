import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { expandApplicationHtml } from '../../build/application-html.js';
import { readStylesheet } from '../testSupport/readStylesheet.mjs';
import {
  ancestorsOf,
  customProperties,
  modelNode,
  resolveVars,
  rules,
  winners,
} from '../testSupport/cssCascade.mjs';
import { createFakeDocument } from '../testSupport/fakeDocument.mjs';
import { renderExposure } from './worldEnergyPanels.js';
import { renderRelationsTab } from './worldRelationsTab.js';
import { renderAssetsTab } from './worldAssetPanels.js';
import { renderPeopleTab } from './worldPeopleTab.js';
import { renderLiveFlagPanel } from './worldLiveFlagPanel.js';
import { renderScoreWords } from './worldScoreWords.js';
import { createWorldPanel } from './worldPanel.js';

// Model the sheet's actual ancestors; this resolver is not a browser and treats
// media queries as active. Browser layout remains a separate gate.
const css = readStylesheet(new URL('../../style.css', import.meta.url));
const sheets = [
  'world-phase-2.css',
  'world-phase-3.css',
  'world-phase-4.css',
  'world-phase-5.css',
  'world-phase-6.css',
  'world-words.css',
];
const later = sheets
  .map((name) =>
    readFileSync(new URL(`./styles/${name}`, import.meta.url), 'utf8'),
  )
  .join('\n');
const orders = [rules(css + '\n' + later), rules(later + '\n' + css)];
const html = expandApplicationHtml(
  readFileSync(new URL('../../index.html', import.meta.url), 'utf8'),
);
let parent = null;
let body;
for (const { tag, attrs } of ancestorsOf(html, 'world-sheet-content')) {
  const actual = new Map(attrs);
  if (tag === 'body') {
    actual.set('class', `${actual.get('class') ?? ''} gev-frame`.trim());
    actual.set('data-today', 'open');
    actual.set('data-sheet', 'open');
  }
  if (actual.get('id') === 'world-character-sheet') actual.delete('hidden');
  parent = modelNode(tag, actual, parent);
  if (tag === 'body') body = parent;
}
const sheet = parent;
const FONT = {
  font: ['font-size', 'font-family'],
  'font-size': ['font-size'],
  'font-family': ['font-family'],
  'text-transform': ['text-transform'],
};
function typeOf(className, list, parent = sheet) {
  const vars = customProperties(list);
  const tag = className === 'world-control' ? 'button' : 'span';
  const node = modelNode(tag, [['class', className]], parent);
  const won = winners(node, list, FONT);
  const get = (prop) => won[prop] && resolveVars(won[prop].decl.value, vars);
  const fontSize = get('font-size');
  assert.ok(fontSize, `${className} has explicit font size`);
  const match = /([\d.]+)(px|rem)(?:\s*\/|\b)/.exec(fontSize);
  assert.ok(match, `${className}: unrecognised font size ${fontSize}`);
  let family = get('font-family');
  for (let up = parent; !family && up; up = up.parent) {
    const inherited = winners(up, list, FONT)['font-family'];
    if (inherited) family = resolveVars(inherited.decl.value, vars);
  }
  return {
    size: Number(match[1]) * (match[2] === 'rem' ? 16 : 1),
    family: family ?? '',
    transform: get('text-transform') ?? 'none',
  };
}

for (const [name, min] of [
  ['world-control', 12],
  ['world-detail', 13],
  ['world-flag', 12],
  ['world-person-role', 12],
  ['world-portrait-credit', 12],
  ['world-person-unavailable', 13],
  ['world-person-account', 12],
  ['world-live-evidence', 13],
]) {
  test(`${name} text stays readable and uses a proportional face`, () => {
    for (const list of orders) {
      const type = typeOf(name, list);
      assert.ok(type.size >= min, `${name}: ${type.size}px is below ${min}px`);
      assert.doesNotMatch(type.family, /mono|consolas|courier/i);
      assert.notEqual(
        type.transform,
        'uppercase',
        `${name} keeps sentence case`,
      );
    }
  });
}

test('the FAO banner uses readable proportional type', () => {
  for (const list of orders) {
    const type = typeOf('world-live-fao world-board-hud', list, body);
    assert.ok(type.size >= 13, `banner is ${type.size}px`);
    assert.doesNotMatch(type.family, /mono|consolas|courier/i);
  }
});

function resolvedType(node, list, inherited) {
  const vars = customProperties(list);
  const won = winners(node, list, FONT);
  const base = ['button', 'input', 'select', 'textarea'].includes(node.tag)
    ? { size: 13.333, family: 'system-ui', transform: inherited.transform }
    : { ...inherited };
  for (const prop of ['font-size', 'font-family', 'text-transform']) {
    const decl = won[prop]?.decl;
    if (!decl) continue;
    const value = resolveVars(decl.value, vars).trim();
    if (['inherit', 'unset'].includes(value)) {
      base[
        prop === 'font-size'
          ? 'size'
          : prop === 'font-family'
            ? 'family'
            : 'transform'
      ] =
        inherited[
          prop === 'font-size'
            ? 'size'
            : prop === 'font-family'
              ? 'family'
              : 'transform'
        ];
    } else if (prop === 'font-size') {
      const m = /([\d.]+)(px|rem|em|%)(?:\s*\/|\b)/.exec(value);
      assert.ok(m, `cannot resolve font size ${value}`);
      base.size =
        Number(m[1]) *
        { px: 1, rem: 16, em: inherited.size, '%': inherited.size / 100 }[m[2]];
    } else if (prop === 'font-family') {
      base.family =
        decl.prop === 'font'
          ? value.replace(/^.*?[\d.]+(?:px|rem|em|%)(?:\s*\/\s*[^\s]+)?\s+/, '')
          : value;
    } else base.transform = value;
  }
  return base;
}

function renderedTypes(fake, list) {
  let type = { size: 16, family: 'serif', transform: 'none' };
  const chain = [];
  for (let node = sheet; node; node = node.parent) chain.unshift(node);
  for (const node of chain) type = resolvedType(node, list, type);
  const result = [];
  function walk(element, parent, inherited) {
    const node = modelNode(
      element.tagName.toLowerCase(),
      element.attributes,
      parent,
    );
    const own = resolvedType(node, list, inherited);
    const text = element.childNodes
      .filter((child) => child.nodeType === 3)
      .map((child) => child.data)
      .join('')
      .trim();
    if (text)
      result.push({ text, tag: node.tag, classes: [...node.classes], ...own });
    for (const child of element.children) walk(child, node, own);
  }
  walk(fake, sheet, type);
  return result;
}

test('rendered board tabs and evidence keep readable text through the real sheet ancestry', async () => {
  const document = createFakeDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const element = createElement(tag);
    Object.defineProperty(element, 'childElementCount', {
      get: () => element.children.length,
    });
    return element;
  };
  const snapshot = {
    selected: 'IND',
    countryIndex: [
      { iso3: 'IND', name: 'India' },
      { iso3: 'PAK', name: 'Pakistan' },
    ],
    features: {
      'relations-ucdp': {
        relations: [{ id: 'r1', type: 'alliance', from: 'IND', to: 'PAK' }],
      },
      wikidata: {
        actors: [
          {
            id: 'Q1',
            kind: 'person',
            country: 'IND',
            role: 'foreign-minister',
            name: 'A Person',
            accounts: { website: 'https://example.org' },
          },
        ],
      },
    },
  };
  const context = {
    document,
    snapshot,
    sheetModel: { iso3: 'IND' },
    openCard() {},
    getDetail: async () => ({
      rows: [
        {
          id: 'a1',
          name: 'A facility',
          type: 'port',
          locatedIn: 'IND',
          status: 'operating',
        },
      ],
    }),
  };
  const assets = renderAssetsTab(context);
  const trees = [
    ['Exposure', renderExposure(context)],
    ['Relations', renderRelationsTab({ ...context, getDetail: undefined })],
    ['Assets', assets],
    ['People', renderPeopleTab({ ...context, getDetail: undefined })],
    [
      'Live flags',
      renderLiveFlagPanel(document, [
        {
          label: 'A dated flag',
          date: '2026-11-17',
          source: 'https://example.org',
          sourceName: 'Source',
        },
      ]),
    ],
    [
      'Score explanation',
      renderScoreWords(document, {
        slot: 'C1',
        words: {
          meaning: 'A sentence describing the score.',
          world: { sentence: 'This score is below the median.', position: 0.2 },
          trend: { sentence: 'The score rose over time.' },
        },
      }),
    ],
  ];
  await Promise.resolve();
  await Promise.resolve();
  const classes = (name) =>
    renderedTypes(
      trees.find(([label]) => label === name)[1],
      orders[0],
    ).flatMap((item) => item.classes);
  for (const [name, required] of [
    ['People', ['world-person-role', 'world-person-account']],
    ['Assets', ['world-asset-select']],
  ]) {
    const found = classes(name);
    for (const expected of required)
      assert.ok(
        found.includes(expected),
        `${name} fixture includes ${expected}`,
      );
  }
  for (const [name, tree] of trees) {
    assert.ok(tree, `${name} rendered`);
    for (const list of orders) {
      const text = renderedTypes(tree, list);
      assert.ok(text.length > 0, `${name} has text`);
      for (const item of text) {
        const label = `${name}: ${item.tag}.${item.classes.join('.')} “${item.text}”`;
        assert.ok(item.size >= 12, `${label} is ${item.size}px`);
        if (
          (item.tag === 'p' && !item.classes.includes('world-energy-status')) ||
          item.tag === 'summary'
        )
          assert.ok(
            item.size >= 13,
            `${label} is reading text at ${item.size}px`,
          );
        assert.doesNotMatch(
          item.family,
          /mono|consolas|courier/i,
          `${label} is prose or a label`,
        );
        assert.notEqual(
          item.transform,
          'uppercase',
          `${label} keeps sentence case`,
        );
      }
    }
  }
});

test('rendered Condition and Strength distinguish numeric scores from Unknown', (t) => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  t.after(() => delete globalThis.ResizeObserver);
  const document = createFakeDocument();
  const make = (id) => {
    const node = document.createElement('div');
    node.setAttribute('id', id);
    document.body.append(node);
    return node;
  };
  const bar = make('world-lens-bar');
  const options = document.createElement('div');
  options.className = 'world-lens-options';
  bar.append(options);
  const byId = document.getElementById;
  document.getElementById = (id) => byId(id) ?? make(id);
  document.documentElement = { style: { removeProperty() {} } };
  const load = (name) =>
    JSON.parse(
      readFileSync(
        new URL(`../../public/world/${name}.json`, import.meta.url),
        'utf8',
      ),
    );
  const snapshot = {
    enabled: true,
    lenses: [],
    indicators: load('indicators'),
    sources: load('sources'),
    countryIndex: [],
    features: {},
    selected: 'USA',
    countries: {
      USA: {
        name: 'United States',
        condition: { slot: 'C5', score: 16 },
        coverage: { known: 2, total: 18 },
        slots: {
          C5: { score: 16, period: '2026', observation: { value: 130.8 } },
          S1: { score: 38, period: '2026', observation: { value: 1 } },
        },
      },
    },
  };
  let listener;
  const panel = createWorldPanel({
    document,
    layer: {
      getSnapshot: () => snapshot,
      subscribe: (fn) => {
        listener = fn;
        return () => {};
      },
      getDetail: async () => null,
    },
  });
  t.after(() => panel.destroy());
  listener(snapshot);
  const tabs = document.getElementById('world-sheet-tabs');
  const content = document.getElementById('world-sheet-content');
  for (const tab of ['condition', 'strength']) {
    const choice = tabs.children.find((node) => node.dataset.worldTab === tab);
    tabs.dispatchEvent({ type: 'click', target: { closest: () => choice } });
    for (const list of orders) {
      const all = content.children.flatMap((node) => renderedTypes(node, list));
      assert.ok(
        all.some((item) => item.classes.includes('world-row-number')),
        `${tab} has a numeric score`,
      );
      assert.ok(
        all.some(
          (item) =>
            item.classes.includes('world-row-score') && item.text === 'Unknown',
        ),
        `${tab} has an unknown score`,
      );
      for (const item of all) {
        const label = `${tab}: ${item.classes.join('.')} ${item.text}`;
        assert.ok(item.size >= 12, `${label} at ${item.size}px`);
        const numeric =
          item.classes.includes('world-row-number') ||
          item.classes.includes('world-slot-id');
        if (numeric) assert.match(item.family, /mono|consolas|courier/i, label);
        else {
          assert.doesNotMatch(item.family, /mono|consolas|courier/i, label);
          assert.notEqual(item.transform, 'uppercase', label);
        }
        if (item.classes.includes('world-detail'))
          assert.ok(item.size >= 13, `${label} at ${item.size}px`);
      }
    }
  }
});
