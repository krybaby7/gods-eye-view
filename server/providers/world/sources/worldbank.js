import { setTimeout as wait } from 'node:timers/promises';
import { readResponseJsonCapped } from '../../common/http.js';
import {
  countryCode,
  monthIndex,
  observation,
  releaseDue,
  sourceCountries,
} from './common.js';

const COUNTRY_URL = 'https://api.worldbank.org/v2/country/all';
const POPULATION = { id: 'population.total', sourceCode: 'SP.POP.TOTL' };
const USER_AGENT =
  'GodsEyeView-WorldBoard/0.2 (https://github.com/krybaby7/gods-eye-view)';

export function shouldCheck(context) {
  return releaseDue(context, monthIndex);
}

function retryDelay(value) {
  if (value === null) return 1_000;
  const milliseconds = /^\d+$/.test(value)
    ? Number(value) * 1_000
    : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 1_000;
}

async function readRows(fetchImpl, path, retry = true) {
  const signal = AbortSignal.timeout(30_000);
  const url = COUNTRY_URL + path;
  let data;
  try {
    const response = await fetchImpl(url, {
      signal,
      // This adapter already retries both the request and the body read.
      retryConnection: false,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error(`HTTP ${response.status} from ${url}`), {
        status: response.status,
        retryAfter: response.headers.get('Retry-After'),
      });
    }
    data = await readResponseJsonCapped(response, 2_000_000, signal);
  } catch (failure) {
    const transient =
      failure instanceof TypeError ||
      signal.aborted ||
      failure.status === 429 ||
      failure.status >= 500;
    const delay = retryDelay(failure.retryAfter ?? null);
    if (!retry || !transient || delay > 30_000) throw failure;
    await wait(delay);
    return readRows(fetchImpl, path, false);
  }
  const [metadata, rows] = data;
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
    POPULATION,
    ...registry.indicators.filter(({ source }) => source === 'worldbank'),
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
  let population = [];
  const failures = [];
  for (const definition of series) {
    try {
      const rows = await loadSeries(definition);
      if (definition === POPULATION) population = rows;
      else observations.push(...rows);
    } catch (reason) {
      const status = reason.message?.match(/^HTTP \d{3}/)?.[0];
      const detail = status ?? reason.cause?.code ?? reason.message;
      failures.push(`${definition.sourceCode}: ${detail}`);
      if (reason.status === 429) break;
    }
  }
  return {
    observations: [...observations, ...population],
    ...(failures.length && { error: failures.join(', ') }),
  };
}
