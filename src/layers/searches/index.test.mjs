import assert from 'node:assert/strict';
import test from 'node:test';

import { createSearchesLayer } from './index.js';
import { normalizeSearchSnapshot } from './records.js';

function fixture(options = {}) {
  const sources = [];
  const overlays = [];
  const viewer = {
    camera: { positionCartographic: { height: 1_000_000 } },
    scene: { preRender: { addEventListener: () => () => {} } },
    dataSources: {
      add(source) {
        sources.push(source);
      },
      remove(source) {
        sources.splice(sources.indexOf(source), 1);
      },
    },
  };
  const search = {
    id: 'sr_1234',
    label: 'An answer',
    colorIndex: 0,
    visible: true,
    run: { id: 'run_1', finishedAt: '2026-11-06T08:00:00Z' },
    findings: [
      {
        id: 'f_1234',
        kind: 'event',
        title: 'An event',
        sourceCount: 1,
        location: { lat: 10, lon: 20 },
        hotspot: { lat: 10, lon: 20, key: 'country:X', label: 'X' },
      },
    ],
  };
  const layer = createSearchesLayer({
    source: {
      getSnapshot: async ({ asOf }) =>
        normalizeSearchSnapshot({ searches: [search], revision: '1', asOf }),
      getRun: async () =>
        normalizeSearchSnapshot({ searches: [search] }).searches[0],
      ...options.source,
    },
    overlayHost: {
      setVisible() {},
      clearSource() {},
      setEntries(id, entries) {
        overlays.push({ id, entries });
      },
    },
    services: options.services,
    screenSpaceEventHandlerFactory: () => ({
      setInputAction() {},
      destroy() {},
    }),
  });
  return { layer, viewer, sources, overlays };
}

test('layer draws pins, filters a historical run and clears rendering resources on destroy', async () => {
  const focus = [];
  const { layer, viewer, sources } = fixture({
    services: {
      focus: { requestWorldFocus: (request) => focus.push(request) },
    },
  });
  layer.init(viewer);
  assert.equal(sources[0].show, false);
  layer.enable();
  await layer.update();
  assert.equal(sources[0].entities.values.length, 1);
  assert.equal(layer.selectFinding('sr_1234', 'f_1234'), true);
  assert.equal(focus[0].kind, 'story');
  await layer.setRun('sr_1234', 'run_1');
  assert.equal(layer.getSnapshot().asOf, '2026-11-06');
  await layer.setDay(null);
  assert.equal(layer.getSnapshot().asOf, null);
  layer.destroy();
  assert.deepEqual(sources, []);
});

test('an exact run uses the browser calendar day of its stored timestamp', async (t) => {
  const originalZone = process.env.TZ;
  process.env.TZ = 'Europe/Paris';
  t.after(() => {
    if (originalZone == null) delete process.env.TZ;
    else process.env.TZ = originalZone;
  });
  const { layer, viewer } = fixture({
    source: {
      getRun: async () => ({
        id: 'sr_1234',
        run: { id: 'run_1', finishedAt: '2026-11-05T23:15:00Z' },
        findings: [],
      }),
    },
  });
  t.after(() => layer.destroy());
  layer.init(viewer);
  layer.enable();
  await layer.setRun('sr_1234', 'run_1');
  assert.equal(layer.getSnapshot().asOf, '2026-11-06');
});

test('disabling the layer cancels a pending snapshot and ignores its result', async () => {
  let complete;
  let signal;
  const { layer, viewer, sources } = fixture({
    source: {
      getSnapshot: (options) => {
        signal = options.signal;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    },
  });
  layer.init(viewer);
  layer.enable();
  const loading = layer.update();
  layer.disable();
  assert.equal(signal.aborted, true);
  complete(
    normalizeSearchSnapshot({
      searches: [{ id: 'unexpected', visible: true }],
    }),
  );
  await loading;
  assert.equal(sources[0].show, false);
  assert.deepEqual(layer.getSnapshot().searches, []);
});

test(
  'voice wait finds the finished search after the viewer opens history',
  { timeout: 1500 },
  async () => {
    let done = false;
    const run = { id: 'run_now', status: 'ok' };
    const { layer, viewer } = fixture({
      source: {
        getSnapshot: async ({ asOf }) =>
          normalizeSearchSnapshot({
            agents: { claude: { busy: !done } },
            searches: asOf
              ? []
              : [
                  {
                    id: 'sr_voice',
                    visible: true,
                    status: done ? 'ready' : 'running',
                    run: done ? run : null,
                  },
                ],
          }),
      },
    });
    layer.enable(viewer);
    await layer.update();
    const result = layer.waitForRun('sr_voice');
    done = true;
    await layer.setDay('2026-11-06');
    assert.equal((await result).run.id, 'run_now');
    layer.destroy();
  },
);

test(
  'voice wait ends when the voice session aborts without canceling the search',
  { timeout: 1500 },
  async () => {
    const { layer, viewer } = fixture();
    layer.enable(viewer);
    const controller = new AbortController();
    const waiting = layer.waitForRun('sr_pending', {
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    layer.destroy();
  },
);
