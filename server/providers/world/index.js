import { admitSameSiteRequest } from '../../../src/localRequestGate.mjs';
import { loadWorldRegistry } from './registry.js';
import { worldAdapters, worldRefreshSteps } from './refreshRegistry.js';
import { scoreCountries } from './scores.js';
import { createWorldStore } from './store.js';
import { createTurn } from './turn.js';
import './dependencies.js';
import './phase-3.js';

const USER_AGENT =
  'GodsEyeView-WorldBoard/0.2 (https://github.com/krybaby7/gods-eye-view)';
const PREFIX = '/api/world';
const EMPTY_FEATURES = Object.freeze({});
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

function vintageKey({
  iso3,
  indicator,
  period,
  value,
  method,
  publishedAt,
  sourceVersion,
}) {
  return JSON.stringify([
    iso3,
    indicator,
    period,
    value,
    method,
    publishedAt,
    sourceVersion,
  ]);
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export function createWorldService({
  cacheDir,
  adapters = worldAdapters,
  refreshSteps = worldRefreshSteps,
  fetchImpl = (url, options) =>
    globalThis.fetch(url, {
      ...options,
      headers: { 'User-Agent': USER_AGENT, ...options?.headers },
    }),
  loadRegistry = loadWorldRegistry,
  now = () => new Date(),
  logger = console,
  store = createWorldStore({ cacheDir }),
} = {}) {
  let initialized;
  let registry;
  let saved;
  let board;
  let active = null;
  let progress = null;
  let error = null;
  let startedFirstTurn = false;

  function ready() {
    initialized ??= Promise.all([loadRegistry(), store.read()])
      .then(([loadedRegistry, state]) => {
        registry = loadedRegistry;
        saved = state;
        board = saved.board ?? {
          asOf: now().toISOString(),
          countries: scoreCountries(registry, [], now()),
        };
      })
      .catch((failure) => {
        initialized = null;
        throw failure;
      });
    return initialized;
  }

  async function runTurn() {
    const started = now();
    const startedAt = started.toISOString();
    const lastCheckedAt = { ...saved.lastCheckedAt };
    const sources = registry.sources;
    const features = { ...saved.board?.features };
    const pending = new Set(sources.map(({ id }) => id));

    function addProgress() {
      progress = {
        completed: sources.length - pending.size,
        total: sources.length,
        source: pending.values().next().value ?? null,
      };
    }

    function mergeObservations(existing, additions) {
      const known = new Set(existing.map(vintageKey));
      const next = [...existing];
      for (const observation of additions) {
        const key = vintageKey(observation);
        if (known.has(key)) continue;
        known.add(key);
        next.push(observation);
      }
      return next;
    }

    async function check(id, observations, dependencyUpdated = false) {
      let checked = false;
      try {
        const adapter = adapters[id];
        if (
          !adapter ||
          !adapter.shouldCheck({
            lastCheckedAt: dependencyUpdated ? null : lastCheckedAt[id],
            now: started,
            observations,
            data: features[id],
            features,
          })
        ) {
          return {
            status: { id, status: 'skipped', checked, count: 0 },
            observations: [],
          };
        }
        checked = true;
        const result = await adapter.fetchObservations({
          fetchImpl,
          registry,
          now: started,
          observations,
          data: features[id],
          features,
        });
        const additions = mergeObservations(
          observations,
          result.observations ?? [],
        ).slice(observations.length);
        if (result.data !== undefined) features[id] = result.data;
        if (!result.error) lastCheckedAt[id] = startedAt;
        return {
          status: {
            id,
            status: result.error ? 'failed' : 'loaded',
            ...(result.error && { error: result.error }),
            checked,
            count: result.count ?? additions.length,
            ...(result.count !== undefined && {
              unit: result.unit ?? 'record',
            }),
            ...(result.detail && { detail: result.detail }),
          },
          observations: additions,
          changes: result.changes,
          dataUpdated: result.data !== undefined,
        };
      } catch (failure) {
        return {
          status: {
            id,
            status: 'failed',
            checked,
            count: 0,
            error: failure?.cause?.code ?? failure?.message ?? String(failure),
          },
          observations: [],
        };
      } finally {
        pending.delete(id);
        addProgress();
      }
    }

    addProgress();
    const completed = new Map();
    async function run(id) {
      if (completed.has(id)) return completed.get(id);
      const dependency = refreshSteps[id];
      const prior = pending.has(dependency)
        ? await run(dependency)
        : completed.get(dependency);
      const additions = prior?.observations ?? [];
      const dependencyUpdated =
        dependency === 'worldbank' && id === 'ucdp'
          ? additions.some(({ indicator }) => indicator === 'population.total')
          : Boolean(prior?.dataUpdated || additions.length);
      const result = await check(
        id,
        [...saved.observations, ...additions],
        dependencyUpdated,
      );
      completed.set(id, result);
      return result;
    }
    const results = [];
    for (const { id } of sources) results.push(await run(id));
    const observations = mergeObservations(
      saved.observations,
      results.flatMap((result) => result.observations),
    );
    const asOf = now().toISOString();
    const countries = scoreCountries(registry, observations, asOf);
    const turn = createTurn({
      number: (saved.turns.at(-1)?.number ?? 0) + 1,
      startedAt,
      endedAt: asOf,
      sources: results.map(({ status }, i) => ({
        ...status,
        ...(sources[i].name && { name: sources[i].name }),
      })),
      previous: saved.board?.countries ?? null,
      countries,
      newObservations: observations.length - saved.observations.length,
      featureChanges: results.flatMap(({ changes }) => changes ?? []),
    });
    const next = {
      board: { asOf, countries, features },
      observations,
      turns: [...saved.turns, turn],
      lastCheckedAt,
    };
    await store.write(next);
    saved = next;
    board = next.board;
  }

  function start() {
    if (active) return;
    startedFirstTurn = true;
    error = null;
    progress = { completed: 0, total: registry.sources.length, source: null };
    active = Promise.resolve()
      .then(runTurn)
      .catch((failure) => {
        logger.warn?.('[world] Refresh could not be saved', failure);
        error = 'The World Board refresh could not be saved.';
      })
      .finally(() => {
        progress = null;
        active = null;
      });
  }

  function view() {
    return {
      ...board,
      features: board.features ?? EMPTY_FEATURES,
      indicators: registry.indicators,
      sources: registry.sources,
      countryIndex: registry.countries,
      turn: saved.turns.at(-1) ?? null,
      progress,
      ...(error && { error }),
    };
  }

  async function snapshot() {
    await ready();
    if (!saved.turns.length && !startedFirstTurn) start();
    return view();
  }

  async function refresh() {
    await ready();
    start();
    return view();
  }

  async function handle(req, res, next) {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== PREFIX && pathname !== PREFIX + '/refresh')
      return next?.();
    const headers = req.headers ?? {};
    const verdict = admitSameSiteRequest({
      hostHeader: headers.host,
      protocol: req.socket?.encrypted ? 'https:' : 'http:',
      origin: headers.origin,
      secFetchSite: headers['sec-fetch-site'],
      proxyHeaders: headers,
    });
    if (!verdict.ok)
      return sendJson(res, verdict.status, { error: verdict.error });
    if (
      !LOOPBACK_ADDRESSES.has(req.socket?.remoteAddress) ||
      !LOCAL_HOST.test(headers.host ?? '')
    ) {
      return sendJson(res, 403, {
        error:
          'The World Board is available only on the machine running the server.',
      });
    }
    const isRefresh = pathname !== PREFIX;
    const method = isRefresh ? 'POST' : 'GET';
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return sendJson(res, 405, { error: 'Use ' + method + '.' });
    }
    try {
      return isRefresh
        ? sendJson(res, 202, await refresh())
        : sendJson(res, 200, await snapshot());
    } catch (failure) {
      logger.warn?.('[world] Request failed', failure);
      return sendJson(res, 500, {
        error: 'The World Board could not be loaded.',
      });
    }
  }

  return { snapshot, refresh, handle, store, whenIdle: () => active };
}

export function worldProxy(options) {
  function install(server) {
    const service = createWorldService(options);
    server.middlewares.use(service.handle);
  }

  return {
    name: 'gev-world',
    configureServer: install,
    configurePreviewServer: install,
  };
}
