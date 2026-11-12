import {
  JEV_MODEL,
  createJevFiler,
  itemsWithinBudget,
  jevCostUsd,
  JEV_ESTIMATED_INPUT_TOKENS_PER_ITEM,
} from './jev.js';

/**
 * Filing for the War monitor: each collected headline is filed once by Jev
 * as kept or set aside, and into one of the board's twelve areas. A set-aside
 * item is never sent to the digest model. Filing fails open: an item that
 * could not be filed is treated as kept, and nothing here ever throws into
 * collection or the digest.
 */

export const FILING_MAX_ATTEMPTS = 3;
export const FILING_DEFAULT_BUDGET_USD = 0.25;
export const FILING_WHEN = Object.freeze(['collect', 'refresh']);
/** After the key is refused, collection does not try again for this long. */
export const FILING_AUTH_PAUSE_MS = 30 * 60_000;

/**
 * Filing settings from the server environment.
 * @param {Record<string, string|undefined>} env
 */
export function filingSettings(env = process.env) {
  const key = String(env.TYPESAFE_API_KEY ?? '').trim();
  const choice = String(env.NEWS_FILER ?? '')
    .trim()
    .toLowerCase();
  const filer =
    choice === 'off' ? 'off' : choice === 'jev' ? 'jev' : key ? 'jev' : 'off';
  const when = String(env.NEWS_FILER_WHEN ?? '')
    .trim()
    .toLowerCase();
  const budgetRaw = String(env.NEWS_FILER_DAILY_BUDGET_USD ?? '').trim();
  const budget = budgetRaw === '' ? NaN : Number(budgetRaw);
  return {
    filer,
    enabled: filer === 'jev' && Boolean(key),
    keyConfigured: Boolean(key),
    when: FILING_WHEN.includes(when) ? when : 'collect',
    model: String(env.NEWS_FILER_MODEL ?? '').trim() || JEV_MODEL,
    budgetUsd:
      Number.isFinite(budget) && budget >= 0
        ? budget
        : FILING_DEFAULT_BUDGET_USD,
  };
}

/** An item still to be filed: undigested, unfiled, under the attempt cap. */
export function needsFiling(item) {
  return (
    !item.digestedAt &&
    !item.filing &&
    (Number(item.filingAttempts) || 0) < FILING_MAX_ATTEMPTS
  );
}

/** Set aside by the filer: never sent to the digest model. */
export function isSetAside(item) {
  return item?.filing?.keep === false;
}

const roundUsd = (value) => Math.round(value * 1e7) / 1e7;

/**
 * One theater's filing runner: single-flight, budgeted, never throws.
 * @param {{
 *   store: ReturnType<import('../store.js').createNewsItemStore>,
 *   env?: Record<string, string|undefined>,
 *   fetchImpl?: Function,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   spentToday?: (nowMs: number) => number,
 *   log?: (line: string) => void,
 *   onChange?: () => void,
 * }} options
 */
export function createFilingRunner({
  store,
  env = process.env,
  fetchImpl,
  now = Date.now,
  sleep,
  spentToday = (nowMs) => store.filingUsage(nowMs).costUsd,
  log,
  onChange = () => {},
}) {
  let running = null;
  let again = false;
  let lastError = null;
  let authPausedUntil = 0;

  function setError(next) {
    const before = JSON.stringify(lastError);
    lastError = next;
    if (JSON.stringify(next) !== before) onChange();
  }

  /** One batch over the items that need filing now. */
  async function fileOnce({ fromCollect }) {
    const outcome = { filed: 0, failed: 0, unsent: 0, overBudget: 0 };
    try {
      const settings = filingSettings(env);
      if (!settings.enabled) return outcome;
      const nowMs = now();
      if (fromCollect && nowMs < authPausedUntil) return outcome;
      const pending = store.list().filter(needsFiling);
      if (!pending.length) return outcome;
      const remaining = settings.budgetUsd - spentToday(nowMs);
      const fits = Math.min(pending.length, itemsWithinBudget(remaining));
      outcome.overBudget = pending.length - fits;
      if (!fits) {
        log?.(
          `[news] filing: daily budget of $${settings.budgetUsd.toFixed(2)} used up; ${pending.length} items left unfiled`,
        );
        return outcome;
      }
      const batch = pending.slice(0, fits);
      const filer = createJevFiler({
        apiKey: String(env.TYPESAFE_API_KEY ?? '').trim(),
        fetchImpl,
        model: settings.model,
        ...(sleep && { sleep }),
        ...(log && { log }),
      });
      const result = await filer.file(batch, {
        nowIso: new Date(nowMs).toISOString(),
      });
      for (const row of result.results) {
        if (!row.sent) continue;
        store.noteFilingAttempt(row.id);
        if (row.filing) store.setFiling(row.id, row.filing);
      }
      store.addFilingUsage(nowMs, {
        requests: result.usage.requests,
        inputTokens: result.usage.inputTokens,
        costUsd: roundUsd(result.usage.costUsd),
      });
      outcome.filed = result.filed;
      outcome.failed = result.failed;
      outcome.unsent = result.unsent;
      if (result.authError) {
        authPausedUntil = nowMs + FILING_AUTH_PAUSE_MS;
        setError({
          code: 'auth',
          message: 'TypeSafe refused the key',
          at: new Date(nowMs).toISOString(),
        });
      } else if (result.failed) {
        const code = result.results.find((row) => row.error)?.error ?? 'error';
        setError({
          code,
          message: `${result.failed} of ${batch.length} headlines could not be filed (${code})`,
          at: new Date(nowMs).toISOString(),
        });
      } else setError(null);
      await store.save();
    } catch (error) {
      setError({
        code: 'error',
        message: String(error?.message || 'filing failed').slice(0, 160),
        at: new Date(now()).toISOString(),
      });
    }
    return outcome;
  }

  /**
   * File what needs filing. Single-flight: a call during a run asks for one
   * more pass after it and shares its promise. Never rejects.
   * @param {{fromCollect?: boolean}} [options]
   */
  function fileNow({ fromCollect = false } = {}) {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      const total = { filed: 0, failed: 0, unsent: 0, overBudget: 0 };
      do {
        again = false;
        const outcome = await fileOnce({ fromCollect });
        total.filed += outcome.filed;
        total.failed += outcome.failed;
        total.unsent += outcome.unsent;
        total.overBudget = outcome.overBudget;
      } while (again);
      return total;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    fileNow,
    /** Resolves when no batch is running (tests, shutdown). */
    async idle() {
      while (running) await running;
    },
    lastError: () => lastError,
  };
}

/** The per-item budget estimate in dollars (for docs and status). */
export const FILING_ESTIMATED_USD_PER_ITEM = jevCostUsd(
  JEV_ESTIMATED_INPUT_TOKENS_PER_ITEM,
);
