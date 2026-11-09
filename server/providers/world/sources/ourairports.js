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
const url = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
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
        statusDetail:
          'OurAirports lists scheduled service. Live airport status is unknown.',
      }),
    );
  }
  return assets;
}

export const ourAirports = createAssetAdapter(
  async ({ registry, now, fetchImpl, cacheDirectory, onProgress }) => {
    const country = await assetCountryResolver(registry);
    const { path } = await downloadWorldFile(url, {
      fetchImpl,
      cacheDirectory,
      onProgress,
      maxBytes: 60_000_000,
    });
    const rows = parseOurAirports(await readFile(path, 'utf8'), {
      country,
      now,
    });
    if (!rows.length)
      throw new Error(
        'OurAirports returned no large airports with scheduled service',
      );
    return { data: { rows }, count: rows.length, unit: 'airport' };
  },
  7,
  { estimatedBytes: 13_000_000 },
);
