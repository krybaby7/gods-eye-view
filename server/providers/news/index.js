import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { admitSameSite } from '../common/same-site.js';
import { clientKey, makeRateLimiter } from '../common/rate-limit.js';
import { defaultSourceRoot } from '../common/source-root.js';
import { gdeltQueue as defaultGdeltQueue } from './fetchers/gdeltDomain.js';
import { createNewsCollector } from './collector.js';
import { loadNewsRegistry } from './registry.js';
import { createNewsItemStore } from './store.js';
import { DIGEST_MODEL, runDigest } from './digest/runner.js';
import { mergeDigest, storyByItem, unassignedItems } from './digest/stories.js';
import {
  createDigestStore,
  dailyBudgetUsd,
  localDayKey,
} from './digest/store.js';

/**
 * War monitor news provider.
 *
 * Collect: feeds from the curated source directory are polled on timers
 * (RSS 10 min, Telegram 5 min, GDELT 15 min, ReliefWeb 30 min) into a 72 h
 * item store with a disk cache at .gev-cache/news/<theater>.json. Collection
 * for a theater starts on its first /api/news request and stops with the
 * server; importing or constructing the plugin performs no acquisition.
 *
 * Digest: only on POST /api/news/digest (the Refresh control or the
 * refresh_news voice action), never on a timer. One run in flight at a
 * time; today's run costs are capped by NEWS_DIGEST_DAILY_BUDGET_USD.
 *
 * Routes:
 *   GET  /api/news?theater=&rev=  → items, stories, lastRun, sources, budget
 *                                   ({unchanged:true} when rev matches)
 *   POST /api/news/digest?theater= → run summary; 409 in flight, 429 over
 *                                   budget, 503 no_key, 200 skipped
 *   GET  /api/news/status         → per-theater collection health
 */

