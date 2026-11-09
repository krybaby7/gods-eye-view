import { readFile } from 'node:fs/promises';
import {
  assetCountryResolver,
  assetRow,
  createAssetAdapter,
  point,
} from './asset-common.js';
import { columnIndices, csvRows } from './csv.js';
import { downloadWorldFile } from './download.js';
import { zipEntryChunks } from './zip.js';

const source = 'wri-power';
const page = 'https://datasets.wri.org/datasets/global-power-plant-database';
const archive =
  'https://datasets.wri.org/private-admin/dataset/53623dfd-3df6-4f15-a091-67457cdb571f/resource/66bcdacc-3d0e-46ad-9271-a5a76b1853d2/download/globalpowerplantdatabasev130.zip';
const fields = [
  'country',
  'name',
  'gppd_idnr',
  'capacity_mw',
  'latitude',
  'longitude',
  'primary_fuel',
  'owner',
];

export function parsePowerPlants(csv, { country, now }) {
  const rows = csvRows(csv);
  const indices = columnIndices(rows.next().value, fields);
  const assets = [];
  const known = new Set();
  for (const row of rows) {
    const [rawCountry, name, plant, capacity, lat, lon, fuel, owner] =
      indices.map((index) => row[index]?.trim());
    const mw = Number(capacity);
    if (
      !name ||
      !plant ||
      known.has(plant) ||
      !Number.isFinite(mw) ||
      mw < 100 ||
      fuel === 'Nuclear'
    )
      continue;
    const locatedIn = country(rawCountry);
    if (!locatedIn) continue;
    known.add(plant);
    assets.push(
      assetRow({
        id: 'asset_wri-' + plant,
        type: 'power_plant',
        name,
        locatedIn,
        geometry: point(lon, lat),
        source,
        sourceUrl: page,
        licence: 'CC BY 4.0',
        now,
        capacity: { value: mw, unit: 'MW' },
        fuel,
        historical: true,
        sourceVersion: 'v1.3.0 (2021 historical inventory)',
        statusDetail:
          'Historical WRI inventory. Current operating status has not been established.',
        owners: owner
          ? [{ actor: owner, country: null, share: null, verified: false }]
          : [],
      }),
    );
  }
  return assets;
}

export const wriPower = createAssetAdapter(
  async ({ registry, now, fetchImpl, cacheDirectory, onProgress }) => {
    const country = await assetCountryResolver(registry);
    const { path } = await downloadWorldFile(archive, {
      fetchImpl,
      cacheDirectory,
      onProgress,
      maxBytes: 25_000_000,
      immutable: true,
    });
    const bytes = await readFile(path);
    const decoder = new TextDecoder();
    let text = '';
    for await (const chunk of zipEntryChunks(
      bytes,
      (name) => /(^|\/)global_power_plant_database\.csv$/i.test(name),
      80_000_000,
    )) {
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
    const rows = parsePowerPlants(text, { country, now });
    if (!rows.length)
      throw new Error('WRI returned no eligible historical power plants');
    return { data: { rows }, count: rows.length, unit: 'historical plant' };
  },
  Infinity,
  { estimatedBytes: 4_200_000 },
);
