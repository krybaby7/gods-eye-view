import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { admitSameSiteRequest } from '../../../src/localRequestGate.mjs';
import {
  activeConditionFlags,
  liveFeatureView,
  netConditionChanges,
} from './conditionEvents.js';
import './events.js';
import { liveSourceFromRequest, sourcesForWorldTurn } from './liveScope.js';
import { loadWorldRegistry } from './registry.js';
import {
  worldAdapters,
  worldFeatureViews,
  worldRefreshSteps,
} from './refreshRegistry.js';
import { scoreCountries } from './scores.js';
import { runWorldSources } from './sourceQueue.js';
import { cleanupLegacyWorldDownloads } from './sources/legacyDownloads.js';
import { createWorldFetch } from './sources/transport.js';
import { createWorldStore } from './store.js';
import { createTurn } from './turn.js';

const PREFIX = '/api/world';
const REFRESH = PREFIX + '/refresh';
const PROGRESS = PREFIX + '/progress';
const DETAIL = PREFIX + '/detail';
const ROUTES = new Set([PREFIX, REFRESH, PROGRESS, DETAIL]);
const gzipAsync = promisify(gzip);
// These small API sources can paint the first board while the archives download.
const BASE_SOURCES = new Set(['worldbank', 'imf']);
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

function readingKey({ iso3, indicator, period }) {
  return JSON.stringify([iso3, indicator, period]);
}

function countChangedReadings(previous, additions) {
  const latest = new Map();
  for (const reading of previous) {
    const key = readingKey(reading);
    const prior = latest.get(key);
    if (!prior || (reading.retrievedAt ?? '') >= (prior.retrievedAt ?? '')) {
      latest.set(key, reading);
    }
  }
  let changed = 0;
  for (const reading of additions) {
    const key = readingKey(reading);
    if (latest.get(key)?.value !== reading.value) changed++;
    latest.set(key, reading);
  }
  return changed;
}

function acceptsGzip(header = '') {
  const encodings = new Map(
    header.split(',').map((entry) => {
      const [name, ...parameters] = entry.trim().toLowerCase().split(';');
      const quality = parameters.find((parameter) =>
        parameter.trim().startsWith('q='),
      );
      return [name, quality ? Number(quality.trim().slice(2)) : 1];
    }),
  );
  return (encodings.get('gzip') ?? encodings.get('*') ?? 0) > 0;
}

async function sendJson(res, status, payload, encoding) {
  const json = JSON.stringify(payload);
  const compressed = acceptsGzip(encoding) ? await gzipAsync(json) : null;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Accept-Encoding');
  if (compressed) res.setHeader('Content-Encoding', 'gzip');
  res.end(compressed ?? json);
}

