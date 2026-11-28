import { readFileSync } from 'node:fs';
import { expandApplicationHtml } from '../build/application-html.js';
import { readStylesheet } from './testSupport/readStylesheet.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ancestorsOf,
  customProperties,
  resolveVars,
  rules,
  winners,
} from './testSupport/cssCascade.mjs';

const css = readStylesheet(new URL('../style.css', import.meta.url));
const authors = rules(css);
const vars = customProperties(authors);

function assertRing(rule, { important = false } = {}) {
  const outline = /outline:\s*2px\s+solid\s+([^;]+);/.exec(rule);
  assert.ok(outline, 'two-pixel solid outline exists');
  const value = outline[1].trim();
  if (important) assert.match(value, /!important$/);
  assert.equal(
    resolveVars(value.replace(/\s*!important$/, ''), vars),
    resolveVars('var(--text-1)', vars),
  );
}

function ruleBody(selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `${selector} rule exists`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function ruleText(selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `${selector} rule exists`);
  const close = css.indexOf('}', css.indexOf('{', start));
  return css.slice(start, close + 1);
}

function ruleBodyContaining(selector, declaration) {
  let start = -1;
  while ((start = css.indexOf(selector, start + 1)) >= 0) {
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    const body = css.slice(open + 1, close);
    if (body.includes(declaration)) return body;
  }
  assert.fail(`${selector} rule containing ${declaration} exists`);
}

test('the global keyboard ring survives local active and outline-reset rules', () => {
  const rule = ruleText(':where(\n  button,');
  assertRing(rule, { important: true });
  for (const selector of [
    "[role='button']",
    "[role='radio']",
    "[role='slider']",
    "[role='tab']",
    '[tabindex]',
    'a[href]',
  ])
    assert.ok(rule.includes(selector), `${selector} receives the global ring`);
});

test('Location city, POI, search toggle and search field use an inset ring', () => {
  const rule = ruleText('.location-pill:focus-visible,');
  assert.match(rule, /\.poi-pill:focus-visible/);
  assert.match(rule, /\.search-toggle-btn:focus-visible/);
  assert.match(rule, /#location-search:focus-visible/);
  assert.match(rule, /outline:\s*2px solid var\(--text-primary\)/);
  assert.match(rule, /outline-offset:\s*-3px/);
  for (const selector of [
    '.location-pill {',
    '.poi-pill {',
    '.search-toggle-btn {',
  ]) {
    assert.doesNotMatch(ruleBody(selector), /transition:\s*all\b/);
  }
});

test('Cockpit Display and Radio launcher glyphs have a complete inset ring', () => {
  const html = expandApplicationHtml(
    readFileSync(new URL('../index.html', import.meta.url), 'utf8'),
  );
  for (const id of ['cockpit-display-toggle-btn', 'cockpit-radio-toggle-btn']) {
    const chain = ancestorsOf(html, id);
    chain.find(({ tag }) => tag === 'body').classes.add('cockpit-mode');
    const glyph = chain.at(-1);
    const control = chain.find(({ classes }) =>
      classes.has('cockpit-utility-control'),
    );
    for (const expanded of [false, true]) {
      if (expanded) control.classes.add('is-expanded');
      const focus = winners(glyph, authors, {
        outline: ['width', 'style', 'color'],
        'outline-width': ['width'],
        'outline-style': ['style'],
        'outline-color': ['color'],
        'outline-offset': ['offset'],
      });
      const reason = `${id} (${expanded ? 'expanded' : 'collapsed'})`;
      const color = resolveVars('var(--text-1)', vars);
      const widthPattern = /^2px(?: |$)/;
      const stylePattern = /(?:^| )solid(?: |$)/;
      assert.match(focus.width?.decl.value ?? '', widthPattern, reason);
      assert.match(focus.style?.decl.value ?? '', stylePattern, reason);
      assert.ok(
        resolveVars(focus.color?.decl.value ?? '', vars).endsWith(color),
        reason,
      );
      assert.equal(focus.offset?.decl.value, '-3px', reason);
    }
  }
});

test('focusable controls do not animate the global outline', () => {
  for (const selector of [
    '.panel-collapse-btn {',
    '#top-center-actions button {',
    '.kit-chip {',
    '.kit-chip.pick {',
    '.data-toggle-chip:not(:where(.kit-chip)) {',
    '.scene-btn {',
    '.scene-shot-btn {',
  ]) {
    assert.doesNotMatch(
      ruleBody(selector),
      /transition:\s*all\b/,
      `${selector} must leave the focus outline immediate`,
    );
  }
});

test('opening a dock popover makes its controls keyboard-reachable immediately', () => {
  const base = ruleBodyContaining(
    '#command-dock .dock-popover-content {',
    'visibility: hidden',
  );
  assert.match(base, /visibility\s+0s\s+linear\s+180ms/);
  const open = ruleText(
    '#command-dock #location-bar:not(.collapsed) .dock-popover-content,',
  );
  assert.match(open, /transition-delay:\s*0s/);
});
