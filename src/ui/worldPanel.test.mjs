import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorldPanel } from './worldPanel.js';

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
