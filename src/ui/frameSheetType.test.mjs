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
import { renderOverviewTab } from './worldOverview.js';
import { worldSheetTabs } from './worldPanel.js';

const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');
const appCss = readStylesheet(new URL('../../style.css', import.meta.url));
const wordsCss = read('./styles/world-words.css');
const html = expandApplicationHtml(read('../../index.html'));

// ── Style sheets ──

function splitTop(text, delimiter) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === delimiter && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Style rules in source order; @media and @supports count as always on. */
function rules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  (function walk(from, to) {
    let at = from;
    while (at < to) {
      const open = src.indexOf('{', at);
      const semi = src.indexOf(';', at);
      if (open < 0 || open >= to) return;
      if (
        semi >= 0 &&
        semi < open &&
        src.slice(at, semi).trim().startsWith('@')
      ) {
        at = semi + 1;
        continue;
      }
      const head = src.slice(at, open).trim();
      let depth = 1;
      let close = open + 1;
      for (; close < to && depth; close += 1) {
        if (src[close] === '{') depth += 1;
        else if (src[close] === '}') depth -= 1;
      }
      const inner = [open + 1, close - 1];
      if (/^@(media|supports|layer)\b/.test(head)) walk(...inner);
      else if (!head.startsWith('@')) {
        const decls = splitTop(src.slice(...inner), ';').flatMap((text) => {
          const colon = text.indexOf(':');
          if (colon < 0) return [];
          const value = text.slice(colon + 1).trim();
          return [
            {
              prop: text.slice(0, colon).trim().toLowerCase(),
              value: value.replace(/\s*!important$/i, ''),
              important: /!important$/i.test(value),
            },
          ];
        });
        out.push({ selectors: splitTop(head, ','), decls });
      }
      at = close;
    }
  })(0, src.length);
  return out;
}

// ── Selectors ──

const STATES =
  /^:(hover|focus|focus-visible|focus-within|active|visited|link|checked|disabled|enabled|empty|first-child|last-child|only-child|first-of-type|last-of-type|nth-child\(.*\)|nth-of-type\(.*\)|nth-last-child\(.*\)|placeholder-shown|target|open|popover-open|modal|fullscreen|-webkit-[\w-]+|-moz-[\w-]+|root|scope|default|indeterminate|invalid|valid|required|optional|read-only|read-write|lang\(.*\)|dir\(.*\)|has\(.*\))$/;

/** A complex selector as compounds and the combinators between them. */
function complex(selector) {
  const tokens = [];
  let depth = 0;
  let current = '';
  const flush = () => {
    if (current.trim()) tokens.push(current.trim());
    current = '';
  };
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i];
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (depth === 0 && /[\s>+~]/.test(char)) {
      flush();
      if (char !== ' ' && char !== '\n' && char !== '\t') tokens.push(char);
      else if (tokens.length && !['>', '+', '~', ' '].includes(tokens.at(-1)))
        tokens.push(' ');
      continue;
    }
    current += char;
  }
  flush();
  const cleaned = [];
  for (const token of tokens) {
    if (['>', '+', '~'].includes(token) && cleaned.at(-1) === ' ')
      cleaned.pop();
    cleaned.push(token);
  }
  while (cleaned.at(-1) === ' ') cleaned.pop();
  return cleaned;
}

