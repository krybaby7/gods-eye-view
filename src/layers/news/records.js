/**
 * War monitor snapshot records. Portable: no Cesium, DOM or Node imports.
 * Headlines and stories are reporting, not verified incidents or risk
 * rankings; the verification label says how the reporting stands.
 */

export const NEWS_VERIFICATION_LABELS = Object.freeze({
  'participant-claim': 'Participant claim',
  reported: 'Reported',
  corroborated: 'Corroborated',
  disputed: 'Disputed',
});
export const NEWS_FOLDERS = Object.freeze([
  'reporting',
  'official',
  'local',
  'armed-group',
  'verification',
  'humanitarian',
  'analysis',
]);
/** Situation Brief: fixed lists the model chooses from; checked again here. */
export const NEWS_TRACK_STATES = Object.freeze([
  'escalating',
  'easing',
  'stalled',
  'shifting',
  'unclear',
]);
export const NEWS_SCENARIO_HORIZONS = Object.freeze([
  'days',
  'weeks',
  'months',
]);
export const NEWS_ACTOR_ROLES = Object.freeze([
  'party',
  'mediator',
  'institution',
  'affected',
  'external',
]);
const ACTOR_TYPES = ['state', 'armed-group', 'institution', 'population'];
const FALLBACK_CATEGORY_COLOR = '#94a3b8';

const text = (value, max = 600) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const textOrNull = (value, max = 600) =>
  typeof value === 'string' && value.trim() ? value.slice(0, max) : null;
const finiteOrNull = (value) => (Number.isFinite(value) ? value : null);
const isoOrNull = (value) => {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};
const stringList = (value, max = 200) =>
  Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string').slice(0, max)
    : [];

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function normalizeItem(raw) {
  if (!raw || typeof raw.id !== 'string' || typeof raw.title !== 'string')
    return null;
  const primary = raw.primarySource;
  return {
    id: raw.id,
    sourceId: text(raw.sourceId, 64),
    folder: NEWS_FOLDERS.includes(raw.folder) ? raw.folder : 'reporting',
    kind: text(raw.kind, 32),
    perspective: text(raw.perspective, 64),
    title: text(raw.title, 400),
    titleOriginal: text(raw.titleOriginal || raw.title, 400),
    snippet: text(raw.snippet, 600),
    language: text(raw.language, 8) || 'en',
    url: safeUrl(raw.url),
    publishedAt: isoOrNull(raw.publishedAt),
    collectedAt: isoOrNull(raw.collectedAt),
    digestedAt: isoOrNull(raw.digestedAt),
    storyId: textOrNull(raw.storyId, 64),
    transport: text(raw.transport, 32),
    primarySource:
      primary && typeof primary === 'object'
        ? {
            kind: text(primary.kind, 32),
            issuer: text(primary.issuer, 160),
            url: safeUrl(primary.url),
          }
        : null,
  };
}

function normalizeLocation(raw) {
  if (
    !raw ||
    !Number.isFinite(raw.lat) ||
    !Number.isFinite(raw.lon) ||
    Math.abs(raw.lat) > 90 ||
    Math.abs(raw.lon) > 180
  )
    return null;
  return {
    lat: raw.lat,
    lon: raw.lon,
    precision: text(raw.precision, 32) || 'city',
    method: raw.method === 'model' ? 'model' : 'gazetteer',
    name: textOrNull(raw.name, 160),
  };
}

function normalizeStory(raw) {
  if (!raw || typeof raw.id !== 'string' || typeof raw.title !== 'string')
    return null;
  return {
    id: raw.id,
    title: text(raw.title, 200),
    summary: text(raw.summary, 800),
    category: text(raw.category, 64),
    place: textOrNull(raw.place?.name, 160),
    location: normalizeLocation(raw.location),
    eventAt: isoOrNull(raw.eventAt),
    firstSeenAt: isoOrNull(raw.firstSeenAt),
    updatedAt: isoOrNull(raw.updatedAt),
    itemIds: stringList(raw.itemIds),
    claims: (Array.isArray(raw.claims) ? raw.claims : [])
      .filter((claim) => claim && typeof claim.text === 'string')
      .slice(0, 20)
      .map((claim) => ({
        text: text(claim.text, 400),
        actor: textOrNull(claim.actor, 80),
        type: text(claim.type, 32) || 'other',
        status: Object.hasOwn(NEWS_VERIFICATION_LABELS, claim.status)
          ? claim.status
          : 'reported',
        itemIds: stringList(claim.itemIds),
      })),
    whatsNew: text(raw.whatsNew, 400),
    contradictions: stringList(raw.contradictions, 10).map((line) =>
      line.slice(0, 400),
    ),
    status: raw.status === 'closed' ? 'closed' : 'open',
    perspectives: stringList(raw.perspectives, 40),
    verification: Object.hasOwn(NEWS_VERIFICATION_LABELS, raw.verification)
      ? raw.verification
      : 'reported',
    sourceCount: Number.isInteger(raw.sourceCount)
      ? Math.max(0, raw.sourceCount)
      : 0,
    // Stories from before kinds existed read as events.
    kind: raw.kind === 'development' ? 'development' : 'event',
    actorIds: stringList(raw.actorIds, 40),
  };
}

