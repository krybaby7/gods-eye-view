import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createFakeDocument } from '../testSupport/fakeDocument.mjs';
import { createWorldPanel, worldSheetTabs } from './worldPanel.js';
import phase2 from '../layers/world/phase-2.js';
import phase3 from '../layers/world/phase-3.js';
import phase4 from '../layers/world/phase-4.js';
import phase5 from '../layers/world/phase-5.js';
import phase6 from '../layers/world/phase-6.js';

// The phases the app loads (Vite's glob in phaseRegistry.js); plain Node has
// no glob, so the test hands the same descriptors in.
const phaseTabs = [phase2, phase3, phase4, phase5, phase6].flatMap(
  (phase) => phase.tabs ?? [],
);

test('the sheet lists its tabs in the approved order, Overview first', () => {
  const tabs = worldSheetTabs(phaseTabs);
  // Appendix D: Overview, Condition, Strength, Relations, then Exposure,
  // Assets, People, News and Stakes. News has no tab until it is built
  // (decision 32); Leverage, which only phase 2 knows, follows Exposure.
  assert.deepEqual(
    tabs.map(({ id }) => id),
    [
      'overview',
      'condition',
      'strength',
      'relations',
      'exposure',
      'leverage',
      'assets',
      'people',
      'stakes',
    ],
  );
  assert.deepEqual(
    tabs.slice(0, 4).map(({ label }) => label),
    ['Overview', 'Condition', 'Strength', 'Relations'],
  );
  // A phase supplies a listed tab's content without moving it.
  const relations = tabs.find(({ id }) => id === 'relations');
  assert.equal(relations.render, phase3.tabs[0].render);
  const moved = worldSheetTabs([{ id: 'people', order: -100 }]);
  assert.equal(moved[0].id, 'overview');
  // Without the phases (plain Node) the order of the listed tabs holds.
  assert.deepEqual(
    worldSheetTabs()
      .map(({ id }) => id)
      .slice(0, 4),
    ['overview', 'condition', 'strength', 'relations'],
  );
});

function panelDocument() {
  const document = createFakeDocument();
  const make = (id, tag = 'div') => {
    const node = document.createElement(tag);
    node.setAttribute('id', id);
    document.body.append(node);
    return node;
  };
  const bar = make('world-lens-bar');
  const options = document.createElement('div');
  options.className = 'world-lens-options';
  bar.append(options);
  const byId = document.getElementById;
  document.getElementById = (id) => byId(id) ?? make(id);
  document.documentElement = { style: { removeProperty() {} } };
  return document;
}

const load = (name) =>
  JSON.parse(
    readFileSync(new URL(`../../public/world/${name}.json`, import.meta.url)),
  );

test('a selected country opens on Overview, and a new one opens there again', (t) => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  t.after(() => delete globalThis.ResizeObserver);
  const document = panelDocument();
  const country = (name) => ({
    name,
    coverage: { known: 0, total: 18 },
    slots: {},
  });
  let snapshot = {
    enabled: true,
    lenses: [],
    indicators: load('indicators'),
    sources: load('sources'),
    countryIndex: [],
    features: {},
    countries: { FRA: country('France'), DEU: country('Germany') },
    selected: 'FRA',
  };
  const listeners = new Set();
  const panel = createWorldPanel({
    document,
    layer: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      // No relations held: the Overview keeps its first reading.
      getDetail: async () => null,
    },
  });
  t.after(() => panel.destroy());
  const publish = (next) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener(snapshot);
  };
  publish({});
  const tabs = document.getElementById('world-sheet-tabs');
  const body = document.getElementById('world-sheet-content');
  const selected = () =>
    tabs.children
      .filter((node) => node.getAttribute('aria-selected') === 'true')
      .map((node) => node.dataset.worldTab);
  assert.equal(document.getElementById('world-character-sheet').hidden, false);
  assert.deepEqual(selected(), ['overview']);
  assert.equal(body.getAttribute('aria-labelledby'), 'world-tab-overview');
  assert.equal(body.children[0].className, 'world-overview');
  // The viewer moves to Condition; the same country keeps it.
  const condition = tabs.children.find(
    (node) => node.dataset.worldTab === 'condition',
  );
  tabs.dispatchEvent({
    type: 'click',
    target: { closest: () => condition },
  });
  assert.deepEqual(selected(), ['condition']);
  publish({ lens: 'strength' });
  assert.deepEqual(selected(), ['condition']);
  // Another country opens on Overview again.
  publish({ selected: 'DEU' });
  assert.deepEqual(selected(), ['overview']);
});

test('the panel shows the failed tick save alongside queued manual progress', (t) => {
  const nodes = new Map();
  const document = new EventTarget();
  document.createElement = () =>
    Object.assign(new EventTarget(), {
      dataset: {},
      setAttribute() {},
    });
  document.getElementById = (id) => {
    if (!nodes.has(id)) {
      const node = new EventTarget();
      node.querySelector = () => node;
      node.replaceChildren = () => {};
      node.append = () => {};
      node.setAttribute = () => {};
      node.classList = { toggle() {} };
      nodes.set(id, node);
    }
    return nodes.get(id);
  };
  document.documentElement = { style: { removeProperty() {} } };
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  t.after(() => delete globalThis.ResizeObserver);
  const panel = createWorldPanel({
    document,
    layer: {
      getSnapshot: () => ({
        lenses: [],
        progress: { kind: 'manual', completed: 1, total: 2 },
        error: 'The World Board refresh could not be saved.',
      }),
      subscribe: () => () => {},
    },
  });
  t.after(() => panel.destroy());
  const status = nodes.get('world-progress').textContent;
  assert.match(status, /Loading World Board · 1 \/ 2 sources/);
  assert.match(status, /could not be saved/);
});
