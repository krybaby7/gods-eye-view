import { expandApplicationHtml } from '../build/application-html.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = expandApplicationHtml(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
const parameters = readFileSync(new URL('./ui/styleParameters.js', import.meta.url), 'utf8');

// Focused markup guards; actual computed names are checked in Chromium.
// Native labels and hidden inputs must not be treated as missing aria-labels.
test('HUD sliders and location search have descriptive explicit names', () => {
  for (const [id, name] of [
    ['scope-feather-slider', 'Scope edge feather'],
    ['bloom-intensity-slider', 'Bloom intensity'],
    ['sharpen-intensity-slider', 'Sharpen intensity'],
    ['location-search', 'Search location by name or coordinates'],
  ]) {
    const input = html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
    assert.ok(input, `${id} exists`);
    assert.ok(input.includes(`aria-label="${name}"`), `${id} has its descriptive name`);
  }
});

test('the welcome stays outside the accessibility tree until it opens', () => {
  const dialog = html.match(/<aside\s+id="first-run-launcher"[^>]*>/)?.[0];
  assert.ok(dialog);
  assert.match(dialog, /\bhidden\b/);
  assert.match(dialog, /role="dialog"/);
  const title = dialog.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(title && html.includes(`id="${title}"`));
});

test('generated style sliders use the visible parameter label as their name', () => {
  assert.match(parameters, /label\.textContent\s*=\s*metadata\.label;/);
  assert.match(parameters, /slider\.setAttribute\(['"]aria-label['"],\s*metadata\.label\)/);
});
