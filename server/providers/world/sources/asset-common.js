import { readFile } from 'node:fs/promises';

const DAY_MS = 86_400_000;
let shapes;
const mapUnitAliases = {
  BQ: 'NLD',
  CC: 'AUS',
  ESH: 'SAH',
  GF: 'FRA',
  GP: 'FRA',
  GUF: 'FRA',
  MQ: 'FRA',
  RE: 'FRA',
  YT: 'FRA',
};

export async function assetCountryResolver(registry) {
  shapes ??= readFile(
    new URL(
      '../../../../src/data/local_data/natural_earth/countries.json',
      import.meta.url,
    ),
    'utf8',
  ).then((json) =>
    JSON.parse(json).features.map(({ iso, iso2, name, country }) => ({
      iso,
      iso2,
      name,
      country,
    })),
  );
  const keys = new Map();
  const shapeIds = new Map();
  const add = (key, iso3, priority) => {
    if (!key || key === '-99') return;
    const upper = key.toUpperCase();
    const previous = keys.get(upper);
    if (!previous || priority > previous.priority)
      keys.set(upper, { iso3, priority });
    else if (priority === previous.priority && previous.iso3 !== iso3)
      keys.set(upper, { iso3: null, priority });
  };
  for (const record of registry.countries) {
    add(record.iso3, record.iso3, 3);
    add(record.name, record.iso3, 1);
    add(record.aliases?.worldbank, record.iso3, 0);
    for (const id of record.shapeIds ?? [record.iso3]) shapeIds.set(id, record);
  }
  for (const { iso, iso2, name, country } of await shapes) {
    const record = shapeIds.get(iso);
    if (!record) continue;
    const { iso3, kind } = record;
    add(iso, iso3, 1);
    add(iso2, iso3, kind === 'state' && iso === iso3 ? 2 : 1);
    add(name, iso3, 1);
    if (name === country) add(country, iso3, 1);
  }
  if (keys.has('KOS')) {
    add('XK', 'KOS', 2);
    add('XKX', 'KOS', 2);
  }
  for (const [key, iso3] of Object.entries(mapUnitAliases)) {
    if (keys.has(iso3)) add(key, iso3, 0);
  }
  return (value) => keys.get(value?.trim().toUpperCase())?.iso3 ?? null;
}

export function point(longitude, latitude) {
  if (
    longitude == null ||
    latitude == null ||
    longitude === '' ||
    latitude === ''
  )
    return null;
  const lon = Number(longitude);
  const lat = Number(latitude);
  return Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    Math.abs(lon) <= 180 &&
    Math.abs(lat) <= 90
    ? { type: 'Point', coordinates: [lon, lat] }
    : null;
}

export function assetRow({
  id,
  type,
  name,
  locatedIn,
  geometry,
  source,
  sourceUrl,
  licence,
  now,
  ...detail
}) {
  return {
    id,
    type,
    name,
    locatedIn,
    geometry,
    jurisdiction: null,
    capacity: null,
    owners: [],
    operator: null,
    canInterrupt: [],
    status: 'unknown',
    source,
    sourceUrl,
    licence,
    lastVerified: now.toISOString().slice(0, 10),
    ...detail,
  };
}

export function createAssetAdapter(
  fetchObservations,
  intervalDays,
  { estimatedBytes = 0, requestHost, version = 2 } = {},
) {
  return {
    version,
    estimatedBytes,
    requestHost,
    shouldCheck({ now, lastCheckedAt, data, rederive }) {
      if (Date.parse(data?.retryAt) > +now) return false;
      if (rederive) return true;
      if (!data) return true;
      if (intervalDays === Infinity) return false;
      const last = Date.parse(lastCheckedAt);
      return !Number.isFinite(last) || +now - last >= intervalDays * DAY_MS;
    },
    fetchObservations,
  };
}
