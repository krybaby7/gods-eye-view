import { createHash } from 'node:crypto';

import {
  DIGEST_MODEL,
  actorListForPrompt,
  callDigestModel,
  cleanText,
  parseDigestText,
  worstCaseCost,
} from './runner.js';
import { NEWS_ACTOR_ROLES, NEWS_ACTOR_TYPES } from '../registry.js';

/**
 * The Situation Brief: a second model call after each successful digest that
 * explains the whole crisis from the finished stories. Same Agent API call
 * shape as the digest (Claude Sonnet 5.5, no tools, one step, strict JSON
 * schema), its own 16,000-token output limit.
 *
 * The model writes the text, track states, scenario horizons, citations,
 * which signposts it has seen, and a cited role line per actor (plus actors
 * the list lacks). Code checks every citation against the stories it sent:
 * an unknown id is dropped and counted, a line left with no valid story is
 * dropped, and a brief without a valid headline is rejected. Code also
 * enforces the limits and the never-break rules it can check (no single
 * forecast, no probabilities). Whether a proposed role or actor is accepted
 * is decided afterwards by actors.js. Code never writes analysis itself.
 */

/**
 * Hidden reasoning counts toward this limit: the live digests spent 3,100 to
 * 3,700 tokens reasoning, so 16,000 leaves room for a full brief.
 */
export const BRIEF_MAX_OUTPUT_TOKENS = 16000;
export const BRIEF_STORY_CAP = 80;
/** Closed stories stay in the brief's input this long after their update. */
export const BRIEF_CLOSED_WINDOW_MS = 72 * 3600_000;
/** `unclear` is the honest answer when the stories show no direction. */
export const TRACK_STATES = Object.freeze([
  'escalating',
  'easing',
  'stalled',
  'shifting',
  'unclear',
]);
export const SCENARIO_HORIZONS = Object.freeze(['days', 'weeks', 'months']);
export const BRIEF_LIMITS = Object.freeze({
  changes: 3,
  affected: 3,
  unknowns: 3,
  scenariosMin: 2,
  scenariosMax: 3,
  signposts: 4,
  newActors: 3,
});

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const idList = { type: 'array', items: { type: 'string' } };
const enumOrString = (values) =>
  values.length ? { type: 'string', enum: [...values] } : { type: 'string' };

function citedLineSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'storyIds'],
    properties: { text: { type: 'string' }, storyIds: idList },
  };
}

/**
 * Strict output schema. Bounds and citations are checked by
 * validateBriefOutput; the schema fixes only shapes and closed lists.
 * @param {{trackIds: string[], actorIds: string[]}} ids
 */
export function briefSchema({ trackIds, actorIds }) {
  const lines = { type: 'array', items: citedLineSchema() };
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'headline',
      'changes',
      'trigger',
      'tracks',
      'affected',
      'scenarios',
      'unknowns',
      'actorRoles',
      'newActors',
    ],
    properties: {
      headline: citedLineSchema(),
      changes: lines,
      trigger: nullable(citedLineSchema()),
      tracks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'state', 'reason', 'storyIds'],
          properties: {
            id: enumOrString(trackIds),
            state: { type: 'string', enum: [...TRACK_STATES] },
            reason: { type: 'string' },
            storyIds: idList,
          },
        },
      },
      affected: lines,
      scenarios: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'horizon', 'text', 'storyIds', 'signposts'],
          properties: {
            title: { type: 'string' },
            horizon: { type: 'string', enum: [...SCENARIO_HORIZONS] },
            text: { type: 'string' },
            storyIds: idList,
            signposts: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'seenIn'],
                properties: { text: { type: 'string' }, seenIn: idList },
              },
            },
          },
        },
      },
      unknowns: lines,
      actorRoles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['actorId', 'role', 'text', 'storyIds'],
          properties: {
            actorId: enumOrString(actorIds),
            role: { type: 'string', enum: [...NEWS_ACTOR_ROLES] },
            text: { type: 'string' },
            storyIds: idList,
          },
        },
      },
      // A name, never an id: code makes the id and refuses duplicates.
      newActors: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'type', 'role', 'aliases', 'text', 'storyIds'],
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: [...NEWS_ACTOR_TYPES] },
            role: { type: 'string', enum: [...NEWS_ACTOR_ROLES] },
            aliases: { type: 'array', items: { type: 'string' } },
            text: { type: 'string' },
            storyIds: idList,
          },
        },
      },
    },
  };
}

