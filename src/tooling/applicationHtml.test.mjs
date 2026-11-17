import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  expandApplicationHtml,
  APPLICATION_TEMPLATES,
} from '../../build/application-html.js';

test('the standalone document expands every component once and preserves unique element ids', () => {
  const source = readFileSync(
    new URL('../../index.html', import.meta.url),
    'utf8',
  );
  const html = expandApplicationHtml(source);
  assert.equal(
    [...source.matchAll(/gev:template /g)].length,
    APPLICATION_TEMPLATES.length,
  );
  assert.doesNotMatch(html, /gev:template/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /id="cesiumContainer"/);
  assert.match(html, /type="module" src="\/src\/main.js"/);
});

test('component selection includes only requested markup and refuses filesystem traversal', () => {
  const html = expandApplicationHtml('<!-- gev:template welcome -->\n');
  assert.match(html, /id="first-run-launcher"/);
  assert.doesNotMatch(html, /id="cesiumContainer"/);
  assert.throws(
    () => expandApplicationHtml('<!-- gev:template ../../.env -->'),
    /Unknown application template/,
  );
});

test('Weather is a hidden, semantically labelled panel until a product is active', () => {
  const source = readFileSync(
    new URL('../../index.html', import.meta.url),
    'utf8',
  );
  const html = expandApplicationHtml(source);
  assert.match(
    html,
    /<section\b(?=[^>]*\bid="weather-panel")(?=[^>]*\baria-labelledby="weather-panel-title")(?=[^>]*\bhidden\b)[^>]*>/,
  );
  assert.match(
    html,
    /<h2\b(?=[^>]*\bid="weather-panel-title")(?=[^>]*\bclass="[^"]*\bpanel-title\b)[^>]*>\s*Weather\s*<\/h2>/,
  );
  assert.match(html, /id="weather-panel-body"/);
  assert.match(html, /data-collapse-target="weather-panel"/);
});
