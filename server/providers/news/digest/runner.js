import { placeNamesForPrompt } from '../geocode.js';

/**
 * One war monitor digest: assemble the input, make one Perplexity Agent API
 * call (Claude Sonnet 5.5, no tools, one step, strict JSON schema output) and
 * validate what comes back. Runs only on an explicit Refresh; nothing here is
 * ever scheduled.
 *
 * Request fields verified against the official Perplexity SDK types and
 * OpenAPI spec (perplexity-node src/generated/api.ts, 2026-10-22):
 * `instructions`, `input` message items, `tools`,
 * `max_steps`, `max_output_tokens`,
 * `response_format: {type: "json_schema", json_schema: {name, schema, strict}}`,
 * and `usage.cost.total_cost` on the response. No `effort`/`preset` is sent,
 * so no preset tools attach. The endpoint is POST /v1/agent, as
 * docs.perplexity.ai documents it on 2026-10-28; the older /v1/responses
 * path is no longer documented for creating a response.
 *
 * The key and the request/response bodies are never logged.
 */

export const DIGEST_ENDPOINT = 'https://api.perplexity.ai/v1/agent';
export const DIGEST_MODEL = 'anthropic/claude-sonnet-5-5';
/**
 * Hidden reasoning counts toward this limit. Two live runs (249 and 334
 * items, no open stories) used about 14,300 tokens each, 3,100 to 3,700 of
 * them reasoning, so 64,000 leaves room for the design caps of 400 items and
 * 60 open stories. Only tokens actually written are billed.
 */
export const DIGEST_MAX_OUTPUT_TOKENS = 64000;
export const DIGEST_ITEM_CAP = 400;
export const DIGEST_OPEN_STORY_CAP = 60;
/** Claims kept per story, so each story stays short. */
export const DIGEST_CLAIM_CAP = 5;
/** List price per million tokens, used only when a response omits its cost. */
export const DIGEST_FALLBACK_PRICE_PER_MTOK = Object.freeze({
  input: 2,
  output: 10,
});
export const CLAIM_TYPES = Object.freeze([
  'occurrence',
  'attribution',
  'casualty',
  'damage',
  'statement',
  'denial',
  'intent',
  'other',
]);
/**
 * An event happened at a place (a strike, a protest) and gets a pin; a
 * development is a change with no meaningful point (a sanction, talks, a
 * ruling) and appears only in the Stories list and the Brief.
 */
export const STORY_KINDS = Object.freeze(['event', 'development']);
// The live runs wrote about 95 tokens a second, so a full 64k-token answer
// takes about 11 minutes; a slower call is charged an estimate.
const TIMEOUT_MS = 900_000;
const MAX_RESPONSE_CHARS = 2_000_000;

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

/**
 * Strict output schema. Claude structured outputs accept `anyOf`, `enum` and
 * `additionalProperties: false` but no numeric or length constraints, so the
 * bounds are enforced by validateDigestOutput instead.
 * @param {string[]} categoryIds
 * @param {string[]} [actorIds] The theater's actor ids.
 */
export function digestSchema(categoryIds, actorIds = []) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['stories'],
    properties: {
      stories: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'title',
            'summary',
            'category',
            'placeName',
            'lat',
            'lon',
            'eventAt',
            'itemIds',
            'claims',
            'whatsNew',
            'contradictions',
            'status',
            'kind',
            'actorIds',
          ],
          properties: {
            id: nullable({ type: 'string' }),
            title: { type: 'string' },
            summary: { type: 'string' },
            category: { type: 'string', enum: [...categoryIds] },
            placeName: nullable({ type: 'string' }),
            lat: nullable({ type: 'number' }),
            lon: nullable({ type: 'number' }),
            eventAt: nullable({ type: 'string' }),
            itemIds: { type: 'array', items: { type: 'string' } },
            claims: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'actor', 'type', 'itemIds'],
                properties: {
                  text: { type: 'string' },
                  actor: nullable({ type: 'string' }),
                  type: { type: 'string', enum: [...CLAIM_TYPES] },
                  itemIds: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            whatsNew: { type: 'string' },
            contradictions: { type: 'array', items: { type: 'string' } },
            status: { type: 'string', enum: ['open', 'closed'] },
            kind: { type: 'string', enum: [...STORY_KINDS] },
            actorIds: {
              type: 'array',
              items: actorIds.length
                ? { type: 'string', enum: [...actorIds] }
                : { type: 'string' },
            },
          },
        },
      },
    },
  };
}

