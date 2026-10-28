/**
 * The Situation Brief's Coverage line, computed by code from source health
 * and item timestamps; the model never writes it. Quiet is not calm: it says
 * which sources are down, which perspectives have gone silent and how many
 * open stories have no location. Portable: no Cesium, DOM or Node imports,
 * so the server (for the brief's input) and the panel share it.
 */

export const COVERAGE_SILENCE_MS = 24 * 3600_000;

/** Why a degraded source is degraded, in the panel's words. */
export function sourceHealthReason(health = {}) {
  if (health.blocked) return 'blocked';
  if (health.rateLimited) return 'rate limited';
  if (health.stale)
    return health.quiet && health.newestItemAt
      ? `nothing new since ${health.newestItemAt.slice(0, 10)}`
      : 'stale';
  return health.error || 'failing';
}

function itemMs(item) {
  const ms = Date.parse(item?.publishedAt || item?.collectedAt || '');
  return Number.isNaN(ms) ? null : ms;
}

const plural = (count, one, many) => (count === 1 ? one : many);

/**
 * @param {{
 *   sources?: Array<{id: string, name: string, perspective: string, health?: object}>,
 *   perspectives?: Array<{id: string, label: string}>,
 *   items?: Array<{perspective?: string, publishedAt?: string, collectedAt?: string}>,
 *   stories?: Array<{status: string, location: ?object}>,
 *   nowMs: number,
 * }} input
 * @returns {{down: Array<object>, silent: Array<object>, unlocated: number, summary: string, details: string[]}}
 */
export function newsCoverage({
  sources = [],
  perspectives = [],
  items = [],
  stories = [],
  nowMs,
} = {}) {
  const labels = new Map(
    (perspectives || []).map((perspective) => [
      perspective.id,
      perspective.label || perspective.id,
    ]),
  );
  // Theater order first, then any perspective the theater does not list.
  const order = [...labels.keys()];
  for (const source of sources || [])
    if (source.perspective && !labels.has(source.perspective)) {
      labels.set(source.perspective, source.perspective);
      order.push(source.perspective);
    }
  const watched = (sources || []).filter(
    (source) => !source.health?.linkOnly && !source.health?.disabled,
  );
  const down = order
    .map((perspective) => ({
      perspective,
      label: labels.get(perspective),
      sources: watched
        .filter(
          (source) =>
            source.perspective === perspective && source.health?.degraded,
        )
        .map((source) => ({
          id: source.id,
          name: source.name,
          reason: sourceHealthReason(source.health),
        })),
    }))
    .filter((group) => group.sources.length);
  const heard = new Set();
  for (const item of items || []) {
    const ms = itemMs(item);
    if (ms !== null && nowMs - ms <= COVERAGE_SILENCE_MS)
      heard.add(item.perspective);
  }
  const watchedPerspectives = new Set(
    watched.map((source) => source.perspective),
  );
  const silent = order
    .filter((id) => watchedPerspectives.has(id) && !heard.has(id))
    .map((perspective) => ({ perspective, label: labels.get(perspective) }));
  const unlocated = (stories || []).filter(
    (story) => story.status === 'open' && !story.location,
  ).length;

  const downCount = down.reduce((sum, group) => sum + group.sources.length, 0);
  const parts = [];
  if (downCount)
    parts.push(`${downCount} ${plural(downCount, 'source', 'sources')} down`);
  if (silent.length === 1) parts.push(`no ${silent[0].label} items in 24 h`);
  else if (silent.length)
    parts.push(`${silent.length} perspectives with no items in 24 h`);
  if (unlocated)
    parts.push(
      `${unlocated} open ${plural(unlocated, 'story', 'stories')} without a location`,
    );
  const summary = parts.length
    ? `Coverage: ${parts.join(' · ')}`
    : watched.length
      ? 'Coverage: every watched source answering; every watched perspective has items from the last 24 h'
      : 'Coverage: no source health yet';
  const details = [
    ...down.map(
      (group) =>
        `${group.label} down: ${group.sources.map((s) => `${s.name} (${s.reason})`).join(', ')}`,
    ),
    ...silent.map((entry) => `No ${entry.label} items in 24 h`),
    ...(unlocated
      ? [
          `${unlocated} open ${plural(unlocated, 'story', 'stories')} without a location`,
        ]
      : []),
  ];
  return { down, silent, unlocated, summary, details };
}
