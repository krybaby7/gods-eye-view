export const SEARCH_COLORS = Object.freeze([
  '#a78bfa',
  '#2dd4bf',
  '#fde047',
  '#f472b6',
  '#38bdf8',
  '#fb923c',
  '#bef264',
  '#cbd5e1',
]);

export const FINDING_BASIS = Object.freeze({
  'happened-here': 'Happened here',
  'speaker-based': 'Placed where the speaker is based',
  'said-here': 'Said here',
  'located-here': 'Located here',
  'applies-here': 'Applies here',
});

const FINDING_KINDS = new Set(['event', 'statement', 'place', 'area']);
const array = (value) => (Array.isArray(value) ? value : []);

function location(value) {
  if (
    !Number.isFinite(value?.lat) ||
    Math.abs(value.lat) > 90 ||
    !Number.isFinite(value.lon) ||
    Math.abs(value.lon) > 180
  )
    return null;
  return { ...value };
}

function normalizeFinding(finding) {
  if (typeof finding?.id !== 'string' || !FINDING_KINDS.has(finding.kind))
    return null;
  return {
    ...finding,
    location: location(finding.location),
    hotspot: location(finding.hotspot),
    sourceIds: array(finding.sourceIds),
    alsoIn: array(finding.alsoIn),
    warMonitor: array(finding.warMonitor),
  };
}

function validSource(source) {
  if (typeof source?.id !== 'string' || typeof source.url !== 'string')
    return false;
  try {
    const url = new URL(source.url);
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function normalizeSearchRecord(search) {
  if (typeof search?.id !== 'string') return null;
  const color = SEARCH_COLORS[search.colorIndex] || SEARCH_COLORS[0];
  return {
    ...search,
    color,
    visible: search.visible === true,
    pinned: search.pinned === true,
    sources: array(search.sources).filter(validSource),
    findings: array(search.findings).map(normalizeFinding).filter(Boolean),
    earlierFindings: array(search.earlierFindings)
      .map(normalizeFinding)
      .filter(Boolean),
    runs: array(search.runs),
  };
}

export function normalizeSearchSnapshot(payload) {
  if (!Array.isArray(payload?.searches)) return null;
  return {
    ...payload,
    revision: String(payload.revision ?? ''),
    searches: payload.searches.map(normalizeSearchRecord).filter(Boolean),
    days: array(payload.days),
    agents: payload.agents ?? {},
    defaultAgent: payload.defaultAgent ?? 'claude',
  };
}
