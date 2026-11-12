import { FILING_AREA_IDS, KEEP_RULE, areaCriteria } from './areas.js';

/**
 * Jev (TypeSafe System One) as the headline filer: one request per item,
 * asking whether it belongs in a world-affairs digest and which board area
 * it mostly concerns. The request and the answer parsing are those of the
 * filing test of 2026-11-12 (qa-artifacts/filing-eval/filing-eval.mjs).
 *
 * A filing says which area a headline concerns and whether it belongs in a
 * world-affairs digest, never whether it is true.
 *
 * The key and the request and response bodies are never logged.
 */

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-1.14.0';
/** 0.042 US dollars per million input tokens; output is free. */
export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1e6;
export const KEEP_THRESHOLD = 0.5;
export const SECOND_AREA_MIN = 0.25;
/** Budget estimate per item before a batch is sent. */
export const JEV_ESTIMATED_INPUT_TOKENS_PER_ITEM = 1000;
/** Retries after a 429 or 529 (so up to four requests for one item). */
export const JEV_MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1500;
const MAX_RESPONSE_CHARS = 200_000;

/** The text Jev reads: outlet id, headline and, when present, the snippet. */
export function jevItemText(item) {
  return [
    'Outlet: ' + item.sourceId,
    'Headline: ' + item.title,
    item.snippet ? 'Snippet: ' + item.snippet : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The request body for one item. Pure.
 * @param {{sourceId: string, title: string, snippet?: string}} item
 * @param {{model?: string}} [options]
 */
export function jevRequest(item, { model = JEV_MODEL } = {}) {
  return {
    model,
    state: jevItemText(item),
    questions: {
      keep: {
        type: 'noul',
        instructions:
          'Does this news item belong in a daily digest of world affairs? ' +
          KEEP_RULE,
        criteria: {
          true: 'News about how a country or the world is governed, secured, supplied or held together.',
          false:
            'Sport, entertainment, lifestyle, human interest, routine local administration, an ordinary crime, minor company news, or ordinary weather.',
        },
      },
      area: {
        type: 'choice',
        instructions:
          'Which one part of a country does this news item mostly concern?',
        criteria: areaCriteria(),
      },
    },
  };
}

const probability = (value) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

/**
 * Read one Jev response body. Pure. Kept when the keep probability is at
 * least KEEP_THRESHOLD; the area is the most probable known area and the
 * second area the next one when its probability is at least
 * SECOND_AREA_MIN. Like the filing test, a set-aside item has no area.
 * Unknown area names are ignored. Returns null when the answer is malformed
 * (no keep probability, or no known area probability).
 * @param {unknown} body
 * @returns {?{keep: boolean, keepProbability: number, area: ?string, area2: ?string, areaProbability: number}}
 */
export function parseJevAnswer(body) {
  const answers = body?.answers;
  const p = answers?.keep?.noul;
  if (!probability(p)) return null;
  const probabilities = answers?.area?.probabilities;
  if (!probabilities || typeof probabilities !== 'object') return null;
  const ranked = Object.entries(probabilities)
    .filter(
      ([area, value]) => FILING_AREA_IDS.includes(area) && probability(value),
    )
    .sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const keep = p >= KEEP_THRESHOLD;
  return {
    keep,
    keepProbability: p,
    area: keep ? ranked[0][0] : null,
    area2:
      keep && ranked[1] && ranked[1][1] >= SECOND_AREA_MIN
        ? ranked[1][0]
        : null,
    areaProbability: ranked[0][1],
  };
}

/** Input tokens → US dollars. */
export function jevCostUsd(inputTokens) {
  return (Number(inputTokens) || 0) * JEV_USD_PER_INPUT_TOKEN;
}

/** How many items fit a remaining budget, at the per-item estimate. */
export function itemsWithinBudget(remainingUsd) {
  const perItem = jevCostUsd(JEV_ESTIMATED_INPUT_TOKENS_PER_ITEM);
  if (!(remainingUsd > 0)) return 0;
  return Math.floor(remainingUsd / perItem + 1e-9);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A Jev client that files lists of items.
 * @param {{
 *   apiKey: string,
 *   fetchImpl?: Function,
 *   model?: string,
 *   concurrency?: number,
 *   timeoutMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   log?: (line: string) => void,
 * }} options
 */
export function createJevFiler({
  apiKey,
  fetchImpl = (...args) => globalThis.fetch(...args),
  model = JEV_MODEL,
  concurrency = 4,
  timeoutMs = 30_000,
  sleep = defaultSleep,
  log = (line) => console.log(line),
}) {
  /** One item: resolves to {filing, model, inputTokens, requests} or throws a coded error. */
  async function fileOne(item, usage) {
    const body = JSON.stringify(jevRequest(item, { model }));
    for (let attempt = 0; ; attempt++) {
      let response;
      usage.requests++;
      try {
        response = await fetchImpl(JEV_ENDPOINT, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body,
        });
      } catch (error) {
        throw coded(error?.name === 'TimeoutError' ? 'timeout' : 'network');
      }
      if (response.status === 429 || response.status === 529) {
        if (attempt < JEV_MAX_RETRIES) {
          await sleep(BACKOFF_BASE_MS * 2 ** attempt);
          continue;
        }
        throw coded(response.status === 429 ? 'rate_limited' : 'overloaded');
      }
      if (response.status === 401 || response.status === 403)
        throw coded('auth');
      let payload = null;
      try {
        const raw = await response.text();
        if (raw.length <= MAX_RESPONSE_CHARS) payload = JSON.parse(raw);
      } catch {
        /* handled below */
      }
      if (!response.ok) throw coded(`http_${response.status}`);
      const inputTokens = Number(payload?.usage?.input_tokens);
      if (Number.isFinite(inputTokens) && inputTokens > 0)
        usage.inputTokens += inputTokens;
      const filing = parseJevAnswer(payload);
      if (!filing) throw coded('malformed');
      return {
        ...filing,
        model: typeof payload.model === 'string' ? payload.model : model,
      };
    }
  }

  return {
    model,

    /**
     * File a list of items, at most `concurrency` requests at a time. A 401
     * or 403 stops the batch: items not yet sent stay unsent.
     * @param {Array<object>} items
     * @param {{nowIso?: string}} [options]
     * @returns {Promise<{
     *   results: Array<{id: string, sent: boolean, filing: ?object, error: ?string}>,
     *   usage: {requests: number, inputTokens: number, costUsd: number},
     *   filed: number, failed: number, unsent: number, authError: boolean,
     * }>}
     */
    async file(items, { nowIso = new Date().toISOString() } = {}) {
      const usage = { requests: 0, inputTokens: 0, costUsd: 0 };
      const results = items.map((item) => ({
        id: item.id,
        sent: false,
        filing: null,
        error: null,
      }));
      let authError = false;
      let next = 0;
      const lane = async () => {
        while (!authError && next < items.length) {
          const index = next++;
          results[index].sent = true;
          try {
            const answer = await fileOne(items[index], usage);
            results[index].filing = { ...answer, filedAt: nowIso };
          } catch (error) {
            results[index].error = error?.code || 'error';
            if (error?.code === 'auth') authError = true;
          }
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.max(1, Math.min(concurrency, items.length)) },
          lane,
        ),
      );
      usage.costUsd = jevCostUsd(usage.inputTokens);
      const filed = results.filter((r) => r.filing).length;
      const kept = results.filter((r) => r.filing?.keep).length;
      const failed = results.filter((r) => r.error).length;
      const unsent = results.filter((r) => !r.sent).length;
      if (items.length)
        log(
          `[news] filing (Jev ${model}): ${filed} filed (${kept} kept, ${filed - kept} set aside), ${failed} failed${authError ? ' (key refused)' : ''}, ${unsent} unsent, ${usage.requests} requests, ${usage.inputTokens} input tokens, $${usage.costUsd.toFixed(5)}`,
        );
      return { results, usage, filed, failed, unsent, authError };
    },
  };
}

function coded(code) {
  return Object.assign(new Error(`Jev ${code}`), { code });
}
