import {
  readResponseBytesCapped,
  readResponseTextCapped,
} from '../../common/http.js';
import {
  countryCode,
  fetchResponse,
  monthIndex,
  observation,
  releaseDue,
  sourceCountries,
} from './common.js';
import { columnIndices, csvRows } from './csv.js';
import { zipEntryChunks } from './zip.js';

const CATALOG = 'https://ucdp.uu.se/downloads/';
const HISTORY = `${CATALOG}olddw.html`;
const DOWNLOADS = `${CATALOG}candidateged/`;
const BULK_LIMIT = 50_000_000;

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

async function download(fetchImpl, { url, extension }) {
  const signal = AbortSignal.timeout(120_000);
  const response = await fetchResponse(fetchImpl, url, signal);
  if (extension !== 'zip')
    return readResponseTextCapped(response, BULK_LIMIT, signal);
  const bytes = await readResponseBytesCapped(response, BULK_LIMIT, signal);
  const decoder = new TextDecoder();
  let csv = '';
  for await (const chunk of zipEntryChunks(
    bytes,
    (name) => /\.csv$/i.test(name),
    BULK_LIMIT,
  )) {
    csv += decoder.decode(chunk, { stream: true });
  }
  return csv + decoder.decode();
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

function mergeEvents(csv, events, countryNames) {
  const rows = csvRows(csv);
  const columns = columnIndices(rows.next().value, [
    'id',
    'country',
    'date_start',
    'date_end',
    'best',
  ]);
  for (const row of rows) {
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
    events.set(id, {
      iso3: countryNames.get(countryKey(country)),
      country,
      dateStart: dateStart.slice(0, 7),
      dateEnd: dateEnd.slice(0, 7),
      best: best?.trim() ? Number(best) : NaN,
    });
  }
}

export async function fetchObservations({
  fetchImpl,
  registry,
  now,
  observations = [],
}) {
  const indicator = registry.indicators.find(({ source }) => source === 'ucdp');
  if (!populationsFor(observations, String(now.getUTCFullYear())).size)
    throw new Error('World Bank population is unavailable for UCDP Candidate');
  const catalogues = await Promise.all(
    [CATALOG, HISTORY].map(async (url) => {
      const signal = AbortSignal.timeout(30_000);
      return readResponseTextCapped(
        await fetchResponse(fetchImpl, url, signal),
        2_000_000,
        signal,
      );
    }),
  );
  const releases = catalogues
    .flatMap(releasesIn)
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
  for (const release of selected) {
    mergeEvents(await download(fetchImpl, release), events, countryNames);
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
        (best >= 0 && Number.isFinite(best) ? best : NaN),
    );
  }
  const sourceVersion = `UCDP Candidate ${selected.map(({ version }) => version).join(' + ')}`;
  const countries = sourceCountries(registry);
  const missing = countries.filter(
    ({ iso3 }) => !populations.has(iso3) || Number.isNaN(totals.get(iso3)),
  ).length;
  if (unmapped.size) {
    throw new Error(
      `Unmapped UCDP Candidate event countries: ${[...unmapped].sort().join(', ')}`,
    );
  }
  return {
    observations: countries.flatMap(({ iso3 }) => {
      const population = populations.get(iso3);
      const deaths = totals.get(iso3) ?? 0;
      if (!population || !Number.isFinite(deaths)) return [];
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
    detail: `UCDP Candidate public bulk files, ${firstPeriod} through ${period}. ${missing} countries lacked a usable population or fatality count.`,
  };
}
