import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { createWorldLayer } from './index.js';

test('progress polls recover with backoff and load the board only for new data and completion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = new EventTarget();
  t.after(() => delete globalThis.document);
  const canvas = new EventTarget();
  const progress = (completed) => ({ completed, total: 8, source: 'imf' });
  const snapshots = [
    { revision: 0, progress: null },
    { revision: 1, progress: progress(4) },
    { revision: 1, progress: null },
  ];
  const polls = [
    ...Array.from({ length: 7 }, () => new Error('Temporary failure')),
    { revision: 0, refresh: progress(2) },
    { revision: 1, refresh: progress(4) },
    { revision: 1, refresh: progress(7) },
    { revision: 1, refresh: null },
  ];
  let reads = 0;
  let pollCount = 0;
  let finishBoard;
  const source = {
    getSnapshot: async () => {
      const next = { countryIndex: [], ...snapshots[reads++] };
      if (reads === snapshots.length) {
        await new Promise((resolve) => {
          finishBoard = resolve;
        });
      }
      return next;
    },
    refresh: async () => ({ revision: 0, refresh: progress(0) }),
    getProgress: async () => {
      const next = polls[pollCount++];
      if (next instanceof Error) throw next;
      return next;
    },
  };
  const layer = createWorldLayer({ source });
  let reported;
  layer.subscribe(() => {
    reported = layer.getSnapshot();
  });
  layer.init({
    camera: {},
    scene: {
      canvas,
      requestRender() {},
      preRender: { addEventListener: () => () => {} },
    },
  });
  layer.enable();
  t.after(() => layer.destroy());

  await layer.update();
  await layer.refresh();
  assert.deepEqual(layer.getSnapshot().progress, progress(0));
  for (const [index, delay] of [
    1000, 1000, 2000, 4000, 8000, 16000, 30000, 30000,
  ].entries()) {
    t.mock.timers.tick(delay - 1);
    await setImmediate();
    assert.equal(pollCount, index);
    t.mock.timers.tick(1);
    await setImmediate();
    assert.equal(pollCount, index + 1);
    assert.equal(reads, 1);
    if (index === 0) {
      assert.equal(reported.progress, null);
      assert.equal(reported.loading, false);
      assert.equal(reported.error, 'Temporary failure');
    }
  }
  assert.deepEqual(layer.getSnapshot().progress, progress(2));
  assert.equal(layer.getSnapshot().error, null);
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(reads, 2);
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(reads, 2);
  assert.deepEqual(layer.getSnapshot().progress, progress(7));
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(reads, 3);
  assert.equal(reported.progress, null);
  assert.equal(reported.loading, false);
  finishBoard();
  await setImmediate();
  t.mock.timers.tick(30000);
  await setImmediate();
  assert.equal(pollCount, 11);
});

test('manual Refresh reaches the server while a live tick progress poll is pending', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = new EventTarget();
  t.after(() => delete globalThis.document);
  const live = { kind: 'live', completed: 0, total: 1, source: 'live-gdelt' };
  const held = Promise.withResolvers();
  let pollSignal;
  let manualPosts = 0;
  const layer = createWorldLayer({
    source: {
      getSnapshot: async () => ({
        revision: 2,
        countryIndex: [],
        progress: live,
      }),
      async getProgress({ signal }) {
        pollSignal = signal;
        await held.promise;
        return { refresh: live, revision: 2 };
      },
      async refresh({ sourceId }) {
        assert.equal(sourceId, undefined);
        manualPosts++;
        return { refresh: { ...live, queued: true }, revision: 2 };
      },
    },
  });
  layer.init({
    camera: {},
    scene: {
      canvas: new EventTarget(),
      requestRender() {},
      preRender: { addEventListener: () => () => {} },
    },
  });
  layer.enable();
  t.after(() => {
    held.resolve();
    layer.destroy();
  });
  await layer.update();
  t.mock.timers.tick(1_000);
  await setImmediate();
  assert.equal(pollSignal?.aborted, false);
  await layer.refresh();
  assert.equal(manualPosts, 1);
  assert.equal(pollSignal.aborted, true);
  assert.deepEqual(layer.getSnapshot().progress, { ...live, queued: true });
  held.resolve();
  await setImmediate();
  assert.equal(layer.getSnapshot().progress.queued, true);
});
