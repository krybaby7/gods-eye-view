// The one-panel-open rule, separated from the retired Cyber skin. It only ever
// applied under Cyber, so it ships switched off; these pin that it still works
// for the day the frame switches it on, and that the default rail is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RIGHT_RAIL_SINGLE_PANEL,
  SINGLE_PANEL_COLLAPSED_CLASS,
  applySinglePanelRule,
  singlePanelPeersToClose,
} from './railSinglePanel.js';

function fakePanel(id, { collapsed = false, floating = false, hidden = false, rail = null } = {}) {
  const classes = new Set(['panel-collapsible']);
  if (collapsed) classes.add('collapsed');
  if (floating) classes.add('panel-floating');
  const panel = {
    id,
    hidden,
    parentElement: rail,
    focusInside: false,
    classList: {
      contains: (name) => classes.has(name),
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
    matches: (selector) => selector === '[data-panel-id]',
    contains(node) {
      return node === panel || (node === 'focus' && panel.focusInside);
    },
  };
  rail?.children.push(panel);
  return panel;
}

const isOpen = (panel) => !panel.classList.contains('collapsed');

test('the rule ships off, because it only ever applied to the retired Cyber skin', () => {
  assert.equal(RIGHT_RAIL_SINGLE_PANEL, false);
  const rail = readFileSync(new URL('./rightPanelRail.js', import.meta.url), 'utf8');
  assert.match(rail, /enabled: RIGHT_RAIL_SINGLE_PANEL/, 'the rail consults the switch');
  const chrome = readFileSync(new URL('./panelChrome.js', import.meta.url), 'utf8');
  assert.match(chrome, /RIGHT_RAIL_SINGLE_PANEL &&/, 'explicit opening consults the same switch');
  assert.doesNotMatch(rail + chrome, /uiThem[e]|cyber/i, 'no theme decides the rule any more');
});

test('with the rule on, only the preferred panel stays open', () => {
  const panels = ['display', 'cctv', 'context'].map((id) => fakePanel(id));
  const synced = [];
  const owner = applySinglePanelRule({
    panels,
    enabled: true,
    preferredPanelId: 'cctv',
    onCollapse: (panel) => synced.push(panel.id),
  });
  assert.equal(owner.id, 'cctv');
  assert.deepEqual(panels.map(isOpen), [false, true, false]);
  assert.deepEqual(synced, ['display', 'context']);
  assert.ok(panels[0].classList.contains(SINGLE_PANEL_COLLAPSED_CLASS));
});

test('without a preference, focus and then order pick the open panel', () => {
  const panels = ['display', 'cctv', 'context'].map((id) => fakePanel(id));
  panels[2].focusInside = true;
  const owner = applySinglePanelRule({
    panels,
    enabled: true,
    activeElement: 'focus',
    onCollapse() {},
  });
  assert.equal(owner.id, 'context');
  const fresh = ['a', 'b'].map((id) => fakePanel(id));
  assert.equal(applySinglePanelRule({ panels: fresh, enabled: true, onCollapse() {} }).id, 'a');
});

test('a panel the user closed stays closed, and lifting the rule reopens only its own', () => {
  const panels = [fakePanel('display'), fakePanel('cctv', { collapsed: true }), fakePanel('context')];
  applySinglePanelRule({ panels, enabled: true, preferredPanelId: 'display', onCollapse() {} });
  assert.deepEqual(panels.map(isOpen), [true, false, false]);
  const synced = [];
  assert.equal(
    applySinglePanelRule({ panels, enabled: false, onCollapse: (panel) => synced.push(panel.id) }),
    null,
  );
  assert.deepEqual(panels.map(isOpen), [true, false, true], 'the user-closed panel stays closed');
  assert.deepEqual(synced, ['context']);
});

test('opening a docked panel closes its docked, visible peers; floating windows are outside the rule', () => {
  const rail = { children: [] };
  const display = fakePanel('display', { rail });
  const cctv = fakePanel('cctv', { rail });
  fakePanel('street', { rail, hidden: true });
  fakePanel('floater', { rail, floating: true });
  assert.deepEqual(singlePanelPeersToClose(display, rail).map((panel) => panel.id), ['cctv']);
  const floating = fakePanel('window', { rail, floating: true });
  assert.deepEqual(singlePanelPeersToClose(floating, rail), []);
  assert.deepEqual(singlePanelPeersToClose(cctv, null), []);
  assert.deepEqual(singlePanelPeersToClose(fakePanel('elsewhere', { rail: { children: [] } }), rail), []);
});
