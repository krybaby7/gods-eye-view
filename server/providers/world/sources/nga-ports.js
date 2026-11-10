import { readFile } from 'node:fs/promises';
import { readResponseJsonCapped } from '../../common/http.js';
import {
  assetCountryResolver,
  assetRow,
  createAssetAdapter,
  point,
} from './asset-common.js';
import { fetchResponseWithDeadline } from './common.js';
import { downloadWorldFile, hasWorldDownload } from './download.js';

const source = 'nga-ports';
// Public U.S. DOE National Energy Technology Laboratory mirror of NGA Pub. 150.
const service =
  'https://arcgis.netl.doe.gov/server/rest/services/Hosted/CCS_EJ_SJ_Data/FeatureServer';

function queryUrl(layer) {
  return (
    layer +
    '/query?' +
    new URLSearchParams({
      where: "harbor_size_code='Large'",
      outFields: 'wpinumber,main_port_name,wpi_cc,harbor_size_code',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
    })
  );
}

export function worldPortLayer(metadata) {
  const matches = Array.isArray(metadata?.layers)
    ? metadata.layers.filter(
        ({ name, id }) =>
          name === 'World Port Index' && Number.isSafeInteger(id) && id >= 0,
      )
    : [];
  if (matches.length !== 1)
    throw new Error('DOE mirror did not identify one World Port Index layer');
  return service + '/' + matches[0].id;
}

function comparableName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/^port of /, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchOperator(name, locatedIn, coordinates, candidates) {
  if (!coordinates) return null;
  const [lon, lat] = coordinates;
  const nameKey = comparableName(name);
  const matches = candidates.filter((candidate) => {
    if (
      locatedIn !== candidate.iso3 ||
      nameKey !== comparableName(candidate.name)
    )
      return false;
    const [x, y] = candidate.coordinates;
    const deltaLon = Math.min(Math.abs(x - lon), 360 - Math.abs(x - lon));
    return (
      Math.hypot(deltaLon * Math.cos((lat * Math.PI) / 180), y - lat) <= 0.3
    );
  });
  return matches.length === 1 ? matches[0] : null;
}

function decimalCoordinate(value) {
  if (value == null || value === '') return null;
  const dms = /^(\d+)°(\d+)'([\d.]+)"([NSEW])$/.exec(String(value).trim());
  if (!dms) return Number(value);
  const [, degrees, minutes, seconds, hemisphere] = dms;
  if (Number(minutes) >= 60 || Number(seconds) >= 60) return null;
  const magnitude =
    Number(degrees) + Number(minutes) / 60 + Number(seconds) / 3600;
  return hemisphere === 'W' || hemisphere === 'S' ? -magnitude : magnitude;
}

export function parseWorldPortIndex(
  payload,
  {
    country,
    now,
    operatorCandidates = [],
    operatorReviews = new Map(),
    sourceUrl = service,
  },
) {
  if (!Array.isArray(payload?.ports))
    throw new Error('Unexpected NGA World Port Index response');
  const assets = [];
  const known = new Set();
  for (const row of payload.ports) {
    const id = row.portNumber;
    const name = row.portName?.trim();
    if (
      !id ||
      !name ||
      known.has(id) ||
      !/^(l|large)$/i.test(row.harborSize?.trim() ?? '')
    )
      continue;
    const locatedIn = country(row.countryCode);
    if (!locatedIn) continue;
    known.add(id);
    const geometry = point(
      decimalCoordinate(row.longitude ?? row.xcoord),
      decimalCoordinate(row.latitude ?? row.ycoord),
    );
    const match = matchOperator(
      name,
      locatedIn,
      geometry?.coordinates,
      operatorCandidates,
    );
    const review = operatorReviews.get(String(id));
    assets.push(
      assetRow({
        id: 'asset_nga-' + id,
        type: 'port',
        name,
        locatedIn,
        geometry,
        source,
        sourceUrl,
        licence: 'Public domain (U.S. government)',
        now,
        operator: review?.operator ?? match?.operator ?? null,
        operatorSourceUrl: review?.sourceUrl ?? match?.sourceUrl ?? null,
        operatorReferenceUrl: match?.referenceUrl ?? null,
        owners: match?.owners ?? [],
        sourceLocator: 'World Port Index ' + id,
        statusDetail:
          'NGA World Port Index large harbor. Live port status is unknown.',
      }),
    );
  }
  return assets;
}

const wpiCountryCodes = new Map([
  ['United States', 'USA'],
  ['Hong Kong', 'HKG'],
  ["Cote D'Ivoire", 'CIV'],
  ['Saint Helena, Ascension, and Tristan da Cunha', 'SHN'],
]);

export function parseWpiFeatureLayer(payload, options) {
  if (payload?.exceededTransferLimit)
    throw new Error('The DOE World Port Index response was truncated');
  if (!Array.isArray(payload?.features))
    throw new Error('Unexpected DOE World Port Index feature layer');
  const ports = payload.features.map(({ attributes, geometry }) => ({
    portNumber: attributes?.wpinumber,
    portName: attributes?.main_port_name,
    countryCode: wpiCountryCodes.get(attributes?.wpi_cc) ?? attributes?.wpi_cc,
    harborSize: attributes?.harbor_size_code,
    longitude: geometry?.x,
    latitude: geometry?.y,
  }));
  return parseWorldPortIndex({ ports }, options);
}

function savedLayer(data) {
  const layer = data?.layer ?? data?.rows?.[0]?.sourceUrl;
  return layer?.startsWith(service + '/') &&
    /^\d+$/.test(layer.slice(service.length + 1))
    ? layer
    : null;
}

export const ngaPorts = createAssetAdapter(
  async ({
    registry,
    now,
    fetchImpl,
    cacheDirectory,
    onProgress,
    features,
    data,
    rederive,
    signal,
  }) => {
    const country = await assetCountryResolver(registry);
    const operatorCandidates = features?.['wikidata-assets']?.portOperators;
    const { operators } = JSON.parse(
      await readFile(
        new URL(
          '../../../../public/world/curated/port-attributions.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const operatorReviews = new Map(operators.map((row) => [row.wpi, row]));
    const previousLayer = savedLayer(data);
    const cachedLayer =
      rederive &&
      previousLayer &&
      (await hasWorldDownload(queryUrl(previousLayer), cacheDirectory));
    const layer = cachedLayer
      ? previousLayer
      : worldPortLayer(
          await fetchResponseWithDeadline(fetchImpl, service + '?f=json', {
            signal,
            read: readResponseJsonCapped,
          }),
        );
    const { parsed: rows } = await downloadWorldFile(queryUrl(layer), {
      fetchImpl,
      cacheDirectory,
      onProgress,
      signal,
      maxBytes: 2_000_000,
      immutable: cachedLayer,
      async parse(path) {
        const payload = JSON.parse(await readFile(path, 'utf8'));
        const ports = parseWpiFeatureLayer(payload, {
          country,
          now,
          operatorCandidates,
          operatorReviews,
          sourceUrl: layer,
        });
        if (!ports.length) throw new Error('NGA returned no large harbors');
        return ports;
      },
    });
    return {
      data: { rows, layer },
      count: rows.length,
      unit: 'large harbor',
      detail:
        'NGA World Port Index via the public U.S. Department of Energy mirror.',
    };
  },
  30,
  {
    estimatedBytes: 35_000,
    downloadUrls: (data) => {
      const layer = savedLayer(data);
      return layer ? [queryUrl(layer)] : [];
    },
  },
);
