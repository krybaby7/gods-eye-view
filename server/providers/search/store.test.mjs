import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSearchStore } from './store.js';

test('serializes record changes, persists its index and recovers an interrupted update', async (t) => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'gev-search-store-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const now = () => new Date('2026-11-07T12:00:00Z');
  const store = createSearchStore({ cacheDir, now });
  const id = 'sr_01';
  const oldRun = {
    id: 'run_01',
    status: 'ok',
    finishedAt: '2026-11-06T12:00:00Z',
  };
  await store.transact(() => ({
    id,
    label: 'Search',
    status: 'ready',
    runs: [oldRun],
    count: 0,
  }));
  await Promise.all(
    Array.from({ length: 5 }, () =>
      store.transact((records) => {
        const record = records.get(id);
        return { ...record, count: record.count + 1 };
      }),
    ),
  );
  const running = {
    id: 'run_02',
    kind: 'update',
    agent: 'claude',
    stage: 'research',
    startedAt: now().toISOString(),
  };
  await store.transact((records) => ({
    ...records.get(id),
    status: 'running',
    running,
  }));
  const restarted = createSearchStore({ cacheDir, now });
  const [record] = await restarted.list();
  assert.equal(record.count, 5);
  assert.equal(record.status, 'failed');
  assert.equal(record.error.reason, 'interrupted');
  assert.equal(record.running, undefined);
  assert.deepEqual(record.runs[0], oldRun);
  assert.equal(record.runs[1].kind, 'update');
  assert.equal(record.runs[1].finishedAt, now().toISOString());
  const index = JSON.parse(
    await readFile(path.join(cacheDir, 'searches', 'index.json'), 'utf8'),
  );
  assert.equal(index.searches[0].status, 'failed');
  await restarted.transact(() => ({ id, deleted: true }));
  assert.deepEqual(await restarted.list(), []);
});