/** A cited brief line, or null when it has no text or no story. */
function normalizeLine(raw, max = 400) {
  if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) return null;
  const storyIds = stringList(raw.storyIds, 40);
  return storyIds.length ? { text: raw.text.slice(0, max), storyIds } : null;
}

const lineList = (value, max) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => normalizeLine(entry))
    .filter(Boolean)
    .slice(0, max);

/**
 * The Situation Brief, already checked by the server; checked again here so
 * a malformed payload cannot put an uncited line on screen. A brief without
 * a cited headline is no brief.
 */
function normalizeBrief(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const headline = normalizeLine(raw.headline);
  if (!headline) return null;
  return {
    id: text(raw.id, 32),
    digestRunId: textOrNull(raw.digestRunId, 64),
    createdAt: isoOrNull(raw.createdAt),
    headline,
    changes: lineList(raw.changes, 3),
    trigger: normalizeLine(raw.trigger),
    tracks: (Array.isArray(raw.tracks) ? raw.tracks : [])
      .filter((track) => track && typeof track.id === 'string')
      .slice(0, 4)
      .map((track) => ({
        id: text(track.id, 64),
        state: NEWS_TRACK_STATES.includes(track.state)
          ? track.state
          : 'unclear',
        reason: text(track.reason, 300),
        storyIds: stringList(track.storyIds, 40),
      })),
    affected: lineList(raw.affected, 3),
    scenarios: (Array.isArray(raw.scenarios) ? raw.scenarios : [])
      .filter(
        (scenario) =>
          scenario &&
          typeof scenario.title === 'string' &&
          typeof scenario.text === 'string',
      )
      .slice(0, 3)
      .map((scenario) => ({
        title: text(scenario.title, 120),
        horizon: NEWS_SCENARIO_HORIZONS.includes(scenario.horizon)
          ? scenario.horizon
          : null,
        text: text(scenario.text, 500),
        storyIds: stringList(scenario.storyIds, 40),
        signposts: (Array.isArray(scenario.signposts) ? scenario.signposts : [])
          .filter(
            (signpost) =>
              typeof signpost?.text === 'string' && signpost.text.trim(),
          )
          .slice(0, 4)
          .map((signpost) => ({
            text: text(signpost.text, 200),
            seenIn: stringList(signpost.seenIn, 40),
          })),
      })),
    unknowns: lineList(raw.unknowns, 3),
    // Proposed roles with their cited reason; whether a role was accepted
    // is on the theater's actors, set by code.
    actorRoles: (Array.isArray(raw.actorRoles) ? raw.actorRoles : [])
      .filter(
        (entry) =>
          typeof entry?.actorId === 'string' &&
          NEWS_ACTOR_ROLES.includes(entry.role),
      )
      .map((entry) => {
        const line = normalizeLine(entry, 300);
        return line
          ? { actorId: text(entry.actorId, 64), role: entry.role, ...line }
          : null;
      })
      .filter(Boolean),
  };
}

function normalizeRun(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string')
    return null;
  const count = (value) => (Number.isFinite(value) ? value : null);
  return {
    id: raw.id,
    kind: raw.kind === 'brief' ? 'brief' : 'digest',
    digestRunId: textOrNull(raw.digestRunId, 64),
    reason: textOrNull(raw.reason, 32),
    status: ['ok', 'failed', 'skipped'].includes(raw.status)
      ? raw.status
      : 'failed',
    startedAt: isoOrNull(raw.startedAt),
    finishedAt: isoOrNull(raw.finishedAt),
    durationMs: count(raw.durationMs),
    itemCount: count(raw.itemCount),
    storyCount: count(raw.storyCount),
    storiesCreated: count(raw.storiesCreated),
    storiesUpdated: count(raw.storiesUpdated),
    unassignedCount: count(raw.unassignedCount),
    leftOut: count(raw.leftOut),
    droppedItemIds: count(raw.droppedItemIds),
    storiesSent: count(raw.storiesSent),
    droppedLines: count(raw.droppedLines),
    droppedStoryIds: count(raw.droppedStoryIds),
    inputTokens: count(raw.inputTokens),
    outputTokens: count(raw.outputTokens),
    reasoningTokens: count(raw.reasoningTokens),
    costUsd: count(raw.costUsd),
    costEstimated: raw.costEstimated === true,
    model: textOrNull(raw.model, 80),
    error: textOrNull(raw.error, 64),
    message: textOrNull(raw.message, 200),
  };
}