/** The simple selectors of one compound. */
function simples(compound) {
  const out = [];
  let i = 0;
  while (i < compound.length) {
    let j = i + 1;
    if (compound[i] === '[') j = compound.indexOf(']', i) + 1;
    else {
      if (compound[i] === ':' && compound[i + 1] === ':') j += 1;
      while (j < compound.length && !/[.#[:]/.test(compound[j])) {
        if (compound[j] === '(') {
          let depth = 1;
          j += 1;
          while (depth) {
            if (compound[j] === '(') depth += 1;
            if (compound[j] === ')') depth -= 1;
            j += 1;
          }
        } else j += 1;
      }
    }
    out.push(compound.slice(i, j));
    i = j;
  }
  return out;
}

const argsOf = (simple) =>
  splitTop(simple.slice(simple.indexOf('(') + 1, -1), ',');

/**
 * Whether a compound matches. A state the test cannot know (hover, focus,
 * :has) counts as on where that widens what applies, and as off inside :not.
 */
function compoundMatches(compound, el, wide) {
  return simples(compound).every((simple) => {
    if (simple === '*') return true;
    if (simple.startsWith('::')) return false;
    if (simple.startsWith('#')) return el.id === simple.slice(1);
    if (simple.startsWith('.')) return el.classes.has(simple.slice(1));
    if (simple.startsWith('[')) {
      const m = /^\[([\w-]+)(?:([~^$*|]?=)['"]?([^'"\]]*)['"]?)?\]$/.exec(
        simple,
      );
      assert.ok(m, `attribute selector the test cannot read: ${simple}`);
      const value = el.attrs.get(m[1]);
      if (value === undefined) return false;
      if (!m[2]) return true;
      const want = m[3];
      return {
        '=': value === want,
        '~=': value.split(/\s+/).includes(want),
        '^=': value.startsWith(want),
        '$=': value.endsWith(want),
        '*=': value.includes(want),
        '|=': value === want || value.startsWith(`${want}-`),
      }[m[2]];
    }
    if (/^:(is|where|matches|-webkit-any)\(/.test(simple))
      return argsOf(simple).some((arg) => selectorMatches(arg, el, wide));
    if (simple.startsWith(':not('))
      return !argsOf(simple).some((arg) => selectorMatches(arg, el, !wide));
    if (STATES.test(simple)) return wide;
    if (simple.startsWith(':')) return wide;
    return el.tag === simple.toLowerCase();
  });
}

function selectorMatches(selector, el, wide = true) {
  const parts = complex(selector);
  const from = (index, node) => {
    if (!compoundMatches(parts[index], node, wide)) return false;
    if (index === 0) return true;
    const combinator = parts[index - 1];
    if (combinator === '>')
      return Boolean(node.parent) && from(index - 2, node.parent);
    if (combinator === ' ') {
      for (let up = node.parent; up; up = up.parent)
        if (from(index - 2, up)) return true;
      return false;
    }
    // A sibling the test does not model: it may be there, sharing the parent.
    if (!wide) return false;
    return index - 2 === 0 || continueFrom(index - 2, node);
  };
  const continueFrom = (index, node) => {
    const combinator = parts[index - 1];
    if (combinator === '>')
      return Boolean(node.parent) && from(index - 2, node.parent);
    if (combinator === ' ') {
      for (let up = node.parent; up; up = up.parent)
        if (from(index - 2, up)) return true;
      return false;
    }
    return wide;
  };
  return from(parts.length - 1, el);
}

function specificity(selector) {
  const total = [0, 0, 0];
  const add = (s) => s.forEach((n, i) => (total[i] += n));
  for (const part of complex(selector)) {
    if ([' ', '>', '+', '~'].includes(part)) continue;
    for (const simple of simples(part)) {
      if (simple === '*' || simple.startsWith(':where(')) continue;
      if (/^:(is|matches|not|has)\(/.test(simple)) {
        add(
          argsOf(simple)
            .map(specificity)
            .reduce((a, b) => (compare(a, b) >= 0 ? a : b), [0, 0, 0]),
        );
      } else if (simple.startsWith('#')) total[0] += 1;
      else if (simple.startsWith('::')) total[2] += 1;
      else if (/^[.[:]/.test(simple)) total[1] += 1;
      else total[2] += 1;
    }
  }
  return total;
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// ── Values ──

function customProperties(list) {
  const map = new Map();
  for (const rule of list)
    if (rule.selectors.includes(':root'))
      for (const { prop, value } of rule.decls)
        if (prop.startsWith('--')) map.set(prop, value);
  return map;
}

function resolveVars(value, vars, depth = 0) {
  assert.ok(depth < 10, `custom properties nest too deep: ${value}`);
  const next = value.replace(
    /var\((--[\w-]+)(?:,\s*([^()]*))?\)/g,
    (_, name, fallback) => {
      const found = vars.get(name) ?? fallback;
      assert.ok(found !== undefined, `undefined custom property ${name}`);
      return found;
    },
  );
  return next === value ? value : resolveVars(next, vars, depth + 1);
}

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

// A browser's own type: buttons and inputs do not inherit the page's font.
const UA = [
  {
    selectors: ['button', 'input', 'select', 'textarea'],
    decls: [
      { prop: 'font', value: '400 13.333px system-ui', important: false },
    ],
  },
];

function computeFonts(element, list, vars, parent) {
  const winners = {};
  list.forEach((rule, order) => {
    for (const selector of rule.selectors) {
      if (!selectorMatches(selector, element)) continue;
      const spec = specificity(selector);
      for (const decl of rule.decls) {
        const props =
          decl.prop === 'font'
            ? ['font-size', 'font-family']
            : ['font-size', 'font-family'].includes(decl.prop)
              ? [decl.prop]
              : [];
        for (const prop of props) {
          const best = winners[prop];
          const beats =
            !best ||
            Number(decl.important) - Number(best.decl.important) > 0 ||
            (decl.important === best.decl.important &&
              (compare(spec, best.spec) > 0 ||
                (compare(spec, best.spec) === 0 && order >= best.order)));
          if (beats) winners[prop] = { decl, spec, order, selector };
        }
      }
    }
  });
  const size = winners['font-size']
    ? apply(winners['font-size'].decl, parent, vars).size
    : parent.size;
  const family = winners['font-family']
    ? apply(winners['font-family'].decl, parent, vars).family
    : parent.family;
  return { size, family, by: winners['font-size']?.selector ?? 'inherited' };
}

// ── The sheet's ancestors, from the application's HTML ──

function ancestorsOf(id) {
  const VOID = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'source',
    'track',
    'wbr',
  ]);
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const stack = [];
  for (const m of body.matchAll(
    /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g,
  )) {
    const [, closing, rawTag, attrText, selfClosing] = m;
    const tag = rawTag.toLowerCase();
    if (closing) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
      continue;
    }
    const attrs = new Map();
    for (const a of attrText.matchAll(
      /([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g,
    ))
      attrs.set(a[1].toLowerCase(), (a[2] ?? '').replace(/^["']|["']$/g, ''));
    const node = { tag, attrs };
    if (attrs.get('id') === id) return [...stack, node];
    if (!selfClosing && !VOID.has(tag)) stack.push(node);
  }
  throw new Error(`#${id} is not in the application's HTML`);
}

function modelNode(tag, attrs, parent) {
  const map = new Map(attrs);
  return {
    tag,
    id: map.get('id') ?? '',
    classes: new Set((map.get('class') ?? '').split(/\s+/).filter(Boolean)),
    attrs: map,
    parent,
  };
}

function sheetChain() {
  const chain = ancestorsOf('world-sheet-content');
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
    tabs: worldSheetTabs().map(({ id, label }) => ({ id, label })),
    selectTab: () => {},
  });
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
