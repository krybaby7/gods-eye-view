import { conditionFlag, conditionResult } from '../conditionEvents.js';
import { countryIds, DAY, download, due } from './liveFeedCommon.js';

const UNHCR = 'https://api.unhcr.org/population/v1/population/';
const UNHCR_SOURCE = 'https://www.unhcr.org/refugee-statistics/';
const UCDP_SOURCE = 'https://ucdp.uu.se/downloads/';
const DRAFT_CONFLICT_DEATH_THRESHOLD = 25;

function displacementStocks(rows, supported, releaseYear) {
  const byCountry = new Map();
  for (const { year, coa_iso, coo_iso, idps } of rows) {
    const value = Number(idps);
    if (
      coa_iso !== coo_iso ||
      !supported.has(coa_iso) ||
      !/^\d{4}$/.test(year) ||
      (releaseYear !== undefined && Number(year) !== releaseYear) ||
      idps === null ||
      idps === '' ||
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
  return byCountry;
}

export function displacementFlags(rows, supported, releaseYear) {
  return [...displacementStocks(rows, supported, releaseYear)].flatMap(
    ([iso3, { year, value }]) =>
      value >= 100_000
        ? [
            conditionFlag('live-unhcr', {
              iso3,
              slot: 'C6',
              label:
                value.toLocaleString('en-US') +
                ' internally displaced (UNHCR ' +
                year +
                ' annual stock)',
              date: String(year),
              source: UNHCR_SOURCE,
              sourceName: 'UNHCR',
            }),
          ]
        : [],
  );
}

export function ucdpStockFlags(ucdp, now) {
  const { period, deathsByIso3 } = ucdp ?? {};
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3))
    .toISOString()
    .slice(0, 7);
  if (
    !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period) ||
    period < cutoff ||
    period >= now.toISOString().slice(0, 7) ||
    !deathsByIso3
  )
    return [];
  const periodStart = new Date(
    Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)) - 12),
  )
    .toISOString()
    .slice(0, 7);
  return Object.entries(deathsByIso3).flatMap(([iso3, recordedDeaths]) =>
    /^[A-Z]{3}$/.test(iso3) &&
    Number.isSafeInteger(recordedDeaths) &&
    recordedDeaths >= DRAFT_CONFLICT_DEATH_THRESHOLD
      ? [
          conditionFlag('live-ucdp-saved', {
            iso3,
            slot: 'C2',
            label:
              recordedDeaths.toLocaleString('en-US') +
              ' recorded conflict deaths in 12 months (draft threshold: ' +
              DRAFT_CONFLICT_DEATH_THRESHOLD +
              ')',
            date: period,
            periodStart,
            recordedDeaths,
            source: UCDP_SOURCE,
            sourceName: 'UCDP Candidate',
          }),
        ]
      : [],
  );
}

export const unhcr = {
  version: 2,
  live: true,
  shouldCheck: (context) => due(context, 7 * DAY),
  async fetchObservations({ fetchImpl, now, data, registry }) {
    const supported = countryIds(registry);
    const currentYear = now.getUTCFullYear();
    for (let year = currentYear - 1; year >= currentYear - 4; year--) {
      const records = await unhcrYear(fetchImpl, year);
      if (!records.length) continue;
      const fresh = year >= currentYear - 2;
      const stocks = displacementStocks(records, supported, year);
      return conditionResult(
        fresh ? displacementFlags(records, supported, year) : [],
        data,
        now,
        {
          period: String(year),
          records: records.length,
          covered: ({ iso3 }) => fresh && stocks.has(iso3),
        },
      );
    }
    throw new Error(
      'UNHCR population API had no annual data in the last four completed years',
    );
  },
};

async function unhcrYear(fetchImpl, year) {
  const url = new URL(UNHCR);
  url.search = new URLSearchParams({
    year: String(year),
    coo_all: 'true',
    coa_all: 'true',
    limit: '2000',
  });
  const records = [];
  let maxPages = 1;
  for (let page = 1; page <= maxPages; page++) {
    url.searchParams.set('page', String(page));
    let result;
    try {
      result = await download(fetchImpl, url.href);
    } catch (error) {
      if (page === 1 && error.status === 404) return [];
      throw error;
    }
    if (
      page === 1 &&
      Array.isArray(result.items) &&
      !result.items.length &&
      (result.maxPages === 0 || result.maxPages === 1)
    )
      return [];
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
    records.push(...result.items.filter((row) => Number(row.year) === year));
  }
  return records;
}

export const savedUcdp = {
  version: 2,
  shouldCheck: () => true,
  async fetchObservations({ features, data, now }) {
    const ucdp = features?.ucdp;
    return conditionResult(ucdpStockFlags(ucdp, now), data, now, {
      period: ucdp?.period,
      bilateralEvents: (ucdp?.bilateralEvents ?? []).filter(
        ({ date }) =>
          Date.parse(date) <= +now && +now - Date.parse(date) <= 90 * DAY,
      ),
      covered: ({ iso3 }) => Number.isSafeInteger(ucdp?.deathsByIso3?.[iso3]),
    });
  },
};
