/**
 * Situation panel presentation, pure: digest line, Refresh state, tab and
 * folder counts, raw-feed filters and timestamps. No DOM.
 */
import {
  NEWS_FOLDERS,
  NEWS_VERIFICATION_LABELS,
  formatUsdShort,
  isPinnedStory,
} from '../layers/news/records.js';

export const SITUATION_FOLDER_LABELS = Object.freeze({
  reporting: 'Reporting',
  official: 'Official',
  local: 'Local',
  'armed-group': 'Armed group',
  verification: 'Verification',
  humanitarian: 'Humanitarian',
  analysis: 'Analysis',
});

export const REFRESH_DISABLED_REASONS = Object.freeze({
  no_key: 'Needs PERPLEXITY_API_KEY — add it in Provider Settings',
  over_budget: "Today's digest budget is used up",
  in_flight: 'A digest is running',
  nothing_new: 'Nothing new since the last digest',
});

export const SITUATION_DISCLAIMER =
  'Headlines and stories are reporting, not verified incidents or risk rankings.';

const pad = (value) => String(value).padStart(2, '0');

function parts(ms, timeZone) {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(
    format.formatToParts(ms).map(({ type, value }) => [type, value]),
  );
}

/**
 * "14:02" today, "25 Oct 14:02" on another day, "—" when unknown.
 * @param {?string} iso
 * @param {number} nowMs
 * @param {{timeZone?: string}} [options]
 */
export function formatSituationTime(iso, nowMs, { timeZone } = {}) {
  const ms = Date.parse(iso || '');
  if (Number.isNaN(ms)) return '—';
  const at = parts(ms, timeZone);
  const now = parts(nowMs, timeZone);
  const clock = `${at.hour}:${at.minute}`;
  return at.day === now.day && at.month === now.month && at.year === now.year
    ? clock
    : `${at.day} ${at.month} ${clock}`;
}

/** "0:23", "1:05" — elapsed time of a running digest. */
export function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
}

/**
 * Refresh control state from the layer snapshot.
 * @returns {{running: boolean, disabled: boolean, label: string, reason: ?string, reasonCode: ?string}}
 */
export function refreshState(snapshot, nowMs) {
  const digest = snapshot?.digest || {};
  if (digest.running) {
    const started = Date.parse(digest.startedAt || '');
    return {
      running: true,
      disabled: true,
      label: `Digesting… ${formatElapsed(Number.isNaN(started) ? 0 : nowMs - started)}`,
      reason: REFRESH_DISABLED_REASONS.in_flight,
      reasonCode: 'in_flight',
    };
  }
  if (!snapshot?.ready)
    return {
      running: false,
      disabled: true,
      label: 'Refresh',
      reason: 'Waiting for the news feed',
      reasonCode: 'loading',
    };
  const code = digest.disabledReason || null;
  return {
    running: false,
    disabled: Boolean(code),
    label: 'Refresh',
    reason: code ? REFRESH_DISABLED_REASONS[code] || code : null,
    reasonCode: code,
  };
}

/** Items the digest processed without citing them. */
export function unassignedItems(items) {
  return (items || []).filter((item) => item.digestedAt && !item.storyId);
}

/**
 * "Digest 14:02 · 23 stories from 312 items · 9 unassigned · last run 18¢ ·
 * budget $1.42 left".
 */
export function formatDigestLine(snapshot, nowMs, options = {}) {
  if (!snapshot?.ready) return 'Loading the news feed…';
  const open = (snapshot.stories || []).filter((s) => s.status === 'open');
  const items = snapshot.items || [];
  const digested = items.filter((item) => item.digestedAt).length;
  const budget = snapshot.budget || {};
  const tail = [];
  if (Number.isFinite(budget.lastRunCostUsd))
    tail.push(`last run ${formatUsdShort(budget.lastRunCostUsd)}`);
  if (Number.isFinite(budget.remainingUsd))
    tail.push(`budget $${budget.remainingUsd.toFixed(2)} left`);
  const lastDigest = snapshot.lastDigest;
  if (!lastDigest)
    return [`No digest yet · ${items.length} items collected`, ...tail].join(
      ' · ',
    );
  return [
    `Digest ${formatSituationTime(lastDigest.finishedAt, nowMs, options)}`,
    `${open.length} ${open.length === 1 ? 'story' : 'stories'} from ${digested} items`,
    `${unassignedItems(items).length} unassigned`,
    ...tail,
  ].join(' · ');
}

/** Degraded sources: count, names and a one-line reason list. */
export function degradedSources(sources) {
  const list = (sources || []).filter((source) => source.health?.degraded);
  return {
    count: list.length,
    text: list.length
      ? `${list.length} ${list.length === 1 ? 'source' : 'sources'} degraded`
      : '',
    detail: list
      .map((source) => {
        const health = source.health;
        const why = health.blocked
          ? 'blocked'
          : health.rateLimited
            ? 'rate limited'
            : health.stale
              ? health.quiet && health.newestItemAt
                ? `nothing new since ${health.newestItemAt.slice(0, 10)}`
                : 'stale'
              : health.error || 'failing';
        return `${source.name}: ${why}`;
      })
      .join('\n'),
  };
}

/** Tab counts: open stories under the category filter, raw items. */
export function tabCounts(snapshot) {
  return {
    stories: (snapshot?.visibleStories || []).filter(
      (story) => story.status === 'open',
    ).length,
    raw: (snapshot?.items || []).length,
  };
}

/** Items per folder, in folder order, zeros included. */
export function folderCounts(items) {
  const counts = Object.fromEntries(NEWS_FOLDERS.map((folder) => [folder, 0]));
  for (const item of items || [])
    if (Object.hasOwn(counts, item.folder)) counts[item.folder]++;
  return counts;
}

/** Perspectives and languages present in a list of items, sorted. */
export function rawFilterOptions(items) {
  const perspectives = new Set();
  const languages = new Set();
  for (const item of items || []) {
    if (item.perspective) perspectives.add(item.perspective);
    if (item.language) languages.add(item.language);
  }
  return {
    perspectives: [...perspectives].sort(),
    languages: [...languages].sort(),
  };
}

/**
 * Raw-feed items for one folder tab and optional perspective and language.
 * @param {Array<object>} items Newest first.
 * @param {{folder: string, perspective?: string, language?: string}} filter
 */
export function filterRawItems(items, { folder, perspective, language } = {}) {
  return (items || []).filter(
    (item) =>
      (!folder || item.folder === folder) &&
      (!perspective || item.perspective === perspective) &&
      (!language || item.language === language),
  );
}

/** Digest marker for one item: not yet digested, unassigned, or its story. */
export function itemDigestState(item) {
  if (!item?.digestedAt) return 'not-digested';
  return item.storyId ? 'assigned' : 'unassigned';
}

/** Readable verification label. */
export function verificationLabel(code) {
  return NEWS_VERIFICATION_LABELS[code] || NEWS_VERIFICATION_LABELS.reported;
}

/**
 * Cited items for a story, in citation order, from the live items and the
 * cited-item snapshots the provider keeps after retention.
 */
export function citedItems(story, items, citations) {
  const byId = new Map();
  for (const item of citations || []) byId.set(item.id, item);
  for (const item of items || []) byId.set(item.id, item);
  return (story?.itemIds || []).map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Open stories without a pin (no location, or a development): list-only,
 * counted in the panel.
 */
export function listOnlyCount(stories) {
  return (stories || []).filter(
    (story) => story.status === 'open' && !isPinnedStory(story),
  ).length;
}