export function createWorldService({
  cacheDir,
  adapters = worldAdapters,
  refreshSteps = worldRefreshSteps,
  featureViews = worldFeatureViews,
  fetchImpl,
  loadRegistry = loadWorldRegistry,
  now = () => new Date(),
  logger = console,
  store = createWorldStore({ cacheDir }),
} = {}) {
  const worldFetch = createWorldFetch(fetchImpl);
  const cacheDirectory = resolve(
    cacheDir ?? '.gev-cache',
    'world',
    'downloads',
  );
  let initialized;
  let registry;
  let saved;
  let board;
  let live;
  let summaryFor;
  let summary;
  let active = null;
  let activeKind = null;
  let manualQueued = false;
  let progress = null;
  let error = null;
  let startedFirstTurn = false;

  function ready() {
    const loadLive = () =>
      store.readLive?.().catch((failure) => {
        logger.warn?.('[world] Live conditions could not be restored', failure);
        return null;
      });
    initialized ??= Promise.all([loadRegistry(), store.read(), loadLive()])
      .then(([loadedRegistry, state, liveState]) => {
        registry = loadedRegistry;
        saved = state;
        board = saved.board ?? {
          asOf: now().toISOString(),
          countries: scoreCountries(registry, [], now()),
        };
        live = {
          features: { ...liveState?.features },
          sources: { ...liveState?.sources },
          revision: liveState?.revision ?? 0,
        };
        // Legacy durable states stored live data alongside board features.
        // Preserve history and use the newest good source result on restart.
        for (const [id, data] of Object.entries(board.features ?? {})) {
          if (!isLive(id)) continue;
          const lastGoodAt = saved.lastCheckedAt[id] ?? board.asOf;
          if (lastGoodAt > (live.sources[id]?.lastGoodAt ?? '')) {
            live.features[id] = data;
            live.sources[id] = {
              lastGoodAt,
              lastCheckedAt: lastGoodAt,
              version: saved.sourceVersions?.[id] ?? 1,
            };
          }
        }
      })
      .catch((failure) => {
        initialized = null;
        throw failure;
      });
    return initialized;
  }

  function isLive(id) {
    return adapters[id]?.live === true || id.startsWith('live-');
  }

  function revision() {
    return (board.revision ?? 0) + live.revision;
  }

  async function runTurn(sources, liveOnly) {
    const baseline = saved;
    const firstTurn = baseline.turns.length === 0;
    const resume = firstTurn ? baseline.firstTurn : null;
    const started = now();
    const checkedAt = started.toISOString();
    const startedAt = resume?.startedAt ?? checkedAt;
    const lastCheckedAt = Object.fromEntries(
      Object.entries(baseline.lastCheckedAt).filter(([id]) => !isLive(id)),
    );
    const sourceVersions = Object.fromEntries(
      Object.entries(baseline.sourceVersions ?? {}).filter(
        ([id]) => !isLive(id),
      ),
    );
    const features = { ...baseline.board?.features, ...live.features };
    const liveSources = { ...live.sources };
    let liveUpdated = false;
    const completed = new Map(
      Object.entries(resume?.results ?? {}).filter(
        ([id, { adapterVersion }]) =>
          adapterVersion === (adapters[id]?.version ?? 1),
      ),
    );
    const pending = new Set(
      sources.map(({ id }) => id).filter((id) => !completed.has(id)),
    );
    const running = new Set();
    const downloads = new Map();
    let observations = baseline.observations;
    let newObservations = firstTurn
      ? (resume?.newObservations ?? observations.length)
      : 0;
    let checkpoint = Promise.resolve();

    function addProgress() {
      const source =
        downloads.keys().next().value ??
        running.values().next().value ??
        pending.values().next().value ??
        null;
      progress = {
        kind: liveOnly ? 'live' : 'manual',
        ...(manualQueued && { queued: true }),
        completed: sources.length - pending.size,
        total: sources.length,
        source,
        ...(downloads.has(source) && { download: downloads.get(source) }),
      };
    }

    function boardAt(asOf) {
      return {
        asOf,
        revision: (board.revision ?? 0) + 1,
        countries: scoreCountries(registry, observations, asOf),
        features: Object.fromEntries(
          Object.entries(features).filter(([id]) => !isLive(id)),
        ),
      };
    }

    function persistEarlyBoard() {
      const next = {
        board,
        observations,
        turns: baseline.turns,
        lastCheckedAt: { ...lastCheckedAt },
        sourceVersions: { ...sourceVersions },
        firstTurn: {
          startedAt,
          newObservations,
          results: Object.fromEntries(
            [...completed].filter(([id]) => !isLive(id)),
          ),
        },
      };
      checkpoint = checkpoint
        .then(async () => {
          await store.write(next);
          saved = next;
        })
        .catch((failure) => {
          logger.warn?.(
            '[world] First-launch checkpoint could not be saved',
            failure,
          );
        });
      return checkpoint;
    }

    function mergeObservations(existing, additions) {
      if (!additions.length) return existing;
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
      const clock = performance.now();
      running.add(id);
      addProgress();
      try {
        const adapter = adapters[id];
        const version = adapter?.version ?? 1;
        const checkedAt = isLive(id)
          ? (liveSources[id]?.lastCheckedAt ?? liveSources[id]?.lastGoodAt)
          : lastCheckedAt[id];
        const savedVersion = isLive(id)
          ? liveSources[id]?.version
          : sourceVersions[id];
        const rederive = Boolean(
          (checkedAt || features[id] !== undefined) &&
          (savedVersion ?? 1) !== version,
        );
        if (
          !adapter ||
          !adapter.shouldCheck({
            lastCheckedAt: dependencyUpdated || rederive ? null : checkedAt,
            now: started,
            observations,
            data: features[id],
            features,
            rederive,
          })
        ) {
          return {
            status: { id, status: 'skipped', checked, count: 0 },
            observations: [],
          };
        }
        checked = true;
        const result = await adapter.fetchObservations({
          fetchImpl: worldFetch,
          cacheDirectory,
          lastCheckedAt: checkedAt,
          onProgress(download) {
            downloads.set(id, download);
            addProgress();
          },
          registry,
          now: started,
          currentTime: now,
          observations,
          data: features[id],
          features,
          rederive,
        });
        const replacedIndicators =
          rederive && !result.error && result.observations !== undefined
            ? new Set(
                registry.indicators
                  .filter(({ source }) => source === id)
                  .map(({ id }) => id),
              )
            : null;
        const existing = replacedIndicators?.size
          ? observations.filter(
              ({ indicator }) => !replacedIndicators.has(indicator),
            )
          : observations;
        const additions = mergeObservations(
          existing,
          result.observations ?? [],
        ).slice(existing.length);
        const addedCount = replacedIndicators?.size
          ? countChangedReadings(observations, additions)
          : additions.length;
        return {
          status: {
            id,
            status: result.error ? 'failed' : 'loaded',
            ...(result.error && { error: result.error }),
            checked,
            durationMs: Math.round(performance.now() - clock),
            count: result.count ?? addedCount,
            ...(result.count !== undefined && {
              unit: result.unit ?? 'record',
            }),
            ...(result.detail && { detail: result.detail }),
            ...(rederive && !result.error && { rederived: true }),
          },
          observations: additions,
          addedCount,
          checkedRelease: result.checkedRelease !== false,
          changes: result.changes,
          replacedIndicators,
          data: result.data,
          dataUpdated: result.data !== undefined,
          cached: result.cached,
        };
      } catch (failure) {
        return {
          status: {
            id,
            status: 'failed',
            checked,
            durationMs: Math.round(performance.now() - clock),
            count: 0,
            error: failure?.cause?.code
              ? `${failure?.message ?? failure} (${failure.cause.code})`
              : (failure?.message ?? String(failure)),
          },
          observations: [],
        };
      }
    }

    addProgress();
    async function run(id, prior) {
      const dependency = refreshSteps[id];
      const additions = prior?.observations ?? [];
      const dependencyUpdated =
        dependency === 'worldbank' && id === 'ucdp'
          ? additions.some(({ indicator }) => indicator === 'population.total')
          : Boolean(prior?.dataUpdated || additions.length);
      const result = await check(
        id,
        mergeObservations(baseline.observations, additions),
        dependencyUpdated,
      );
      const adapterVersion = adapters[id]?.version ?? 1;
      if (isLive(id) && result.status.checked) {
        const previous = liveSources[id];
        const succeeded = result.status.status === 'loaded';
        const finishedAt = now().toISOString();
        liveSources[id] = {
          ...previous,
          lastCheckedAt: checkedAt,
          lastAttemptAt: finishedAt,
          ...(succeeded
            ? {
                lastGoodAt: result.cached ? previous?.lastGoodAt : finishedAt,
                version: adapterVersion,
                error: null,
                staleSince: null,
              }
            : {
                error: result.status.error,
                staleSince: previous?.staleSince ?? finishedAt,
              }),
        };
        liveUpdated = true;
      } else if (result.status.status === 'loaded') {
        if (result.checkedRelease) lastCheckedAt[id] = checkedAt;
        sourceVersions[id] = adapterVersion;
      }
      if (!liveOnly) {
        if (result.replacedIndicators?.size) {
          observations = observations.filter(
            ({ indicator }) => !result.replacedIndicators.has(indicator),
          );
        }
        observations = mergeObservations(observations, result.observations);
        newObservations += result.addedCount ?? 0;
      }
      if (result.dataUpdated) features[id] = result.data;
      if (
        !liveOnly &&
        !isLive(id) &&
        (result.dataUpdated ||
          result.observations.length ||
          result.replacedIndicators?.size)
      ) {
        board = boardAt(now().toISOString());
      }
      pending.delete(id);
      running.delete(id);
      downloads.delete(id);
      addProgress();
      const { status, changes, dataUpdated } = result;
      const completedResult = {
        status,
        changes,
        dataUpdated,
        adapterVersion,
        observations: result.observations,
      };
      completed.set(id, completedResult);
      if (firstTurn && !BASE_SOURCES.has(id)) await persistEarlyBoard();
      return completedResult;
    }
    const queue = { adapters, dependencies: refreshSteps, completed, run };
    const base = firstTurn
      ? sources.filter(({ id }) => BASE_SOURCES.has(id) && !completed.has(id))
      : [];
    if (base.length) {
      await runWorldSources(base, queue);
      await persistEarlyBoard();
    }
    await runWorldSources(
      sources.filter(({ id }) => !completed.has(id)),
      queue,
    );
    const results = sources.map(({ id }) => completed.get(id));
    const previousLiveFeatures = live.features;
    if (liveUpdated) {
      const nextLive = {
        features: Object.fromEntries(
          Object.entries(features).filter(([id]) => isLive(id)),
        ),
        sources: liveSources,
        revision: live.revision + 1,
      };
      await store.writeLive?.(nextLive);
      live = nextLive;
    }
    if (liveOnly) return;
    const asOf = now().toISOString();
    const nextBoard = boardAt(asOf);
    const previousFlags =
      baseline.liveFlags ??
      (firstTurn ? [] : activeConditionFlags(previousLiveFeatures, started));
    const liveFlags = activeConditionFlags(live.features, new Date(asOf));
    const changes = results.flatMap(({ status, changes }) =>
      isLive(status.id) ? [] : (changes ?? []),
    );
    const turn = createTurn({
      number: (baseline.turns.at(-1)?.number ?? 0) + 1,
      startedAt,
      endedAt: asOf,
      sources: results.map(({ status }, i) => ({
        ...status,
        ...(sources[i].name && { name: sources[i].name }),
      })),
      previous: baseline.board?.countries ?? null,
      countries: nextBoard.countries,
      newObservations,
      featureChanges: [
        ...changes,
        ...netConditionChanges(previousFlags, liveFlags, live.features),
      ],
    });
    const next = {
      board: nextBoard,
      observations,
      turns: [...baseline.turns, turn],
      lastCheckedAt,
      sourceVersions,
      liveFlags,
    };
    await store.write(next);
    saved = next;
    board = next.board;
    await cleanupLegacyWorldDownloads(
      cacheDirectory,
      baseline.board?.features ?? EMPTY_FEATURES,
      baseline.observations,
      Object.entries(adapters).flatMap(
        ([id, adapter]) => adapter.downloadUrls?.(features[id]) ?? [],
      ),
    ).catch((failure) =>
      logger.warn?.('[world] Old downloads could not be removed', failure),
    );
  }

  function start(
    sources = registry.sources,
    liveOnly = false,
    preserveError = false,
  ) {
    if (active) {
      if (!liveOnly && activeKind === 'live') {
        manualQueued = true;
        progress = { ...progress, queued: true };
      }
      return false;
    }
    startedFirstTurn = true;
    if (!preserveError) error = null;
    activeKind = liveOnly ? 'live' : 'manual';
    progress = {
      kind: activeKind,
      completed: 0,
      total: sources.length,
      source: null,
    };
    active = Promise.resolve()
      .then(() => runTurn(sources, liveOnly))
      .then(() => {
        error = null;
      })
      .catch((failure) => {
        logger.warn?.('[world] Refresh could not be saved', failure);
        board = saved.board ?? board;
        error = 'The World Board refresh could not be saved.';
      })
      .finally(() => {
        progress = null;
        active = null;
        activeKind = null;
        if (manualQueued) {
          manualQueued = false;
          start(undefined, false, true);
          return active;
        }
      });
    return true;
  }

  function boardFeatures(compact) {
    const features = board.features ?? EMPTY_FEATURES;
    if (compact && summaryFor !== features) {
      summary = { ...features };
      for (const { summary: project } of featureViews.values()) {
        for (const [id, summarize] of Object.entries(project ?? {})) {
          if (Object.hasOwn(features, id))
            summary[id] = summarize(features[id]);
        }
      }
      summaryFor = features;
    }
    const displayed = { ...(compact ? summary : features) };
    for (const id of Object.keys(live.sources)) {
      displayed[id] = liveFeatureView(
        id,
        live.features[id],
        live.sources[id],
        now(),
        compact,
      );
    }
    return displayed;
  }

  function view(compact = false) {
    return {
      ...board,
      revision: revision(),
      features: boardFeatures(compact),
      indicators: registry.indicators,
      sources: registry.sources,
      countryIndex: registry.countries,
      turn: saved.turns.at(-1) ?? null,
      progress,
      ...(error && { error }),
    };
  }

  async function snapshot({ compact = false } = {}) {
    await ready();
    if (!saved.turns.length && !startedFirstTurn) start();
    return view(compact);
  }

  async function refresh(liveSource = null, { compact = false } = {}) {
    await ready();
    const sources = sourcesForWorldTurn(registry.sources, adapters, liveSource);
    const liveOnly = liveSource !== null;
    if (liveOnly && !sources.length) return null;
    const accepted = Boolean(
      (!liveOnly || saved.turns.length) && start(sources, liveOnly),
    );
    const status = compact ? progressView() : view();
    return liveOnly ? { ...status, accepted } : status;
  }

  function progressView() {
    return {
      refresh: progress,
      revision: revision(),
      ...(error && { error }),
    };
  }

  async function readProgress() {
    await ready();
    return progressView();
  }

  async function detail(country, lens) {
    await ready();
    const project = featureViews.get(lens)?.detail;
    if (!project) return null;
    return {
      country,
      lens,
      data:
        project({ country, board, features: boardFeatures(false), registry }) ??
        null,
    };
  }

  async function handle(req, res, next) {
    const [pathname, query] = (req.url ?? '').split('?', 2);
    if (!ROUTES.has(pathname)) return next?.();
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
    const isRefresh = pathname === REFRESH;
    const method = isRefresh ? 'POST' : 'GET';
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return sendJson(res, 405, { error: 'Use ' + method + '.' });
    }
    try {
      const encoding = headers['accept-encoding'];
      if (isRefresh) {
        const status = await refresh(liveSourceFromRequest(req.url), {
          compact: true,
        });
        if (status) return await sendJson(res, 202, status, encoding);
        return await sendJson(res, 400, {
          error: 'Unknown World Board live source.',
        });
      }
      if (pathname === PROGRESS)
        return await sendJson(res, 200, await readProgress(), encoding);
      if (pathname === DETAIL) {
        const params = new URLSearchParams(query);
        const country = params.get('country');
        const lens = params.get('lens');
        await ready();
        if (
          country !== null &&
          !registry.countries.some(({ iso3 }) => iso3 === country)
        ) {
          return await sendJson(res, 400, {
            error: 'Unknown World Board country.',
          });
        }
        const payload = await detail(country, lens);
        if (payload) return await sendJson(res, 200, payload, encoding);
        return await sendJson(res, 404, {
          error: 'Unknown World Board detail lens.',
        });
      }
      return await sendJson(
        res,
        200,
        await snapshot({ compact: true }),
        encoding,
      );
    } catch (failure) {
      logger.warn?.('[world] Request failed', failure);
      return sendJson(res, 500, {
        error: 'The World Board could not be loaded.',
      });
    }
  }

  return {
    snapshot,
    refresh,
    refreshStatus: () => refresh(null, { compact: true }),
    progress: readProgress,
    detail,
    handle,
    store,
    whenIdle: () => active,
  };
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
