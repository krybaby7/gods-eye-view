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

const ORIGIN = 'https://www.v-dem.net';
const RELEASE_PAGE = `${ORIGIN}/data/the-v-dem-dataset/`;
const SIZE_LIMIT = 200_000_000;
const EXPANDED_SIZE_LIMIT = 500_000_000;

export const estimatedBytes = 27_000_000;
export const version = 2;

function archiveUrl(sourceVersion) {
  return `${ORIGIN}/media/datasets/V-Dem-CY-FullOthers-${sourceVersion}_csv.zip`;
}

async function currentRelease(fetchImpl, signal) {
  const html = await fetchResponseWithDeadline(fetchImpl, RELEASE_PAGE, {
    signal,
    read: readResponseTextCapped,
  });
  const release = html.match(
    /href=["'][^"']*\/country-year-v-dem-fullothers-v(\d+)\/?["']/i,
  );
  if (!release)
    throw new Error('V-Dem Country-Year Full+Others release was not listed');
  const block = html.slice(
    html.lastIndexOf('<h3', release.index),
    release.index,
  );
  const publishedYear = block.match(/March\s+(\d{4})/i)?.[1];
  return {
    sourceVersion: `v${release[1]}`,
    publishedAt: publishedYear ? `${publishedYear}-03` : null,
  };
}

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
  rederive,
  data,
  observations = [],
}) {
  const indicator = registry.indicators.find(({ source }) => source === 'vdem');
  const savedVersion = data?.sourceVersion;
  const cached =
    rederive &&
    /^v\d+$/.test(savedVersion ?? '') &&
    (await hasWorldDownload(archiveUrl(savedVersion), cacheDirectory));
  const { sourceVersion, publishedAt } = cached
    ? {
        sourceVersion: savedVersion,
        publishedAt:
          data.publishedAt ??
          observations.find(
            (item) =>
              item.indicator === indicator.id &&
              item.sourceVersion === savedVersion,
          )?.publishedAt ??
          null,
      }
    : await currentRelease(fetchImpl, signal);
  const releaseData = { sourceVersion, publishedAt };
  const unavailable = (reason) => ({
    observations: [],
    data: releaseData,
    detail: `C6 unavailable: V-Dem Full+Others ${sourceVersion}${publishedAt ? ` (${publishedAt})` : ''} ${reason}.`,
  });
  const countries = new Map(
    sourceCountries(registry).map((country) => [
      countryCode(country, 'vdem'),
      country.iso3,
    ]),
  );
  let download;
  try {
    download = await downloadWorldFile(archiveUrl(sourceVersion), {
      cacheDirectory,
      fetchImpl,
      signal,
      onProgress,
      maxBytes: SIZE_LIMIT,
      immutable: true,
      format: 'zip',
      source: 'vdem',
      async parse(path) {
        const latest = new Map();
        const chunks = zipEntryChunks(
          path,
          (name) =>
            name.split('/').at(-1) ===
            `V-Dem-CY-Full+Others-${sourceVersion}.csv`,
          EXPANDED_SIZE_LIMIT,
          signal,
        );
        let columns;
        let header;
        for await (const record of csvRecords(chunks)) {
          if (header && !columns) continue;
          const row = csvRows(record).next().value;
          if (!row) continue;
          if (!header) {
            header = row;
            columnIndices(header, ['country_text_id', 'year']);
            if (header.includes(indicator.sourceCode))
              columns = columnIndices(header, [
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
        if (!header) throw new Error('Missing V-Dem CSV header');
        if (!columns)
          return unavailable(`does not include ${indicator.sourceCode}`);
        if (latest.size === 0)
          return unavailable(`has no usable ${indicator.sourceCode} values`);
        return { observations: [...latest.values()], data: releaseData };
      },
    });
  } catch (error) {
    if (error.code !== 'RESPONSE_TOO_LARGE') throw error;
    return unavailable('download exceeds 200 MB');
  }
  await pruneWorldDownloads('vdem', [download.path]);
  return download.parsed;
}