const BRIEF_RULES = `You write the Situation Brief for a personal war-monitoring map. You receive the stories from the latest digest (each one real-world event or development, with attributed claims, a verification label computed by code and the perspectives of its sources), the previous brief, a coverage note on which sources are down or silent, and the theater background. Explain the whole situation in under two minutes of reading and answer with JSON matching the schema.

Rules:
1. Cite story ids only, exactly as given. Every line cites the stories that support it. A sentence you cannot cite, leave out: a line without a valid story id is dropped.
2. Write a party's claim as that party's claim ("Iran's foreign ministry said...", "the IDF said..."). Never state a party's claim as fact. A casualty or damage figure appears only inside a cited line, attributed to its source. The verification labels are computed by code; do not restate a claim as confirmed.
3. Roles, not sides. Do not group actors into two teams, and never describe anyone as winning or losing.
4. No probabilities, odds, percentages of likelihood, scores or ratings, and no single forecast. Scenarios are distinct possibilities to watch, not predictions.
5. Use "unclear" for a track when the stories do not show a direction. Do not guess a direction.
6. Quiet is not calm: when the coverage note says sources are down or silent, do not read missing reports as an absence of events.
7. Plain, neutral English. No adjectives of your own, no URLs, no sound or drama.

Fields:
- headline: one neutral sentence on where the situation stands now.
- changes: up to ${BRIEF_LIMITS.changes} lines on what changed since the previous brief (since the stories began when there is none), most important first.
- trigger: one line on why this is happening now, the immediate event or decision behind the current phase; null when the stories do not show one.
- tracks: one entry per track id: a state (escalating, easing, stalled, shifting or unclear) and a one-sentence reason.
- affected: up to ${BRIEF_LIMITS.affected} lines on civilians, displacement, access and services, from the humanitarian stories.
- scenarios: ${BRIEF_LIMITS.scenariosMin} or ${BRIEF_LIMITS.scenariosMax} distinct possibilities for what could happen next, each with a horizon (days, weeks or months), a short title, at most two sentences and up to ${BRIEF_LIMITS.signposts} signposts: observable things that would show it unfolding. signposts[].seenIn: ids of stories that already report that signpost, else [].
- unknowns: up to ${BRIEF_LIMITS.unknowns} things that are poorly known or contested, and why.
- actorRoles: one line for each listed actor the stories show acting or affected: its role as the cited stories show it now, and one short sentence on why. Set a role only from what the stories report, not from what you know; when the stories show no change, give the listed role. A role change is accepted only when a cited story corroborates it. actorId from the actor list.
- newActors: up to ${BRIEF_LIMITS.newActors} states, armed groups, institutions or populations the stories show taking part that are not in the actor list: the name as commonly written, its type, its role, other names it goes by, one sentence on why, and the stories that name it. Never repeat a listed actor under another name.

Roles:
- party: takes part in the fighting (strikes, attacks, or defends as a combatant);
- mediator: carries messages between parties or hosts their talks;
- institution: an international body (UN agencies, the IAEA);
- affected: a population harmed by the fighting;
- external: an involved state or group that is not fighting or mediating (it supplies, hosts, sanctions or pledges support).`;

/**
 * Fixed instructions: rules, theater brief, actors, drivers and tracks.
 * Identical across runs for one theater, so a provider-side prefix cache can
 * reuse it. Driver links stay out; the panel shows them.
 * @param {object} theater Validated theater.
 */
export function buildBriefInstructions(theater) {
  const drivers = (theater.drivers || [])
    .map((driver) => `- ${driver.text} (${driver.source.name})`)
    .join('\n');
  const tracks = (theater.tracks || [])
    .map((track) => `- ${track.id}: ${track.label}`)
    .join('\n');
  return [
    BRIEF_RULES,
    `Theater: ${theater.name}\n${theater.brief.join('\n\n')}`,
    `Actors (id: name, aliases in parentheses — type, role; current roles, set from earlier stories):\n${actorListForPrompt(theater.actors, { withRole: true }) || '(none)'}`,
    `Long-running drivers (curated background, already shown to the reader):\n${drivers || '(none)'}`,
    `Tracks:\n${tracks || '(none)'}`,
  ].join('\n\n');
}

