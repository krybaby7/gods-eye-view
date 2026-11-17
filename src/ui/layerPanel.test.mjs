import test from 'node:test';
import assert from 'node:assert/strict';

function mountRows(ids, { enabled = () => false, extra = {} } = {}) {
  return import('./railTestFixture.mjs').then(async ({ railFixture }) => {
    const { LayerPanel } = await import('./layerPanel.js');
    const f = railFixture();
    const layers = ids.map((id) => ({
      id,
      name: `catalog ${id}`,
      icon: '*',
      source: 'Source',
      enabled: enabled(id),
      showInTogglePanel: true,
      stats: {},
    }));
    const calls = [];
    const panel = new LayerPanel({
      getLayers: () => layers,
      isEnabled: (id) => enabled(id),
      setEnabled: (...args) => calls.push(args),
      setLayerParams() {},
      hasRowControls: () => false,
      subscribeRowControls() {},
      getRowControls: () => null,
      ...extra,
    });
    return { f, panel, calls, layers };
  });
}

test('rows follow the group table: three columns, table names, no World or War Monitor row, unknown layers last', async () => {
  const previousDocument = globalThis.document;
  const { f, panel } = await mountRows([
    'bikeshare',
    'world',
    'transit',
    'flights',
    'traffic',
    'mystery-layer',
    'news',
    'earthquakes',
  ]);
  globalThis.document = f.document;
  try {
    panel.mount(f.container);
    const columns = f.container.children;
    assert.deepEqual(
      columns.map((column) => column.dataset.column),
      ['1', '2', '3'],
    );
    const groups = (column) =>
      column.children.map((section) => [
        section.children[0].textContent,
        section.children.slice(1).map((row) => row.dataset.layerId),
      ]);
    assert.deepEqual(groups(columns[0]), [['Air', ['flights']]]);
    assert.deepEqual(groups(columns[1]), [
      ['Hazards and weather', ['earthquakes']],
    ]);
    assert.deepEqual(groups(columns[2]), [
      ['City', ['traffic', 'transit', 'bikeshare']],
      ['Other layers', ['mystery-layer']],
    ]);
    assert.equal(
      f.find((node) => node.dataset?.layerId === 'world'),
      null,
      'World keeps working by code and command but has no row',
    );
    assert.equal(
      f.find((node) => node.dataset?.layerId === 'news'),
      null,
      'the War Monitor is switched from Menu > Data sources and keys, not a row',
    );
    const traffic = f.find((node) => node.dataset?.layerId === 'traffic');
    assert.equal(
      traffic.querySelector('.data-name').textContent,
      'Street traffic',
    );
    assert.equal(
      traffic.querySelector('.data-toggle-state').textContent,
      'Off',
    );
    const mystery = f.find((node) => node.dataset?.layerId === 'mystery-layer');
    assert.equal(
      mystery.querySelector('.data-name').textContent,
      'catalog mystery-layer',
    );
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('a click anywhere on a row switches it, and Search layers only opens its panel', async () => {
  const previousDocument = globalThis.document;
  const { f, panel, calls } = await mountRows(['traffic', 'searches']);
  globalThis.document = f.document;
  const opened = [];
  f.container.ownerDocument.querySelector = (selector) =>
    selector === '[data-open-panel-for="searches-panel"]'
      ? { click: () => opened.push(selector) }
      : null;
  try {
    panel.mount(f.container);
    const traffic = f.find((node) => node.dataset?.layerId === 'traffic');
    traffic.querySelector('.data-name').click();
    assert.deepEqual(calls, [['traffic', true, { origin: 'user' }]]);
    const searches = f.find((node) => node.dataset?.layerId === 'searches');
    assert.equal(
      searches.querySelector('.data-toggle-state').textContent,
      'Asks before it runs',
    );
    searches.querySelector('.data-name').click();
    searches.querySelector('.data-toggle-btn').click();
    assert.equal(opened.length, 2);
    assert.equal(
      calls.length,
      1,
      'opening the panel never switches or runs a search',
    );
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('partial feed controls distinguish incomplete records from stale data and outages', async () => {
  const { LayerPanel, layerFeedState } = await import('./layerPanel.js');
  const { layerRowFor } = await import('../lenses/groups.js');
  const panelLabel = (layer) => layerRowFor(layer.id)?.row.name || layer.name;
  const classes = new Map();
  const attrs = new Map();
  const button = {
    classList: { toggle: (key, value) => classes.set(key, value) },
    dataset: {},
    setAttribute: (key, value) => attrs.set(key, value),
  };
  const layer = {
    id: 'ais-live-vessels',
    name: 'Live Vessels',
    source: 'AISStream',
    enabled: true,
    stats: {
      partial: true,
      stale: false,
      count: 2,
      acceptedRowCount: 2,
      rawRowCount: 3,
      lastUpdate: Date.now(),
    },
  };
  const panel = LayerPanel.prototype;
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'PARTIAL');
  assert.equal(button.dataset.feedState, 'partial');
  assert.equal(classes.get('feed-partial'), true);
  assert.equal(classes.get('feed-stale'), false);
  assert.equal(attrs.get('role'), 'switch');
  assert.equal(attrs.get('aria-checked'), 'true');
  // The state is said once, by aria-checked: the name carries no state word.
  assert.equal(attrs.get('aria-label'), panelLabel(layer));
  assert.doesNotMatch(attrs.get('aria-label'), /partial|on/i);
  assert.match(
    panel._buildMetaText(layer),
    /^PARTIAL · AISStream · 2 of 3 records accepted · /,
  );
  assert.match(
    panel._buildMetaText({
      ...layer,
      stats: { ...layer.stats, rawRowCount: 2 },
    }),
    /incomplete snapshot/,
  );
  assert.equal(layerFeedState({ ...layer.stats, stale: true }), 'stale');
  assert.equal(
    layerFeedState({ ...layer.stats, error: 'Connection lost' }),
    'degraded',
  );
  assert.equal(
    layerFeedState({ ...layer.stats, status: 'unavailable' }),
    'unavailable',
  );
  assert.equal(layerFeedState({ ...layer.stats, loading: true }), 'loading');
  layer.stats = { ...layer.stats, partial: false };
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'ON');
  assert.equal(classes.get('feed-partial'), false);
  layer.enabled = false;
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'OFF');
  assert.equal(attrs.get('aria-checked'), 'false');
  assert.equal(attrs.get('aria-label'), panelLabel(layer));
  assert.doesNotMatch(attrs.get('aria-label'), /off/i);
});

test('readout rows contain only toggles and metadata; ordinary rows retain controls', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const ids = [
    'wind',
    'weather-radar',
    'weather-satellite',
    'weather-lightning',
    'weather-cyclones',
    'other',
  ];
  let refresh;
  const layers = ids.map((id) => ({
    id,
    name: id,
    icon: '*',
    source: 'Source',
    enabled: true,
    showInTogglePanel: true,
    stats: {},
  }));
  const calls = [];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: () => true,
    setEnabled: (...args) => calls.push(args),
    setLayerParams: (...args) => calls.push(args),
    hasRowControls: () => true,
    subscribeRowControls: (_id, callback) => {
      refresh = callback;
    },
    getRowControls: (id) => ({
      readout: id !== 'other',
      summary: { status: 'Loading' },
      info: 'Detailed time',
      chips: [{ id: 'config', label: 'Soft', params: { opacity: 'light' } }],
      legend: [{ label: 'Rain', color: '#abcdef' }],
      list: {
        items: [{ id: 'storm', text: 'Storm', params: { focus: true } }],
      },
    }),
  });
  try {
    panel.mount(f.container);
    for (const id of ids.slice(0, -1)) {
      const row = f.find((n) => n.dataset.layerId === id);
      assert.equal(row.children.length, 2);
      assert.ok(row.querySelector('.data-name'));
      assert.ok(row.querySelector('.data-toggle-meta'));
      for (const cls of [
        'data-toggle-chip',
        'data-count',
        'data-toggle-controls',
        'data-toggle-controls-status',
        'data-row-list',
      ])
        assert.equal(row.querySelector(`.${cls}`), null);
      row.querySelector('.data-toggle-btn').click();
    }
    assert.deepEqual(
      calls.map(([id]) => id),
      ids.slice(0, -1),
    );
    const ordinary = f.find((n) => n.dataset.layerId === 'other');
    assert.equal(
      ordinary.querySelector('.data-toggle-controls-info').textContent,
      'Detailed time',
    );
    assert.ok(ordinary.querySelector('.data-toggle-legend-item'));
    ordinary.querySelector('.data-toggle-chip').click();
    assert.deepEqual(calls.at(-1), [
      'other',
      { opacity: 'light' },
      { origin: 'user' },
    ]);
    assert.equal(typeof refresh, 'function');
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('the Recent Imagery readout mounts in its rail body like the weather readout and is rebuilt or released with the panel', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const body = f.document.createElement('div');
  f.document.getElementById = (id) =>
    id === 'recent-imagery-panel-body' ? body : null;
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const mounted = [];
  const factory = (container) => {
    const readout = {
      container,
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
    };
    mounted.push(readout);
    return readout;
  };
  const panel = new LayerPanel({
    getLayers: () => [],
    isEnabled: () => false,
    setEnabled() {},
    setLayerParams() {},
    hasRowControls: () => false,
    subscribeRowControls() {},
    getRowControls: () => null,
  });
  try {
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 0, 'no body before the panel mounts');
    panel.mount(f.container);
    assert.equal(mounted.length, 1);
    assert.equal(mounted[0].container, body);
    panel.mount(f.container);
    assert.equal(mounted[0].destroyed, true, 'a remount rebuilds it');
    assert.equal(mounted.length, 2);
    panel.attachRecentImagery(null);
    assert.equal(mounted[1].destroyed, true);
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 3);
    panel.destroy();
    assert.equal(mounted[2].destroyed, true);
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 3, 'a destroyed panel mounts nothing');
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('an omitted source is visibly unavailable and cannot be toggled on', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const attrs = new Map();
  const button = {
    classList: { toggle() {} },
    dataset: {},
    setAttribute: (key, value) => attrs.set(key, value),
  };
  const layer = {
    id: 'flights',
    name: 'Flights',
    enabled: false,
    stats: {
      sourceUnavailable: true,
      status: 'unavailable',
      error: 'Data source not configured: flights',
    },
  };
  LayerPanel.prototype._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'UNAVAILABLE');
  assert.equal(attrs.get('aria-disabled'), 'true');
  assert.match(button.title, /not configured/);
  LayerPanel.prototype._syncToggleButton(button, { ...layer, enabled: true });
  assert.equal(
    attrs.get('aria-disabled'),
    'false',
    'an active layer can always be switched off',
  );
});

