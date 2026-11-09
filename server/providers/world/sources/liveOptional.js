import { conditionFlag, conditionResult } from '../conditionEvents.js';
import { iso2Country } from './liveCountryCodes.js';
import { candidateCountryResolver } from './ucdp.js';
import {
  countryIds,
  dateOf,
  DAY,
  download,
  due,
  HOUR,
} from './liveFeedCommon.js';

const ELECTIONS = 'https://www.electionguide.org/p/access/';
const HDX = 'https://docs.humdata.org/build/hdx-apis/hapi';
const IODA = 'https://ioda.inetintel.cc.gatech.edu/';
const UCDP = 'https://ucdp.uu.se/apidocs/';
const DRAFT_CANDIDATE_THRESHOLD = 25;

function allowedEndpoint(value, hosts) {
  const url = URL.parse(value);
  return url?.protocol === 'https:' &&
    hosts.includes(url.hostname) &&
    !url.username &&
    !url.password
    ? url.href
    : null;
}

function protectedFetch(fetchImpl, headers) {
  return async (url, options) => {
    try {
      return await fetchImpl(url, {
        ...options,
        redirect: 'error',
        ...(headers && { headers: { ...options?.headers, ...headers } }),
      });
    } catch {
      throw new Error('Optional feed request could not be completed');
    }
  };
}

function expectRows(payload, ...fields) {
  const rows = Array.isArray(payload)
    ? payload
    : fields.map((field) => payload?.[field]).find(Array.isArray);
  if (!rows)
    throw new Error('Optional feed response has no recognized record list');
  if (
    payload?.next ||
    payload?.hasMore ||
    (Number.isFinite(payload?.TotalCount) && payload.TotalCount > rows.length)
  ) {
    throw new Error('Optional feed response is incomplete');
  }
  return rows;
}

function optional(enabled, interval, read) {
  return {
    version: 2,
    live: enabled,
    shouldCheck: (context) => enabled && due(context, interval),
    async fetchObservations(context) {
      if (!enabled)
        throw new Error('Optional feed requires explicit configuration');
      return conditionResult(await read(context), context.data, context.now);
    },
  };
}

function electionFlags(rows, now, supported) {
  return rows.flatMap((row) => {
    const iso3 = row.country_iso3 ?? row.country?.iso3;
    const date = dateOf(row.election_date ?? row.date);
    const distance = date
      ? Date.parse(date) - Date.parse(now.toISOString().slice(0, 10))
      : NaN;
    return supported.has(iso3) && distance >= 0 && distance <= 30 * DAY
      ? [
          conditionFlag('live-electionguide', {
            iso3,
            slot: 'C1',
            key: date,
            date,
            label: 'Election within 30 days',
            source: ELECTIONS,
            sourceName: 'IFES ElectionGuide',
            stage: 'announced',
          }),
        ]
      : [];
  });
}

function hdxFlags(ipc, prices, now, supported) {
  const flags = new Map();
  const today = now.toISOString().slice(0, 10);
  for (const row of ipc) {
    const iso3 = row.location_code;
    const date = dateOf(row.reference_period_start);
    const end = dateOf(row.reference_period_end);
    const phase = Number(row.ipc_phase);
    if (
      !supported.has(iso3) ||
      !date ||
      date > today ||
      !end ||
      end < today ||
      ![4, 5].includes(phase) ||
      !(Number(row.population_in_phase) > 0)
    )
      continue;
    const flag = conditionFlag('live-hdx', {
      iso3,
      slot: 'C4',
      key: 'ipc',
      date,
      label: 'IPC Phase 4+ areas reported',
      source: HDX,
      sourceName: 'HDX HAPI / IPC',
      stage: 'reported',
    });
    if (!flags.has(flag.id) || flags.get(flag.id).date < date)
      flags.set(flag.id, flag);
  }
  const series = new Map();
  for (const row of prices) {
    const date = dateOf(row.reference_period_start);
    const parts = [
      row.location_code,
      row.market_code,
      row.commodity_code,
      row.currency_code,
      row.unit,
      row.price_type,
    ];
    if (
      !supported.has(row.location_code) ||
      !date ||
      date > today ||
      parts.some((part) => !part) ||
      !(Number(row.price) > 0)
    )
      continue;
    const key = parts.join('|');
    if (!series.has(key)) series.set(key, new Map());
    series.get(key).set(date.slice(0, 7), Number(row.price));
  }
  for (const [key, values] of series) {
    const [iso3, , commodity] = key.split('|');
    const month = [...values.keys()].sort().at(-1);
    if (+now - Date.parse(month + '-01') > 120 * DAY) continue;
    const baseline = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 4),
    )
      .toISOString()
      .slice(0, 7);
    if (!values.has(baseline)) continue;
    const increase =
      (values.get(month) - values.get(baseline)) / values.get(baseline);
    if (increase < 0.2) continue;
    const flag = conditionFlag('live-hdx', {
      iso3,
      slot: 'C4',
      key: 'price:' + key,
      date: month,
      label:
        commodity +
        ' monitored market price up ' +
        (increase * 100).toFixed(0) +
        '% over three months',
      periodStart: baseline,
      source: HDX,
      sourceName: 'HDX HAPI / WFP',
    });
    flags.set(flag.id, flag);
  }
  return [...flags.values()];
}

