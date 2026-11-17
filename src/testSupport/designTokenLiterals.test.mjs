import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSource, compareCensus } from './designTokenLiterals.mjs';

const counts = (source, path = 'src/ui/example.css') =>
  Object.fromEntries(
    scanSource(path, source).map((x) => [x.kind, x.lines.length]),
  );

test('detects literal declarations while allowing balanced token fallbacks and resets', () => {
  assert.deepEqual(
    counts(`.x { color: #fff; background: rgb(1 2 3); font: 12px Arial, sans-serif; border-radius: 4px; box-shadow: 0 1px 2px red; backdrop-filter: blur(2px); }
.y { color: var(--x, rgb(1, 2, 3)); background: color-mix(in srgb, var(--x) 8%, transparent); border-radius: 0; box-shadow: none; }`),
    { color: 3, font: 1, family: 1, radius: 1, shadow: 1, backdrop: 1 },
  );
});

test('recognizes markup and JavaScript style writes without treating prose or IDs as CSS', () => {
  const source = `const label = '#fff'; const path = '/#abc';
const html = \`<div id="fff" style="color: #fff; font-size: 11px" fill="red">#123</div>\`;
el.style.borderRadius = '4px'; el.style.setProperty('box-shadow', '0 1px 2px #fff');
Cesium.Color.fromCssColorString('#123456');`;
  assert.deepEqual(counts(source, 'src/ui/example.js'), {
    color: 3,
    font: 1,
    radius: 1,
    shadow: 1,
    cesium: 1,
  });
});

test('foundation root definitions are exempt but local custom properties count', () => {
  assert.deepEqual(
    counts(
      ':root { --surface: #fff; } .x { --local: #000; }',
      'src/ui/styles/foundation.css',
    ),
    { color: 1 },
  );
});

test('exact ratchet rejects additions, changes, stale and zero rows', () => {
  const actual = [{ path: 'src/a.css', kind: 'color', lines: [1, 2] }];
  assert.equal(
    compareCensus(actual, [{ path: 'src/a.css', kind: 'color', count: 2 }])
      .length,
    0,
  );
  for (const allowed of [
    [],
    [{ path: 'src/a.css', kind: 'color', count: 1 }],
    [{ path: 'src/a.css', kind: 'color', count: 3 }],
    [{ path: 'src/b.css', kind: 'color', count: 1 }],
    [{ path: 'src/a.css', kind: 'color', count: 0 }],
  ])
    assert.ok(compareCensus(actual, allowed).length);
});

test('finds style objects and named colors without scanning comments or unrelated data', () => {
  const source = `// el.style.color = '#fff';
/* Cesium.Color.fromCssColorString('#fff') */
const record = { color: 'red' };
Object.assign(el.style, { color: 'papayawhip', fontFamily: 'Arial', borderRadius: '3px' });`;
  assert.deepEqual(counts(source, 'src/ui/a.js'), {
    color: 1,
    family: 1,
    radius: 1,
  });
});

test('tracks the shared canvas palette as an explicit census exception', () => {
  assert.deepEqual(
    counts(
      "export const DESIGN_COLORS = { '--ramp-0': '#c2410c' };",
      'src/designTokens.js',
    ),
    { palette: 1 },
  );
});

test('zero resets are allowed and custom design properties outside foundation are scanned', () => {
  assert.deepEqual(
    counts(
      '.x { border-radius: 0px; --local-radius: 4px; --local-font-size: 13px; --local-shadow: 0 1px 3px #000; }',
    ),
    { color: 1, font: 1, radius: 1, shadow: 1 },
  );
});

test('detects cssText and literal style attribute writes', () => {
  const source = `el.style.cssText = 'color: #abc; border-radius: 2px'; el.setAttribute('style', 'font-size: 11px; color: red');`;
  assert.deepEqual(counts(source, 'src/ui/a.js'), {
    color: 2,
    font: 1,
    radius: 1,
  });
});

test('font shorthand detects an unquoted single family', () => {
  assert.deepEqual(counts('.x { font: 14px Arial; }'), { font: 1, family: 1 });
});

test('counts every color in one gradient or shadow and catches drop-shadow and color()', () => {
  assert.deepEqual(
    counts(
      '.x { background: linear-gradient(#fff, #000); box-shadow: 0 0 1px red, 0 0 2px blue; filter: drop-shadow(0 1px 2px color(display-p3 1 0 0)); }',
    ),
    { color: 5, shadow: 2 },
  );
  const one = scanSource(
    'src/x.css',
    '.x { background: linear-gradient(#fff, transparent); }',
  );
  const two = scanSource(
    'src/x.css',
    '.x { background: linear-gradient(#fff, #000); }',
  );
  assert.ok(
    compareCensus(two, [
      { path: 'src/x.css', kind: 'color', count: one[0].lines.length },
    ]).length,
  );
});

test('recognizes static paint writes and quoted markup with nested quotes', () => {
  const source = `el.setAttribute('fill', '#fff'); el.setAttribute('stroke', 'red');
const html = '<svg fill="blue" style="color: #123; font-family: &quot;Arial&quot;, sans-serif"></svg>';
el.style.fontFamily = "'Inter', sans-serif";`;
  assert.deepEqual(counts(source, 'src/ui/a.js'), { color: 4, family: 2 });
});

test('invalid standalone CSS fails closed', () => {
  assert.throws(() => scanSource('src/a.css', '.x { color: #fff;'));
});

test('handles escaped quotes in static markup and quoted style object keys', () => {
  const source = `const html = "<span style=\\"color: red\\">x</span>"; Object.assign(el.style, { 'font-family': 'Inter', color: '#fff' });`;
  assert.deepEqual(counts(source, 'src/ui/a.js'), { color: 2, family: 1 });
});

test('permits a token-only drop-shadow and rejects a literal drop-shadow', () => {
  assert.deepEqual(
    counts('.x { filter: drop-shadow(var(--shadow, 0 1px 3px red)); }'),
    {},
  );
  assert.deepEqual(
    counts('.x { filter: drop-shadow(0 1px 3px var(--shadow-color)); }'),
    { shadow: 1 },
  );
});

test('detects radii after slash and signed values inside calc', () => {
  assert.deepEqual(
    counts(
      '.x { border-radius: var(--r)/4px; border-top-left-radius: calc(-1px + var(--r)); }',
    ),
    { radius: 2 },
  );
});

test('counts local type shorthand while exempting foundation root tokens', () => {
  assert.deepEqual(
    counts('.x { --type-card: 500 11px/14px var(--font-sans); }'),
    { font: 1 },
  );
  assert.deepEqual(
    counts(
      ':root { --type-card: 500 11px/14px Arial; }',
      'src/ui/styles/foundation.css',
    ),
    {},
  );
  assert.deepEqual(counts('.x { --type-card: 500 11px/14px Arial; }'), {
    font: 1,
    family: 1,
  });
});
