import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  modelNode,
  rules,
  winners,
  customProperties,
  resolveVars,
} from '../testSupport/cssCascade.mjs';

const read = (name) => {
  const url = new URL(`./styles/${name}.css`, import.meta.url);
  return existsSync(url) ? readFileSync(url, 'utf8') : '';
};
const properties = Object.fromEntries(
  [
    'display',
    'background',
    'background-color',
    'border',
    'border-style',
    'border-color',
    'border-radius',
    'box-shadow',
    'font',
    'font-size',
    'line-height',
    'color',
    'opacity',
    'width',
    'height',
    'min-height',
    'left',
    'right',
    'outline',
    'padding',
    'overflow',
  ].map((p) => [p, [p]]),
);
const node = (classes, extra = []) =>
  modelNode('button', [['class', classes], ...extra], null);
// The shared cascade model treats dynamic pseudo-classes as always active. Map
// these states to model attributes so base, hover, disabled and focus differ.
const sheet = () =>
  rules(read('foundation') + '\n' + read('kit')).map((rule) => ({
    ...rule,
    selectors: rule.selectors.map((selector) =>
      selector
        .replace(/:hover\b/g, '[data-hover]')
        .replace(/:disabled\b/g, '[disabled]')
        .replace(/:focus-visible\b/g, '[data-focus]')
        .replace(/:checked\b/g, '[checked]'),
    ),
  }));
const won = (el, list = sheet()) => winners(el, list, properties);
const hasAny = (result, keys) => keys.some((key) => result[key]);

test('each kit primitive supplies its own surface or readable treatment', () => {
  for (const [classes, keys] of [
    ['kit-pop', ['background', 'background-color']],
    ['kit-panel', ['background', 'background-color']],
    ['kit-sec', ['padding', 'border']],
    ['kit-sec-h', ['font']],
    ['kit-btn', ['font', 'height']],
    ['kit-iconbtn', ['width', 'height']],
    ['kit-seg', ['background', 'background-color']],
    ['kit-seg-item', ['height', 'font']],
    ['kit-switch', ['width', 'height']],
    ['kit-chip', ['font', 'height']],
    ['kit-dl', ['display', 'font']],
    ['kit-card', ['background', 'background-color']],
    ['kit-note', ['font', 'color']],
    ['kit-empty', ['font', 'color']],
  ])
    assert.ok(
      hasAny(won(node(classes)), keys),
      `${classes} has no expected treatment`,
    );
});

test('hidden kit primitives stay hidden despite their display rules', () => {
  for (const classes of [
    'kit-pop',
    'kit-panel',
    'kit-sec',
    'kit-sec-h',
    'kit-btn',
    'kit-iconbtn',
    'kit-seg',
    'kit-seg-item',
    'kit-switch',
    'kit-chip',
    'kit-dl',
    'kit-card',
    'kit-note',
    'kit-empty',
  ]) {
    const display =
      won(node(classes, [['hidden', '']])).display?.decl.value ?? 'none';
    assert.equal(display, 'none', classes);
  }
});

test('unavailable and dim states convey their specified opacity', () => {
  for (const [classes, attributes, expected] of [
    ['kit-switch na', [], '0.4'],
    ['kit-btn dim', [], '0.45'],
    ['kit-btn', [['aria-disabled', 'true']], '0.4'],
  ]) {
    const opacity = won(node(classes, attributes)).opacity?.decl.value;
    if (attributes.length)
      assert.ok(opacity && Number(opacity) < 1, 'aria-disabled');
    else assert.equal(Number(opacity), Number(expected), classes);
  }
});

test('selected segmented and pick controls have a selected surface', () => {
  for (const classes of ['kit-seg-item sel', 'kit-chip pick on']) {
    const result = won(node(classes));
    const background =
      result.background?.decl.value ?? result['background-color']?.decl.value;
    assert.equal(background, 'var(--surface-3)', classes);
    assert.equal(result.color?.decl.value, 'var(--text-1)', classes);
    const base = won(node(classes.replace(/ (?:sel|on)$/, '')));
    assert.notEqual(
      base.background?.decl.value ?? base['background-color']?.decl.value,
      background,
      `${classes} base`,
    );
  }
});

test('claim variants retain distinct fact, interpretation and forecast edges', () => {
  const edges = ['fact', 'interp', 'forecast'].map((variant) => {
    const result = won(node(`kit-chip ${variant}`));
    return result['border-style']?.decl.value ?? result.border?.decl.value;
  });
  assert.ok(edges.every(Boolean), `missing edges: ${edges}`);
  assert.equal(new Set(edges).size, 3, `claim edges must differ: ${edges}`);
});

