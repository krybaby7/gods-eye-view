import { readFile } from 'node:fs/promises';
import { readResponseTextCapped } from '../../common/http.js';

const DAY_MS = 86_400_000;
let shapes;

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
  const add = (key, iso3) => {
    if (!key || key === '-99') return;
    const upper = key.toUpperCase();
    if (keys.has(upper) && keys.get(upper) !== iso3) keys.set(upper, null);
    else keys.set(upper, iso3);
  };
  for (const record of registry.countries) {
    add(record.iso3, record.iso3);
    add(record.name, record.iso3);
    add(record.aliases?.worldbank, record.iso3);
    for (const id of record.shapeIds ?? [record.iso3])
      shapeIds.set(id, record.iso3);
  }
  for (const { iso, iso2, name, country } of await shapes) {
    const iso3 = shapeIds.get(iso);
    if (!iso3) continue;
    add(iso, iso3);
    add(iso2, iso3);
    add(name, iso3);
    if (name === country) add(country, iso3);
  }
  if (keys.has('KOS')) {
    add('XK', 'KOS');
    add('XKX', 'KOS');
  }
  return (value) => keys.get(value?.trim().toUpperCase()) ?? null;
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

export function createAssetAdapter(load, intervalDays) {
  let retryAt = 0;
  return {
    shouldCheck({ now, lastCheckedAt, data }) {
      if (+now < retryAt) return false;
      if (!data) return true;
      if (intervalDays === Infinity) return false;
      const last = Date.parse(lastCheckedAt);
      return !Number.isFinite(last) || +now - last >= intervalDays * DAY_MS;
    },
    async fetchObservations({ fetchImpl, now, ...context }) {
      async function request(url, cap, read = readResponseTextCapped, headers) {
        const signal = AbortSignal.timeout(35_000);
        const response = await fetchImpl(url, { signal, headers });
        if (!response.ok) {
          if (response.status === 429) {
            const header = response.headers.get('Retry-After');
            const until = /^\d+$/.test(header ?? '')
              ? +now + Number(header) * 1000
              : Date.parse(header);
            retryAt = Number.isFinite(until)
              ? Math.max(+now, until)
              : +now + 3600_000;
          }
          await response.body?.cancel();
          throw new Error(
            `HTTP ${response.status} from ${new URL(url).hostname}`,
          );
        }
        return read(response, cap, signal);
      }
      return load({ ...context, now, request });
    },
  };
}