/**
 * Open stories and stories closed within 72 h, most recently updated first,
 * capped at 80.
 */
export function selectBriefStories(stories, nowMs, cap = BRIEF_STORY_CAP) {
  return stories
    .filter(
      (story) =>
        story.status === 'open' ||
        nowMs - Date.parse(story.updatedAt) <= BRIEF_CLOSED_WINDOW_MS,
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, cap);
}

/** The previous brief, text only, so changes can be relative to it. */
function previousForPrompt(brief) {
  const text = (entry) => entry?.text ?? null;
  return {
    createdAt: brief.createdAt,
    headline: text(brief.headline),
    changes: (brief.changes || []).map(text),
    trigger: text(brief.trigger),
    tracks: (brief.tracks || []).map(({ id, state, reason }) => ({
      id,
      state,
      reason,
    })),
    affected: (brief.affected || []).map(text),
    scenarios: (brief.scenarios || []).map((scenario) => ({
      title: scenario.title,
      horizon: scenario.horizon,
      signposts: (scenario.signposts || []).map(text),
    })),
    unknowns: (brief.unknowns || []).map(text),
  };
}

/**
 * The per-run user message: previous brief, coverage note, then stories.
 * Stories carry claims and code-owned labels, never item ids or links.
 * @param {{previousBrief: ?object, stories: Array<object>, coverage?: ?{summary: string, details: string[]}, nowIso: string}} input
 */
export function buildBriefInput({ previousBrief, stories, coverage, nowIso }) {
  const rows = stories.map((story) => ({
    id: story.id,
    kind: story.kind === 'development' ? 'development' : 'event',
    status: story.status,
    title: story.title,
    summary: story.summary,
    category: story.category,
    place: story.place?.name ?? null,
    eventAt: story.eventAt ?? null,
    updatedAt: story.updatedAt,
    whatsNew: story.whatsNew || '',
    claims: (story.claims || []).map(({ text, actor, type, status }) => ({
      text,
      actor,
      type,
      status,
    })),
    contradictions: story.contradictions || [],
    verification: story.verification,
    perspectives: story.perspectives || [],
    actorIds: story.actorIds || [],
  }));
  const coverageNote = coverage
    ? [coverage.summary, ...coverage.details.map((line) => `- ${line}`)].join(
        '\n',
      )
    : 'No source health available.';
  return `Brief time: ${nowIso}

${previousBrief ? `Previous brief (${previousBrief.createdAt}):\n${JSON.stringify(previousForPrompt(previousBrief))}` : 'Previous brief: none'}

Coverage (computed by code from source health; quiet is not calm):
${coverageNote}

Stories (${rows.length}):
${JSON.stringify(rows)}`;
}

/** The Agent API request body: the digest's shape, the brief's schema. */
export function buildBriefRequest({ instructions, input, trackIds, actorIds }) {
  return {
    model: DIGEST_MODEL,
    instructions,
    input: [{ type: 'message', role: 'user', content: input }],
    tools: [],
    max_steps: 1,
    max_output_tokens: BRIEF_MAX_OUTPUT_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'situation_brief',
        schema: briefSchema({ trackIds, actorIds }),
        strict: true,
      },
    },
    stream: false,
  };
}

/**
 * Assemble one brief call without sending it, so the budget can be checked
 * against its worst case first.
 * @param {{theater: object, stories: Array<object>, previousBrief: ?object, coverage: ?object, nowMs: number}} input
 * @returns {{body: object, storyIds: string[], worstCase: ReturnType<typeof worstCaseCost>}}
 */
export function prepareBrief({
  theater,
  stories,
  previousBrief,
  coverage,
  nowMs,
}) {
  const selected = selectBriefStories(stories, nowMs);
  const body = buildBriefRequest({
    instructions: buildBriefInstructions(theater),
    input: buildBriefInput({
      previousBrief,
      stories: selected,
      coverage,
      nowIso: new Date(nowMs).toISOString(),
    }),
    trackIds: (theater.tracks || []).map((track) => track.id),
    actorIds: (theater.actors || []).map((actor) => actor.id),
  });
  return {
    body,
    storyIds: selected.map((story) => story.id),
    worstCase: worstCaseCost(body),
  };
}

