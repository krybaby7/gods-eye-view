import test from 'node:test';
import assert from 'node:assert/strict';
import { captureStable } from './qaLookCapture.mjs';

test('capture discards moved pixels and keeps both geometry samples', async () => {
  const reads = [{ box: 1 }, { box: 2 }, { box: 3 }, { box: 3 }];
  const discarded = [];
  const result = await captureStable({
    settle: async () => reads.shift(),
    read: async () => reads.shift(),
    capture: async (_, i) => `pixels-${i}`,
    discard: async (_, i) => discarded.push(i),
    key: (x) => x.box,
    maxAttempts: 3,
  });
  assert.equal(result.value, 'pixels-2');
  assert.deepEqual(discarded, [1]);
  assert.deepEqual(
    result.attempts.map((x) => [x.before.box, x.after.box, x.accepted]),
    [
      [1, 2, false],
      [3, 3, true],
    ],
  );
});

test('capture fails after bounded retries and discards every moved image', async () => {
  let n = 0;
  const discarded = [];
  await assert.rejects(
    captureStable({
      settle: async () => ({ box: ++n }),
      read: async () => ({ box: ++n }),
      capture: async (_, i) => i,
      discard: async (_, i) => discarded.push(i),
      key: (x) => x.box,
      maxAttempts: 2,
    }),
    (error) => error.attempts.length === 2 && /moved/.test(error.message),
  );
  assert.deepEqual(discarded, [1, 2]);
});
