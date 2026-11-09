import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function setup(t) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'gev-world-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  return { cacheDir };
}

const registry = {
  countries: [{ iso3: 'USA', name: 'United States', kind: 'state' }],
  indicators: [],
  sources: [{ id: 'worldbank' }, { id: 'imf' }, { id: 'ucdp' }],
};

const observation = (value, now) => ({
  iso3: 'USA',
  indicator: 'SP.POP.TOTL',
  period: '2025',
  value,
  retrievedAt: now.toISOString(),
  method: 'observed',
});

async function settled(service) {
  await service.whenIdle();
  return service.snapshot();
}

test('first launch starts a single turn and keeps the previous board while refreshing', async (t) => {
  const { createWorldService } = await import('./index.js');
  const { cacheDir } = await setup(t);
  const pending = Promise.withResolvers();
  let calls = 0;
  const service = createWorldService({
    cacheDir,
    loadRegistry: async () => registry,
    adapters: {
      worldbank: {
        shouldCheck: () => true,
        async fetchObservations() {
          calls++;
          await pending.promise;
          return { observations: [] };
        },
      },
    },
  });
  const initial = await service.snapshot();
  assert.equal(initial.turn, null);
  assert.ok(initial.progress);
  assert.equal(initial.countryIndex, registry.countries);
  assert.equal(initial.countries.USA.iso3, 'USA');
  assert.equal((await service.refresh()).turn, null);
  assert.equal(calls, 1);
  pending.resolve();
  const completed = await settled(service);
  assert.equal(completed.turn.number, 1);
  assert.equal(completed.progress, null);

  const second = await service.refresh();
  assert.equal(second.turn.number, 1);
  assert.ok(second.progress);
  assert.equal((await settled(service)).turn.number, 2);
});

test('first launch saves base scores and publishes finished background sources within one turn', async (t) => {
  const { createWorldService } = await import('./index.js');
  const heavy = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const checkpoint = Promise.withResolvers();
  const medium = Promise.withResolvers();
  let baseLoaded = false;
  let heavyCalls = 0;
  const adapter = (fetchObservations, estimatedBytes) => ({
    shouldCheck: () => true,
    fetchObservations,
    estimatedBytes,
  });
  const service = createWorldService({
    ...(await setup(t)),
    loadRegistry: async () => ({
      ...registry,
      sources: [{ id: 'vdem' }, ...registry.sources, { id: 'medium' }],
    }),
    adapters: {
      worldbank: adapter(({ now }) => ({
        observations: [observation(100, now)],
      })),
      ucdp: adapter(() => {
        baseLoaded = true;
        return { data: { deaths: 26 } };
      }),
      medium: adapter(async () => {
        await medium.promise;
        return { data: { records: [1] } };
      }, 100),
      vdem: adapter(async ({ onProgress }) => {
        heavyCalls++;
        onProgress({ bytes: 12_000_000, totalBytes: 27_000_000 });
        entered.resolve();
        await heavy.promise;
        return { data: { records: [2] } };
      }, 27_000_000),
    },
  });
  t.after(() => {
    heavy.resolve();
    medium.resolve();
    return service.whenIdle();
  });
  const initial = await service.snapshot();
  await entered.promise;
  assert.equal(baseLoaded, true);
  const early = await service.snapshot();
  assert.equal(early.turn, null);
  assert.notEqual(early.countries, initial.countries);
  assert.equal(early.features.ucdp.deaths, 26);
  assert.equal(early.progress.download.bytes, 12_000_000);
  assert.equal((await service.store.read()).observations[0].value, 100);
  assert.equal((await service.refresh()).turn, null);
  assert.equal(heavyCalls, 1);

  medium.resolve();
  const waitForMedium = setInterval(async () => {
    const snapshot = await service.snapshot();
    if (snapshot.features.medium) checkpoint.resolve(snapshot);
  }, 5);
  try {
    const background = await Promise.race([
      checkpoint.promise,
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error('Background result was never published')),
          2_000,
        ).unref();
      }),
    ]);
    assert.equal(background.turn, null);
    assert.equal(background.features.vdem, undefined);
  } finally {
    clearInterval(waitForMedium);
  }
  heavy.resolve();
  const done = await settled(service);
  assert.equal(done.turn.number, 1);
  assert.deepEqual(done.features.vdem.records, [2]);
});

test('the source queue starts at most four ready sources in estimated size order', async (t) => {
  const { createWorldService } = await import('./index.js');
  const release = Promise.withResolvers();
  const sizes = { large: 90, tiny: 1, small: 2, middle: 5, bigger: 20 };
  const starts = [];
  const service = createWorldService({
    ...(await setup(t)),
    loadRegistry: async () => ({
      ...registry,
      sources: Object.keys(sizes).map((id) => ({ id })),
    }),
    adapters: Object.fromEntries(
      Object.entries(sizes).map(([id, size]) => [
        id,
        {
          estimatedBytes: size,
          shouldCheck: () => true,
          async fetchObservations() {
            starts.push(id);
            await release.promise;
            return {};
          },
        },
      ]),
    ),
  });
  t.after(() => {
    release.resolve();
    return service.whenIdle();
  });
  await service.snapshot();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, ['tiny', 'small', 'middle', 'bigger']);
  release.resolve();
  assert.equal((await settled(service)).turn.sources.length, 5);
  assert.equal(starts.at(-1), 'large');
});

