import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelNode, rules, winners } from '../testSupport/cssCascade.mjs';

// Follow the actual entry-point order, so older layer rules can compete with
// kit rules exactly as they do in the application. This is a cascade model;
// browser capture separately verifies computed pixels and layout.
const root = new URL('../../', import.meta.url);
const entry = readFileSync(new URL('style.css', root), 'utf8');
const css = [...entry.matchAll(/@import\s+['"]([^'"]+\.css)['"]/g)]
  .map((match) => readFileSync(new URL(match[1], root), 'utf8'))
  .join('\n');
const sheet = rules(css);
const properties = Object.fromEntries(
  [
    'width',
    'height',
    'min-width',
    'min-height',
    'background',
    'border-color',
    'opacity',
    'left',
    'right',
  ].map((key) => [key, [key]]),
);
const menu = modelNode('section', [['class', 'layers-menu']], null);
const row = modelNode('div', [['class', 'data-toggle-row']], menu);
const button = (checked, extra = '') =>
  modelNode(
    'button',
    [
      ['class', `data-toggle-btn kit-switch ${extra}`],
      ['aria-checked', String(checked)],
    ],
    row,
  );
const won = (element, list = sheet) => winners(element, list, properties);

test('layers switch retains kit dimensions and visible checked state through the app cascade', () => {
  const off = won(button(false));
  const on = won(button(true, 'active'));
  assert.equal(off.width?.decl.value, '34px');
  assert.equal(off.height?.decl.value, '20px');
  assert.equal(off.background?.decl.value, 'var(--surface-3)');
  assert.equal(on.background?.decl.value, 'var(--accent)');
  assert.equal(on['border-color']?.decl.value, 'var(--accent)');
  const pseudo = sheet.map((rule) => ({
    ...rule,
    selectors: rule.selectors
      .filter((s) => s.includes('::after'))
      .map((s) => s.replace('::after', '')),
  }));
  assert.equal(won(button(true, 'active'), pseudo).right?.decl.value, '2px');
  assert.equal(won(button(true, 'active'), pseudo).left?.decl.value, 'auto');
});
