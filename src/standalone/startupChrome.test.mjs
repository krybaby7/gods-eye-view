import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../app/startupChrome.js', import.meta.url),
  'utf8',
)
  .replace(/^import .*;\n/gm, '')
  .replace('export function', 'function');

function fixture({ withSearches = false } = {}) {
  const timers = new Map();
  const listeners = new Map();
  const events = [];
  let restored;
  let nextTimer = 0;
  const controller = new AbortController();
  const searchButtons = Array.from({ length: 2 }, () => ({
    hidden: true,
    addEventListener(type, handler) {
      this[type] = handler;
    },
    removeEventListener(type) {
      delete this[type];
    },
  }));
  const context = {
    console,
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    initFirstRunExperience() {
      events.push('welcome');
      return {
        destroy: () => events.push('welcome:destroy'),
        isTopmost: () => true,
        dismiss: ({ restoreFocus }) => events.push(['dismiss', restoreFocus]),
      };
    },
    async initKeySetup() {
      return { destroy: () => events.push('settings:destroy') };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const stop = context.startApplicationChrome({
    initializeSettings: context.initKeySetup,
    loadingScreen: {
      ownerDocument: {
        querySelectorAll: () => searchButtons,
        querySelector: () => ({
          focus: () => events.push('question:focus'),
        }),
      },
      classList: { add: (value) => events.push(value) },
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    },
    styleManager: {
      initialRestorePromise: new Promise((resolve) => {
        restored = resolve;
      }),
      setPanelCollapsed: (id, collapsed) => events.push([id, collapsed]),
    },
    dataManager: withSearches
      ? {
          layers: new Map([['searches', {}]]),
          async setEnabled(id, enabled, { origin }) {
            events.push([id, enabled, origin]);
            return true;
          },
        }
      : {},
    signal: controller.signal,
  });
  return {
    events,
    listeners,
    stop,
    restored,
    controller,
    searchButtons,
    fire(delay) {
      for (const [id, task] of timers) {
        if (task.delay === delay) {
          timers.delete(id);
          task.fn();
        }
      }
    },
    timers,
  };
}

test('both Search Layers shortcuts open the existing panel and focus its question', async () => {
  const f = fixture({ withSearches: true });
  f.restored();
  f.fire(1000);
  await flush();
  f.fire(900);
  for (const button of f.searchButtons) {
    assert.equal(button.hidden, false);
    await button.click();
    assert.deepEqual(f.events.slice(-4), [
      ['searches', true, 'user'],
      ['searches-panel', false],
      ['dismiss', false],
      'question:focus',
    ]);
  }
  await f.stop();
  assert.ok(f.searchButtons.every((button) => button.hidden && !button.click));
});
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

test('welcome waits for restoration, minimum delay, and the cover transition', async () => {
  const f = fixture();
  f.fire(1000);
  await flush();
  assert.deepEqual(f.events, []);
  f.restored();
  await flush();
  assert.deepEqual(f.events, ['hidden']);
  f.listeners.get('transitionend')();
  f.fire(900);
  assert.deepEqual(f.events, ['hidden', 'welcome']);
  await f.stop();
  assert.deepEqual(f.events.slice(-2), ['welcome:destroy', 'settings:destroy']);
  assert.equal(f.timers.size, 0);
});

test('reduced motion uses the bounded fallback after the cover hides', async () => {
  const f = fixture();
  f.restored();
  f.fire(1000);
  await flush();
  f.fire(900);
  assert.deepEqual(f.events, ['hidden', 'welcome']);
  await f.stop();
});

test('shutdown while restore is pending never reveals late welcome UI', async () => {
  const f = fixture();
  f.controller.abort();
  await f.stop();
  f.restored();
  await flush();
  f.fire(1000);
  f.fire(900);
  assert.deepEqual(f.events, ['settings:destroy']);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
});

test('shutdown during the cover transition cancels the listener and fallback', async () => {
  const f = fixture();
  f.restored();
  f.fire(1000);
  await flush();
  const transition = f.listeners.get('transitionend');
  f.controller.abort();
  await f.stop();
  transition();
  f.fire(900);
  assert.deepEqual(f.events, ['hidden', 'settings:destroy']);
});