const HANDLING_RULES = `You are the digest editor for a personal war-monitoring map. You receive news items collected from a curated source directory, and the stories still open from the previous digest. Group the items into stories, one story per real-world event, and answer with JSON matching the schema.

Handling rules:
1. Track claims, not articles. A story is one event; each claim is one statement about it, with its type and, when attributed, the actor making it.
2. Separate event time from publication time. eventAt is when the event happened (ISO 8601, UTC), or null when the items do not say. Never use a publication time as the event time.
3. Preserve the original source. Cite item ids exactly as given. Never output URLs, and never cite an id you were not given.
4. Keep uncertainty visible. Attribute every claim ("IRNA said...", "the IDF said..."). Do not state a party's claim as fact. Add no adjectives of your own.
5. Deduplicate shared evidence. Items repeating one statement or report describe the same event; put them in the same story.
6. Preserve original language. Item titles may be Arabic, Hebrew, Persian or another language; read them as published, but write titles, summaries, claims and what's new in English.
7. Keep civilian and dissenting voices visible. Cite local, humanitarian and dissenting items even when a larger outlet covers the same event.
8. Allow unknown. Use null for an unknown place, coordinates or event time. Leave an item unassigned when you are unsure which story it belongs to.

Output rules:
- Prefer updating an open story over creating a new one. To update, return the story with its existing id and the complete list of item ids it cites, old and new. A new story has id null.
- Put an item in at most one story; leave it unassigned if unsure. Return only stories you create or change; open stories you leave out stay as they were.
- Set status "closed" only when the items show the event is over; otherwise "open".
- category: exactly one id from the category list.
- placeName: the most specific place the items name, spelled as in the gazetteer when it appears there, or null. lat and lon: only for a place missing from the gazetteer whose coordinates you know; otherwise null.
- Keep every story short; the whole answer must fit the output limit.
- itemIds: only the items that report this event.
- title: a neutral English headline of at most 120 characters. summary: at most two short attributed sentences.
- whatsNew: one short sentence on what this digest's new items add; "" for a new story.
- claims: at most ${DIGEST_CLAIM_CAP} per story, the most important first.
- contradictions: one sentence per conflict between sources ("IRNA says X; CENTCOM says Y."), else [].
- claims[].itemIds: the cited items that carry that claim.
- kind: "event" for something that happened at a place (a strike, an interception, a protest); "development" for a change with no meaningful point on a map (a sanction, talks, a ruling, a statement of policy, a mobilisation order).
- actorIds: ids from the actor list of the actors the story involves, [] when none applies. Use the list's ids only.`;

/**
 * Fixed instructions: rules, theater brief, categories and gazetteer names.
 * Identical across runs for one theater, so a provider-side prefix cache can
 * reuse it.
 * @param {object} theater Validated theater.
 */
export function buildDigestInstructions(theater) {
  const categories = theater.categories
    .map((category) => `- ${category.id}: ${category.label}`)
    .join('\n');
  return [
    HANDLING_RULES,
    `Theater: ${theater.name}\n${theater.brief.join('\n\n')}`,
    `Categories:\n${categories}`,
    `Actors (id: name, aliases in parentheses):\n${actorListForPrompt(theater.actors) || '(none)'}`,
    `Gazetteer place names (aliases in parentheses):\n${placeNamesForPrompt(theater.gazetteer).join('\n')}`,
  ].join('\n\n');
}

