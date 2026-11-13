const DAY = 86_400_000;
const FX_THRESHOLD = 0.2;
const CPI_THRESHOLD = 0.2;
const rules = {
  'live-coups': [
    'Coup attempt or irregular change in the last 90 days',
    'reported coup coding',
    90,
  ],
  'live-gdacs': [
    'GDACS red alert in the current report window',
    'official alert',
    7,
  ],
  'live-gdelt': [
    'At least 3 distinct events from 3 source domains in 72 hours',
    'news-derived, low confidence',
    3,
  ],
  'live-fx': [
    'At least 20% depreciation versus USD over about 30 days',
    'published reference rates',
    7,
  ],
  'live-imf-cpi': [
    'At least 20% year-on-year all-items inflation',
    'published series or calculated from indices',
    150,
  ],
  'live-unhcr': [
    'At least 100,000 internally displaced in the latest eligible year',
    'published annual stock',
    730,
  ],
  'live-ucdp-saved': [
    'At least 25 recorded deaths over 12 released months',
    'preliminary event data',
    120,
  ],
  'live-ucdp-token': [
    'At least 25 recorded deaths in the latest completed month',
    'preliminary event data',
    90,
  ],
  'live-debt-dsa': [
    'Latest published assessment reports debt distress',
    'official assessment',
    730,
  ],
  'live-electionguide': [
    'Election scheduled within 30 days',
    'published calendar',
    0,
  ],
  'live-hdx': [
    'IPC Phase 4+ or a monitored market price at least 20% higher in three months',
    'reported humanitarian indicator',
    120,
  ],
  'live-ioda': [
    'Current country-level outage signal within 24 hours',
    'network measurement',
    1,
  ],
};

/** The live feeds that have a flag rule, so can set a condition flag. */
export const CONDITION_FLAG_SOURCES = Object.freeze(Object.keys(rules));

export function conditionFlag(sourceId, fields) {
  const { iso3, slot, key = slot } = fields;
  return {
    rule: rules[sourceId]?.[0] ?? 'Condition rule',
    evidence: rules[sourceId]?.[1] ?? 'single-source evidence',
    ruleReviewed: false,
    ...fields,
    id: sourceId + ':' + iso3 + ':' + key,
    sourceId,
  };
}

function evidenceExpiry(flag) {
  const days = rules[flag.sourceId]?.[2];
  const date = /^\d{4}$/.test(flag.date) ? flag.date + '-12-31' : flag.date;
  return flag.expiresAt
    ? Date.parse(flag.expiresAt)
    : Date.parse(date) + days * DAY;
}

function expired(flag, now) {
  return +now > evidenceExpiry(flag);
}

function showFlag(flag, now) {
  if (flag.status === 'cleared') return true;
  const since =
    flag.status === 'no-recent-data'
      ? Date.parse(flag.statusAt)
      : evidenceExpiry(flag);
  const days = rules[flag.sourceId]?.[2];
  return !(+now > since + days * DAY);
}

function flagChange(flag, action) {
  return {
    iso3: flag.iso3,
    text: (action === 'set' ? 'Flag set · ' : 'Flag cleared · ') + flag.label,
    kind: 'condition-flag',
    action,
  };
}

export function activeConditionFlags(features, now) {
  return Object.values(features).flatMap((data) =>
    (data?.flags ?? [])
      .filter((flag) => !expired(flag, now))
      .map(({ id, iso3, label }) => ({ id, iso3, label })),
  );
}

export function netConditionChanges(before, after, features) {
  const oldIds = new Set(before.map(({ id }) => id));
  const newIds = new Set(after.map(({ id }) => id));
  const cleared = new Set(
    Object.values(features)
      .flatMap((data) => data?.inactiveFlags ?? [])
      .filter(({ status }) => status === 'cleared')
      .map(({ id }) => id),
  );
  return [
    ...after
      .filter(({ id }) => !oldIds.has(id))
      .map((flag) => flagChange(flag, 'set')),
    ...before
      .filter(({ id }) => !newIds.has(id) && cleared.has(id))
      .map((flag) => flagChange(flag, 'cleared')),
  ];
}

