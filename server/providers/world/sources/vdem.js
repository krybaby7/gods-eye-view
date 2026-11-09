import { readResponseTextCapped } from '../../common/http.js';
import {
  countryCode,
  fetchResponse,
  monthIndex,
  observation,
  releaseDue,
  sourceCountries,
} from './common.js';
import { columnIndices, csvRecords, csvRows } from './csv.js';
import { downloadWorldFile } from './download.js';
import { zipEntryChunks } from './zip.js';

const ORIGIN = 'https://www.v-dem.net';
const RELEASE_PAGE = `${ORIGIN}/data/the-v-dem-dataset/`;
const SIZE_LIMIT = 200_000_000;
const EXPANDED_SIZE_LIMIT = 500_000_000;

export const estimatedBytes = 27_000_000;

export function shouldCheck(context) {
  if (context.observations && !context.data) return true;
  return releaseDue(context, (date) => {
    const month = date.getUTCMonth();
    return monthIndex(date) - month + (month >= 2 ? 2 : -10);
  });
}

export async function fetchObservations({
  fetchImpl,
  registry,
  now,
  cacheDirectory,
  signal,
  onProgress,
}) {
  const indicator = registry.indicators.find(({ source }) => source === 'vdem');
  const timeout = AbortSignal.timeout(30_000);
  const metadataSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const metadata = await fetchResponse(fetchImpl, RELEASE_PAGE, metadataSignal);
  const html = await readResponseTextCapped(
    metadata,
    2_000_000,
    metadataSignal,
  );
  const release = html.match(
    /href=["'][^"']*\/country-year-v-dem-fullothers-v(\d+)\/?["']/i,
  );
  if (!release)
    throw new Error('V-Dem Country-Year Full+Others release was not listed');

  const sourceVersion = `v${release[1]}`;
  const block = html.slice(
    html.lastIndexOf('<h3', release.index),
    release.index,
  );
  const publishedYear = block.match(/March\s+(\d{4})/i)?.[1];
  const publishedAt = publishedYear ? `${publishedYear}-03` : null;
  const unavailable = (reason) => ({
    observations: [],
    data: { sourceVersion },
    detail: `C6 unavailable: V-Dem Full+Others ${sourceVersion}${publishedAt ? ` (${publishedAt})` : ''} ${reason}.`,
  });
  const filename = `V-Dem-CY-FullOthers-${sourceVersion}`;
  const url = `${ORIGIN}/media/datasets/${filename}_csv.zip`;
  let path;
  try {
    ({ path } = await downloadWorldFile(url, {
      cacheDirectory,
      fetchImpl,
      signal,
      onProgress,
      maxBytes: SIZE_LIMIT,
      immutable: true,
    }));
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
    path,
    (name) =>
      name.split('/').at(-1) === `V-Dem-CY-Full+Others-${sourceVersion}.csv`,
    EXPANDED_SIZE_LIMIT,
    signal,
  );
  let columns;
  for await (const record of csvRecords(chunks)) {
    const row = csvRows(record).next().value;
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
  if (latest.size === 0)
    return unavailable(`has no usable ${indicator.sourceCode} values`);
  return { observations: [...latest.values()], data: { sourceVersion } };
}
