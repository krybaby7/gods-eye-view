import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { conditionFlag, conditionResult } from './conditionEvents.js';
import { createWorldService } from './index.js';
import { loadWorldRegistry } from './registry.js';
import { due } from './sources/liveFeedCommon.js';

test('eight 15-minute ticks each fetch despite three seconds of download time', async () => {
  const source = 'live-gdelt';
  const first = Date.parse('2026-11-09T00:00:00Z');
  const interval = 15 * 60_000;
  let clock = first;
  let calls = 0;
  let live;
  const service = createWorldService({
    now: () => new Date(clock),
    loadRegistry: async () => ({
      countries: [],
      indicators: [],
      sources: [{ id: source }],
    }),
    store: {
      read: async () => ({
        board: { countries: {} },
        turns: [{ number: 1 }],
        observations: [],
        lastCheckedAt: {},
      }),
      writeLive: async (value) => {
        live = value;
      },
    },
    adapters: {
      [source]: {
        live: true,
        shouldCheck: (context) => due(context, interval),
        fetchObservations() {
          calls++;
          clock += 3000;
          return { data: { flags: [] } };
        },
      },
    },
  });
  for (let tick = 0; tick < 8; tick++) {
    clock = first + tick * interval;
    await service.refresh(source);
    await service.whenIdle();
  }
  assert.equal(calls, 8);
  assert.equal(
    live.sources[source].lastCheckedAt,
    new Date(clock - 3000).toISOString(),
  );
  assert.equal(live.sources[source].lastGoodAt, new Date(clock).toISOString());
});

test('a turn reports the net change after three live flag flaps', async () => {
  const source = 'live-gdacs';
  const now = new Date('2026-11-09T00:00:00Z');
  const flag = conditionFlag(source, {
    iso3: 'IND',
    slot: 'C3',
    label: 'Red alert',
    date: now.toISOString(),
    source: 'https://example.org/alert',
  });
  let flagged = true;
  let state = { board: null, turns: [], observations: [], lastCheckedAt: {} };
  const service = createWorldService({
    now: () => now,
    loadRegistry: async () => ({
      countries: [],
      indicators: [],
      sources: [{ id: source }],
    }),
    store: {
      read: async () => state,
      write: async (next) => {
        state = next;
      },
    },
    adapters: {
      [source]: {
        live: true,
        shouldCheck: () => true,
        fetchObservations: ({ data }) =>
          conditionResult(flagged ? [flag] : [], data, now),
      },
    },
  });
  await service.refresh();
  await service.whenIdle();
  for (const value of [false, true, false]) {
    flagged = value;
    await service.refresh(source);
    await service.whenIdle();
  }
  await service.refresh();
  await service.whenIdle();
  const changes = (await service.snapshot()).turn.changes.filter(
    ({ kind }) => kind === 'condition-flag',
  );
  assert.deepEqual(
    changes.map(({ action }) => action),
    ['cleared'],
  );
  await service.refresh();
  await service.whenIdle();
  assert.equal((await service.snapshot()).turn.newEvents, 0);
});

test('a failed tick save stays visible while its queued manual turn runs', async () => {
  const source = 'live-gdacs';
  const tickStarted = Promise.withResolvers();
  const releaseTick = Promise.withResolvers();
  const manualStarted = Promise.withResolvers();
  const releaseManual = Promise.withResolvers();
  let calls = 0;
  let writes = 0;
  const service = createWorldService({
    loadRegistry: async () => ({
      countries: [],
      indicators: [],
      sources: [{ id: source }],
    }),
    store: {
      read: async () => ({
        board: { countries: {} },
        turns: [{ number: 1 }],
        observations: [],
        lastCheckedAt: {},
      }),
      writeLive: async () => {
        if (++writes === 1) throw Error('Disk unavailable');
      },
      write: async () => {},
    },
    logger: { warn() {} },
    adapters: {
      [source]: {
        live: true,
        shouldCheck: () => true,
        async fetchObservations() {
          if (++calls === 1) {
            tickStarted.resolve();
            await releaseTick.promise;
          } else {
            manualStarted.resolve();
            await releaseManual.promise;
          }
          return { data: { flags: [] } };
        },
      },
    },
  });
  const accepted = await service.refresh(source, { compact: true });
  await tickStarted.promise;
  const busy = await service.refresh(source, { compact: true });
  await service.refreshStatus();
  const idle = service.whenIdle();
  releaseTick.resolve();
  await manualStarted.promise;
  try {
    const status = await service.progress();
    assert.equal(status.refresh.kind, 'manual');
    assert.match(status.error, /could not be saved/);
  } finally {
    releaseManual.resolve();
    await idle;
  }
  assert.equal(accepted.accepted, true);
  assert.equal(busy.accepted, false);
  assert.equal((await service.progress()).error, undefined);
});

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
            data: {
              active,
              flags: active
                ? [
                    conditionFlag('gdacs', {
                      iso3: 'IND',
                      slot: 'C3',
                      label: 'Red alert',
                      date: now.toISOString(),
                      source: 'https://example.org/alert',
                    }),
                  ]
                : [],
            },
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