function briefError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

// A scenario that states a likelihood is a forecast; it is removed.
const PROBABILITY =
  /\d+(?:\.\d+)?\s*(?:%|per\s?cent)|\b(?:probability|probabilities|likelihood|odds|chances?)\b/i;

/**
 * Check a parsed brief against the stories that were sent.
 * @param {unknown} output Parsed JSON.
 * @param {{storyIds: Set<string>, trackIds: string[], actorIds: string[]}} context
 * @returns {{brief: object, counts: object}} Throws `no_headline` or
 *   `malformed_output`.
 */
export function validateBriefOutput(output, { storyIds, trackIds, actorIds }) {
  if (!output || typeof output !== 'object' || Array.isArray(output))
    throw briefError('malformed_output', 'brief output is not an object');
  const counts = {
    droppedStoryIds: 0,
    droppedLines: 0,
    trimmedLines: 0,
    clampedStates: 0,
    clampedHorizons: 0,
    droppedTracks: 0,
    droppedActorLines: 0,
    droppedScenarios: 0,
  };
  const list = (value) => (Array.isArray(value) ? value : []);
  const validIds = (value) => {
    const ids = [];
    for (const id of list(value)) {
      if (typeof id !== 'string' || !storyIds.has(id)) counts.droppedStoryIds++;
      else if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  };
  const cited = (raw, max) => {
    if (!raw || typeof raw !== 'object') {
      counts.droppedLines++;
      return null;
    }
    const text = cleanText(raw.text, max);
    const ids = validIds(raw.storyIds);
    if (!text || !ids.length) {
      counts.droppedLines++;
      return null;
    }
    return { text, storyIds: ids };
  };
  const capped = (entries, max) => {
    if (entries.length > max) counts.trimmedLines += entries.length - max;
    return entries.slice(0, max);
  };
  const lines = (value, max) =>
    capped(
      list(value)
        .map((raw) => cited(raw, 300))
        .filter(Boolean),
      max,
    );

  const headline = cited(output.headline, 240);
  if (!headline)
    throw briefError('no_headline', 'the brief had no cited headline');
  const changes = lines(output.changes, BRIEF_LIMITS.changes);
  const trigger = output.trigger === null ? null : cited(output.trigger, 300);

  const tracksById = new Map();
  for (const raw of list(output.tracks)) {
    if (!trackIds.includes(raw?.id) || tracksById.has(raw.id)) {
      counts.droppedTracks++;
      continue;
    }
    const line = cited({ text: raw.reason, storyIds: raw.storyIds }, 240);
    if (!line) continue;
    let state = raw.state;
    if (!TRACK_STATES.includes(state)) {
      counts.clampedStates++;
      state = 'unclear';
    }
    tracksById.set(raw.id, {
      id: raw.id,
      state,
      reason: line.text,
      storyIds: line.storyIds,
    });
  }
  const tracks = trackIds
    .filter((id) => tracksById.has(id))
    .map((id) => tracksById.get(id));

  const affected = lines(output.affected, BRIEF_LIMITS.affected);

  let scenarios = [];
  for (const raw of list(output.scenarios)) {
    const title = cleanText(raw?.title, 100);
    const line = cited({ text: raw?.text, storyIds: raw?.storyIds }, 400);
    if (!line) continue;
    if (!title) {
      counts.droppedLines++;
      continue;
    }
    if (PROBABILITY.test(`${title} ${line.text}`)) {
      counts.droppedScenarios++;
      continue;
    }
    let horizon = raw.horizon;
    if (!SCENARIO_HORIZONS.includes(horizon)) {
      counts.clampedHorizons++;
      horizon = null;
    }
    const signposts = [];
    for (const signpost of list(raw.signposts)) {
      const text = cleanText(signpost?.text, 160);
      // A signpost may cite nothing: it has not been seen yet.
      const seenIn = validIds(signpost?.seenIn);
      if (text) signposts.push({ text, seenIn });
      else counts.droppedLines++;
    }
    scenarios.push({
      title,
      horizon,
      text: line.text,
      storyIds: line.storyIds,
      signposts: capped(signposts, BRIEF_LIMITS.signposts),
    });
  }
  scenarios = capped(scenarios, BRIEF_LIMITS.scenariosMax);
  // One scenario left would read as a forecast.
  if (scenarios.length < BRIEF_LIMITS.scenariosMin) {
    counts.droppedScenarios += scenarios.length;
    scenarios = [];
  }

  const unknowns = lines(output.unknowns, BRIEF_LIMITS.unknowns);

  // Actor lines: a listed role, a sentence and its stories. A line that
  // fails any check is dropped and counted apart from the other lines.
  const actorLine = (raw) => {
    const text = cleanText(raw?.text, 240);
    const ids = validIds(raw?.storyIds);
    return text && ids.length && NEWS_ACTOR_ROLES.includes(raw.role)
      ? { role: raw.role, text, storyIds: ids }
      : null;
  };
  const actorRoles = [];
  for (const raw of list(output.actorRoles)) {
    const line =
      actorIds.includes(raw?.actorId) &&
      !actorRoles.some((entry) => entry.actorId === raw.actorId)
        ? actorLine(raw)
        : null;
    if (line) actorRoles.push({ actorId: raw.actorId, ...line });
    else counts.droppedActorLines++;
  }
  const newActors = [];
  for (const raw of list(output.newActors)) {
    const name = cleanText(raw?.name, 60);
    const line =
      name && NEWS_ACTOR_TYPES.includes(raw.type) ? actorLine(raw) : null;
    if (!line) {
      counts.droppedActorLines++;
      continue;
    }
    newActors.push({
      name,
      type: raw.type,
      role: line.role,
      aliases: [
        ...new Set(
          list(raw.aliases)
            .filter((alias) => typeof alias === 'string')
            .map((alias) => cleanText(alias, 40))
            .filter(Boolean),
        ),
      ].slice(0, 5),
      text: line.text,
      storyIds: line.storyIds,
    });
  }

  return {
    brief: {
      headline,
      changes,
      trigger,
      tracks,
      affected,
      scenarios,
      unknowns,
      actorRoles,
      newActors: capped(newActors, BRIEF_LIMITS.newActors),
    },
    counts,
  };
}

/**
 * Send a prepared brief call and check the answer.
 * @param {{
 *   apiKey: string,
 *   prepared: ReturnType<typeof prepareBrief>,
 *   theater: object,
 *   digestRunId?: string,
 *   runId?: string,
 *   nowMs: number,
 *   fetchImpl?: Function,
 *   signal?: AbortSignal,
 * }} options
 */
export async function runBrief({
  apiKey,
  prepared,
  theater,
  digestRunId = null,
  runId = '',
  nowMs,
  fetchImpl,
  signal,
}) {
  const result = await callDigestModel({
    apiKey,
    body: prepared.body,
    fetchImpl,
    signal,
    label: 'brief',
  });
  const billed = { cost: result.cost, model: result.model };
  const parsed = parseDigestText(result.text);
  if (!parsed)
    throw briefError(
      'malformed_output',
      'brief output was not valid JSON',
      billed,
    );
  let validated;
  try {
    validated = validateBriefOutput(parsed, {
      storyIds: new Set(prepared.storyIds),
      trackIds: (theater.tracks || []).map((track) => track.id),
      actorIds: (theater.actors || []).map((actor) => actor.id),
    });
  } catch (error) {
    throw Object.assign(error, billed);
  }
  return {
    brief: {
      id: `br_${createHash('sha1')
        .update(`${theater.id}:${runId}:${nowMs}`)
        .digest('hex')
        .slice(0, 8)}`,
      theater: theater.id,
      digestRunId,
      createdAt: new Date(nowMs).toISOString(),
      ...validated.brief,
    },
    counts: validated.counts,
    storiesSent: prepared.storyIds.length,
    model: result.model,
    cost: result.cost,
    reasoningTokens: result.reasoningTokens,
    responseId: result.responseId,
  };
}
