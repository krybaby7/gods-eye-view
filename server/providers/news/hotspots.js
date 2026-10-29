import { distanceKm, normalizePlaceName } from './geocode.js';

/**
 * Hotspot grouping for the world view. Pure: a story's bubble comes from the
 * theater gazetteer only, never from the model, so the map does not decide
 * who owns a disputed place.
 */

// A model-placed story inherits a gazetteer row no further away than this.
const NEAR_ROW_KM = 100;
const GROUPING_PRECISIONS = new Set(['region', 'water']);
const COUNTRY_PRECISIONS = new Set(['city', 'locality', 'site', 'country']);

const isGrouping = (row) => GROUPING_PRECISIONS.has(row?.precision);
const hasPoint = (value) =>
  Number.isFinite(value?.lat) && Number.isFinite(value?.lon);
const round4 = (value) => Math.round(value * 1e4) / 1e4;

function gazetteerIndex(gazetteer) {
  const rows = (Array.isArray(gazetteer) ? gazetteer : []).filter(
    (row) => row && typeof row.name === 'string' && hasPoint(row),
  );
  const byName = new Map();
  const countryRows = new Map();
  for (const row of rows) {
    if (!byName.has(row.name)) byName.set(row.name, row);
    if (
      row.precision === 'country' &&
      typeof row.country === 'string' &&
      !countryRows.has(row.country)
    )
      countryRows.set(row.country, row);
  }
  return { rows, byName, countryRows };
}

function nearestRow(location, rows) {
  let best = null;
  for (const row of rows) {
    const km = distanceKm(location, row);
    if (km <= NEAR_ROW_KM && (!best || km < best.km)) best = { row, km };
  }
  return best?.row ?? null;
}

const fixedAt = (row) => ({
  key: `${row.precision}:${row.name}`,
  label: row.name,
  kind: row.precision,
  at: { lat: row.lat, lon: row.lon },
});

/** Rules 1 to 3 for one row; null when the row joins no shared bubble. */
function describeRow(row, index) {
  const target =
    typeof row.hotspot === 'string' ? index.byName.get(row.hotspot) : null;
  if (isGrouping(target)) return fixedAt(target);
  if (isGrouping(row)) return fixedAt(row);
  const country = row.country;
  if (
    COUNTRY_PRECISIONS.has(row.precision) &&
    typeof country === 'string' &&
    country.trim()
  ) {
    const countryRow = index.countryRows.get(country);
    return {
      key: `country:${country}`,
      label: country,
      kind: 'country',
      at: countryRow ? { lat: countryRow.lat, lon: countryRow.lon } : null,
    };
  }
  return null;
}

/** Rule 5: a bubble of its own, shared by stories naming the same place. */
function describePlace(location) {
  const name = typeof location.name === 'string' ? location.name : '';
  const folded = normalizePlaceName(name);
  if (folded) return { key: `place:${folded}`, label: name, kind: 'place' };
  return {
    key: `point:${location.lat.toFixed(1)},${location.lon.toFixed(1)}`,
    label: 'Unnamed place',
    kind: 'place',
  };
}

function describeStory(location, index) {
  const row =
    location.method === 'gazetteer' && typeof location.name === 'string'
      ? index.byName.get(location.name)
      : null;
  // A gazetteer name that is no longer a row reads like a model-placed story.
  const source = row ?? nearestRow(location, index.rows);
  return (
    (source && describeRow(source, index)) ?? {
      ...describePlace(location),
      at: null,
    }
  );
}

/** Mean of unit vectors, so points either side of the antimeridian average. */
function meanPosition(points) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const { lat, lon } of points) {
    const phi = (lat * Math.PI) / 180;
    const lambda = (lon * Math.PI) / 180;
    x += Math.cos(phi) * Math.cos(lambda);
    y += Math.cos(phi) * Math.sin(lambda);
    z += Math.sin(phi);
  }
  const horizontal = Math.hypot(x, y);
  // Antipodal points cancel out; fall back to the first.
  if (horizontal < 1e-9 && Math.abs(z) < 1e-9) return points[0];
  return {
    lat: (Math.atan2(z, horizontal) * 180) / Math.PI,
    lon: (Math.atan2(y, x) * 180) / Math.PI,
  };
}

/**
 * Every story with its `hotspot` (or `hotspot: null`), computed from the
 * theater's gazetteer. Returns new story objects; input is not mutated.
 * @param {Array<object>} stories
 * @param {Array<object>} gazetteer
 * @returns {Array<object>}
 */
export function assignHotspots(stories, gazetteer) {
  const index = gazetteerIndex(gazetteer);
  const groups = new Map();
  const described = stories.map((story) => {
    const location = story.location;
    if (story.kind === 'development' || !hasPoint(location)) return null;
    const hotspot = describeStory(location, index);
    let group = groups.get(hotspot.key);
    if (!group) {
      group = { hotspot, open: [], all: [] };
      groups.set(hotspot.key, group);
    }
    group.all.push(location);
    if (story.status === 'open') group.open.push(location);
    return group;
  });
  for (const group of groups.values()) {
    const { key, label, kind, at } = group.hotspot;
    const point =
      at ?? meanPosition(group.open.length ? group.open : group.all);
    group.hotspot = {
      key,
      label,
      kind,
      lat: round4(point.lat),
      lon: round4(point.lon),
    };
  }
  return stories.map((story, i) => ({
    ...story,
    hotspot: described[i] ? { ...described[i].hotspot } : null,
  }));
}