export const DEFAULT_NEWS_THEATER = 'iran-israel-us';
export const DIGEST_PROVIDER = 'Perplexity Agent API';
const THEATER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function roundUsd(value) {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * @param {{
 *   root?: string,
 *   cacheDir?: string,
 *   fetchImpl?: Function,
 *   env?: Record<string, string|undefined>,
 *   now?: () => number,
 *   gdeltQueue?: object,
 *   timers?: {setInterval: Function, clearInterval: Function},
 *   digestRunner?: typeof runDigest,
 * }} [options]
 */
export function createNewsService(options = {}) {
  const {
    root = defaultSourceRoot,
    cacheDir = path.join(process.cwd(), '.gev-cache', 'news'),
    fetchImpl,
    env = process.env,
    now = Date.now,
    gdeltQueue = defaultGdeltQueue,
    timers = globalThis,
    digestRunner = runDigest,
  } = options;
  /** @type {Map<string, Promise<object>>} */
  const contexts = new Map();
  let theaterList = null;
  let stopped = false;
  let runSerial = 0;

  const apiKey = () => String(env.PERPLEXITY_API_KEY || '').trim();

  /** Theater ids and names from public/news/theaters, validated once. */
  async function listTheaters() {
    theaterList ??= (async () => {
      let names = [];
      try {
        names = await fsp.readdir(
          path.join(root, 'public', 'news', 'theaters'),
        );
      } catch {
        return [];
      }
      const list = [];
      for (const file of names.sort()) {
        const id = file.replace(/\.json$/, '');
        if (!file.endsWith('.json') || !THEATER_ID.test(id)) continue;
        try {
          const { theater } = await loadNewsRegistry({ theaterId: id, root });
          list.push({ id: theater.id, name: theater.name });
        } catch (error) {
          console.warn(`[news] theater ${id} skipped:`, error?.message);
        }
      }
      return list;
    })();
    return theaterList;
  }

  async function createContext(theaterId) {
    const registry = await loadNewsRegistry({ theaterId, root });
    const store = createNewsItemStore({ theaterId, cacheDir, now });
    const digest = createDigestStore({ theaterId, cacheDir, now });
    await Promise.all([store.load(), digest.load()]);
    const ctx = {
      theaterId,
      registry,
      store,
      digest,
      inFlight: null,
      healthRevision: 0,
      perspectiveGroups: new Map(
        registry.theater.perspectives.map((p) => [p.id, p.group]),
      ),
    };
    ctx.collector = createNewsCollector({
      registry,
      store,
      fetchImpl,
      env,
      now,
      queue: gdeltQueue,
      timers,
      onUpdate: () => {
        ctx.healthRevision++;
      },
    });
    return ctx;
  }

  /** Resolve a theater context, or null for an unknown theater. */
  async function context(theaterId) {
    const id = theaterId || DEFAULT_NEWS_THEATER;
    const theaters = await listTheaters();
    if (!theaters.some((theater) => theater.id === id)) return null;
    if (!contexts.has(id)) {
      const pending = createContext(id);
      contexts.set(id, pending);
      pending.catch(() => contexts.delete(id));
    }
    return contexts.get(id);
  }

  /** Daily budget across every theater's digest log. */
  async function budget() {
    const nowMs = now();
    const dailyUsd = dailyBudgetUsd(env);
    let spent = 0;
    let lastRunCostUsd = null;
    let lastAt = -Infinity;
    for (const pending of contexts.values()) {
      const ctx = await pending.catch(() => null);
      if (!ctx) continue;
      spent += ctx.digest.spentOnDay(nowMs);
      const last = ctx.digest.lastRun();
      if (
        last &&
        last.status !== 'skipped' &&
        Date.parse(last.startedAt) > lastAt
      ) {
        lastAt = Date.parse(last.startedAt);
        lastRunCostUsd = Number(last.costUsd) || 0;
      }
    }
    return {
      dailyUsd,
      spentTodayUsd: roundUsd(spent),
      remainingUsd: roundUsd(Math.max(0, dailyUsd - spent)),
      exhausted: spent >= dailyUsd,
      lastRunCostUsd,
      day: localDayKey(nowMs),
    };
  }

  /** Why Refresh cannot run now, or null. */
  function disabledReason(ctx, budgetState) {
    if (!apiKey()) return 'no_key';
    if (ctx.inFlight) return 'in_flight';
    if (budgetState.exhausted) return 'over_budget';
    if (!ctx.store.undigested().length) return 'nothing_new';
    return null;
  }

  function revisionOf(ctx, budgetState) {
    return [
      ctx.store.revision(),
      ctx.digest.revision(),
      ctx.healthRevision,
      ctx.inFlight ? 1 : 0,
      apiKey() ? 1 : 0,
      budgetState.day,
    ].join('.');
  }

  function sourceRows(ctx) {
    const health = new Map(
      ctx.collector.health().map((entry) => [entry.sourceId, entry]),
    );
    return ctx.registry.theater.sourceIds.map((id) => {
      const source = ctx.registry.sourcesById.get(id);
      const { sourceId, ...state } = health.get(id);
      return {
        id: source.id,
        name: source.name,
        homepage: source.homepage,
        folder: source.folder,
        kind: source.kind,
        perspective: source.perspective,
        languages: source.languages,
        starred: source.starred,
        caution: source.caution,
        credit: source.credit,
        transport: source.transport.type,
        health: state,
      };
    });
  }

  function runId(nowMs) {
    runSerial = (runSerial + 1) % 1296;
    return `run_${nowMs.toString(36)}${runSerial.toString(36).padStart(2, '0')}`;
  }

  function failedRun(base, error, nowMs) {
    return {
      ...base,
      status: 'failed',
      finishedAt: new Date(nowMs).toISOString(),
      durationMs: nowMs - Date.parse(base.startedAt),
      error: error?.code || 'error',
      message: String(error?.message || 'digest failed').slice(0, 200),
      costUsd: roundUsd(Number(error?.cost?.costUsd) || 0),
      costEstimated: error?.cost?.estimated === true,
      inputTokens: error?.cost?.inputTokens ?? null,
      outputTokens: error?.cost?.outputTokens ?? null,
      model: error?.model ?? null,
    };
  }

  /** Run one digest for a context already admitted by requestDigest. */
  async function digestOnce(ctx, base) {
    const { theater, sourcesById } = ctx.registry;
    const nowMs = now();
    const previous = ctx.digest.stories();
    const itemsById = new Map();
    for (const story of previous)
      for (const id of story.itemIds) {
        const snapshot = ctx.digest.citation(id);
        if (snapshot) itemsById.set(id, snapshot);
      }
    for (const item of ctx.store.list()) itemsById.set(item.id, item);
    const result = await digestRunner({
      apiKey: apiKey(),
      theater,
      sourcesById,
      openStories: previous,
      newItems: ctx.store.undigested(),
      knownItemIds: new Set(itemsById.keys()),
      nowMs,
      fetchImpl,
    });
    const finishedMs = now();
    const finishedIso = new Date(finishedMs).toISOString();
    const merged = mergeDigest({
      previous,
      validated: result.stories,
      itemsById,
      theaterId: theater.id,
      gazetteer: theater.gazetteer,
      perspectiveGroups: ctx.perspectiveGroups,
      runId: base.id,
      nowIso: finishedIso,
    });
    const unassigned = unassignedItems(result.processedItemIds, merged.stories);
    const run = {
      ...base,
      status: 'ok',
      finishedAt: finishedIso,
      durationMs: finishedMs - Date.parse(base.startedAt),
      itemCount: result.processedItemIds.length,
      leftOut: result.leftOut,
      openStoriesSent: result.openStoryIds.length,
      storiesCreated: merged.created,
      storiesUpdated: merged.updated,
      storyCount: merged.stories.filter((s) => s.status === 'open').length,
      locatedCount: merged.stories.filter(
        (s) => s.status === 'open' && s.location,
      ).length,
      unassignedCount: unassigned.length,
      droppedItemIds: result.counts.droppedItemIds,
      duplicateItemIds: result.counts.duplicateItemIds,
      rejectedStories: result.counts.rejectedStories,
      unknownStoryIds: result.counts.unknownStoryIds,
      clampedCategories: result.counts.clampedCategories,
      costUsd: roundUsd(result.cost.costUsd),
      costEstimated: result.cost.estimated,
      inputTokens: result.cost.inputTokens,
      outputTokens: result.cost.outputTokens,
      model: result.model,
      responseId: result.responseId,
    };
    const citedItems = [];
    for (const story of merged.stories)
      for (const id of story.itemIds) {
        const item = itemsById.get(id);
        if (item) citedItems.push(item);
      }
    ctx.digest.commit({ stories: merged.stories, run, citedItems });
    ctx.store.markDigested(
      result.processedItemIds,
      storyByItem(merged.stories),
      finishedIso,
    );
    await Promise.all([ctx.digest.save(), ctx.store.save()]);
    return run;
  }

  return {
    listTheaters,
    context,
    budget,

    /**
     * Snapshot for the browser layer and Situation panel. Starts the
     * theater's collector on first use.
     * @param {string} theaterId
     * @param {{rev?: string}} [query]
     */
    async snapshot(theaterId, { rev } = {}) {
      const ctx = await context(theaterId);
      if (!ctx) return null;
      if (!stopped) ctx.collector.start();
      const budgetState = await budget();
      const stories = ctx.digest.stories();
      const revision = revisionOf(ctx, budgetState);
      const retrievedAt = new Date(now()).toISOString();
      if (rev && rev === revision)
        return { unchanged: true, revision, retrievedAt };
      const { theater } = ctx.registry;
      const items = ctx.store.list();
      const inStore = new Set(items.map((item) => item.id));
      const citations = [];
      for (const story of stories)
        for (const id of story.itemIds) {
          if (inStore.has(id)) continue;
          const snapshot = ctx.digest.citation(id);
          if (snapshot) citations.push(snapshot);
        }
      return {
        revision,
        retrievedAt,
        theater: {
          id: theater.id,
          name: theater.name,
          categories: theater.categories,
          perspectives: theater.perspectives,
        },
        theaters: await listTheaters(),
        items,
        citations,
        stories,
        lastRun: ctx.digest.lastRun(),
        lastDigest: ctx.digest.lastCompletedRun(),
        sources: sourceRows(ctx),
        budget: budgetState,
        digest: {
          provider: DIGEST_PROVIDER,
          model: DIGEST_MODEL,
          keyConfigured: Boolean(apiKey()),
          running: Boolean(ctx.inFlight),
          startedAt: ctx.inFlight?.startedAt ?? null,
          disabledReason: disabledReason(ctx, budgetState),
          undigestedCount: ctx.store.undigested().length,
        },
      };
    },

    /**
     * Run one digest now. Resolves to an HTTP status and body; never throws.
     * @param {string} theaterId
     */
    async requestDigest(theaterId) {
      const ctx = await context(theaterId);
      if (!ctx) return { status: 404, body: { error: 'unknown_theater' } };
      if (!apiKey())
        return {
          status: 503,
          body: { error: 'no_key', keyRequired: true },
        };
      if (ctx.inFlight)
        return {
          status: 409,
          body: { error: 'in_flight', startedAt: ctx.inFlight.startedAt },
        };
      const budgetState = await budget();
      if (budgetState.exhausted)
        return {
          status: 429,
          body: {
            error: 'over_budget',
            reason: `Today's digests cost $${budgetState.spentTodayUsd.toFixed(2)} of the $${budgetState.dailyUsd.toFixed(2)} daily budget`,
            budget: budgetState,
          },
        };
      const startedMs = now();
      const base = {
        id: runId(startedMs),
        theater: ctx.theaterId,
        startedAt: new Date(startedMs).toISOString(),
      };
      if (!ctx.store.undigested().length) {
        const run = {
          ...base,
          status: 'skipped',
          finishedAt: base.startedAt,
          durationMs: 0,
          message: 'Nothing new since the last digest',
          costUsd: 0,
        };
        ctx.digest.recordRun(run);
        await ctx.digest.save();
        return {
          status: 200,
          body: { skipped: true, message: run.message, run },
        };
      }
      ctx.inFlight = { startedAt: base.startedAt };
      try {
        const run = await digestOnce(ctx, base);
        console.log(
          `[news] digest ${ctx.theaterId}: ${run.storiesCreated} new, ${run.storiesUpdated} updated, ${run.unassignedCount} unassigned, $${run.costUsd.toFixed(4)}`,
        );
        return { status: 200, body: { ok: true, run, budget: await budget() } };
      } catch (error) {
        const run = failedRun(base, error, now());
        ctx.digest.recordRun(run);
        await ctx.digest.save();
        console.warn(
          `[news] digest ${ctx.theaterId} failed: ${run.error} ($${run.costUsd.toFixed(4)})`,
        );
        return {
          status: error?.code === 'no_key' ? 503 : 502,
          body: { error: run.error, message: run.message, run },
        };
      } finally {
        ctx.inFlight = null;
      }
    },

    async status() {
      const theaters = [];
      for (const { id, name } of await listTheaters()) {
        const pending = contexts.get(id);
        const ctx = pending ? await pending.catch(() => null) : null;
        const health = ctx ? ctx.collector.health() : [];
        theaters.push({
          id,
          name,
          collecting: ctx ? ctx.collector.running() : false,
          itemCount: ctx ? ctx.store.size() : 0,
          storyCount: ctx
            ? ctx.digest.stories().filter((s) => s.status === 'open').length
            : 0,
          lastRun: ctx ? ctx.digest.lastRun() : null,
          digestRunning: Boolean(ctx?.inFlight),
          sources: {
            total: health.length,
            ok: health.filter((h) => h.ok).length,
            degraded: health.filter((h) => h.degraded).length,
            blocked: health.filter((h) => h.blocked).length,
            disabled: health.filter((h) => h.disabled && !h.linkOnly).length,
            linkOnly: health.filter((h) => h.linkOnly).length,
            fragile: health.filter((h) => h.fragile).length,
          },
        });
      }
      return {
        keyConfigured: Boolean(apiKey()),
        budget: await budget(),
        theaters,
        gdelt: gdeltQueue.state?.() ?? null,
      };
    },

    /** Stop every collector timer (server close). */
    async stop() {
      stopped = true;
      for (const pending of contexts.values()) {
        const ctx = await pending.catch(() => null);
        ctx?.collector.stop();
      }
    },
  };
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/**
 * Vite plugin mounting /api/news on the dev and preview servers.
 * @param {Parameters<typeof createNewsService>[0]} [options]
 * @returns {import('vite').Plugin}
 */
export function newsProxy(options = {}) {
  const installMiddleware = (server) => {
    const service = createNewsService(options);
    // Digests cost money: a few per minute per client is far above any
    // real use of the Refresh control.
    const allowDigest = makeRateLimiter({
      windowMs: 60_000,
      max: 4,
      globalMax: 12,
    });
    server.httpServer?.once?.('close', () => void service.stop());
    server.middlewares.use('/api/news', async (req, res) => {
      try {
        const url = new URL(String(req.url || '/'), 'http://local');
        const subPath = url.pathname.replace(/\/+$/, '') || '/';
        const theaterId = url.searchParams.get('theater') || undefined;
        if (subPath === '/status') {
          if (req.method !== 'GET')
            return sendJson(res, 405, { error: 'method_not_allowed' });
          return sendJson(res, 200, await service.status());
        }
        if (subPath === '/digest') {
          if (req.method !== 'POST')
            return sendJson(res, 405, { error: 'method_not_allowed' });
          if (admitSameSite(req, res)) return undefined;
          if (!allowDigest(clientKey(req)))
            return sendJson(res, 429, { error: 'rate_limited' });
          const { status, body } = await service.requestDigest(theaterId);
          return sendJson(res, status, body);
        }
        if (subPath === '/') {
          if (req.method !== 'GET')
            return sendJson(res, 405, { error: 'method_not_allowed' });
          const payload = await service.snapshot(theaterId, {
            rev: url.searchParams.get('rev') || undefined,
          });
          if (!payload) return sendJson(res, 404, { error: 'unknown_theater' });
          return sendJson(res, 200, payload);
        }
        return sendJson(res, 404, { error: 'not_found' });
      } catch (error) {
        console.warn('[news] request failed:', error?.message || error);
        return sendJson(res, 500, { error: 'news provider error' });
      }
    });
  };
  return {
    name: 'news-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
