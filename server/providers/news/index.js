import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { defaultSourceRoot } from '../common/source-root.js';
import { gdeltQueue as defaultGdeltQueue } from './fetchers/gdeltDomain.js';
import { createNewsCollector } from './collector.js';
import { loadNewsRegistry } from './registry.js';
import { createNewsItemStore } from './store.js';

/**
 * War monitor news provider.
 *
 * Collect: feeds from the curated source directory are polled on timers
 * (RSS 10 min, Telegram 5 min, GDELT 15 min, ReliefWeb 30 min) into a 72 h
 * item store with a disk cache at .gev-cache/news/<theater>.json. Collection
 * for a theater starts on its first /api/news request and stops with the
 * server; importing or constructing the plugin performs no acquisition.
 *
 * Routes:
 *   GET /api/news?theater=&rev=  → items, stories, lastRun, sources, budget
 *                                  ({unchanged:true} when rev matches)
 *   GET /api/news/status         → per-theater collection health
 */

export const DEFAULT_NEWS_THEATER = 'iran-israel-us';
const THEATER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * @param {{
 *   root?: string,
 *   cacheDir?: string,
 *   fetchImpl?: Function,
 *   env?: Record<string, string|undefined>,
 *   now?: () => number,
 *   gdeltQueue?: object,
 *   timers?: {setInterval: Function, clearInterval: Function},
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
  } = options;
  /** @type {Map<string, Promise<object>>} */
  const contexts = new Map();
  let theaterList = null;
  let stopped = false;

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
    await store.load();
    const collector = createNewsCollector({
      registry,
      store,
      fetchImpl,
      env,
      now,
      queue: gdeltQueue,
      timers,
    });
    return { theaterId, registry, store, collector };
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

  function revisionOf(ctx) {
    return `${ctx.store.revision()}`;
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

  return {
    listTheaters,
    context,

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
      const revision = revisionOf(ctx);
      const retrievedAt = new Date(now()).toISOString();
      if (rev && rev === revision)
        return { unchanged: true, revision, retrievedAt };
      const { theater } = ctx.registry;
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
        items: ctx.store.list(),
        stories: [],
        lastRun: null,
        sources: sourceRows(ctx),
      };
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
      return { theaters, gdelt: gdeltQueue.state?.() ?? null };
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
