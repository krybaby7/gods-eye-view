const SOURCE_NAMES = {
  worldbank: 'World Bank',
  imf: 'IMF DataMapper',
  ucdp: 'UCDP Candidate Events',
  vdem: 'V-Dem',
};

function sourceChange({
  id,
  name = SOURCE_NAMES[id] ?? id,
  status,
  count,
  error,
  detail,
  unit = 'observation',
}) {
  const loaded = `${count} ${unit}${count === 1 ? '' : 's'}`;
  if (status === 'failed') {
    const outcome = count ? `loaded ${loaded} with errors` : 'failed';
    return `${name} ${outcome}${error ? ` (${error})` : ''}.`;
  }
  if (status === 'skipped') return `${name} skipped.`;
  return `${name} loaded ${loaded}.${detail ? ` ${detail}` : ''}`;
}

function displayScore(score) {
  return score == null ? 'unknown' : `${Math.round(score)}/100`;
}

function slotChange(id, before, after) {
  const beforeValue = before?.observation?.value;
  const afterValue = after?.observation?.value;
  const beforeScore = before?.score ?? null;
  const afterScore = after?.score ?? null;
  if (beforeScore === null && afterScore === null) return null;
  const details = [];
  if (
    beforeScore !== afterScore &&
    (beforeScore === null ||
      afterScore === null ||
      Math.round(beforeScore) !== Math.round(afterScore))
  ) {
    details.push(`${displayScore(beforeScore)} → ${displayScore(afterScore)}`);
  }
  if (beforeValue != null && afterValue != null && beforeValue !== afterValue) {
    details.push(`value ${beforeValue} → ${afterValue}`);
  }
  if (before?.period && after?.period && before.period !== after.period) {
    details.push(`period ${before.period} → ${after.period}`);
  }
  if (
    beforeScore !== null &&
    afterScore !== null &&
    Boolean(before.stale) !== Boolean(after.stale)
  ) {
    details.push(after.stale ? 'became stale' : 'became current');
  }
  if (
    beforeScore !== null &&
    afterScore !== null &&
    Boolean(before.critical) !== Boolean(after.critical)
  ) {
    details.push(after.critical ? 'became critical' : 'cleared critical flag');
  }
  return details.length ? `${id} ${details.join(', ')}` : null;
}

function countryChange(iso3, before, after) {
  const oldSlots = before?.slots ?? {};
  const newSlots = after?.slots ?? {};
  const slots = new Set([...Object.keys(oldSlots), ...Object.keys(newSlots)]);
  const changes = [...slots]
    .map((id) => slotChange(id, oldSlots[id], newSlots[id]))
    .filter(Boolean);
  const oldCondition = before?.condition;
  const newCondition = after?.condition;
  const label = (condition) =>
    condition?.slot
      ? `${condition.slot} ${displayScore(condition.score)}`
      : 'unknown';
  if (label(oldCondition) !== label(newCondition)) {
    changes.unshift(
      `Condition ${label(oldCondition)} → ${label(newCondition)}`,
    );
  }
  return changes.length
    ? {
        iso3,
        text: `${after?.name ?? before?.name ?? iso3} — ${changes.join(' · ')}`,
      }
    : null;
}

export function createTurn({
  number,
  startedAt,
  endedAt,
  sources,
  previous,
  countries,
  newObservations,
  featureChanges = [],
}) {
  const changes = [];
  if (previous == null || number === 1) {
    changes.push(
      ...sources.map((source) => ({ iso3: null, text: sourceChange(source) })),
    );
  } else {
    const countriesSeen = [
      ...new Set([...Object.keys(previous), ...Object.keys(countries)]),
    ].sort();
    for (const iso3 of countriesSeen) {
      const change = countryChange(iso3, previous[iso3], countries[iso3]);
      if (change) changes.push(change);
    }
    if (!changes.length && !featureChanges.length)
      changes.push({ iso3: null, text: 'No country changes.' });
    for (const source of sources.filter(({ status }) => status === 'failed')) {
      changes.push({ iso3: null, text: sourceChange(source) });
    }
  }
  changes.push(...featureChanges);
  const flagChanges = featureChanges.filter(
    ({ kind }) => kind === 'condition-flag',
  );
  return {
    number,
    startedAt,
    endedAt,
    sources,
    newObservations,
    newEvents: flagChanges.filter(({ action }) => action === 'set').length,
    statusChanges: flagChanges.length,
    newEstimates: 0,
    changes,
  };
}
