import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
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

const ORIGIN = 'https://www.v-dem.net';
const RELEASE_PAGE = `${ORIGIN}/data/the-v-dem-dataset/`;
const SIZE_LIMIT = 200_000_000;

export function shouldCheck(context) {
  return releaseDue(context, (date) => {
    const month = date.getUTCMonth();
    return monthIndex(date) - month + (month >= 2 ? 2 : -10);
  });
}

export async function fetchObservations({ fetchImpl, registry, now }) {
  const indicator = registry.indicators.find(({ source }) => source === 'vdem');
  const metadataSignal = AbortSignal.timeout(30_000);
  const metadata = await fetchResponse(fetchImpl, RELEASE_PAGE, metadataSignal);
  const html = await readResponseTextCapped(
    metadata,
    2_000_000,
    metadataSignal,
  );
  const release = html.match(
    /href=["'][^"']*\/country-year-v-dem-core-v(\d+)\/?["']/i,
  );
  if (!release)
    throw new Error('V-Dem Country-Year Core release was not listed');

  const sourceVersion = `v${release[1]}`;
  const block = html.slice(
    html.lastIndexOf('<h3', release.index),
    release.index,
  );
  const publishedYear = block.match(/March\s+(\d{4})/i)?.[1];
  const publishedAt = publishedYear ? `${publishedYear}-03` : null;
  const unavailable = (reason) => ({
    observations: [],
    detail: `C6 unavailable: V-Dem Core ${sourceVersion}${publishedAt ? ` (${publishedAt})` : ''} ${reason}.`,
  });
  const filename = `V-Dem-CY-Core-${sourceVersion}`;
  const url = `${ORIGIN}/media/datasets/${filename}_csv.zip`;
  const signal = AbortSignal.timeout(120_000);
  const response = await fetchResponse(fetchImpl, url, signal);
  let bytes;
  try {
    bytes = await readResponseBytesCapped(response, SIZE_LIMIT, signal);
  } catch (error) {
    if (error.code !== 'RESPONSE_TOO_LARGE') throw error;
    return unavailable('download exceeds 200 MB');
  }

  const countries = new Map(
    sourceCountries(registry).map((country) => [
      countryCode(country, 'vdem'),
      country.iso3,
    ]),
  );
  const latest = new Map();
  const chunks = zipEntryChunks(
    bytes,
    (name) => name.split('/').at(-1) === `${filename}.csv`,
    SIZE_LIMIT,
  );
  const input = Readable.from(chunks);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let columns;
  try {
    for await (const line of lines) {
      const row = csvRows(line).next().value;
      if (!row) continue;
      if (!columns) {
        if (!row.includes(indicator.sourceCode)) {
          return unavailable(`does not include ${indicator.sourceCode}`);
        }
        columns = columnIndices(row, [
          'country_text_id',
          'year',
          indicator.sourceCode,
        ]);
        continue;
      }
      const [code, year, raw] = columns.map((index) => row[index]);
      const iso3 = countries.get(code);
      const value = raw?.trim() ? Number(raw) : NaN;
      if (
        !iso3 ||
        !/^\d{4}$/.test(year) ||
        !Number.isFinite(value) ||
        year <= (latest.get(iso3)?.period ?? '')
      )
        continue;
      latest.set(
        iso3,
        observation(now, indicator.id, iso3, value, year, {
          publishedAt,
          sourceVersion,
          method: 'source-estimate',
        }),
      );
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (latest.size === 0)
    return unavailable(`has no usable ${indicator.sourceCode} values`);
  return { observations: [...latest.values()] };
}
