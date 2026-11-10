import { createReadStream } from 'node:fs';
import { readResponseTextCapped } from '../../common/http.js';
import {
  countryCode,
  fetchResponseWithDeadline,
  monthIndex,
  observation,
  releaseDue,
  sourceCountries,
} from './common.js';
import { columnIndices, csvRecords, csvRows } from './csv.js';
import {
  downloadWorldFile,
  hasWorldDownload,
  pruneWorldDownloads,
} from './download.js';
import { zipEntryChunks } from './zip.js';

const CATALOG = 'https://ucdp.uu.se/downloads/';
const HISTORY = `${CATALOG}olddw.html`;
const DOWNLOADS = `${CATALOG}candidateged/`;
const BULK_LIMIT = 50_000_000;
const EVENT_COLUMNS = ['id', 'country', 'date_start', 'date_end', 'best'];

export const estimatedBytes = 34_000_000;
export const requestHost = new URL(CATALOG).hostname;
export const version = 2;

// Candidate's country column uses Gleditsch and Ward labels.
const COUNTRY_ALIASES = {
  'Cambodia (Kampuchea)': 'KHM',
  'DR Congo (Zaire)': 'COD',
  'Congo (Brazzaville)': 'COG',
  'Ivory Coast': 'CIV',
  'Myanmar (Burma)': 'MMR',
  'Russia (Soviet Union)': 'RUS',
  'Yemen (North Yemen)': 'YEM',
  Turkey: 'TUR',
  Tanzania: 'TZA',
  'Macedonia, FYR': 'MKD',
  'Serbia (Yugoslavia)': 'SRB',
  'Bosnia-Herzegovina': 'BIH',
  'United States of America': 'USA',
  'United Kingdom': 'GBR',
  'East Timor': 'TLS',
  Swaziland: 'SWZ',
  'Vietnam (North Vietnam)': 'VNM',
  Palestine: 'PSE',
};

export function shouldCheck(context) {
  return releaseDue(context, monthIndex);
}

function periodLabel(month) {
  const year = Math.floor(month / 12);
  return `${year}-${String((month % 12) + 1).padStart(2, '0')}`;
}

