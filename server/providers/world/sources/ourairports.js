import { readFile } from 'node:fs/promises';
import {
  assetCountryResolver,
  assetRow,
  createAssetAdapter,
  point,
} from './asset-common.js';
import { columnIndices, csvRows } from './csv.js';
import { downloadWorldFile } from './download.js';

const source = 'ourairports';
export const airportCsvUrl =
  'https://davidmegginson.github.io/ourairports-data/airports.csv';
const fields = [
  'id',
  'ident',
  'type',
  'name',
  'latitude_deg',
  'longitude_deg',
  'iso_country',
  'scheduled_service',
];

export function parseOurAirports(csv, { country, now }) {
  const rows = csvRows(csv);
  const indices = columnIndices(rows.next().value, fields);
  const assets = [];
  for (const row of rows) {
    const [id, ident, type, name, lat, lon, iso, scheduled] = indices.map(
      (index) => row[index],
    );
    if (
      !id ||
      !ident ||
      !name ||
      type !== 'large_airport' ||
      scheduled !== 'yes'
    )
      continue;
    const locatedIn = country(iso);
    if (!locatedIn) continue;
    assets.push(
      assetRow({
        id: 'asset_ourairports-' + id,
        type: 'airport',
        name,
        locatedIn,
        geometry: point(lon, lat),
        source,
        sourceUrl:
          'https://ourairports.com/airports/' + encodeURIComponent(ident) + '/',
        licence: 'Public domain',
        now,
        sourceCountry: iso,
        statusDetail:
          'OurAirports lists scheduled service. Live airport status is unknown.',
      }),
    );
  }
  return assets;
}

export const ourAirports = createAssetAdapter(
  async ({
    registry,
    now,
    fetchImpl,
    cacheDirectory,
    onProgress,
    rederive,
    signal,
  }) => {
    const country = await assetCountryResolver(registry);
    const { parsed: rows, reused } = await downloadWorldFile(airportCsvUrl, {
      fetchImpl,
      cacheDirectory,
      onProgress,
      signal,
      maxBytes: 60_000_000,
      immutable: rederive,
      format: 'csv',
      csvColumns: fields,
      async parse(path) {
        const airports = parseOurAirports(await readFile(path, 'utf8'), {
          country,
          now,
        });
        if (!airports.length)
          throw new Error(
            'OurAirports returned no large airports with scheduled service',
          );
        return airports;
      },
    });
    return {
      data: { rows },
      count: rows.length,
      unit: 'airport',
      ...(rederive && reused && { checkedRelease: false }),
    };
  },
  7,
  { estimatedBytes: 13_000_000, downloadUrls: () => [airportCsvUrl] },
);