/**
 * "- iran: Iran (Tehran, IRGC)" per actor, with " — state, party" appended
 * for the brief prompt.
 */
export function actorListForPrompt(actors = [], { withRole = false } = {}) {
  return actors
    .map(
      (actor) =>
        `- ${actor.id}: ${actor.name}${actor.aliases?.length ? ` (${actor.aliases.join(', ')})` : ''}${withRole ? ` — ${actor.type}, ${actor.role}` : ''}`,
    )
    .join('\n');
}

function itemTime(item) {
  const ms = Date.parse(item.publishedAt || item.collectedAt || '');
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * New items for one run. Over the cap, non-starred sources' oldest items are
 * left out first, then starred sources' oldest.
 * @param {Array<object>} items Undigested items.
 * @param {Map<string, object>} sourcesById
 * @param {number} [cap]
 * @returns {{items: Array<object>, leftOut: number}}
 */
export function selectDigestItems(items, sourcesById, cap = DIGEST_ITEM_CAP) {
  const ranked = [...items].sort(
    (a, b) =>
      Number(sourcesById.get(b.sourceId)?.starred === true) -
        Number(sourcesById.get(a.sourceId)?.starred === true) ||
      itemTime(b) - itemTime(a),
  );
  const kept = ranked.slice(0, cap).sort((a, b) => itemTime(b) - itemTime(a));
  return { items: kept, leftOut: Math.max(0, ranked.length - cap) };
}

/** Open stories for the input, most recently updated first. */
export function selectOpenStories(stories, cap = DIGEST_OPEN_STORY_CAP) {
  return stories
    .filter((story) => story.status === 'open')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, cap);
}

/**
 * The per-run user message: open stories, then new items.
 * @param {{openStories: Array<object>, items: Array<object>, sourcesById: Map<string, object>, nowIso: string}} input
 */
export function buildDigestInput({ openStories, items, sourcesById, nowIso }) {
  const stories = openStories.map((story) => ({
    id: story.id,
    title: story.title,
    category: story.category,
    place: story.place?.name ?? null,
    eventAt: story.eventAt,
    itemIds: story.itemIds,
    claims: (story.claims || []).map(({ text, actor, type }) => ({
      text,
      actor,
      type,
    })),
    kind: story.kind === 'development' ? 'development' : 'event',
    actorIds: story.actorIds || [],
  }));
  const newItems = items.map((item) => ({
    id: item.id,
    publisher: sourcesById.get(item.sourceId)?.name ?? item.sourceId,
    kind: item.kind,
    perspective: item.perspective,
    publishedAt: item.publishedAt,
    title: item.titleOriginal || item.title,
    snippet: item.snippet || '',
  }));
  return `Digest time: ${nowIso}

Open stories (${stories.length}):
${JSON.stringify(stories)}

New items (${newItems.length}):
${JSON.stringify(newItems)}`;
}

/** The Agent API request body. */
export function buildDigestRequest({
  instructions,
  input,
  categoryIds,
  actorIds = [],
}) {
  return {
    model: DIGEST_MODEL,
    instructions,
    input: [{ type: 'message', role: 'user', content: input }],
    tools: [],
    max_steps: 1,
    max_output_tokens: DIGEST_MAX_OUTPUT_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'war_monitor_digest',
        schema: digestSchema(categoryIds, actorIds),
        strict: true,
      },
    },
    stream: false,
  };
}

/** Concatenate the assistant message text, as the official SDK does. */
export function responseOutputText(body) {
  const texts = [];
  for (const item of Array.isArray(body?.output) ? body.output : []) {
    if (item?.type !== 'message') continue;
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part.text === 'string')
        texts.push(part.text);
    }
  }
  return texts.join('');
}

/**
 * Cost of one response: `usage.cost.total_cost` when present, otherwise an
 * estimate from token counts at list price, flagged as estimated.
 */