function releasesIn(html) {
  const links = html.matchAll(
    /\bhref\s*=\s*["'](?:https:\/\/ucdp\.uu\.se)?(?:\/downloads\/)?candidateged\/(GEDEvent_v((\d{2})_0_(\d{1,2})|(\d{2})_(\d{2})_(\d{2})_(\d{2}))\.(csv|zip))["']/gi,
  );
  return Array.from(
    links,
    ([
      ,
      filename,
      version,
      yy,
      mm,
      firstYear,
      firstMonth,
      lastYear,
      lastMonth,
      extension,
    ]) => {
      const start =
        (2000 + Number(yy ?? firstYear)) * 12 + Number(mm ?? firstMonth) - 1;
      const end =
        (2000 + Number(yy ?? lastYear)) * 12 + Number(mm ?? lastMonth) - 1;
      if (
        Number(mm ?? firstMonth) < 1 ||
        Number(mm ?? firstMonth) > 12 ||
        Number(mm ?? lastMonth) < 1 ||
        Number(mm ?? lastMonth) > 12 ||
        start > end
      )
        return null;
      return {
        start,
        end,
        version: version.replaceAll('_', '.'),
        url: DOWNLOADS + filename,
        extension: extension.toLowerCase(),
      };
    },
  ).filter(Boolean);
}

export function cachedDownloadUrls(sourceVersion) {
  const versions = /^UCDP Candidate (.+)$/.exec(sourceVersion ?? '')?.[1];
  if (!versions) return [];
  const files = versions.split(' + ');
  if (
    files.some(
      (version) => !/^\d{2}\.(?:0\.\d{1,2}|\d{2}\.\d{2}\.\d{2})$/.test(version),
    )
  )
    return [];
  return files.map((version) =>
    ['csv', 'zip'].map(
      (extension) =>
        `${DOWNLOADS}GEDEvent_v${version.replaceAll('.', '_')}.${extension}`,
    ),
  );
}

async function cachedReleases(sourceVersion, cacheDirectory) {
  const releases = [];
  for (const urls of cachedDownloadUrls(sourceVersion)) {
    let cached;
    for (const url of urls) {
      if (await hasWorldDownload(url, cacheDirectory)) {
        [cached] = releasesIn(`href="${url}"`);
        break;
      }
    }
    if (!cached) return [];
    releases.push(cached);
  }
  return releases;
}

function countryKey(name) {
  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function candidateCountries(registry) {
  const byName = new Map(
    Object.entries(COUNTRY_ALIASES).map(([name, iso3]) => [
      countryKey(name),
      iso3,
    ]),
  );
  for (const country of registry.countries) {
    if (country.dataIso3) continue;
    byName.set(countryKey(country.name), country.iso3);
    byName.set(countryKey(countryCode(country, 'ucdp')), country.iso3);
  }
  return byName;
}

function populationsFor(observations, period) {
  const byCountry = new Map();
  for (const item of observations) {
    if (
      item.indicator !== 'population.total' ||
      !Number.isFinite(item.value) ||
      item.value <= 0 ||
      !/^\d{4}$/.test(item.period) ||
      item.period > period.slice(0, 4)
    )
      continue;
    const previous = byCountry.get(item.iso3);
    if (
      !previous ||
      item.period > previous.period ||
      (item.period === previous.period &&
        (item.retrievedAt ?? '') >= (previous.retrievedAt ?? ''))
    ) {
      byCountry.set(item.iso3, item);
    }
  }
  return byCountry;
}

const EVENT_DATE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?$/;

async function mergeEvents(chunks, events, countryNames, coveredCountries) {
  let columns;
  for await (const record of csvRecords(chunks)) {
    const row = csvRows(record).next().value;
    if (!row) continue;
    if (!columns) {
      columns = columnIndices(row, EVENT_COLUMNS);
      continue;
    }
    const [id, country, dateStart, dateEnd, best] = columns.map(
      (index) => row[index],
    );
    if (
      !id ||
      !country ||
      !EVENT_DATE.test(dateStart) ||
      !EVENT_DATE.test(dateEnd)
    )
      throw new Error('Invalid UCDP Candidate event identity or dates');
    const iso3 = countryNames.get(countryKey(country));
    if (iso3) coveredCountries.add(iso3);
    events.set(id, {
      iso3,
      country,
      dateStart: dateStart.slice(0, 7),
      dateEnd: dateEnd.slice(0, 7),
      best: best?.trim() ? Number(best) : NaN,
    });
  }
  if (!columns) throw new Error('Missing UCDP Candidate CSV header');
}

export async function fetchObservations({
  fetchImpl,
  registry,
  now,
  observations = [],
  cacheDirectory,
  onProgress,
  signal,
  data,
  rederive,
  lastCheckedAt,
}) {
  const indicator = registry.indicators.find(({ source }) => source === 'ucdp');
  if (!populationsFor(observations, String(now.getUTCFullYear())).size)
    throw new Error('World Bank population is unavailable for UCDP Candidate');
  const cached =
    rederive && !shouldCheck({ lastCheckedAt, now })
      ? await cachedReleases(
          data?.sourceVersion ??
            observations.find(
              (item) =>
                item.indicator === indicator.id && item.period === data?.period,
            )?.sourceVersion,
          cacheDirectory,
        )
      : [];
  let available = cached;
  if (!cached.length) {
    const catalogues = await Promise.all(
      [CATALOG, HISTORY].map((url) =>
        fetchResponseWithDeadline(fetchImpl, url, {
          signal,
          read: readResponseTextCapped,
        }),
      ),
    );
    available = catalogues.flatMap(releasesIn);
  }
  const releases = available
    .filter(({ end }) => end < monthIndex(now))
    .sort((a, b) => b.end - a.end || a.start - b.start);
  const newest = releases[0]?.end;
  if (newest === undefined)
    throw new Error('No UCDP Candidate bulk releases in the catalogue');
  const oldest = newest - 11;
  const selected = [];
  let uncovered = newest;
  while (uncovered >= oldest) {
    const release = releases.find(
      ({ start, end }) => start <= uncovered && uncovered <= end,
    );
    if (!release)
      throw new Error(
        `UCDP Candidate bulk releases lack 12 complete months: missing ${periodLabel(uncovered)}`,
      );
    selected.unshift(release);
    uncovered = release.start - 1;
  }

  const firstPeriod = periodLabel(oldest);
  const period = periodLabel(newest);
  const countryNames = candidateCountries(registry);
  const populations = populationsFor(observations, period);
  if (!populations.size)
    throw new Error(
      'World Bank population is unavailable for the UCDP Candidate period',
    );
  const events = new Map();
  const coveredCountries = new Set();
  const currentDownloads = [];
  for (const { url, extension } of selected) {
    const { path } = await downloadWorldFile(url, {
      cacheDirectory,
      fetchImpl,
      onProgress,
      signal,
      maxBytes: BULK_LIMIT,
      immutable: true,
      format: extension,
      csvColumns: EVENT_COLUMNS,
      source: 'ucdp',
      parse(path) {
        const chunks =
          extension === 'zip'
            ? zipEntryChunks(
                path,
                (name) => /\.csv$/i.test(name),
                BULK_LIMIT,
                signal,
              )
            : createReadStream(path, { signal });
        return mergeEvents(chunks, events, countryNames, coveredCountries);
      },
    });
    currentDownloads.push(path);
  }

  const totals = new Map();
  const unmapped = new Set();
  for (const { iso3, country, dateStart, dateEnd, best } of events.values()) {
    if (dateStart > period || dateEnd < firstPeriod) continue;
    if (!iso3) {
      unmapped.add(country);
      continue;
    }
    totals.set(
      iso3,
      (totals.get(iso3) ?? 0) +
        (best >= 0 && Number.isSafeInteger(best) ? best : NaN),
    );
  }
  const sourceVersion = `UCDP Candidate ${selected.map(({ version }) => version).join(' + ')}`;
  const countries = sourceCountries(registry);
  if (unmapped.size) {
    throw new Error(
      `Unmapped UCDP Candidate event countries: ${[...unmapped].sort().join(', ')}`,
    );
  }
  const deathsByIso3 = Object.fromEntries(
    countries.flatMap(({ iso3 }) => {
      // The event files contain no country roster. A row in a selected release
      // establishes coverage even when the event falls outside the score window.
      if (!coveredCountries.has(iso3)) return [];
      const deaths = totals.get(iso3) ?? 0;
      return Number.isSafeInteger(deaths) ? [[iso3, deaths]] : [];
    }),
  );
  const missing = countries.filter(
    ({ iso3 }) => !populations.has(iso3) || deathsByIso3[iso3] === undefined,
  ).length;
  await pruneWorldDownloads('ucdp', currentDownloads);
  return {
    observations: countries.flatMap(({ iso3 }) => {
      const population = populations.get(iso3);
      const deaths = deathsByIso3[iso3];
      if (!population || deaths === undefined) return [];
      return observation(
        now,
        indicator.id,
        iso3,
        (deaths * 1_000_000) / population.value,
        period,
        {
          sourceVersion,
          method: 'source-estimate',
        },
      );
    }),
    data: { period, deathsByIso3, sourceVersion },
    ...(cached.length && { checkedRelease: false }),
    detail: `UCDP Candidate public bulk files, ${firstPeriod} through ${period}. Zero reported deaths require a country record in a selected release. ${missing} countries lacked coverage, a usable population, or a fatality count.`,
  };
}
