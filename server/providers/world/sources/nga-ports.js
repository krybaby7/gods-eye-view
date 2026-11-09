import { readResponseJsonCapped } from '../../common/http.js';
import {
  assetCountryResolver,
  assetRow,
  createAssetAdapter,
  point,
} from './asset-common.js';

const source = 'nga-ports';
const page = 'https://msi.nga.mil/Publications/WPI';
const url =
  'https://msi.om.east.paas.nga.mil/api/publications/world-port-index?output=json';

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
  { country, now, operatorCandidates = [] },
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
    assets.push(
      assetRow({
        id: 'asset_nga-' + id,
        type: 'port',
        name,
        locatedIn,
        geometry,
        source,
        sourceUrl: page,
        licence: 'Public domain (U.S. government)',
        now,
        operator: match?.operator ?? null,
        operatorSourceUrl: match?.sourceUrl ?? null,
        operatorReferenceUrl: match?.referenceUrl ?? null,
        sourceLocator: 'World Port Index ' + id,
        statusDetail:
          'NGA World Port Index large harbor. Live port status is unknown.',
      }),
    );
  }
  return assets;
}

export const ngaPorts = createAssetAdapter(
  async ({ registry, now, request, features }) => {
    const country = await assetCountryResolver(registry);
    const operatorCandidates = features?.['wikidata-assets']?.portOperators;
    const payload = await request(url, 25_000_000, readResponseJsonCapped);
    const rows = parseWorldPortIndex(payload, {
      country,
      now,
      operatorCandidates,
    });
    if (!rows.length) throw new Error('NGA returned no large harbors');
    return { data: { rows }, count: rows.length, unit: 'large harbor' };
  },
  30,
);