function outageFlags(rows, now, supported, extraCodes) {
  return rows.flatMap((row) => {
    const { entityType, entityCode } = row;
    const iso3 =
      extraCodes?.[entityCode] ?? iso2Country[entityCode] ?? entityCode;
    const start = Number(row.time) * 1000;
    const duration = Number(row.duration) * 1000;
    if (
      entityType !== 'country' ||
      !supported.has(iso3) ||
      !Number.isFinite(start) ||
      !(duration > 0) ||
      start > +now ||
      +now - start > DAY ||
      start + duration < +now
    )
      return [];
    return [
      conditionFlag('live-ioda', {
        iso3,
        slot: 'C3',
        key: String(start),
        label: 'Country-level internet outage signal',
        date: new Date(start).toISOString(),
        expiresAt: new Date(start + duration).toISOString(),
        source: IODA,
        sourceName: 'IODA',
        stage: 'observed',
      }),
    ];
  });
}

function candidateFlags(rows, now, countries) {
  const resolve = candidateCountryResolver({ countries });
  const totals = new Map();
  const ids = new Set();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1))
    .toISOString()
    .slice(0, 7);
  for (const row of rows) {
    const iso3 = resolve(row.country);
    const date = dateOf(row.date_start);
    const deaths = Number(row.best);
    if (
      !iso3 ||
      !row.id ||
      ids.has(row.id) ||
      !date?.startsWith(month) ||
      !Number.isSafeInteger(deaths) ||
      deaths < 0
    )
      continue;
    ids.add(row.id);
    totals.set(iso3, (totals.get(iso3) ?? 0) + deaths);
  }
  return [...totals].flatMap(([iso3, deaths]) =>
    deaths >= DRAFT_CANDIDATE_THRESHOLD
      ? [
          conditionFlag('live-ucdp-token', {
            iso3,
            slot: 'C2',
            date: month,
            label:
              'UCDP Candidate recorded fatalities: ' +
              deaths +
              ' (draft threshold: ' +
              DRAFT_CANDIDATE_THRESHOLD +
              ')',
            recordedDeaths: deaths,
            source: UCDP,
            sourceName: 'UCDP Candidate',
          }),
        ]
      : [],
  );
}

export function optionalLiveSources(config = {}) {
  const election = allowedEndpoint(config.electionguide?.endpoint, [
    'electionguide.org',
    'www.electionguide.org',
    'api.electionguide.org',
  ]);
  const candidate = allowedEndpoint(config.candidate?.endpoint, [
    'ucdpapi.pcr.uu.se',
    'api.ucdp.uu.se',
  ]);
  return {
    'live-electionguide': optional(
      Boolean(election && config.electionguide?.token),
      DAY,
      async ({ fetchImpl, now, registry }) => {
        const fetch = protectedFetch(fetchImpl, {
          Authorization: 'Bearer ' + config.electionguide.token,
        });
        return electionFlags(
          expectRows(await download(fetch, election), 'results', 'data'),
          now,
          countryIds(registry),
        );
      },
    ),
    'live-hdx': optional(
      Boolean(config.hdx?.appIdentifier),
      7 * DAY,
      async ({ fetchImpl, now, registry }) => {
        const fetch = protectedFetch(fetchImpl);
        const root =
          'https://hapi.humdata.org/api/v2/food-security-nutrition-poverty/';
        const query = new URLSearchParams({
          app_identifier: config.hdx.appIdentifier,
          start_date: new Date(+now - 180 * DAY).toISOString().slice(0, 10),
          output_format: 'json',
          limit: '10000',
        });
        const ipc = expectRows(
          await download(fetch, root + 'food-security?' + query),
          'data',
        );
        const prices = expectRows(
          await download(fetch, root + 'food-prices-market-monitor?' + query),
          'data',
        );
        return hdxFlags(ipc, prices, now, countryIds(registry));
      },
    ),
    'live-ioda': optional(
      config.ioda?.licenceApproved === true,
      HOUR,
      async ({ fetchImpl, now, registry }) => {
        const url =
          'https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?entityType=country&from=' +
          Math.floor((+now - DAY) / 1000) +
          '&until=' +
          Math.floor(+now / 1000);
        const rows = expectRows(await download(fetchImpl, url), 'data');
        return outageFlags(
          rows,
          now,
          countryIds(registry),
          config.ioda.countryCodes,
        );
      },
    ),
    'live-ucdp-token': optional(
      Boolean(candidate && config.candidate?.token),
      7 * DAY,
      async ({ fetchImpl, now, registry }) => {
        const fetch = protectedFetch(fetchImpl, {
          'x-ucdp-access-token': config.candidate.token,
        });
        return candidateFlags(
          expectRows(await download(fetch, candidate), 'Result', 'result'),
          now,
          registry.countries,
        );
      },
    ),
  };
}

export function optionalLiveSourcesFromEnv(env) {
  return optionalLiveSources({
    electionguide: {
      endpoint: env.GEV_WORLD_ELECTIONGUIDE_ENDPOINT,
      token: env.GEV_WORLD_ELECTIONGUIDE_TOKEN,
    },
    hdx: { appIdentifier: env.GEV_WORLD_HDX_APP_IDENTIFIER },
    ioda: { licenceApproved: env.GEV_WORLD_IODA_LICENCE_APPROVED === '1' },
    candidate: {
      endpoint: env.GEV_WORLD_UCDP_CANDIDATE_ENDPOINT,
      token: env.GEV_WORLD_UCDP_CANDIDATE_TOKEN,
    },
  });
}