test('uncertain switch exposes its status as a description and clears it on reconciliation', async () => {
  const previousDocument = globalThis.document;
  const { f, panel, layers } = await mountRows(['traffic'], {
    enabled: () => true,
  });
  globalThis.document = f.document;
  layers[0].lifecycleUncertain = true;
  try {
    panel.mount(f.container);
    const row = f.find((node) => node.dataset?.layerId === 'traffic');
    const button = row.querySelector('.data-toggle-btn');
    const meta = row.querySelector('.data-toggle-state');
    assert.equal(button.getAttribute('aria-describedby'), meta.id);
    assert.ok(meta.id, 'description references a real element');
    assert.match(meta.textContent, /uncertain/i);
    assert.equal(button.getAttribute('aria-label'), 'Street traffic');
    layers[0].lifecycleUncertain = false;
    panel._refreshTogglePanel();
    assert.equal(button.getAttribute('aria-describedby'), null);
    assert.doesNotMatch(meta.textContent, /uncertain/i);
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('optional layer controls use shared styles without losing their state semantics', async () => {
  const previousDocument = globalThis.document;
  const { f, panel } = await mountRows(['traffic'], {
    enabled: () => true,
    extra: {
      hasRowControls: () => true,
      getRowControls: () => ({
        info: 'Updated recently',
        chips: [
          { id: 'selected', label: 'Selected', active: true },
          { id: 'pending', label: 'Pending', state: 'pending', busy: true },
          { id: 'error', label: 'Error', state: 'error' },
        ],
        legend: [{ label: 'Rain', color: '#abcdef', count: 3 }],
        list: {
          items: [{ id: 'one', text: 'First', active: true, current: true }],
        },
      }),
    },
  });
  globalThis.document = f.document;
  try {
    panel.mount(f.container);
    const row = f.find((node) => node.dataset?.layerId === 'traffic');
    const selected = f.find((node) => node.dataset?.chipId === 'selected');
    const pending = f.find((node) => node.dataset?.chipId === 'pending');
    const error = f.find((node) => node.dataset?.chipId === 'error');
    for (const chip of [selected, pending, error]) {
      assert.ok(chip.classList.contains('kit-chip'));
      assert.ok(chip.classList.contains('pick'));
    }
    assert.equal(selected.getAttribute('aria-pressed'), 'true');
    assert.equal(pending.getAttribute('aria-busy'), 'true');
    assert.ok(pending.classList.contains('chip-pending'));
    assert.ok(error.classList.contains('chip-error'));
    const listItem = row.querySelector('.data-row-list-item');
    assert.ok(listItem.classList.contains('kit-btn'));
    assert.ok(listItem.classList.contains('quiet'));
    assert.equal(listItem.getAttribute('aria-current'), 'step');
    assert.equal(listItem.getAttribute('aria-pressed'), 'true');
    assert.match(
      row.querySelector('.data-toggle-legend-item').children[1].textContent,
      /Rain 3/,
    );
    assert.equal(
      row.querySelector('.data-toggle-controls-info').textContent,
      'Updated recently',
    );
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});
