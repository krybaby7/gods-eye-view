import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { expandApplicationHtml } from '../build/application-html.js';
import { readStylesheet } from './testSupport/readStylesheet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const html = expandApplicationHtml(read('index.html'));
const css = readStylesheet(path.join(ROOT, 'style.css'));
const panelChrome = read('src/ui/panelChrome.js');
const layoutController = read('src/ui/panelLayoutController.js');
const sharelink = read('src/sharelink.js');
const panelCss = read('src/ui/styles/situation.css');
const panelJs = read('src/ui/situationPanel.js');
const briefJs = read('src/ui/situationBrief.js');

test('the Situation panel is a panel-surface rail panel, hidden until the layer is on', () => {
  assert.match(
    html,
    /<section id="situation-panel" class="panel-collapsible" data-panel-id="situation-panel" hidden>\s*<div data-panel-surface>\s*<header data-panel-header>/,
  );
  assert.match(
    html,
    /<button class="panel-collapse-btn" data-collapse-target="situation-panel"/,
  );
  assert.match(
    html,
    /<div id="situation-panel-body" data-panel-body data-rail-scroller><\/div>/,
  );
  // It sits in the right rail before Global Context.
  const rail = html.slice(html.indexOf('<aside id="right-context-rail">'));
  assert.ok(
    rail.indexOf('id="situation-panel"') <
      rail.indexOf('id="global-context-panel"'),
  );
});

test('the panel is registered with chrome, share state, cockpit entry and the rail layout', () => {
  assert.match(panelChrome, /\{ id: 'situation-panel' \}/);
  assert.match(
    panelChrome,
    /COCKPIT_ENTRY_COLLAPSE_PANEL_IDS = Object\.freeze\(\[[\s\S]*'situation-panel'/,
  );
  assert.match(panelChrome, /const isRightRail = \[[\s\S]*'situation-panel'/);
  assert.match(
    sharelink,
    /\{ id: 'situation-panel', token: 'n', pinnable: false \}/,
  );
  assert.match(
    layoutController,
    /for \(const panel of \[[\s\S]*?this\._situationPanel,[\s\S]*?\]\) \{[\s\S]*?stack\.insertBefore\(panel, globalContextPanel\)/,
  );
  assert.ok(
    css.includes('.situation-panel-root'),
    'situation.css is in the stylesheet entry',
  );
});

test('panel styles stay inside the surface contract; feed text is never markup', () => {
  assert.equal((panelCss.match(/!important/g) || []).length, 0);
  assert.doesNotMatch(panelCss, /position:\s*fixed/);
  assert.doesNotMatch(panelJs, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(panelJs, /rel: 'noopener noreferrer'/);
  // The Situation Brief writes model text as text too, and stays neutral:
  // no colour per actor or per track state.
  assert.doesNotMatch(briefJs, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(briefJs, /rel: 'noopener noreferrer'/);
  assert.doesNotMatch(briefJs, /style:|color/);
  const briefCss = panelCss.slice(panelCss.indexOf('/* Situation Brief.'));
  assert.ok(briefCss.length > 100, 'the brief styles are present');
  assert.doesNotMatch(
    briefCss,
    /#[0-9a-f]{3,6}\b|rgb|red|green/i,
    'brief styles use the theme tokens only',
  );
});