test('refresh retains revised vintages, persists turn history and isolates a failed source', async (t) => {
  const { createWorldService } = await import('./index.js');
  const { cacheDir } = await setup(t);
  let day = 1;
  let population = 100;
  let shouldFail = false;
  let imfCalls = 0;
  const options = {
    cacheDir,
    now: () => new Date(Date.UTC(2026, 10, day)),
    loadRegistry: async () => registry,
    adapters: {
      worldbank: {
        shouldCheck: () => true,
        async fetchObservations({ now }) {
          if (shouldFail) throw new Error('Upstream outage');
          return { observations: [observation(population, now)] };
        },
      },
      imf: {
        shouldCheck: ({ lastCheckedAt }) => !lastCheckedAt,
        async fetchObservations() {
          imfCalls++;
          return { observations: [] };
        },
      },
      ucdp: {
        shouldCheck: () => true,
        async fetchObservations({ observations }) {
          assert.equal(observations.at(-1).value, population);
          return { observations: [] };
        },
      },
    },
  };
  const service = createWorldService(options);
  await service.snapshot();
  assert.equal((await settled(service)).turn.newObservations, 1);

  day++;
  await service.refresh();
  assert.equal((await settled(service)).turn.newObservations, 0);

  day++;
  population++;
  await service.refresh();
  assert.equal((await settled(service)).turn.newObservations, 1);

  day++;
  shouldFail = true;
  await service.refresh();
  const board = await settled(service);
  assert.deepEqual(
    board.turn.sources.map(({ status }) => status),
    ['failed', 'skipped', 'loaded'],
  );
  assert.equal(imfCalls, 1);
  const restarted = createWorldService(options);
  assert.deepEqual(await restarted.snapshot(), board);
  const state = await restarted.store.read();
  assert.equal(state.turns.length, 4);
  assert.equal(state.lastCheckedAt.worldbank, '2026-11-03T00:00:00.000Z');
  assert.deepEqual(
    state.observations.map(({ value }) => value),
    [100, 101],
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(cacheDir, 'world', 'state.json'), 'utf8')),
    state,
  );
});

test('world routes admit local same-origin requests with exact methods', async (t) => {
  const { createWorldService } = await import('./index.js');
  const service = createWorldService({
    ...(await setup(t)),
    loadRegistry: async () => registry,
    adapters: {},
  });
  async function request(url, method, headers = {}, remoteAddress = '::1') {
    const req = {
      url,
      method,
      headers: { host: 'localhost:5173', ...headers },
      socket: { remoteAddress },
    };
    const res = {
      headers: {},
      setHeader(key, value) {
        this.headers[key] = value;
      },
      end(value) {
        this.payload = JSON.parse(value);
      },
    };
    await service.handle(req, res, () => {
      res.passed = true;
    });
    return res;
  }

  assert.equal((await request('/api/worldly', 'GET')).passed, true);
  assert.equal((await request('/api/world/refresh', 'GET')).statusCode, 405);
  assert.equal((await request('/api/world', 'POST')).statusCode, 405);
  assert.equal(
    (await request('/api/world', 'GET', { 'sec-fetch-site': 'cross-site' }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await request('/api/world/refresh', 'POST', {
        origin: 'http://example.test',
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await request('/api/world/refresh', 'POST', {}, '192.168.0.1')).statusCode,
    403,
  );
  assert.deepEqual((await service.store.read()).turns, []);

  const accepted = await request('/api/world/refresh', 'POST', {
    origin: 'http://localhost:5173',
  });
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.headers['Cache-Control'], 'no-store');
  assert.ok(accepted.payload.progress);
  await settled(service);
  const saved = await request('/api/world?unused=1', 'GET');
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.payload.turn.number, 1);
});

test('a persistence failure leaves the saved board intact and can be retried', async (t) => {
  const { createWorldService } = await import('./index.js');
  const { createWorldStore } = await import('./store.js');
  const options = {
    ...(await setup(t)),
    loadRegistry: async () => registry,
    adapters: {},
    logger: { warn() {} },
  };
  const store = createWorldStore(options);
  let refuseWrite = false;
  const service = createWorldService({
    ...options,
    store: {
      read: store.read,
      async write(next) {
        if (refuseWrite) throw new Error('Disk is unavailable');
        await store.write(next);
      },
    },
  });
  await service.snapshot();
  const saved = await settled(service);

  refuseWrite = true;
  await service.refresh();
  const failed = await settled(service);
  assert.equal(failed.turn.number, saved.turn.number);
  assert.equal(failed.progress, null);
  assert.ok(failed.error);
  assert.deepEqual(await createWorldService(options).snapshot(), saved);

  refuseWrite = false;
  await service.refresh();
  const retried = await settled(service);
  assert.equal(retried.turn.number, 2);
  assert.equal(retried.error, undefined);
});

test('local provider registration serves both Vite server modes', async (t) => {
  const { localProviderPlugins } = await import('../local.js');
  const plugin = localProviderPlugins({
    world: {
      ...(await setup(t)),
      loadRegistry: async () => registry,
      adapters: {},
    },
  }).find(({ name }) => name === 'gev-world');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});
