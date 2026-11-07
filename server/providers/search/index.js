import { createHash, randomUUID } from 'node:crypto';
import { admitSameSiteRequest } from '../../../src/localRequestGate.mjs';
import { clientKey, makeCostRateLimiter } from '../common/rate-limit.js';
import { readRequestBody } from '../common/request.js';
import { createSearchAgents } from './agents/index.js';
import { decorateSearchSnapshots } from './dedupe.js';
import { completeRun, getUnresolvedPlaces } from './findings.js';
import {
  buildRunSnapshot,
  compareRuns,
  createHistoryDayKey,
  listSearchDays,
} from './history.js';
import { runMapStep } from './mapper.js';
import { runResearch } from './research.js';
import { createSearchStore, failSearch, SEARCH_ID } from './store.js';

export const MAX_VISIBLE_SEARCHES = 8;
const PREFIX = '/api/searches';
const DEFAULT_AGENT = 'claude';
const BODY_BYTES = 8192;
const DEFAULT_TIMEOUT_MS = 600_000;
const CODEX_STATUS = Object.freeze({
  installed: false,
  signedIn: false,
  disabledReason: 'Codex is unavailable for search layers.',
  busy: false,
});
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
const RUN_ID = /^run_[a-zA-Z0-9_-]{1,96}$/;
const FINDING_ID = /^f_[a-zA-Z0-9_-]{1,96}$/;

function requestError(status, code, reason) {
  return Object.assign(new Error(reason), { status, code });
}

const missing = () =>
  requestError(404, 'not_found', 'Search, run or finding not found.');
const badRequest = (reason) => requestError(400, 'invalid_request', reason);
const conflict = (reason) => requestError(409, 'conflict', reason);
const unavailable = (reason) => requestError(503, 'agent_unavailable', reason);
const requireSearch = (search) => {
  if (!search) throw missing();
  return search;
};
const makeRunId = () => 'run_' + randomUUID();

function freeColour(records) {
  const used = new Set(
    [...records.values()]
      .filter(({ visible }) => visible)
      .map(({ colorIndex }) => colorIndex),
  );
  for (let index = 0; index < MAX_VISIBLE_SEARCHES; index++) {
    if (!used.has(index)) return index;
  }
  return null;
}

function requireSupportedAgent(agent) {
  if (agent === 'codex') throw unavailable(CODEX_STATUS.disabledReason);
  if (agent !== DEFAULT_AGENT) throw badRequest('Unknown search agent.');
}

function requireFields(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((field) => !allowed.includes(field))
  ) {
    throw badRequest('Unexpected search request fields.');
  }
}

function validatePatch(patch) {
  requireFields(patch, ['label', 'visible', 'pinned', 'agent']);
  if (
    'label' in patch &&
    (typeof patch.label !== 'string' ||
      !patch.label.trim() ||
      [...patch.label.trim()].length > 40)
  ) {
    throw badRequest('Enter a label of up to 40 characters.');
  }
  for (const key of ['visible', 'pinned']) {
    if (key in patch && typeof patch[key] !== 'boolean')
      throw badRequest('Expected a boolean for ' + key + '.');
  }
  if ('agent' in patch) requireSupportedAgent(patch.agent);
}

function usageTotal(first, second, durationMs) {
  const usage = { durationMs };
  for (const key of ['inputTokens', 'outputTokens', 'costUsd']) {
    const values = [first?.[key], second?.[key]].filter(Number.isFinite);
    usage[key] = values.length
      ? values.reduce((total, value) => total + value, 0)
      : null;
  }
  return usage;
}

function terminalError(error, signal) {
  if (signal.aborted) return signal.reason;
  switch (error?.code) {
    case 'SEARCH_AGENT_TIMEOUT':
      return {
        reason: 'timeout',
        message: 'The search exceeded its time limit.',
      };
    case 'SEARCH_AGENT_UNAVAILABLE':
      return {
        reason: 'agent_unavailable',
        message: 'Claude Code is unavailable.',
      };
    case 'SEARCH_MAP_INVALID':
      return {
        reason: 'invalid_map',
        message: 'Claude Code returned invalid map data.',
      };
    default:
      return {
        reason: 'failed',
        message: 'Claude Code did not complete this search.',
      };
  }
}

