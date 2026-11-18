import test from 'node:test';
import assert from 'node:assert/strict';
import { createLensBar, createPresetBusy } from './lensBar.js';
import { railFixture } from './railTestFixture.mjs';

const lenses = [
  { id: 'air', label: 'Air', icon: '✈', hotkey: 1, layerIds: ['a', 'b'] },
  { id: 'sea', label: 'Sea', icon: '⚓', hotkey: 2, layerIds: ['b', 'c'] },
];

function fixture({
  rows,
  setEnabled,
  onWrite,
  withContainer = true,
  busy,
  containerId = 'lens-bar',
} = {}) {
  const f = railFixture(onWrite);
  f.container.id = containerId;
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
    ...(busy ? { busy } : {}),
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
  assert.match(
    air.getAttribute('aria-label'),
    /^Air: partly on, 1 of 2 available layers on\. /,
  );
  f.update(f.rows().map((row) => ({ ...row, enabled: true })));
  assert.equal(air.dataset.status, 'on');
  assert.equal(air.getAttribute('aria-pressed'), 'true');
  assert.equal(air.querySelector('.lens-count').hidden, true);
  f.update(
    f.rows().map((row) => ({ ...row, available: false, reason: 'No source' })),
  );
  assert.equal(air.dataset.status, 'unavailable');
  assert.equal(air.disabled, true);
  assert.match(air.title, /Aircraft: not available — No source/);
  assert.match(air.title, /Military: not available — No source/);
  assert.match(air.getAttribute('aria-label'), /Air: not available/);
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
        reason: 'Add PROVIDER_KEY in Data sources and keys',
      },
    ],
  });
  assert.match(
    f.button('air').title,
    /Add PROVIDER_KEY in Data sources and keys/,
  );
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

test('two bars sharing their busy state show a preset busy in both until it settles', async () => {
  const busy = createPresetBusy();
  const resolve = [];
  const slow = () => new Promise((done) => resolve.push(done));
  const chips = fixture({ busy, setEnabled: slow });
  const menu = fixture({ busy, setEnabled: slow });
  const work = chips.view.click('air');
  assert.equal(chips.button('air').getAttribute('aria-busy'), 'true');
  assert.equal(
    menu.button('air').getAttribute('aria-busy'),
    'true',
    'the other bar reads the preset as busy too',
  );
  assert.equal(menu.button('sea').getAttribute('aria-busy'), 'false');
  resolve.forEach((done) => done(true));
  await work;
  assert.equal(chips.button('air').getAttribute('aria-busy'), 'false');
  assert.equal(menu.button('air').getAttribute('aria-busy'), 'false');
  // Bars that do not share keep their own.
  const alone = fixture({ setEnabled: slow });
  const own = alone.view.click('air');
  assert.equal(alone.button('air').getAttribute('aria-busy'), 'true');
  assert.equal(menu.button('air').getAttribute('aria-busy'), 'false');
  resolve.forEach((done) => done(true));
  await own;
  for (const bar of [chips, menu, alone]) bar.view.destroy();
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
  assert.match(f.button('air').title, /Aircraft: stale/);
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

test('preset strip and menu keep their kit classes through status updates', () => {
  for (const [containerId, classes] of [
    ['lens-bar', ['kit-chip', 'pick']],
    ['frame-presets-menu', ['kit-btn', 'quiet']],
  ]) {
    const f = fixture({ containerId });
    const button = f.button('air');
    for (const expected of classes)
      assert.ok(
        button.classList.contains(expected),
        `${containerId} ${expected}`,
      );
    f.update(f.rows().map((row) => ({ ...row, enabled: row.id === 'a' })));
    assert.equal(button.getAttribute('aria-pressed'), 'mixed');
    for (const expected of classes)
      assert.ok(
        button.classList.contains(expected),
        `${containerId} partial ${expected}`,
      );
    f.update(f.rows().map((row) => ({ ...row, enabled: true })));
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    for (const expected of classes)
      assert.ok(
        button.classList.contains(expected),
        `${containerId} on ${expected}`,
      );
    f.view.destroy();
  }
});
