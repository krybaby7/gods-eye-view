const DAY = 86_400_000;
const FX_THRESHOLD = 0.2;
const CPI_THRESHOLD = 0.2;

export function conditionFlag(sourceId, fields) {
  const { iso3, slot, key = slot } = fields;
  return {
    ...fields,
    id: sourceId + ':' + iso3 + ':' + key,
    sourceId,
  };
}

export function conditionResult(flags, previous, now, extra = {}) {
  const before = new Map(
    (previous?.flags ?? []).map((flag) => [flag.id, flag]),
  );
  const after = new Map(flags.map((flag) => [flag.id, flag]));
  const changes = [];
  const events = [];
  const reportTime = now.toISOString();
  function transition(flag, action) {
    changes.push({
      iso3: flag.iso3,
      text: (action === 'set' ? 'Flag set · ' : 'Flag cleared · ') + flag.label,
      kind: 'condition-flag',
      action,
    });
    events.push({
      id: 'ev_' + flag.id + ':' + action + ':' + reportTime,
      type: 'condition-flag',
      actors: [],
      places: [flag.iso3],
      affects: { assets: [], chokepoints: [], relations: [] },
      eventTime: action === 'set' ? flag.date : reportTime,
      reportTime,
      stage: action === 'cleared' ? 'reversed' : (flag.stage ?? 'observed'),
      sources: [flag.source],
      corroboration: 'single-source',
      sets: [
        { target: 'country:' + flag.iso3 + ':' + flag.slot, status: action },
      ],
      review: flag.reviewed === false ? 'flagged' : 'ok',
    });
  }
  for (const [id, flag] of after) if (!before.has(id)) transition(flag, 'set');
  for (const [id, flag] of before)
    if (!after.has(id)) transition(flag, 'cleared');
  return {
    data: {
      flags,
      events: [...(previous?.events ?? []), ...events].slice(-500),
      ...extra,
    },
    count: flags.length,
    unit: 'flag',
    changes,
  };
}

export function fxFlags(rows, currencies, now, source) {
  const byQuote = new Map();
  for (const { date, quote, rate } of rows) {
    const time = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date) : NaN;
    if (
      !currencies[quote] ||
      !Number.isFinite(rate) ||
      rate <= 0 ||
      !Number.isFinite(time) ||
      time > +now ||
      +now - time > 40 * DAY
    )
      continue;
    if (!byQuote.has(quote)) byQuote.set(quote, new Map());
    byQuote.get(quote).set(date, { date, time, rate });
  }
  const flags = [];
  for (const [quote, days] of byQuote) {
    const ordered = [...days.values()].sort((a, b) => b.time - a.time);
    const latest = ordered[0];
    if (+now - latest.time > 7 * DAY) continue;
    const baseline = latest.time - 30 * DAY;
    const past = ordered
      .filter(({ time }) => Math.abs(time - baseline) <= 3 * DAY)
      .sort(
        (a, b) => Math.abs(a.time - baseline) - Math.abs(b.time - baseline),
      )[0];
    if (!past) continue;
    const decline = (latest.rate - past.rate) / latest.rate;
    if (decline < FX_THRESHOLD) continue;
    for (const iso3 of currencies[quote]) {
      const coverageDays = (latest.time - past.time) / DAY;
      flags.push(
        conditionFlag('live-fx', {
          iso3,
          slot: 'C5',
          label:
            quote +
            ' down ' +
            (decline * 100).toFixed(0) +
            '% vs USD in ' +
            coverageDays +
            ' days',
          source,
          sourceName: 'Frankfurter',
          date: latest.date,
          periodStart: past.date,
          coverageDays,
        }),
      );
    }
  }
  return flags;
}

export function monthlyCpiFlags(rows, now, source) {
  const periodNow = now.toISOString().slice(0, 7);
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 4))
    .toISOString()
    .slice(0, 7);
  const byCountry = new Map();
  for (const { iso3, period, value } of rows) {
    if (
      !/^[A-Z]{3}$/.test(iso3) ||
      !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period) ||
      period > periodNow ||
      !Number.isFinite(value) ||
      value <= 0
    )
      continue;
    if (!byCountry.has(iso3)) byCountry.set(iso3, new Map());
    byCountry.get(iso3).set(period, value);
  }
  const flags = [];
  for (const [iso3, series] of byCountry) {
    const period = [...series.keys()].sort().at(-1);
    if (period < cutoff) continue;
    const previousYear = Number(period.slice(0, 4)) - 1 + period.slice(4);
    const previous = series.get(previousYear);
    if (!previous) continue;
    const inflation = (series.get(period) - previous) / previous;
    if (inflation < CPI_THRESHOLD) continue;
    flags.push(
      conditionFlag('live-imf-cpi', {
        iso3,
        slot: 'C4',
        label:
          'CPI up ' +
          (inflation * 100).toFixed(1) +
          '% year over year (draft 20% threshold)',
        date: period,
        periodStart: previousYear,
        source,
        sourceName: 'IMF CPI',
      }),
    );
  }
  return flags;
}