/**
 * Validate a /api/news payload before it can replace the displayed stories.
 * @param {unknown} payload
 * @returns {?object}
 */
export function normalizeNewsSnapshot(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray(payload.items) ||
    !Array.isArray(payload.stories) ||
    !payload.theater ||
    typeof payload.theater.id !== 'string'
  )
    return null;
  const categories = (
    Array.isArray(payload.theater.categories) ? payload.theater.categories : []
  )
    .filter((c) => c && typeof c.id === 'string')
    .map((c) => ({
      id: c.id,
      label: text(c.label, 60) || c.id,
      color: /^#[0-9a-f]{6}$/i.test(c.color)
        ? c.color
        : FALLBACK_CATEGORY_COLOR,
    }));
  const perspectives = (
    Array.isArray(payload.theater.perspectives)
      ? payload.theater.perspectives
      : []
  )
    .filter((p) => p && typeof p.id === 'string')
    .map((p) => ({
      id: p.id,
      label: text(p.label, 60) || p.id,
      group: text(p.group, 64) || p.id,
    }));
  const list = (value) => (Array.isArray(value) ? value : []);
  const actors = list(payload.theater.actors)
    .filter(
      (actor) =>
        typeof actor?.id === 'string' &&
        typeof actor.name === 'string' &&
        ACTOR_TYPES.includes(actor.type) &&
        NEWS_ACTOR_ROLES.includes(actor.role),
    )
    .map((actor) => ({
      id: actor.id,
      name: text(actor.name, 80),
      type: actor.type,
      role: actor.role,
      aliases: stringList(actor.aliases, 20),
      // When the stories last set the role, and on which stories.
      startingRole: NEWS_ACTOR_ROLES.includes(actor.startingRole)
        ? actor.startingRole
        : actor.role,
      roleSince: isoOrNull(actor.roleSince),
      roleStoryIds: stringList(actor.roleStoryIds, 20),
      changedFrom: NEWS_ACTOR_ROLES.includes(actor.changedFrom)
        ? actor.changedFrom
        : null,
      learned: actor.learned === true,
    }));
  const drivers = list(payload.theater.drivers)
    .filter((driver) => typeof driver?.text === 'string')
    .slice(0, 3)
    .map((driver) => ({
      text: text(driver.text, 400),
      source: {
        name: text(driver.source?.name, 120),
        url: safeUrl(driver.source?.url),
      },
    }));
  const tracks = list(payload.theater.tracks)
    .filter((track) => typeof track?.id === 'string')
    .map((track) => ({
      id: track.id,
      label: text(track.label, 40) || track.id,
    }));
  const budget = payload.budget || {};
  const digest = payload.digest || {};
  const briefStatus = payload.briefStatus || {};
  return {
    revision: String(payload.revision || ''),
    retrievedAt: isoOrNull(payload.retrievedAt),
    theater: {
      id: payload.theater.id,
      name: text(payload.theater.name, 80) || payload.theater.id,
      categories,
      perspectives,
      actors,
      drivers,
      tracks,
    },
    theaters: (Array.isArray(payload.theaters) ? payload.theaters : [])
      .filter((t) => t && typeof t.id === 'string')
      .map((t) => ({ id: t.id, name: text(t.name, 80) || t.id })),
    items: payload.items.map(normalizeItem).filter(Boolean),
    citations: (Array.isArray(payload.citations) ? payload.citations : [])
      .map(normalizeItem)
      .filter(Boolean),
    stories: payload.stories.map(normalizeStory).filter(Boolean),
    lastRun: normalizeRun(payload.lastRun),
    lastDigest: normalizeRun(payload.lastDigest),
    brief: normalizeBrief(payload.brief),
    briefRun: normalizeRun(payload.briefRun),
    briefStatus: {
      digestsBehind: Number.isInteger(briefStatus.digestsBehind)
        ? Math.max(0, briefStatus.digestsBehind)
        : null,
      retryable: briefStatus.retryable === true,
      retryDisabledReason: textOrNull(briefStatus.retryDisabledReason, 32),
    },
    sources: (Array.isArray(payload.sources) ? payload.sources : [])
      .filter((s) => s && typeof s.id === 'string')
      .map((s) => ({
        id: s.id,
        name: text(s.name, 120) || s.id,
        homepage: safeUrl(s.homepage),
        folder: NEWS_FOLDERS.includes(s.folder) ? s.folder : 'reporting',
        kind: text(s.kind, 32),
        perspective: text(s.perspective, 64),
        languages: stringList(s.languages, 8),
        starred: s.starred === true,
        caution: text(s.caution, 300),
        credit: text(s.credit, 120),
        transport: text(s.transport, 32),
        health: {
          ok: s.health?.ok === true,
          count: finiteOrNull(s.health?.count) ?? 0,
          error: textOrNull(s.health?.error, 160),
          blocked: s.health?.blocked === true,
          rateLimited: s.health?.rateLimited === true,
          disabled: s.health?.disabled === true,
          linkOnly: s.health?.linkOnly === true,
          fragile: s.health?.fragile === true,
          loading: s.health?.loading === true,
          quiet: s.health?.quiet === true,
          stale: s.health?.stale === true,
          degraded: s.health?.degraded === true,
          lastOkAt: isoOrNull(s.health?.lastOkAt),
          newestItemAt: isoOrNull(s.health?.newestItemAt),
        },
      })),
    budget: {
      dailyUsd: finiteOrNull(budget.dailyUsd),
      spentTodayUsd: finiteOrNull(budget.spentTodayUsd) ?? 0,
      remainingUsd: finiteOrNull(budget.remainingUsd),
      exhausted: budget.exhausted === true,
      lastRunCostUsd: finiteOrNull(budget.lastRunCostUsd),
      lastBriefCostUsd: finiteOrNull(budget.lastBriefCostUsd),
    },
    digest: {
      provider: text(digest.provider, 80),
      model: text(digest.model, 80),
      keyConfigured: digest.keyConfigured === true,
      running: digest.running === true,
      phase: ['digest', 'brief'].includes(digest.phase) ? digest.phase : null,
      startedAt: isoOrNull(digest.startedAt),
      disabledReason: textOrNull(digest.disabledReason, 32),
      undigestedCount: finiteOrNull(digest.undigestedCount) ?? 0,
    },
  };
}

