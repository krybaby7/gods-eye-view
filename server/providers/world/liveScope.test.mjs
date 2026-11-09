import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWorldService } from './index.js';
import { loadWorldRegistry } from './registry.js';

test('four scoped ticks write live.json without writing state.json or making turns', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'gev-world-live-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const registry = await loadWorldRegistry();
  registry.sources.push({ id: 'gdacs' });
  let now = new Date('2026-11-09T00:00:00Z');
  let datasetCalls = 0;
  let liveCalls = 0;
  let liveDue = true;
  const service = createWorldService({
    cacheDir,
    now: () => now,
    loadRegistry: async () => registry,
    adapters: {
      worldbank: {
        shouldCheck: () => true,
        async fetchObservations() {
          datasetCalls++;
          return {
            observations: [
              {
                indicator: 'condition.immunisation',
                iso3: 'IND',
                period: '2024',
                value: 85 + datasetCalls,
                method: 'observed',
                retrievedAt: now.toISOString(),
              },
            ],
          };
        },
      },
      gdacs: {
        live: true,
        shouldCheck: () => liveDue,
        async fetchObservations() {
          liveCalls++;
          const active = liveCalls % 2 !== 0;
          return {
            data: { active },
            changes: [
              {
                iso3: 'IND',
                text: active ? 'Red alert set' : 'Red alert cleared',
                kind: 'condition-flag',
                action: active ? 'set' : 'cleared',
              },
            ],
          };
        },
      },
    },
  });
  const premature = await service.refresh('gdacs');
  assert.equal(premature.turn, null);
  assert.equal(premature.progress, null);
  assert.equal(liveCalls, 0);
  assert.equal(await service.refresh('worldbank'), null);

  await service.refresh();
  await service.whenIdle();
  const first = await service.snapshot();
  assert.equal(first.turn.number, 1);
  assert.equal(first.features.gdacs.active, true);
  assert.equal(first.turn.newEvents, 1);
  const score = first.countries.IND.slots.C3.score;
  assert.ok(Number.isFinite(score));

  const statePath = join(cacheDir, 'world', 'state.json');
  const initialState = await readFile(statePath, 'utf8');
  const initialWrite = (await stat(statePath)).mtimeMs;
  for (let tick = 1; tick <= 4; tick++) {
    now = new Date(+now + 15 * 60_000);
    await service.refresh('gdacs');
    await service.whenIdle();
    assert.equal((await service.snapshot()).turn.number, 1);
    assert.equal(await readFile(statePath, 'utf8'), initialState);
    assert.equal((await stat(statePath)).mtimeMs, initialWrite);
  }
  const scoped = await service.snapshot();
  assert.equal(scoped.turn.number, 1);
  assert.equal(scoped.asOf, first.asOf);
  assert.equal(scoped.countries.IND.slots.C3.score, score);
  assert.equal(scoped.features.gdacs.active, true);
  assert.ok(scoped.revision > first.revision);
  const live = JSON.parse(
    await readFile(join(cacheDir, 'world', 'live.json'), 'utf8'),
  );
  assert.equal(live.features.gdacs.active, true);
  assert.equal(datasetCalls, 1);
  assert.equal(liveCalls, 5);

  liveDue = false;
  await service.refresh('gdacs');
  await service.whenIdle();
  assert.equal((await service.snapshot()).turn.number, 1);
});

test('two manual requests during one scoped tick queue exactly one turn', async () => {
  const registry = { countries: [], indicators: [], sources: [{ id: 'tick' }] };
  let state = {
    board: { countries: {}, asOf: '2026-11-09' },
    turns: [{ number: 1 }],
    observations: [],
    lastCheckedAt: {},
  };
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  let calls = 0;
  const service = createWorldService({
    loadRegistry: async () => registry,
    store: {
      read: async () => state,
      write: async (next) => {
        state = next;
      },
    },
    adapters: {
      tick: {
        live: true,
        shouldCheck: () => true,
        async fetchObservations() {
          if (++calls === 1) {
            started.resolve();
            await release.promise;
          }
          return { data: { flags: [] } };
        },
      },
    },
  });
  await service.refresh('tick');
  await started.promise;
  for (let i = 0; i < 2; i++) {
    const { refresh } = await service.refreshStatus();
    assert.equal(refresh.kind, 'live');
    assert.equal(refresh.queued, true);
  }
  assert.equal((await service.snapshot()).turn.number, 1);
  release.resolve();
  await service.whenIdle();
  assert.equal((await service.snapshot()).turn.number, 2);
  assert.equal(calls, 2);
});

test('a failed live file write does not advance a manual turn', async () => {
  const registry = {
    countries: [],
    indicators: [],
    sources: [{ id: 'live-feed' }],
  };
  let state = {
    board: { countries: {}, asOf: '2026-11-09' },
    turns: [{ number: 1 }],
    observations: [],
    lastCheckedAt: {},
  };
  let live;
  let failLive = true;
  const store = {
    read: async () => state,
    readLive: async () => live,
    write: async (next) => {
      state = next;
    },
    writeLive: async (next) => {
      if (failLive) throw Error('Disk unavailable');
      live = next;
    },
  };
  const options = {
    loadRegistry: async () => registry,
    store,
    logger: { warn() {} },
    adapters: {
      'live-feed': {
        live: true,
        shouldCheck: () => true,
        fetchObservations: () => ({ data: { banner: 'New result' } }),
      },
    },
  };
  const service = createWorldService(options);
  await service.refresh();
  await service.whenIdle();
  assert.equal((await service.snapshot()).turn.number, 1);
  assert.equal((await createWorldService(options).snapshot()).turn.number, 1);
  failLive = false;
  await service.refresh();
  await service.whenIdle();
  const restored = await createWorldService(options).snapshot();
  assert.equal(restored.turn.number, 2);
  assert.equal(restored.features['live-feed'].banner, 'New result');
});
