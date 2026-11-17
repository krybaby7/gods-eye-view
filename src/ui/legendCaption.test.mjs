import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStylesheet } from '../testSupport/readStylesheet.mjs';
import {
  customProperties,
  modelNode,
  resolveVars,
  rules,
  winners,
} from '../testSupport/cssCascade.mjs';

const css = readStylesheet(new URL('../../style.css', import.meta.url));
const list = rules(css),
  vars = customProperties(list);
const FONT = {
  font: ['font-size', 'line-height'],
  'font-size': ['font-size'],
  'line-height': ['line-height'],
};
const legend = (classes, attrs = []) =>
  modelNode('div', [['class', classes], ...attrs], null);
function type(el) {
  const result = winners(el, list, FONT);
  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => [
      key,
      resolveVars(value.decl.value, vars),
    ]),
  );
}
test('normal and dense legend use the shared 12/16 caption', () => {
  for (const attrs of [[], [['data-dense', '']]]) {
    const result = type(legend('frame-legend', attrs));
    assert.match(
      result['font-size'] ?? '',
      /12px\s*\/\s*16px/,
      JSON.stringify(result),
    );
    assert.match(
      result['line-height'] ?? '',
      /12px\s*\/\s*16px|^16px$/,
      JSON.stringify(result),
    );
  }
});
test('whole legend popover uses the shared caption type', () => {
  const result = type(legend('frame-legend-popup'));
  assert.match(
    result['font-size'] ?? '',
    /12px\s*\/\s*16px/,
    JSON.stringify(result),
  );
  assert.match(
    result['line-height'] ?? '',
    /12px\s*\/\s*16px|^16px$/,
    JSON.stringify(result),
  );
});