/** Category id → colour from the theater config. */
export function newsCategoryColor(categoryId, categories = []) {
  return (
    categories.find((category) => category.id === categoryId)?.color ||
    FALLBACK_CATEGORY_COLOR
  );
}

/**
 * A story gets a pin when it has a location and is an event. A development
 * (talks, a sanction, a ruling) gets none: a pin would suggest something
 * happened at that place.
 */
export function isPinnedStory(story) {
  return Boolean(story?.location) && story.kind !== 'development';
}

/** Stories tagged with one actor; a null actor keeps them all. */
export function filterStoriesByActor(stories, actorId) {
  if (!actorId) return stories;
  return stories.filter((story) => (story.actorIds || []).includes(actorId));
}

/**
 * New since the viewer's last visit: updated after the digest they last
 * saw. Nothing is new before a first visit has been recorded.
 */
export function isNewSince(story, sinceMs) {
  return (
    Number.isFinite(sinceMs) && Date.parse(story?.updatedAt || '') > sinceMs
  );
}

/** Stories visible under a category filter (`hidden` is a Set of ids). */
export function filterNewsStories(stories, hidden) {
  if (!hidden?.size) return stories;
  return stories.filter((story) => !hidden.has(story.category));
}

/**
 * Normalize a hidden-category parameter (array or comma string) to the
 * sorted comma string the layer state stores.
 */
export function normalizeHiddenCategories(value) {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return [
    ...new Set(
      list
        .map((entry) => String(entry).trim())
        .filter((entry) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(entry)),
    ),
  ]
    .sort()
    .join(',');
}

/**
 * One story as a JSON-safe analyst record (analyst_query seam).
 * @param {object} story Normalized story.
 * @param {number} [index]
 */
