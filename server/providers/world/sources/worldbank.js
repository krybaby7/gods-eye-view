import { setTimeout as wait } from 'node:timers/promises';
import { readResponseJsonCapped } from '../../common/http.js';
import {
  countryCode,
  fetchResponse,
  monthIndex,
  observation,
  releaseDue,
  sourceCountries,
} from './common.js';

const COUNTRY_URL = 'https://api.worldbank.org/v2/country/all';
const POPULATION = { id: 'population.total', sourceCode: 'SP.POP.TOTL' };
const REQUESTS_AT_ONCE = 4;

export function shouldCheck(context) {
  return releaseDue(context, monthIndex);
}

async function fetchRows(fetchImpl, path, signal) {
  try {
    return await fetchResponse(fetchImpl, COUNTRY_URL + path, signal);
  } catch (failure) {
    if (
      !(failure instanceof TypeError) &&
      !/^HTTP (429|5\d\d) /.test(failure.message)
    ) {
      throw failure;
    }
    await wait(500, undefined, { signal });
    return fetchResponse(fetchImpl, COUNTRY_URL + path, signal);
  }
}

async function readRows(fetchImpl, path) {
  const signal = AbortSignal.timeout(30_000);
  const response = await fetchRows(fetchImpl, path, signal);
  const [metadata, rows] = await readResponseJsonCapped(
    response,
    2_000_000,
    signal,
  );
  if (!Array.isArray(rows) || Number(metadata?.pages) !== 1) {
    throw new Error(`Unexpected World Bank response for ${path}`);
  }
  return { metadata, rows };
}

export async function fetchObservations({ fetchImpl, registry, now }) {
  const { rows: economies } = await readRows(
    fetchImpl,
    '?format=json&per_page=400',
  );
  const economyCodes = new Set(
    economies
      .filter(({ region }) => region?.id && region.id !== 'NA')
      .map(({ id }) => id),
  );
  const boardCodes = new Map(
    sourceCountries(registry).map((country) => [
      countryCode(country, 'worldbank'),
      country.iso3,
    ]),
  );
  const series = [
    ...registry.indicators.filter(({ source }) => source === 'worldbank'),
    POPULATION,
  ];

  async function loadSeries({ id, sourceCode }) {
    const { metadata, rows } = await readRows(
      fetchImpl,
      `/indicator/${encodeURIComponent(sourceCode)}?format=json&per_page=20000&mrnev=1`,
    );
    const publishedAt = /^\d{4}-\d{2}-\d{2}$/.test(metadata.lastupdated)
      ? metadata.lastupdated
      : null;
    return rows.flatMap((row) => {
      const iso3 = boardCodes.get(row.countryiso3code);
      if (
        !iso3 ||
        !economyCodes.has(row.countryiso3code) ||
        !Number.isFinite(row.value) ||
        !/^\d{4}$/.test(row.date)
      )
        return [];
      return observation(now, id, iso3, row.value, row.date, {
        publishedAt,
        sourceVersion: publishedAt ? `World Bank update ${publishedAt}` : null,
        method: row.obs_status === 'E' ? 'source-estimate' : 'observed',
      });
    });
  }

  const observations = [];
  const failures = [];
  for (let offset = 0; offset < series.length; offset += REQUESTS_AT_ONCE) {
    const batch = series.slice(offset, offset + REQUESTS_AT_ONCE);
    const results = await Promise.allSettled(batch.map(loadSeries));
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') observations.push(...result.value);
      else {
        const reason = result.reason;
        const status = reason.message?.match(/^HTTP \d{3}/)?.[0];
        const detail = status ?? reason.cause?.code ?? reason.message;
        failures.push(`${batch[index].sourceCode}: ${detail}`);
      }
    }
  }
  return {
    observations,
    ...(failures.length && { error: failures.join(', ') }),
  };
}
