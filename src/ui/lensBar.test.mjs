import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLensBar } from './lensBar.js';
import { railFixture } from './railTestFixture.mjs';

const lenses = [
  { id: 'air', label: 'Air', icon: '✈', hotkey: 1, layerIds: ['a', 'b'] },
  { id: 'sea', label: 'Sea', icon: '⚓', hotkey: 2, layerIds: ['b', 'c'] },
];

function fixture({ rows, setEnabled, onWrite, withContainer = true } = {}) {
  const f = railFixture(onWrite);
  const buttons = f.document.createElement('div');
  buttons.className = 'lens-buttons';
  f.container.appendChild(buttons);
  let layers = rows || [
    { id: 'a', name: 'Aircraft', enabled: false, available: true },
    { id: 'b', name: 'Military', enabled: false, available: true },
    { id: 'c', name: 'Ships', enabled: false, available: true },
  ];
  const calls = [];
  const listeners = new Set();
  const view = createLensBar({
    container: withContainer ? f.container : null,
    lenses,
    getLayers: () => layers,
    setEnabled: (id, enabled, options) => {
      calls.push({ id, enabled, options });
      layers = layers.map((row) => (row.id === id ? { ...row, enabled } : row));
      return setEnabled?.(id, enabled, options);
    },
    subscribeActivity(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return {
    ...f,
    buttons,
    view,
    calls,
    listeners,
    button: (id) => f.find((node) => node.dataset.lensId === id),
    rows: () => layers,
    update(next) {
      layers = next;
      for (const listener of listeners) listener({ type: 'status' });
    },
  };
}

test('lens buttons derive off, partial, on and unavailable from available layers', () => {
  const f = fixture();
  const air = f.button('air');
  assert.equal(air.dataset.status, 'off');
  assert.equal(air.getAttribute('aria-pressed'), 'false');
  assert.equal(air.getAttribute('aria-keyshortcuts'), 'Shift+1');
  f.update(f.rows().map((row) => ({ ...row, enabled: row.id === 'a' })));
  assert.equal(air.dataset.status, 'partial');
  assert.equal(air.getAttribute('aria-pressed'), 'mixed');
  assert.equal(air.querySelector('.lens-count').textContent, '1/2');
  assert.equal(air.querySelector('.lens-count').hidden, false);
  f.update(f.rows().map((row) => ({ ...row, enabled: true })));
  assert.equal(air.dataset.status, 'on');
  assert.equal(air.getAttribute('aria-pressed'), 'true');
  assert.equal(air.querySelector('.lens-count').hidden, true);
  f.update(
    f.rows().map((row) => ({ ...row, available: false, reason: 'No source' })),
  );
  assert.equal(air.dataset.status, 'unavailable');
  assert.equal(air.disabled, true);
  assert.match(air.title, /Aircraft: UNAVAILABLE — No source/);
  assert.match(air.title, /Military: UNAVAILABLE — No source/);
  assert.match(air.getAttribute('aria-label'), /Air: UNAVAILABLE/);
  assert.deepEqual(
    f.calls,
    [],
    'rendering never enables a layer to probe availability',
  );
  f.view.destroy();
});

test('a native click enables available layers with user origin and explains skipped layers', async () => {
  const f = fixture({
    rows: [
      { id: 'a', name: 'Aircraft', enabled: false, available: true },
      {
        id: 'b',
        name: 'Military',
        enabled: false,
        available: false,
        reason: 'Add PROVIDER_KEY in Provider Settings',
      },
    ],
  });
  assert.match(f.button('air').title, /Add PROVIDER_KEY in Provider Settings/);
  f.button('air').click();
  assert.deepEqual(f.calls, [
    { id: 'a', enabled: true, options: { origin: 'user' } },
  ]);
  await Promise.resolve();
  assert.equal(f.button('air').dataset.status, 'on');
  assert.equal(f.button('air').disabled, false);
  f.view.destroy();
});

test('busy clicks dispatch their complete intent synchronously and allow rapid reversal', async () => {
  const resolve = [];
  const f = fixture({
    setEnabled: () => new Promise((done) => resolve.push(done)),
  });
  const first = f.view.click('air');
  assert.deepEqual(
    f.calls.map(({ id, enabled }) => [id, enabled]),
    [
      ['a', true],
      ['b', true],
    ],
  );
  assert.equal(f.button('air').getAttribute('aria-busy'), 'true');
  assert.equal(f.button('air').disabled, false);
  const second = f.view.click('air');
  assert.deepEqual(
    f.calls.map(({ id, enabled }) => [id, enabled]),
    [
      ['a', true],
      ['b', true],
      ['a', false],
      ['b', false],
    ],
  );
  assert.equal(f.button('air').dataset.status, 'off');
  resolve.slice(0, 2).forEach((done) => done(true));
  await first;
  assert.equal(f.button('air').getAttribute('aria-busy'), 'true');
  resolve.slice(2).forEach((done) => done(true));
  await second;
  assert.equal(f.button('air').getAttribute('aria-busy'), 'false');
  f.view.destroy();
});

test('a fully on peer protects a shared layer without a remembered lens click', async () => {
  const f = fixture({
    rows: ['a', 'b', 'c'].map((id) => ({ id, enabled: true, available: true })),
  });
  await f.view.click('air');
  assert.deepEqual(
    f.calls.map(({ id, enabled }) => [id, enabled]),
    [['a', false]],
  );
  assert.equal(f.button('air').dataset.status, 'partial');
  assert.equal(f.button('sea').dataset.status, 'on');
  f.view.destroy();
});

test('a partial peer does not protect a shared layer', async () => {
  const f = fixture({
    rows: ['a', 'b', 'c'].map((id) => ({
      id,
      enabled: id !== 'c',
      available: true,
    })),
  });
  await f.view.click('air');
  assert.deepEqual(
    f.calls.map(({ id, enabled }) => [id, enabled]),
    [
      ['a', false],
      ['b', false],
    ],
  );
  assert.equal(f.button('sea').dataset.status, 'off');
  f.view.destroy();
});

test('expert changes and cleared layers update existing buttons without stealing focus', async () => {
  const f = fixture();
  const air = f.button('air');
  air.focus();
  f.update(f.rows().map((row) => ({ ...row, enabled: true })));
  f.update(f.rows().map((row) => ({ ...row, enabled: row.id !== 'a' })));
  assert.equal(air.dataset.status, 'partial');
  await f.view.click('air');
  assert.deepEqual(
    f.calls.map(({ id, enabled }) => [id, enabled]),
    [['a', true]],
  );
  assert.equal(f.button('air'), air);
  assert.equal(f.document.activeElement, air);
  f.update(f.rows().map((row) => ({ ...row, enabled: false })));
  assert.equal(air.dataset.status, 'off');
  assert.equal(f.button('sea').dataset.status, 'off');
  f.view.destroy();
});

test('tooltips use supplied names and reasons as plain text and reflect feed health', () => {
  const reason = '<img src=x onerror=alert(1)> Missing key';
  const f = fixture({
    rows: [
      {
        id: 'a',
        name: 'Aircraft',
        enabled: true,
        available: true,
        stats: { stale: true },
      },
      { id: 'b', name: 'Military', enabled: false, available: false, reason },
    ],
  });
  assert.match(f.button('air').title, /Aircraft: STALE/);
  assert.ok(f.button('air').title.includes(reason));
  assert.equal(
    f.find((node) => node.tagName === 'IMG'),
    null,
  );
  f.view.destroy();
});

test('an unavailable or unknown lens makes no lifecycle calls', async () => {
  const f = fixture({
    rows: ['a', 'b', 'c'].map((id) => ({ id, available: false })),
  });
  f.button('air').click();
  await f.view.click('air');
  await f.view.click('unknown');
  assert.deepEqual(f.calls, []);
  f.view.destroy();
});

test('a rejected layer does not prevent sibling intents or leave a permanently busy button', async () => {
  const f = fixture({
    setEnabled(id) {
      if (id === 'a') throw new Error('Unavailable during click');
      return true;
    },
  });
  const result = await f.view.click('air');
  assert.deepEqual(
    f.calls.map(({ id }) => id),
    ['a', 'b'],
  );
  assert.equal(result[0].status, 'rejected');
  assert.equal(result[1].status, 'fulfilled');
  assert.equal(f.button('air').getAttribute('aria-busy'), 'false');
  f.view.destroy();
});

test('destroy removes owned listeners and prevents late completion from repainting', async () => {
  let writes = 0;
  const resolve = [];
  const f = fixture({
    onWrite: () => writes++,
    setEnabled: () => new Promise((done) => resolve.push(done)),
  });
  const button = f.button('air');
  const pending = f.view.click('air');
  f.view.destroy();
  f.view.destroy();
  assert.equal(f.listeners.size, 0);
  writes = 0;
  resolve.forEach((done) => done(true));
  await pending;
  await f.view.click('air');
  button.click();
  assert.equal(f.calls.length, 2);
  assert.equal(writes, 0);
});

test('a missing mount returns an inert API without reading state or subscribing', async () => {
  const view = createLensBar({
    container: null,
    getLayers() {
      throw new Error('No state for missing mount');
    },
    subscribeActivity() {
      throw new Error('No subscription for missing mount');
    },
  });
  view.refresh();
  await view.click('air');
  view.destroy();
});

test('the static lens bar is the first rail child with the shared surface contract', () => {
  const html = readFileSync(
    new URL('./templates/layer-panels.html', import.meta.url),
    'utf8',
  );
  assert.match(html, /id="left-panel-stack">\s*<section\s+id="lens-bar"/);
  const markup = html.slice(
    html.indexOf('id="lens-bar"'),
    html.indexOf('</section>'),
  );
  assert.match(markup, /data-panel-id="lens-bar"/);
  assert.match(markup, /data-panel-fixed/);
  assert.match(
    markup,
    /<div[^>]*data-panel-surface[^>]*>\s*<div[^>]*class="lens-buttons"[^>]*data-panel-body[^>]*data-rail-scroller/,
  );
});
