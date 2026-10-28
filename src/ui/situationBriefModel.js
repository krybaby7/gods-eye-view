/**
 * Situation Brief presentation, pure: track badges and glyphs, the
 * AI-analysis line, the brief's age, failure and Retry state, actor groups
 * and the per-viewer storage keys. No DOM. Code owns all of these; the
 * model only wrote the brief's lines.
 */
import { formatUsdShort } from '../layers/news/records.js';
import { formatSituationTime } from './situationPanelModel.js';

/** The direction of a track as a small neutral glyph next to the word. */
export const TRACK_STATE_GLYPHS = Object.freeze({
  escalating: '↑',
  easing: '↓',
  stalled: '–',
  shifting: '↔',
  unclear: '?',
});
export const ACTOR_ROLE_LABELS = Object.freeze({
  party: 'Parties',
  mediator: 'Mediators',
  institution: 'Institutions',
  affected: 'Affected',
  external: 'External',
});
const ACTOR_TYPE_LABELS = Object.freeze({
  state: 'state',
  'armed-group': 'armed group',
  institution: 'institution',
  population: 'population',
});
const BRIEF_ERRORS = Object.freeze({
  truncated: 'it hit its output limit',
  no_headline: 'it had no cited headline',
  malformed_output: 'its answer was not valid',
  timeout: 'it timed out',
  network: 'the connection failed',
  auth: 'the key was refused',
  rate_limited: 'Perplexity limited the request rate',
  upstream: 'Perplexity returned an error',
  model_error: 'the model returned an error',
});
const RETRY_DISABLED_REASONS = Object.freeze({
  no_key: 'Needs PERPLEXITY_API_KEY — add it in Provider Settings',
  over_budget: "Today's budget is used up",
  in_flight: 'A digest or brief is running',
});
const COUNT_WORDS = ['no', 'one', 'two', 'three'];

/** Expanded or collapsed, remembered per viewer. */
export const BRIEF_EXPANDED_KEY = 'godsEyeView.v1.situationBriefExpanded';

/** The digest the viewer last saw, per viewer and theater. */
export function lastSeenKey(theaterId) {
  return `godsEyeView.v1.situationLastSeen.${theaterId}`;
}

/** Distinct story ids the brief cites, in first-cited order. */
export function briefStoryIds(brief) {
  if (!brief) return [];
  const ids = new Set();
  const add = (list) => {
    for (const id of list || []) ids.add(id);
  };
  for (const line of [
    brief.headline,
    ...(brief.changes || []),
    brief.trigger,
    ...(brief.tracks || []),
    ...(brief.affected || []),
  ])
    add(line?.storyIds);
  for (const scenario of brief.scenarios || []) {
    add(scenario.storyIds);
    for (const signpost of scenario.signposts || []) add(signpost.seenIn);
  }
  for (const line of [...(brief.unknowns || []), ...(brief.actorNotes || [])])
    add(line.storyIds);
  return [...ids];
}

/** "AI analysis · 14:03 · cites 12 stories". */
export function briefMetaLine(brief, nowMs, options = {}) {
  const cited = briefStoryIds(brief).length;
  return [
    'AI analysis',
    formatSituationTime(brief.createdAt, nowMs, options),
    `cites ${cited} ${cited === 1 ? 'story' : 'stories'}`,
  ].join(' · ');
}

/** "Brief from 14:02, one digest behind", or "" when the brief is current. */
export function briefAgeLine(brief, briefStatus, nowMs, options = {}) {
  const behind = briefStatus?.digestsBehind;
  if (!brief || !Number.isInteger(behind) || behind < 1) return '';
  const count = COUNT_WORDS[behind] ?? String(behind);
  return `Brief from ${formatSituationTime(brief.createdAt, nowMs, options)}, ${count} ${behind === 1 ? 'digest' : 'digests'} behind`;
}

/** Why the latest brief is missing, while Retry brief applies; else "". */
export function briefRunLine(briefRun, briefStatus) {
  if (!briefRun || !briefStatus?.retryable) return '';
  if (briefRun.status === 'skipped')
    return `${String(briefRun.message || 'The brief was skipped').replace(/\.$/, '')}.`;
  const cost =
    Number(briefRun.costUsd) > 0
      ? ` (cost ${formatUsdShort(briefRun.costUsd)})`
      : '';
  return `The latest brief failed: ${BRIEF_ERRORS[briefRun.error] || briefRun.error || 'error'}${cost}.`;
}

/** Retry brief appears only after a failure; disabled with a reason. */
export function retryBriefState(snapshot) {
  const status = snapshot?.briefStatus;
  if (!status?.retryable)
    return { visible: false, disabled: true, reason: null };
  const code = snapshot.digest?.running
    ? 'in_flight'
    : status.retryDisabledReason || null;
  return {
    visible: true,
    disabled: Boolean(code),
    reason: code ? RETRY_DISABLED_REASONS[code] || code : null,
  };
}

/**
 * Actors grouped by role, groups and chips in theater order, each with the
 * number of open stories tagged with it. Roles, not sides: no group is
 * coloured or set against another.
 */
export function actorGroups(actors, stories) {
  const counts = new Map();
  for (const story of stories || [])
    if (story.status === 'open')
      for (const id of story.actorIds || [])
        counts.set(id, (counts.get(id) || 0) + 1);
  const groups = [];
  for (const actor of actors || []) {
    let group = groups.find((entry) => entry.role === actor.role);
    if (!group) {
      group = {
        role: actor.role,
        label: ACTOR_ROLE_LABELS[actor.role] || actor.role,
        actors: [],
      };
      groups.push(group);
    }
    group.actors.push({
      ...actor,
      typeLabel: ACTOR_TYPE_LABELS[actor.type] || actor.type,
      count: counts.get(actor.id) || 0,
    });
  }
  return groups;
}

/** One badge per theater track: the brief's state, or no cited reading. */
export function trackBadges(tracks, brief) {
  return (tracks || []).map((track) => {
    const entry = (brief?.tracks || []).find((t) => t.id === track.id);
    return {
      id: track.id,
      label: track.label,
      state: entry?.state ?? null,
      stateLabel: entry?.state ?? 'no cited reading',
      glyph: entry ? TRACK_STATE_GLYPHS[entry.state] || '?' : '·',
      reason: entry?.reason ?? '',
      storyIds: entry?.storyIds ?? [],
    };
  });
}

/** "within weeks"; a missing horizon is said, not guessed. */
export function horizonLabel(horizon) {
  return horizon ? `within ${horizon}` : 'no time horizon given';
}
