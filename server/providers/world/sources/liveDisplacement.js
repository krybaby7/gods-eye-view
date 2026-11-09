import { conditionFlag, conditionResult } from '../conditionEvents.js';
import { countryIds, DAY, download, due } from './liveFeedCommon.js';

const UNHCR = 'https://api.unhcr.org/population/v1/population/';
const UNHCR_SOURCE = 'https://www.unhcr.org/refugee-statistics/';
const UCDP_SOURCE = 'https://ucdp.uu.se/downloads/';
const CONFLICT_INDICATOR = 'condition.conflict_deaths';

export function displacementFlags(rows, supported) {
  const byCountry = new Map();
  for (const { year, coa_iso, coo_iso, idps } of rows) {
    const value = Number(idps);
    if (
      coa_iso !== coo_iso ||
      !supported.has(coa_iso) ||
      !/^\d{4}$/.test(year) ||
      !Number.isFinite(value) ||
      value < 0
    )
      continue;
    const previous = byCountry.get(coa_iso);
    if (
      !previous ||
      year > previous.year ||
      (year === previous.year && value > previous.value)
    ) {
      byCountry.set(coa_iso, { year, value });
    }
  }
  return [...byCountry].flatMap(([iso3, { year, value }]) =>
    value >= 100_000
      ? [
          conditionFlag('live-unhcr', {
            iso3,
            slot: 'C6',
            label:
              value.toLocaleString('en-US') +
              ' internally displaced (UNHCR stock)',
            date: String(year),
            source: UNHCR_SOURCE,
            sourceName: 'UNHCR',
          }),
        ]
      : [],
  );
}

export function ucdpStockFlags(observations, now) {
  const latest = new Map();
  for (const row of observations) {
    if (
      row.indicator !== CONFLICT_INDICATOR ||
      !/^\d{4}-\d{2}$/.test(row.period)
    )
      continue;
    const saved = latest.get(row.iso3);
    if (
      !saved ||
      row.period > saved.period ||
      (row.period === saved.period && row.retrievedAt >= saved.retrievedAt)
    )
      latest.set(row.iso3, row);
  }
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3))
    .toISOString()
    .slice(0, 7);
  return [...latest.values()].flatMap(({ iso3, period, value }) =>
    period >= cutoff && value > 0
      ? [
          conditionFlag('live-ucdp-saved', {
            iso3,
            slot: 'C2',
            label:
              'UCDP recorded deaths, rolling 12 months: ' +
              Number(value.toFixed(2)) +
              ' per million',
            date: period,
            source: UCDP_SOURCE,
            sourceName: 'UCDP Candidate',
          }),
        ]
      : [],
  );
}

export const unhcr = {
  live: true,
  shouldCheck: (context) => due(context, 7 * DAY),
  async fetchObservations({ fetchImpl, now, data, registry }) {
    const year = now.getUTCFullYear() - 1;
    const url = new URL(UNHCR);
    url.search = new URLSearchParams({
      year: String(year),
      coo_all: 'true',
      coa_all: 'true',
      limit: '2000',
    });
    const records = [];
    let page = 1;
    let maxPages = 1;
    do {
      url.searchParams.set('page', String(page));
      const result = await download(fetchImpl, url.href);
      if (
        !Array.isArray(result.items) ||
        !Number.isInteger(result.maxPages) ||
        result.maxPages < page ||
        result.maxPages > 20
      )
        throw new Error('UNHCR population pagination unavailable');
      if (page === 1) maxPages = result.maxPages;
      else if (maxPages !== result.maxPages)
        throw new Error('UNHCR pagination changed during refresh');
      records.push(...result.items);
      page += 1;
    } while (page <= maxPages);
    if (!records.length)
      throw new Error('UNHCR population release has no records for ' + year);
    return conditionResult(
      displacementFlags(records, countryIds(registry)),
      data,
      now,
      { period: String(year), records: records.length },
    );
  },
};

export const savedUcdp = {
  shouldCheck: () => true,
  async fetchObservations({ observations, data, now }) {
    return conditionResult(ucdpStockFlags(observations, now), data, now);
  },
};
