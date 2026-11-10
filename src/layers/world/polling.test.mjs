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