export function responseCost(body) {
  const usage = body?.usage || {};
  const reported = Number(usage.cost?.total_cost);
  const inputTokens = Number(usage.input_tokens) || 0;
  const outputTokens = Number(usage.output_tokens) || 0;
  if (Number.isFinite(reported) && reported >= 0)
    return { costUsd: reported, estimated: false, inputTokens, outputTokens };
  return {
    costUsd:
      (inputTokens * DIGEST_FALLBACK_PRICE_PER_MTOK.input +
        outputTokens * DIGEST_FALLBACK_PRICE_PER_MTOK.output) /
      1e6,
    estimated: true,
    inputTokens,
    outputTokens,
  };
}

/**
 * Hidden reasoning tokens (counted inside output_tokens) when the response
 * reports them, else null.
 */
export function responseReasoningTokens(body) {
  const usage = body?.usage || {};
  const value = Number(
    usage.output_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens,
  );
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Parse the model's JSON text; tolerate a code fence, nothing else. */
export function parseDigestText(text) {
  const trimmed = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;

/** Model text without URLs or runs of whitespace, cut to `max` characters. */
export function cleanText(value, max) {
  const text = String(value ?? '')
    .replace(URL_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function validEventAt(value, nowMs) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || ms > nowMs + 24 * 3600_000) return null;
  return new Date(ms).toISOString();
}

/**
 * Validate model output against the store. Unknown item ids are dropped and
 * counted, an item cited by two stories stays with the first, stories left
 * with no valid ids are rejected, unknown story ids become new stories and
 * categories are clamped to the theater list. Kind defaults to event and
 * actor ids outside the theater list are dropped and counted. Text fields
 * lose URLs.
 * @param {unknown} output Parsed JSON.
 * @param {{knownItemIds: Set<string>, openStories: Map<string, object>, categoryIds: string[], actorIds?: string[], nowMs: number}} context
 */
export function validateDigestOutput(
  output,
  { knownItemIds, openStories, categoryIds, actorIds = [], nowMs },
) {
  if (!Array.isArray(output?.stories)) {
    const error = new Error('digest output has no stories array');
    error.code = 'malformed_output';
    throw error;
  }
  const counts = {
    droppedItemIds: 0,
    duplicateItemIds: 0,
    rejectedStories: 0,
    unknownStoryIds: 0,
    clampedCategories: 0,
    droppedActorIds: 0,
  };
  const knownActors = new Set(actorIds);
  const assigned = new Set();
  const usedStoryIds = new Set();
  const stories = [];
  for (const raw of output.stories) {
    if (!raw || typeof raw !== 'object') {
      counts.rejectedStories++;
      continue;
    }
    const itemIds = [];
    for (const id of Array.isArray(raw.itemIds) ? raw.itemIds : []) {
      if (typeof id !== 'string' || !knownItemIds.has(id)) {
        counts.droppedItemIds++;
        continue;
      }
      if (assigned.has(id)) {
        if (!itemIds.includes(id)) counts.duplicateItemIds++;
        continue;
      }
      assigned.add(id);
      itemIds.push(id);
    }
    if (!itemIds.length) {
      counts.rejectedStories++;
      continue;
    }
    let id = null;
    if (typeof raw.id === 'string' && raw.id) {
      if (openStories.has(raw.id) && !usedStoryIds.has(raw.id)) {
        id = raw.id;
        usedStoryIds.add(id);
      } else counts.unknownStoryIds++;
    }
    let category = raw.category;
    if (!categoryIds.includes(category)) {
      counts.clampedCategories++;
      category = openStories.get(id)?.category ?? categoryIds[0];
    }
    const lat =
      Number.isFinite(raw.lat) && Math.abs(raw.lat) <= 90 ? raw.lat : null;
    const lon =
      Number.isFinite(raw.lon) && Math.abs(raw.lon) <= 180 ? raw.lon : null;
    const storyItems = new Set(itemIds);
    const storyActors = [];
    for (const actorId of Array.isArray(raw.actorIds) ? raw.actorIds : []) {
      if (typeof actorId !== 'string' || !knownActors.has(actorId))
        counts.droppedActorIds++;
      else if (!storyActors.includes(actorId)) storyActors.push(actorId);
    }
    stories.push({
      id,
      title: cleanText(raw.title, 160) || 'Untitled story',
      summary: cleanText(raw.summary, 600),
      category,
      placeName:
        typeof raw.placeName === 'string' && raw.placeName.trim()
          ? cleanText(raw.placeName, 120)
          : null,
      lat: lat !== null && lon !== null ? lat : null,
      lon: lat !== null && lon !== null ? lon : null,
      eventAt: validEventAt(raw.eventAt, nowMs),
      itemIds,
      claims: (Array.isArray(raw.claims) ? raw.claims : [])
        .filter((claim) => claim && typeof claim.text === 'string')
        .slice(0, DIGEST_CLAIM_CAP)
        .map((claim) => ({
          text: cleanText(claim.text, 300),
          actor:
            typeof claim.actor === 'string' && claim.actor.trim()
              ? cleanText(claim.actor, 60)
              : null,
          type: CLAIM_TYPES.includes(claim.type) ? claim.type : 'other',
          itemIds: (Array.isArray(claim.itemIds) ? claim.itemIds : []).filter(
            (itemId) => storyItems.has(itemId),
          ),
        }))
        .filter((claim) => claim.text),
      whatsNew: cleanText(raw.whatsNew, 300),
      contradictions: (Array.isArray(raw.contradictions)
        ? raw.contradictions
        : []
      )
        .filter((line) => typeof line === 'string')
        .map((line) => cleanText(line, 300))
        .filter(Boolean)
        .slice(0, 8),
      status: raw.status === 'closed' ? 'closed' : 'open',
      kind: raw.kind === 'development' ? 'development' : 'event',
      actorIds: storyActors,
    });
  }
  return { stories, counts };
}

function digestError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

/**
 * What a sent request may have cost when no usage came back (timed out or
 * cut off mid-answer): the input at about three characters a token and a
 * full-length answer (the request's own output limit), at list price,
 * flagged as an estimate. Errs high so the daily budget still counts the
 * call.
 */
export function worstCaseCost(body) {
  const inputTokens = Math.ceil(JSON.stringify(body).length / 3);
  const outputTokens = body?.max_output_tokens ?? DIGEST_MAX_OUTPUT_TOKENS;
  return {
    costUsd:
      (inputTokens * DIGEST_FALLBACK_PRICE_PER_MTOK.input +
        outputTokens * DIGEST_FALLBACK_PRICE_PER_MTOK.output) /
      1e6,
    estimated: true,
    inputTokens,
    outputTokens,
  };
}

function upstreamMessage(body) {
  const message = body?.error?.message ?? body?.detail?.[0]?.msg ?? '';
  return String(message)
    .replace(URL_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * Call the Agent API once. The digest and the Situation Brief share it;
 * `label` names the call in error messages.
 * @param {{apiKey: string, body: object, fetchImpl?: Function, signal?: AbortSignal, label?: string}} options
 * @returns {Promise<{text: string, model: ?string, status: string, cost: ReturnType<typeof responseCost>, reasoningTokens: ?number, responseId: ?string}>}
 *   Throws an error with `code` and, when the provider billed the call, `cost`.
 */
export async function callDigestModel({
  apiKey,
  body,
  fetchImpl = (...args) => globalThis.fetch(...args),
  signal,
  label = 'digest',
}) {
  if (!apiKey) throw digestError('no_key', 'PERPLEXITY_API_KEY is not set');
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(DIGEST_ENDPOINT, {
      method: 'POST',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    // A timeout means the request was sent and may be billed; a failed
    // connection was not.
    if (error?.name === 'TimeoutError')
      throw digestError('timeout', `${label} request timed out`, {
        cost: worstCaseCost(body),
      });
    throw digestError('network', `${label} request failed to connect`);
  }
  let raw;
  try {
    raw = await response.text();
  } catch (error) {
    throw digestError(
      error?.name === 'TimeoutError' ? 'timeout' : 'network',
      error?.name === 'TimeoutError'
        ? `${label} request timed out`
        : `${label} response was cut off`,
      { cost: worstCaseCost(body) },
    );
  }
  if (raw.length > MAX_RESPONSE_CHARS)
    throw digestError('upstream', `${label} response too large`);
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    /* handled below */
  }
  if (!response.ok) {
    const detail = upstreamMessage(payload);
    throw digestError(
      response.status === 401 || response.status === 403
        ? 'auth'
        : response.status === 429
          ? 'rate_limited'
          : 'upstream',
      `Perplexity HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      { status: response.status },
    );
  }
  if (!payload || typeof payload !== 'object')
    throw digestError('upstream', `${label} response was not JSON`);
  const cost = responseCost(payload);
  // An answer cut off at max_output_tokens is billed but unusable JSON.
  if (payload.status === 'incomplete')
    throw digestError(
      'truncated',
      `the ${label} hit the ${(body?.max_output_tokens ?? DIGEST_MAX_OUTPUT_TOKENS).toLocaleString('en-US')}-token output limit before finishing`,
      { cost, model: payload.model ?? null },
    );
  if (payload.status !== 'completed') {
    const detail = upstreamMessage(payload);
    throw digestError(
      'model_error',
      `${label} run ${payload.status || 'failed'}${detail ? `: ${detail}` : ''}`,
      { cost, model: payload.model ?? null },
    );
  }
  return {
    text: responseOutputText(payload),
    model: typeof payload.model === 'string' ? payload.model : null,
    status: payload.status,
    cost,
    reasoningTokens: responseReasoningTokens(payload),
    responseId: typeof payload.id === 'string' ? payload.id : null,
  };
}

/**
 * Assemble, call and validate one digest.
 * @param {{
 *   apiKey: string,
 *   theater: object,
 *   sourcesById: Map<string, object>,
 *   openStories: Array<object>,
 *   newItems: Array<object>,
 *   knownItemIds: Set<string>,
 *   nowMs: number,
 *   fetchImpl?: Function,
 *   signal?: AbortSignal,
 * }} options
 */
export async function runDigest({
  apiKey,
  theater,
  sourcesById,
  openStories,
  newItems,
  knownItemIds,
  nowMs,
  fetchImpl,
  signal,
}) {
  const selected = selectDigestItems(newItems, sourcesById);
  const open = selectOpenStories(openStories);
  const categoryIds = theater.categories.map((category) => category.id);
  const actorIds = (theater.actors || []).map((actor) => actor.id);
  const body = buildDigestRequest({
    instructions: buildDigestInstructions(theater),
    input: buildDigestInput({
      openStories: open,
      items: selected.items,
      sourcesById,
      nowIso: new Date(nowMs).toISOString(),
    }),
    categoryIds,
    actorIds,
  });
  const result = await callDigestModel({ apiKey, body, fetchImpl, signal });
  const parsed = parseDigestText(result.text);
  if (!parsed)
    throw digestError('malformed_output', 'digest output was not valid JSON', {
      cost: result.cost,
      model: result.model,
    });
  let validated;
  try {
    validated = validateDigestOutput(parsed, {
      knownItemIds,
      openStories: new Map(open.map((story) => [story.id, story])),
      categoryIds,
      actorIds,
      nowMs,
    });
  } catch (error) {
    error.cost = result.cost;
    error.model = result.model;
    throw error;
  }
  return {
    stories: validated.stories,
    counts: validated.counts,
    processedItemIds: selected.items.map((item) => item.id),
    openStoryIds: open.map((story) => story.id),
    leftOut: selected.leftOut,
    model: result.model,
    cost: result.cost,
    reasoningTokens: result.reasoningTokens,
    responseId: result.responseId,
  };
}