export function mapNewsAnalystRecord(story, index = 0) {
  const ms = (iso) => {
    const value = Date.parse(iso || '');
    return Number.isNaN(value) ? null : value;
  };
  return {
    id: story?.id || `STORY-${String(index).padStart(4, '0')}`,
    title: textOrNull(story?.title, 200),
    category: textOrNull(story?.category, 64),
    perspectives: Array.isArray(story?.perspectives)
      ? story.perspectives.join(', ')
      : null,
    verification: textOrNull(story?.verification, 32),
    sourceCount: Number.isFinite(story?.sourceCount) ? story.sourceCount : null,
    place: textOrNull(story?.place, 160),
    lat: finiteOrNull(story?.location?.lat),
    lon: finiteOrNull(story?.location?.lon),
    modelPlaced: story?.location?.method === 'model',
    kind: textOrNull(story?.kind, 16),
    status: textOrNull(story?.status, 16),
    eventAt: ms(story?.eventAt),
    updatedAt: ms(story?.updatedAt),
    summary: textOrNull(story?.summary, 400),
  };
}

/** "18¢", "<1¢", "$1.42" — digest costs are cents, budgets are dollars. */
export function formatUsdShort(value) {
  if (!Number.isFinite(value)) return '—';
  if (value <= 0) return '0¢';
  if (value < 0.01) return '<1¢';
  if (value < 1) return `${Math.round(value * 100)}¢`;
  return `$${value.toFixed(2)}`;
}

/** What happened to the brief after a digest or a Retry brief, or "". */
function briefSentence(briefRun) {
  if (!briefRun) return '';
  if (briefRun.status === 'ok')
    return `Brief written, ${formatUsdShort(briefRun.costUsd)}.`;
  if (briefRun.status === 'skipped')
    return `${String(briefRun.message || 'Brief skipped').replace(/\.$/, '')}.`;
  const cost =
    Number(briefRun.costUsd) > 0
      ? ` and cost ${formatUsdShort(briefRun.costUsd)}`
      : '';
  return `The brief failed (${briefRun.error || 'error'})${cost}; the previous brief stays.`;
}

/**
 * One readable sentence for a Retry brief outcome.
 * @param {object} outcome From the source's requestBrief.
 */
export function formatBriefOutcome(outcome) {
  if (!outcome) return '';
  if (outcome.keyRequired)
    return 'The brief needs a Perplexity API key: add PERPLEXITY_API_KEY in Provider Settings.';
  if (outcome.error === 'in_flight')
    return 'A digest or brief is already running.';
  if (outcome.error === 'nothing_to_retry')
    return 'There is no failed brief to retry.';
  if (outcome.error === 'rate_limited')
    return 'Too many requests; try again in a minute.';
  const sentence = briefSentence(outcome.briefRun);
  if (sentence) return sentence;
  return `The brief failed (${outcome.error || 'error'}${outcome.message ? `: ${outcome.message}` : ''}).`;
}

/**
 * One readable sentence for a digest outcome (panel notice and voice
 * read-back).
 * @param {object} outcome From the source's requestDigest.
 * @param {?object} [budget] Snapshot budget after the run.
 */
export function formatDigestOutcome(outcome, budget = null) {
  if (!outcome) return '';
  const left =
    Number.isFinite(budget?.remainingUsd) && Number.isFinite(budget?.dailyUsd)
      ? ` $${budget.remainingUsd.toFixed(2)} of today's $${budget.dailyUsd.toFixed(2)} budget left.`
      : '';
  if (outcome.keyRequired)
    return 'The digest needs a Perplexity API key: add PERPLEXITY_API_KEY in Provider Settings.';
  if (outcome.error === 'in_flight') return 'A digest is already running.';
  if (outcome.error === 'over_budget')
    return `${outcome.message || "Today's digest budget is used up"}. Refresh is off until tomorrow.`;
  if (outcome.error === 'rate_limited')
    return 'Too many refresh requests; try again in a minute.';
  if (outcome.skipped)
    return `${outcome.message || 'Nothing new since the last digest'}; no model call was made.`;
  const run = outcome.run || {};
  if (outcome.ok) {
    const created = run.storiesCreated ?? 0;
    const updated = run.storiesUpdated ?? 0;
    const items = run.itemCount ?? 0;
    const unassigned = run.unassignedCount ?? 0;
    const brief = briefSentence(outcome.briefRun);
    return `Digest done: ${created} new and ${updated} updated ${created + updated === 1 ? 'story' : 'stories'} from ${items} items, ${unassigned} left unassigned. Cost ${formatUsdShort(run.costUsd)}.${brief ? ` ${brief}` : ''}${left}`;
  }
  const cost =
    Number(run.costUsd) > 0 ? ` It cost ${formatUsdShort(run.costUsd)}.` : '';
  if (outcome.error === 'truncated')
    return `The digest hit its output limit before finishing, so no stories changed.${cost}`;
  return `The digest failed (${outcome.error || 'error'}${outcome.message ? `: ${outcome.message}` : ''}).${cost}`;
}
