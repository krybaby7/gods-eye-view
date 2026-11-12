// Disclosure policy of the default rail, kept from the retired Cyber disclosure
// tests: opening a panel leaves its peers alone (the one-panel rule is off; see
// railSinglePanel.js), Radio reveals its Context owner, and fixed controls
// never collapse or persist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PanelChrome } from './panelChrome.js';

function fixture() {
  const nodes = new Map();
  const node = (id, collapsed = true) => {
    const classes = new Set(collapsed ? ['collapsed'] : []);
    const value = { id, hidden: false, children: [],
      matches: () => true,
      contains(target) { return this === target || this.children.some((child) => child.contains(target)); },
      classList: {
        contains: (name) => classes.has(name),
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
      },
    };
    nodes.set(id, value);
    return value;
  };
  const rail = node('rail');
  const display = node('pp-toggles'), context = node('global-context-panel'), cctv = node('cctv-panel'), radio = node('radio-panel');
  rail.children = [display, context, cctv];
  for (const panel of rail.children) panel.parentElement = rail;
  context.children = [radio];
  radio.parentElement = context;
  const saved = [], claimed = [];
  const owner = {
    _rightPanelStack: rail,
    _panelLayout: {},
    _lifetime: { frame() {} },
    _syncPanelCollapseButton() {}, _scheduleRightPanelLayout() {},
    _scheduleLeftPanelLayout() {}, _layoutRightPanels() {}, _syncCctvPanelViewport() {},
    _savePanelCollapsedState: (...args) => saved.push(args),
    shareLinkManager: { claimRestoreLane: (...args) => claimed.push(args), onPanelStateChange() {} },
  };
  owner.setPanelCollapsed = PanelChrome.prototype.setPanelCollapsed.bind(owner);
  return { display, context, cctv, radio, owner, saved, claimed,
    doc: { documentElement: { dataset: {} }, getElementById: (id) => nodes.get(id) },
  };
}

test('explicit and restored openings leave the other rail panels open', () => {
  for (const restored of [false, true]) {
    const f = fixture(), prior = globalThis.document;
    globalThis.document = f.doc;
    try {
      const options = restored ? { restore: true, persist: false } : { explicit: true };
      f.owner.setPanelCollapsed('pp-toggles', false, options);
      f.owner.setPanelCollapsed('cctv-panel', false, options);
      assert.equal(f.display.classList.contains('collapsed'), false);
      assert.equal(f.cctv.classList.contains('collapsed'), false);
      if (restored) assert.deepEqual(f.saved, []);
    } finally { globalThis.document = prior; }
  }
});

test('opening Radio reveals its Context owner and leaves other panels open', () => {
  const f = fixture(), prior = globalThis.document;
  globalThis.document = f.doc;
  try {
    f.owner.setPanelCollapsed('pp-toggles', false, { explicit: true });
    f.owner.setPanelCollapsed('radio-panel', false, { explicit: true });
    assert.equal(f.radio.classList.contains('collapsed'), false);
    assert.equal(f.context.classList.contains('collapsed'), false);
    assert.equal(f.display.classList.contains('collapsed'), false);
  } finally { globalThis.document = prior; }
});

test('fixed rail controls cannot be collapsed or gain persisted disclosure state', () => {
  const f = fixture(), prior = globalThis.document;
  globalThis.document = f.doc;
  try {
    f.display.dataset = { panelFixed: '' };
    f.display.classList.remove('collapsed');
    f.owner.setPanelCollapsed('pp-toggles', true, { explicit: true });
    assert.equal(f.display.classList.contains('collapsed'), false);
    assert.deepEqual(f.saved, []);
    assert.deepEqual(f.claimed, []);
  } finally { globalThis.document = prior; }
});

// Two layout guards that lived among the retired Cyber theme tests but hold
// for every layout.
const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

test('CCTV and Context keep their headers outside their scroll bodies', () => {
  for (const file of ['layer-panels.html', 'context.html']) {
    const markup = read(`./templates/${file}`);
    assert.match(markup, /class="cyber-panel-body" data-rail-scroller/);
    assert.ok(
      markup.indexOf('class="panel-header"') <
        markup.indexOf('class="cyber-panel-body"'),
    );
  }
  assert.match(
    read('./styles/controls.css'),
    /\.cyber-panel-body\s*\{\s*display: contents;/,
  );
});

test('shared panel hooks affect only opted-in rail surfaces without overriding disclosure and concealment', () => {
  const styles = read('./styles/panel-surfaces.css');
  const railRule = styles.match(
    /:is\(#left-panel-stack, #right-context-rail\)\s+> \[data-panel-id\]:has\(> \[data-panel-surface\]\)\s*\{([^}]+)\}/,
  );
  assert.ok(railRule, 'the opted-in rail rule is present');
  assert.match(railRule[1], /pointer-events:\s*auto;/);
  assert.doesNotMatch(railRule[1], /(?:display|visibility):/);
  assert.doesNotMatch(
    styles,
    /:is\(#left-panel-stack, #right-context-rail\)\s*> \[data-panel-id\]\s*\{/,
  );
  assert.match(
    styles,
    /\[data-panel-surface\]:not\(\[hidden\]\):not\(dialog:not\(\[open\]\)\)\s*\{\s*display: flex;/,
  );
  assert.match(
    styles,
    /dialog\[data-panel-surface\]:not\(\[open\]\)\s*\{\s*display: none !important;/,
  );
  assert.match(
    styles,
    /body:is\(\.ui-clean-view, \.recording-mode\)[^{]+\{[^}]*visibility: hidden !important;[^}]*pointer-events: none !important;/,
  );
});