function validateDay(day) {
  if (day == null) return;
  const timestamp = Date.parse(day + 'T00:00:00.000Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== day
  ) {
    throw badRequest('Use a calendar day in YYYY-MM-DD format.');
  }
}

function snapshotDayKey(timeZone) {
  try {
    if (typeof timeZone === 'string' && !/^[+-]/.test(timeZone)) {
      return createHistoryDayKey(timeZone);
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  throw badRequest('Use an IANA time zone identifier.');
}

export function createSearchService({
  cacheDir = '.gev-cache',
  env = process.env,
  now = Date.now,
  logger = console,
  timeoutMs = Number(env.SEARCH_RUN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  store = createSearchStore({ cacheDir, now, logger }),
  agents = createSearchAgents({ cacheDir, env }),
  loadContext = async () => ({}),
  geocode = async () => null,
  loadWarStories = async () => [],
  readRate = 120,
  mutationRate = 30,
} = {}) {
  const readLimiter = makeCostRateLimiter(readRate, 120);
  const writeLimiter = makeCostRateLimiter(mutationRate, 30);
  const active = new Map();
  const lifecycle = new AbortController();
  const timestamp = () => new Date(now()).toISOString();

  async function runTask(task, search, adapter) {
    const { controller, run } = task;
    const { signal } = controller;
    const timer = setTimeout(
      () =>
        controller.abort({
          reason: 'timeout',
          message: 'The search exceeded its time limit.',
        }),
      timeoutMs,
    );
    timer.unref?.();
    let research;
    let mapping;
    try {
      signal.throwIfAborted();
      const prior = search.runs.findLast(({ status }) => status === 'ok');
      const priorIds = new Set(prior?.findingIds);
      const previousFindings =
        run.kind === 'update'
          ? search.findings.filter(({ id }) => priorIds.has(id))
          : [];
      research = await runResearch(adapter, {
        question: search.question,
        since: prior?.finishedAt,
        previousFindings,
        signal,
      });
      signal.throwIfAborted();
      await store.transact((records) => {
        const current = records.get(search.id);
        signal.throwIfAborted();
        return { ...current, running: { ...run, stage: 'map' } };
      });
      const {
        gazetteer = [],
        mapGazetteers = gazetteer,
        registry = [],
        nameSources = (sources) => sources,
      } = await loadContext({ signal });
      signal.throwIfAborted();
      mapping = await runMapStep(adapter, {
        question: search.question,
        notes: research.notes,
        sources: nameSources(research.sources),
        gazetteer: mapGazetteers,
        previousFindings,
        signal,
      });
      const { mapped } = mapping;
      const geocodes = new Map();
      for (const name of getUnresolvedPlaces({
        mapped,
        sources: research.sources,
        gazetteer,
      })) {
        signal.throwIfAborted();
        const result = await Promise.resolve()
          .then(() => geocode(name, { signal }))
          .catch((error) => {
            signal.throwIfAborted();
            logger.warn?.('[searches] Geocoding failed', error);
            return null;
          });
        if (result) geocodes.set(name, result);
      }
      await store.transact((records) => {
        signal.throwIfAborted();
        const { running, error, ...current } = records.get(search.id);
        const finishedAt = timestamp();
        return completeRun({
          search: current,
          mapped,
          sources: research.sources,
          gazetteer,
          registry,
          geocodes,
          run: {
            ...run,
            finishedAt,
            status: 'ok',
            agentModel: mapping.agentModel ?? research.agentModel,
            usage: usageTotal(
              research.usage,
              mapping.usage,
              Math.max(0, Date.parse(finishedAt) - Date.parse(run.startedAt)),
            ),
          },
        });
      });
    } catch (error) {
      const failure = terminalError(error, signal);
      await store.transact((records) => {
        const current = records.get(search.id);
        if (current?.running?.id !== run.id) return null;
        const finishedAt = timestamp();
        const failed = failSearch(current, failure, finishedAt);
        Object.assign(failed.runs.at(-1), {
          usage: usageTotal(
            research?.usage,
            mapping?.usage,
            Math.max(0, Date.parse(finishedAt) - Date.parse(run.startedAt)),
          ),
          agentModel: mapping?.agentModel ?? research?.agentModel ?? null,
        });
        return failed;
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function start({
    question,
    agent = DEFAULT_AGENT,
    id = 'sr_' + randomUUID(),
    action,
  }) {
    requireSupportedAgent(agent);
    if (lifecycle.signal.aborted)
      throw unavailable('The search server is closing.');
    if (active.has(agent))
      throw conflict('Claude Code is already running a search.');

    const task = { controller: new AbortController(), searchId: id, run: null };
    active.set(agent, task);
    let resolveAdmission;
    let rejectAdmission;
    const admitted = new Promise((resolve, reject) => {
      resolveAdmission = resolve;
      rejectAdmission = reject;
    });

    task.done = (async () => {
      const adapter = agents.get(agent);
      const status = (
        await agents.status({ signal: task.controller.signal, fresh: true })
      )[agent];
      if (task.controller.signal.aborted)
        throw unavailable('The search server is closing.');
      if (
        !adapter ||
        !status?.installed ||
        !status.signedIn ||
        status.disabledReason
      ) {
        throw unavailable(
          status?.disabledReason ||
            'Install and sign in to Claude Code to search.',
        );
      }
      const run = {
        id: makeRunId(),
        agent,
        startedAt: timestamp(),
        kind: 'ask',
      };
      const search = await store.transact((records) => {
        if (task.controller.signal.aborted)
          throw unavailable('The search server is closing.');
        let record;
        if (action === 'ask') {
          const colorIndex = freeColour(records);
          record = {
            id,
            question,
            agent,
            label: [...question.trim()].slice(0, 40).join(''),
            colorIndex,
            visible: colorIndex != null,
            pinned: false,
            createdAt: run.startedAt,
            sources: [],
            findings: [],
            runs: [],
          };
        } else {
          record = requireSearch(records.get(id));
          if (record.running) throw conflict('This search is already running.');
          const last = record.runs.at(-1);
          if (action === 'retry') {
            if (last?.status !== 'failed')
              throw conflict('Only a failed search can be retried.');
            run.kind = last.kind === 'update' ? 'update' : 'ask';
          } else {
            if (!record.runs.some(({ status }) => status === 'ok'))
              throw conflict('Retry this search before updating it.');
            run.kind = 'update';
          }
        }
        const { error, ...current } = record;
        return {
          ...current,
          status: 'running',
          running: { ...run, stage: 'research' },
        };
      });
      task.run = run;
      resolveAdmission({ id, runId: run.id });
      await runTask(task, search, adapter);
    })()
      .catch((error) => {
        if (task.run) logger.warn?.('[searches] Could not save run', error);
        else rejectAdmission(error);
      })
      .finally(() => active.delete(agent));
    return admitted;
  }

  function ask(input) {
    requireFields(input, ['question', 'agent']);
    if (
      typeof input.question !== 'string' ||
      !input.question.trim() ||
      [...input.question].length > 500
    ) {
      throw badRequest('Enter a question of up to 500 characters.');
    }
    return start({ ...input, action: 'ask' });
  }

  async function repeat(id, action) {
    const search = requireSearch(await store.get(id));
    return start({ id, agent: search.agent, action });
  }

  async function cancel(id) {
    const task = [...active.values()].find(
      ({ searchId, run }) => searchId === id && run,
    );
    if (!task) {
      requireSearch(await store.get(id));
      throw conflict('This search is not running.');
    }
    task.controller.abort({
      reason: 'cancelled',
      message: 'Search cancelled.',
    });
    return { id, runId: task.run.id };
  }

  async function patchSearch(id, patch) {
    validatePatch(patch);
    return store.transact((records) => {
      const record = requireSearch(records.get(id));
      const next = { ...record, ...patch };
      if ('label' in patch) {
        next.label = patch.label.trim();
        next.labelEdited = true;
      }
      if (patch.visible && !record.visible) {
        const colorIndex = freeColour(records);
        if (colorIndex == null)
          throw conflict(
            'Hide a search first: all ' +
              MAX_VISIBLE_SEARCHES +
              ' colours are in use',
          );
        next.colorIndex = colorIndex;
      }
      return next;
    });
  }

  function deleteSearch(id, findingId) {
    return store.transact((records) => {
      const record = requireSearch(records.get(id));
      if (record.running)
        throw conflict(
          'Cancel the running search before deleting it or its findings.',
        );
      if (!findingId) return { id, deleted: true };
      if (!record.findings.some(({ id }) => id === findingId)) throw missing();
      return {
        ...record,
        findings: record.findings.filter(({ id }) => id !== findingId),
        runs: record.runs.map((run) =>
          run.findingIds?.includes(findingId)
            ? {
                ...run,
                findingIds: run.findingIds.filter((id) => id !== findingId),
              }
            : run,
        ),
      };
    });
  }

  async function getWarStories() {
    try {
      return await loadWarStories();
    } catch (error) {
      logger.warn?.('[searches] Could not load war monitor links', error);
      return [];
    }
  }

  async function snapshot({ rev, asOf = null, timeZone = 'UTC' } = {}) {
    validateDay(asOf);
    const dayKey = snapshotDayKey(timeZone);
    const [status, warStories] = await Promise.all([
      agents.status({ signal: lifecycle.signal }),
      getWarStories(),
    ]);
    const records = await store.list();
    const searches = records
      .map((record) => buildRunSnapshot(record, { asOf, dayKey }))
      .filter(Boolean);
    const data = {
      asOf,
      days: listSearchDays(records, { dayKey }),
      agents: {
        claude: { ...status.claude, busy: active.has(DEFAULT_AGENT) },
        codex: CODEX_STATUS,
      },
      defaultAgent: DEFAULT_AGENT,
      searches: decorateSearchSnapshots(searches, { warStories }),
    };
    const revision = createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
    return rev === revision ? { unchanged: true } : { revision, ...data };
  }

  async function getRun(id, runId) {
    const [record, warStories] = await Promise.all([
      store.get(id),
      getWarStories(),
    ]);
    const search = buildRunSnapshot(requireSearch(record), { runId });
    if (!search) throw missing();
    return { search: decorateSearchSnapshots([search], { warStories })[0] };
  }

  async function getChanges(id, from, to) {
    const result = compareRuns(requireSearch(await store.get(id)), from, to);
    if (!result) throw missing();
    return result;
  }

  const update = (id) => repeat(id, 'update');
  const retry = (id) => repeat(id, 'retry');

  async function route(req, relativePath, params) {
    const method = req.method;
    if (!relativePath) {
      if (method === 'GET')
        return [
          200,
          await snapshot({
            rev: params.get('rev'),
            asOf: params.get('asOf'),
            timeZone: params.get('timeZone') ?? undefined,
          }),
        ];
      if (method === 'POST') return [202, await ask(await jsonBody(req))];
      throw requestError(405, 'method_not_allowed', 'Use GET or POST.');
    }
    const [empty, id, action, child, ...extra] = relativePath.split('/');
    if (empty || !SEARCH_ID.test(id) || extra.length) throw missing();
    if (action === undefined) {
      if (method === 'PATCH') {
        await patchSearch(id, await jsonBody(req));
        return [200, { id }];
      }
      if (method === 'DELETE') {
        await deleteSearch(id);
        return [200, { id }];
      }
      throw requestError(405, 'method_not_allowed', 'Use PATCH or DELETE.');
    }
    if (method === 'GET' && action === 'runs' && RUN_ID.test(child))
      return [200, await getRun(id, child)];
    if (
      method === 'DELETE' &&
      action === 'findings' &&
      FINDING_ID.test(child)
    ) {
      await deleteSearch(id, child);
      return [200, { id, findingId: child }];
    }
    if (child !== undefined) throw missing();
    if (method === 'GET' && action === 'changes') {
      const from = params.get('from');
      const to = params.get('to');
      if (!RUN_ID.test(from) || !RUN_ID.test(to))
        throw badRequest('Specify two run IDs.');
      return [200, await getChanges(id, from, to)];
    }
    if (method === 'POST' && ['update', 'retry', 'cancel'].includes(action)) {
      requireFields(await jsonBody(req), []);
      const result = await { update, retry, cancel }[action](id);
      return [202, result];
    }
    throw missing();
  }

  async function handle(req, res, next) {
    const target = req.url ?? '';
    const queryIndex = target.indexOf('?');
    const pathname = queryIndex < 0 ? target : target.slice(0, queryIndex);
    if (pathname !== PREFIX && !pathname.startsWith(PREFIX + '/')) {
      if (next) return next();
      return sendJson(res, 404, {
        error: 'not_found',
        reason: 'Search route not found.',
      });
    }
    try {
      const headers = req.headers ?? {};
      const verdict = admitSameSiteRequest({
        hostHeader: headers.host,
        protocol: req.socket?.encrypted ? 'https:' : 'http:',
        origin: headers.origin,
        secFetchSite: headers['sec-fetch-site'],
        proxyHeaders: headers,
      });
      if (!verdict.ok)
        throw requestError(verdict.status, 'forbidden', verdict.error);
      if (
        !LOOPBACK_ADDRESSES.has(req.socket?.remoteAddress) ||
        !LOCAL_HOST.test(headers.host ?? '')
      ) {
        throw requestError(
          403,
          'forbidden',
          'Searches are available only on the machine running the server.',
        );
      }
      const limiter = req.method === 'GET' ? readLimiter : writeLimiter;
      if (limiter && !limiter(clientKey(req)))
        throw requestError(
          429,
          'rate_limited',
          'Too many search requests. Try again shortly.',
        );
      const params = new URLSearchParams(
        queryIndex < 0 ? '' : target.slice(queryIndex + 1),
      );
      const [status, data] = await route(
        req,
        pathname.slice(PREFIX.length),
        params,
      );
      sendJson(res, status, data);
    } catch (error) {
      if (!error?.status) logger.warn?.('[searches] Request failed', error);
      sendJson(res, error?.status ?? 500, {
        error: error?.status ? error.code : 'search_error',
        reason: error?.status
          ? error.message
          : 'The search request could not be completed.',
      });
    }
  }

  async function dispose() {
    lifecycle.abort();
    for (const { controller } of active.values())
      controller.abort({
        reason: 'interrupted',
        message: 'The server stopped before the search finished.',
      });
    await Promise.all([...active.values()].map(({ done }) => done));
  }

  return {
    handle,
    snapshot,
    getRun,
    getChanges,
    ask,
    update,
    retry,
    cancel,
    dispose,
    store,
  };
}

async function jsonBody(req) {
  let text;
  try {
    text = await readRequestBody(req, BODY_BYTES);
  } catch (error) {
    if (error.code === 'BODY_TOO_LARGE')
      throw requestError(413, 'body_too_large', 'Search request is too large.');
    throw error;
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('Expected a JSON request body.');
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export function searchesProxy(options = {}) {
  function install(server) {
    const service = createSearchService(options);
    void service.store
      .ready?.()
      .catch((error) =>
        (options.logger ?? console).warn?.(
          '[searches] Could not open search store',
          error,
        ),
      );
    server.middlewares.use(service.handle);
    server.httpServer?.once('close', () => {
      void service.dispose();
    });
  }
  return {
    name: 'gev-searches',
    configureServer: install,
    configurePreviewServer: install,
  };
}
