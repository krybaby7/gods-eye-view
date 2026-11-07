const finishTime = (run) => Date.parse(run.finishedAt ?? '');
const utcDayKey = (time) => new Date(time).toISOString().slice(0, 10);

export function createHistoryDayKey(timeZone) {
  if (timeZone === 'UTC') return utcDayKey;
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (time) => {
    const parts = formatter.formatToParts(time);
    const year = parts.find(({ type }) => type === 'year').value;
    const month = parts.find(({ type }) => type === 'month').value;
    const day = parts.find(({ type }) => type === 'day').value;
    return year.padStart(4, '0') + '-' + month + '-' + day;
  };
}

function runMetadata({ findingIds, answer, ...metadata }) {
  return metadata;
}

function findingsThrough(search, knownRuns) {
  const lastSeen = new Map();
  for (const known of knownRuns) {
    for (const id of known.findingIds ?? []) lastSeen.set(id, known.finishedAt);
  }
  return new Map(
    (search.findings ?? [])
      .filter((finding) => lastSeen.has(finding.id))
      .map((finding) => [
        finding.id,
        { ...finding, lastSeenAt: lastSeen.get(finding.id) },
      ]),
  );
}

/** Project a search as it stood at a point in its history. */
export function buildRunSnapshot(
  search,
  { asOf, runId, dayKey = utcDayKey } = {},
) {
  const createdAt = Date.parse(search.createdAt);
  if (asOf && Number.isFinite(createdAt) && dayKey(createdAt) > asOf)
    return null;
  const runs = (search.runs ?? [])
    .filter((run) => {
      const time = finishTime(run);
      return Number.isFinite(time) && (!asOf || dayKey(time) <= asOf);
    })
    .sort((a, b) => finishTime(a) - finishTime(b));
  const index = runId
    ? runs.findIndex(({ id }) => id === runId)
    : runs.length - 1;
  if (runId && index < 0) return null;
  const knownRuns = runs.slice(0, index + 1);
  const latest = knownRuns.at(-1);
  const run = runId
    ? latest
    : (knownRuns.findLast(({ status }) => status === 'ok') ?? latest ?? null);
  const knownIds = new Set(knownRuns.map(({ id }) => id));
  const knownFindings = findingsThrough(search, knownRuns);
  const findingIds = run?.findingIds ?? [];
  const currentIds = new Set(findingIds);
  const findings = findingIds
    .map((id) => knownFindings.get(id))
    .filter(Boolean)
    .map((finding) => ({ ...finding, fresh: finding.firstRunId === run.id }));
  const { error, ...record } = search;

  return {
    ...record,
    status:
      asOf || runId
        ? latest?.status === 'ok'
          ? 'ready'
          : latest
            ? 'failed'
            : 'running'
        : search.status,
    error: asOf || runId ? latest?.error : error,
    run,
    findings,
    earlierFindings: [...knownFindings.values()].filter(
      ({ id }) => !currentIds.has(id),
    ),
    sources: (search.sources ?? []).filter(({ firstRunId }) =>
      knownIds.has(firstRunId),
    ),
    runs: knownRuns.map(runMetadata),
  };
}

export function listSearchDays(searches, { dayKey = utcDayKey } = {}) {
  const days = new Set();
  for (const search of searches) {
    for (const run of search.runs ?? []) {
      const time = finishTime(run);
      if (Number.isFinite(time)) days.add(dayKey(time));
    }
  }
  return [...days].sort().reverse();
}

export function compareRuns(search, from, to) {
  const runs = (search.runs ?? [])
    .filter((run) => Number.isFinite(finishTime(run)))
    .sort((a, b) => finishTime(a) - finishTime(b));
  const firstIndex = runs.findIndex(
    (run) => run.id === from && run.status === 'ok',
  );
  const secondIndex = runs.findIndex(
    (run) => run.id === to && run.status === 'ok',
  );
  if (firstIndex < 0 || secondIndex < 0) return null;
  const first = runs[firstIndex];
  const second = runs[secondIndex];
  const firstIds = new Set(first.findingIds ?? []);
  const secondIds = new Set(second.findingIds ?? []);
  const byId = findingsThrough(search, runs.slice(0, secondIndex + 1));
  const original =
    firstIndex > secondIndex
      ? findingsThrough(search, runs.slice(0, firstIndex + 1))
      : byId;
  const select = (ids, predicate) =>
    [...ids]
      .filter(predicate)
      .map((id) => byId.get(id) ?? original.get(id))
      .filter(Boolean);
  return {
    added: select(secondIds, (id) => !firstIds.has(id)),
    seenAgain: select(secondIds, (id) => firstIds.has(id)),
    notSeenSince: select(firstIds, (id) => !secondIds.has(id)),
  };
}
