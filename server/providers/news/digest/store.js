import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { closeStaleStories } from './stories.js';

/**
 * Stories and the digest run log for one theater, on disk at
 * .gev-cache/news/<theater>-digest.json. Cited items are snapshotted next to
 * the stories so every story can still expand to its sources after the
 * item store's 72 h retention drops them.
 */

const CACHE_VERSION = 1;
const CLOSED_RETENTION_MS = 7 * 24 * 3600_000;
const RUN_RETENTION_MS = 30 * 24 * 3600_000;
const RUN_LOG_CAP = 500;

/** Local calendar day of a timestamp; the daily budget resets at midnight. */
export function localDayKey(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Daily budget in USD from NEWS_DIGEST_DAILY_BUDGET_USD (default 2.00). */
export function dailyBudgetUsd(env = process.env) {
  const raw = String(env.NEWS_DIGEST_DAILY_BUDGET_USD ?? '').trim();
  if (raw === '') return 2;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 2;
}

/**
 * @param {{theaterId: string, cacheDir: string, now?: () => number}} options
 */
export function createDigestStore({ theaterId, cacheDir, now = Date.now }) {
  const cachePath = path.join(cacheDir, `${theaterId}-digest.json`);
  let stories = [];
  let runs = [];
  /** @type {Map<string, object>} */
  let citations = new Map();
  let revision = 0;
  let loaded = null;
  let saving = Promise.resolve();

  /** Close stale stories and drop expired ones; true when stories changed. */
  function retain() {
    const nowMs = now();
    const next = closeStaleStories(stories, nowMs).filter(
      (story) =>
        story.status === 'open' ||
        nowMs - Date.parse(story.updatedAt) < CLOSED_RETENTION_MS,
    );
    const changed =
      next.length !== stories.length ||
      next.some((story, index) => story !== stories[index]);
    stories = next;
    runs = runs.filter(
      (run) => nowMs - Date.parse(run.startedAt) < RUN_RETENTION_MS,
    );
    if (runs.length > RUN_LOG_CAP) {
      // Today's billed runs stay whatever the cap: the budget sums them.
      const today = localDayKey(nowMs);
      const newest = new Set(runs.slice(-RUN_LOG_CAP));
      runs = runs.filter(
        (run) =>
          newest.has(run) ||
          (Number(run.costUsd) > 0 &&
            localDayKey(Date.parse(run.startedAt)) === today),
      );
    }
    const cited = new Set(stories.flatMap((story) => story.itemIds));
    for (const id of citations.keys()) if (!cited.has(id)) citations.delete(id);
    return changed;
  }

  return {
    cachePath,

    load() {
      loaded ??= (async () => {
        try {
          const parsed = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
          if (parsed?.version !== CACHE_VERSION) return;
          stories = Array.isArray(parsed.stories) ? parsed.stories : [];
          runs = Array.isArray(parsed.runs) ? parsed.runs : [];
          citations = new Map(
            (Array.isArray(parsed.citations) ? parsed.citations : [])
              .filter((item) => typeof item?.id === 'string')
              .map((item) => [item.id, item]),
          );
          retain();
          revision++;
        } catch {
          /* no digest yet */
        }
      })();
      return loaded;
    },

    save() {
      saving = saving.then(async () => {
        const body = JSON.stringify({
          version: CACHE_VERSION,
          theater: theaterId,
          savedAt: new Date(now()).toISOString(),
          stories,
          runs,
          citations: [...citations.values()],
        });
        try {
          await fsp.mkdir(cacheDir, { recursive: true });
          const temporary = `${cachePath}.${process.pid}.tmp`;
          await fsp.writeFile(temporary, body, 'utf8');
          await fsp.rename(temporary, cachePath);
        } catch (error) {
          console.warn(
            '[news] digest cache write failed:',
            error?.code || error?.message || error,
          );
        }
      });
      return saving;
    },

    /** Stories after age-based closing, newest update first. */
    stories() {
      if (retain()) revision++;
      return [...stories].sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      );
    },

    runs() {
      return [...runs];
    },

    lastRun() {
      return runs.at(-1) ?? null;
    },

    /** The most recent run that produced stories (for the digest line). */
    lastCompletedRun() {
      for (let i = runs.length - 1; i >= 0; i--)
        if (runs[i].status === 'ok') return runs[i];
      return null;
    },

    /** Snapshot of a cited item the item store may already have dropped. */
    citation(id) {
      return citations.get(id) || null;
    },

    /** Sum of run costs started on the local day of `ms`. */
    spentOnDay(ms) {
      const day = localDayKey(ms);
      return runs
        .filter((run) => localDayKey(Date.parse(run.startedAt)) === day)
        .reduce((sum, run) => sum + (Number(run.costUsd) || 0), 0);
    },

    /** Record a run that did not change stories (skipped or failed). */
    recordRun(run) {
      runs.push(run);
      retain();
      revision++;
    },

    /**
     * Replace stories after a successful digest, snapshot every cited item
     * and append the run.
     * @param {{stories: Array<object>, run: object, citedItems: Array<object>}} update
     */
    commit({ stories: next, run, citedItems }) {
      stories = next;
      for (const item of citedItems) citations.set(item.id, item);
      runs.push(run);
      retain();
      revision++;
    },

    revision() {
      return revision;
    },
  };
}