export function liveFeatureView(sourceId, data, health, now, compact = false) {
  const { flags = [], inactiveFlags = [], ...extra } = data ?? {};
  if (compact) delete extra.batches;
  const clock = {
    lastGoodAt: health?.lastGoodAt ?? null,
    staleSince: health?.staleSince ?? null,
  };
  return {
    ...extra,
    ...clock,
    ...(health?.error && { error: health.error }),
    flags: [...flags, ...inactiveFlags]
      .filter((flag) => showFlag(flag, now))
      .map((flag) => ({
        rule: rules[sourceId]?.[0],
        evidence: rules[sourceId]?.[1],
        ruleReviewed: false,
        ...flag,
        ...clock,
        status:
          flag.status ??
          (expired(flag, now)
            ? 'no-recent-data'
            : health?.staleSince
              ? 'stale'
              : 'active'),
      })),
  };
}

export function conditionResult(flags, previous, now, extra = {}) {
  const { covered, ...metadata } = extra;
  const before = new Map(
    (previous?.flags ?? []).map((flag) => [flag.id, flag]),
  );
  const after = new Map(flags.map((flag) => [flag.id, flag]));
  const changes = [];
  const events = [];
  const reportTime = now.toISOString();
  function transition(flag, action) {
    changes.push(flagChange(flag, action));
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
  const inactive = new Map(
    (previous?.inactiveFlags ?? [])
      .filter((flag) => showFlag(flag, now))
      .map((flag) => [flag.id, flag]),
  );
  for (const [id, flag] of inactive) {
    if (
      !after.has(id) &&
      flag.status === 'no-recent-data' &&
      !expired(flag, now) &&
      covered?.(flag)
    ) {
      transition(flag, 'cleared');
      inactive.set(id, { ...flag, status: 'cleared', statusAt: reportTime });
    }
  }
  for (const [id, flag] of before) {
    if (after.has(id)) continue;
    if (!showFlag(flag, now)) continue;
    const recent = !expired(flag, now) && (covered?.(flag) ?? true);
    const status = recent ? 'cleared' : 'no-recent-data';
    if (recent) transition(flag, 'cleared');
    const statusAt =
      !recent && expired(flag, now)
        ? new Date(evidenceExpiry(flag)).toISOString()
        : reportTime;
    inactive.set(id, { ...flag, status, statusAt });
  }
  for (const id of after.keys()) inactive.delete(id);
  return {
    data: {
      flags,
      events: [...(previous?.events ?? []), ...events].slice(-500),
      inactiveFlags: [...inactive.values()].slice(-500),
      ...metadata,
    },
    count: flags.length,
    unit: 'flag',
    changes,
  };
}

export function fxFlags(rows, currencies, now, source, covered = new Set()) {
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
    for (const iso3 of currencies[quote]) covered.add(iso3);
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

export function monthlyCpiFlags(rows, now, source, covered = new Set()) {
  const periodNow = now.toISOString().slice(0, 7);
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 4))
    .toISOString()
    .slice(0, 7);
  const byCountry = new Map();
  for (const { iso3, period, value, yearOnYear } of rows) {
    if (
      !/^[A-Z]{3}$/.test(iso3) ||
      !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period) ||
      period > periodNow ||
      (!Number.isFinite(yearOnYear) && (!Number.isFinite(value) || value <= 0))
    )
      continue;
    if (!byCountry.has(iso3)) byCountry.set(iso3, new Map());
    const series = byCountry.get(iso3);
    series.set(period, {
      ...series.get(period),
      ...(value !== undefined && { value }),
      ...(yearOnYear !== undefined && { yearOnYear }),
    });
  }
  const flags = [];
  for (const [iso3, series] of byCountry) {
    const period = [...series.keys()].sort().at(-1);
    if (period < cutoff) continue;
    const previousYear = Number(period.slice(0, 4)) - 1 + period.slice(4);
    const current = series.get(period);
    const previous = series.get(previousYear)?.value;
    const published = Number.isFinite(current.yearOnYear);
    if (!published && (!previous || !current.value)) continue;
    const inflation = published
      ? current.yearOnYear / 100
      : (current.value - previous) / previous;
    covered.add(iso3);
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
        evidence: published
          ? 'IMF published year-on-year rate'
          : 'Calculated from the same calendar month of the IMF index',
        value: inflation * 100,
      }),
    );
  }
  return flags;
}