test('kit text controls use readable shared type', () => {
  const list = sheet(),
    vars = customProperties(list);
  for (const classes of [
    'kit-btn',
    'kit-sec-h',
    'kit-chip',
    'kit-note',
    'kit-empty',
  ]) {
    const value = won(node(classes), list).font?.decl.value;
    assert.ok(value, `${classes} font`);
    const resolved = resolveVars(value, vars);
    const size = /\b(\d+(?:\.\d+)?)px/.exec(resolved);
    assert.ok(size && Number(size[1]) >= 12, `${classes}: ${resolved}`);
    assert.doesNotMatch(resolved, /monospace/i, classes);
  }
});

test('native and ARIA disabled controls receive disabled styling', () => {
  for (const attributes of [[['disabled', '']], [['aria-disabled', 'true']]]) {
    const result = won(node('kit-btn', attributes));
    assert.ok(
      Number(result.opacity?.decl.value) < 1,
      JSON.stringify(attributes),
    );
  }
});

test('control dimensions match the shared kit contract', () => {
  for (const [classes, expected] of [
    ['kit-btn', { 'min-height': '34px' }],
    ['kit-iconbtn', { width: '34px', height: '34px' }],
    ['kit-seg-item', { 'min-height': '28px' }],
    ['kit-chip', { 'min-height': '22px' }],
    ['kit-chip pick', { 'min-height': '28px' }],
    ['kit-switch', { width: '34px', height: '20px' }],
  ]) {
    const result = won(node(classes));
    for (const [property, value] of Object.entries(expected))
      assert.equal(
        result[property]?.decl.value,
        value,
        `${classes} ${property}`,
      );
  }
});

test('primary and quiet buttons have their intended surfaces', () => {
  const primary = won(node('kit-btn primary'));
  assert.equal(primary.background?.decl.value, 'var(--accent)');
  assert.equal(primary.color?.decl.value, 'var(--on-accent)');
  assert.equal(
    won(node('kit-btn quiet')).background?.decl.value,
    'transparent',
  );
});

test('switch track and knob change on activation', () => {
  const base = won(node('kit-switch'));
  const on = won(node('kit-switch on'));
  assert.notEqual(base.background?.decl.value, on.background?.decl.value);
  assert.equal(on.background?.decl.value, 'var(--accent)');
  // Model the ::after rules as a separate pseudo-element cascade.
  const pseudo = sheet().map((rule) => ({
    ...rule,
    selectors: rule.selectors
      .filter((s) => s.includes('::after'))
      .map((s) => s.replace('::after', '')),
  }));
  const before = won(node('kit-switch'), pseudo),
    after = won(node('kit-switch on'), pseudo);
  assert.equal(before.width?.decl.value, '14px');
  assert.equal(before.height?.decl.value, '14px');
  assert.equal(after.right?.decl.value, '2px');
  assert.equal(after.left?.decl.value, 'auto');
  assert.equal(after.background?.decl.value, 'var(--on-accent)');
});

test('selected states remain visible on hover and while disabled', () => {
  for (const attributes of [
    [['data-hover', '']],
    [['disabled', '']],
    [['aria-disabled', 'true']],
  ]) {
    const result = won(node('kit-chip pick on', attributes));
    assert.equal(
      result.background?.decl.value,
      'var(--surface-3)',
      JSON.stringify(attributes),
    );
    assert.equal(
      result.color?.decl.value,
      'var(--text-1)',
      JSON.stringify(attributes),
    );
  }
});

test('focus-visible retains foundation outline for kit controls', () => {
  const outline = won(node('kit-btn', [['data-focus', '']])).outline;
  assert.ok(
    outline?.decl.important,
    'focus outline must remain visible and win the cascade',
  );
  assert.notEqual(outline.decl.value, 'none');
});

test('an enabled hovered selected switch keeps the on-accent knob', () => {
  const pseudo = sheet().map((rule) => ({
    ...rule,
    selectors: rule.selectors
      .filter((s) => s.includes('::after'))
      .map((s) => s.replace('::after', '')),
  }));
  for (const [classes, attrs] of [
    ['kit-switch on', [['data-hover', '']]],
    ['kit-switch sel', [['data-hover', '']]],
    [
      'kit-switch',
      [
        ['data-hover', ''],
        ['aria-checked', 'true'],
      ],
    ],
    [
      'kit-switch',
      [
        ['data-hover', ''],
        ['aria-pressed', 'true'],
      ],
    ],
  ])
    assert.equal(
      won(node(classes, attrs), pseudo).background?.decl.value,
      'var(--on-accent)',
      `${classes} ${JSON.stringify(attrs)}`,
    );
  assert.equal(
    won(node('kit-switch', [['data-hover', '']]), pseudo).background?.decl
      .value,
    'var(--text-1)',
  );
});
