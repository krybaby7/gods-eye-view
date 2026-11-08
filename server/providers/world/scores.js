export function scoreIndicator(indicator, value) {
  if (!Number.isFinite(value)) return null;
  const {
    transform,
    anchors: { a, b },
    direction,
  } = indicator;
  let transformed = value;
  if (transform === 'log10') transformed = Math.log10(value);
  if (transform === 'log10p1') transformed = Math.log10(1 + value);
  if (!Number.isFinite(transformed)) return null;
  const position = Math.max(0, Math.min(1, (transformed - a) / (b - a)));
  return 100 * (direction === 'higher-is-worse' ? 1 - position : position);
}

function periodEnd(period) {
  if (/^\d{4}$/.test(period)) return new Date(`${period}-12-31T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(period)) {
    const start = new Date(`${period}-01T00:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() + 1, 0);
    return start;
  }
  return new Date(`${period}T00:00:00Z`);
}

function stale(end, months, asOf) {
  const deadline = new Date(end);
  const day = deadline.getUTCDate();
  deadline.setUTCMonth(deadline.getUTCMonth() + months + 1, 0);
  deadline.setUTCDate(Math.min(day, deadline.getUTCDate()));
  return asOf > deadline.toISOString().slice(0, 10);
}

function newestFirst(a, b) {
  return (
    b.end - a.end ||
    (
      b.observation.publishedAt ??
      b.observation.retrievedAt ??
      ''
    ).localeCompare(
      a.observation.publishedAt ?? a.observation.retrievedAt ?? '',
    ) ||
    (b.observation.retrievedAt ?? '').localeCompare(
      a.observation.retrievedAt ?? '',
    )
  );
}

function summarizeSlot(definitions, readings) {
  const oldest = readings.reduce(
    (earliest, reading) =>
      !earliest || reading.end < earliest.end ? reading : earliest,
    null,
  );
  const coverage = { known: readings.length, total: definitions.length };
  const weightedSum = readings.reduce(
    (sum, { score, indicator }) => sum + score * (indicator.weight ?? 1),
    0,
  );
  const weights = readings.reduce(
    (sum, { indicator }) => sum + (indicator.weight ?? 1),
    0,
  );
  return {
    score: coverage.known * 2 >= coverage.total ? weightedSum / weights : null,
    period: oldest?.observation.period ?? null,
    coverage,
    observation: oldest?.observation ?? null,
    stale: readings.some((reading) => reading.stale),
    critical: readings.some(
      ({ indicator, score }) =>
        indicator.section === 'condition' &&
        indicator.criticalBelow != null &&
        score < indicator.criticalBelow,
    ),
  };
}

function summarizeCondition(slots, conditionIds) {
  const known = conditionIds.filter((id) => slots[id].score !== null);
  const coverage = { known: known.length, total: conditionIds.length };
  const weakest = known.reduce(
    (lowest, id) =>
      lowest === null || slots[id].score < slots[lowest].score ? id : lowest,
    null,
  );
  const slot = coverage.known * 2 >= coverage.total ? weakest : null;
  return {
    score: slots[slot]?.score ?? null,
    slot,
    period: slots[slot]?.period ?? null,
    coverage,
  };
}

function medianYear(readings) {
  const years = readings
    .filter(
      ({ indicator, observation }) =>
        indicator.frequency === 'annual' &&
        observation.method !== 'source-forecast' &&
        /^\d{4}$/.test(observation.period),
    )
    .map(({ observation }) => Number(observation.period))
    .sort((a, b) => a - b);
  if (!years.length) return null;
  return (
    (years[Math.floor((years.length - 1) / 2)] +
      years[Math.floor(years.length / 2)]) /
    2
  );
}

export function scoreCountries({ countries, indicators }, observations, asOf) {
  const day = new Date(asOf).toISOString().slice(0, 10);
  const definitions = Map.groupBy(indicators, ({ slot }) => slot);
  const indicatorsById = new Map(
    indicators.map((indicator) => [indicator.id, indicator]),
  );
  const conditionIds = [...definitions]
    .filter(([, entries]) => entries[0].section === 'condition')
    .map(([id]) => id);
  const byEconomy = new Map();
  for (const observation of observations) {
    const indicator = indicatorsById.get(observation.indicator);
    if (!indicator) continue;
    const score = scoreIndicator(indicator, observation.value);
    const end = periodEnd(observation.period);
    if (score === null || !Number.isFinite(+end)) continue;
    const key = `${observation.iso3}:${indicator.id}`;
    const reading = {
      observation,
      indicator,
      score,
      end,
      stale: stale(end, indicator.staleAfterMonths, day),
    };
    const current = byEconomy.get(key);
    if (!current || newestFirst(reading, current) < 0)
      byEconomy.set(key, reading);
  }

  return Object.fromEntries(
    countries.map(({ iso3, name, kind, aliases, dataIso3 }) => {
      const readings =
        kind === 'disputed'
          ? []
          : indicators.flatMap((indicator) => {
              const economyCodes = new Set([
                iso3,
                aliases?.[indicator.source],
                dataIso3,
              ]);
              const candidates = [...economyCodes]
                .map((id) => byEconomy.get(`${id}:${indicator.id}`))
                .filter(Boolean);
              return candidates.sort(newestFirst).slice(0, 1);
            });
      const bySlot = Map.groupBy(readings, ({ indicator }) => indicator.slot);
      const slots = Object.fromEntries(
        [...definitions].map(([id, entries]) => [
          id,
          summarizeSlot(entries, bySlot.get(id) ?? []),
        ]),
      );
      return [
        iso3,
        {
          iso3,
          name,
          kind,
          slots,
          condition: summarizeCondition(slots, conditionIds),
          dataAge: medianYear(readings),
          coverage: { known: readings.length, total: indicators.length },
          retrievedAt:
            readings
              .map(({ observation }) => observation.retrievedAt)
              .filter(Boolean)
              .sort()
              .at(-1) ?? null,
        },
      ];
    }),
  );
}
