import { greatCircleKm, normalizePlaceName } from './geocode.js';

/**
 * Hotspot grouping for the map's zoomed-out view: which bubble each located
 * story belongs to. Pure and code-owned (the model never sets it): a country,
 * or a named region or water, so the map never decides who owns a disputed
 * place. Applied when the snapshot is served, so stored stories are unchanged
 * and the browser never needs the gazetteer.
 */

/** A model-placed story takes the nearest gazetteer row within this. */
export const HOTSPOT_NEAR_KM = 100;
const LINKED_PRECISIONS = new Set(['region', 'water']);

const indexes = new WeakMap();

/** Rows by canonical name and country rows by country label, once per gazetteer. */
function gazetteerIndex(gazetteer) {
  let index = indexes.get(gazetteer);
  if (index) return index;
  const byName = new Map();
  const countryRows = new Map();
  const rows = gazetteer.filter(
    (row) =>
      row &&
      typeof row.name === 'string' &&
      Number.isFinite(row.lat) &&
      Number.isFinite(row.lon),
  );
  for (const row of rows) {
    if (!byName.has(row.name)) byName.set(row.name, row);
    if (
      row.precision === 'country' &&
      typeof row.country === 'string' &&
      !countryRows.has(row.country)
    )
      countryRows.set(row.country, row);
  }
  index = { rows, byName, countryRows };
  indexes.set(gazetteer, index);
  return index;
}

function nearestRow(location, rows) {
  let best = null;
  for (const row of rows) {
    const km = greatCircleKm(location, row);
    if (km <= HOTSPOT_NEAR_KM && (!best || km < best.km)) best = { row, km };
  }
  return best?.row ?? null;
}

/** Rules 1 to 3 for one row; null when the row has no country label. */
function fromRow(row, { byName, countryRows }) {
  const linked = row.hotspot ? byName.get(row.hotspot) : null;
  const region =
    linked && LINKED_PRECISIONS.has(linked.precision)
      ? linked
      : LINKED_PRECISIONS.has(row.precision)
        ? row
        : null;
  if (region)
    return {
      key: `${region.precision}:${region.name}`,
      label: region.name,
      kind: region.precision,
      at: region,
    };
  if (typeof row.country !== 'string' || !row.country) return null;
  return {
    key: `country:${row.country}`,
    label: row.country,
    kind: 'country',
    at: countryRows.get(row.country) ?? null,
  };
}

/** Rule 5: the story's own place, shared by name. */
function ownPlace(location) {
  const name = normalizePlaceName(location.name);
  if (name)
    return {
      key: `place:${name}`,
      label: location.name.trim(),
      kind: 'place',
      at: null,
    };
  const round = (value) => (Math.round(value * 10) / 10).toFixed(1);
  return {
    key: `point:${round(location.lat)},${round(location.lon)}`,
    label: 'Unnamed place',
    kind: 'place',
    at: null,
  };
}

function hotspotFor(location, index) {
  const row =
    (location.method === 'gazetteer' && index.byName.get(location.name)) ||
    nearestRow(location, index.rows);
  return (row && fromRow(row, index)) || ownPlace(location);
}

/** Mean position on the sphere, so a group across the date line stays put. */
function averagePosition(locations) {
  const rad = Math.PI / 180;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const { lat, lon } of locations) {
    x += Math.cos(lat * rad) * Math.cos(lon * rad);
    y += Math.cos(lat * rad) * Math.sin(lon * rad);
    z += Math.sin(lat * rad);
  }
  const round = (value) => Math.round(value * 1e4) / 1e4;
  return {
    lat: round(Math.atan2(z, Math.hypot(x, y)) / rad),
    lon: round(Math.atan2(y, x) / rad),
  };
}

/**
 * Give every located event story a `hotspot` ({key, label, kind, lat, lon}),
 * first match wins:
 * 1. its row links a region or water row (`hotspot`): that row's bubble;
 * 2. its row is a region or water: its own bubble;
 * 3. otherwise its row's country label, at that country's row, or at its
 *    stories' average when the theater has none;
 * 4. a model-placed story (or one whose row is gone) uses the nearest row
 *    within 100 km;
 * 5. otherwise a bubble of its own place name (or rounded point).
 * Stories without a location and developments get none.
 * @param {Array<object>} stories
 * @param {Array<object>} gazetteer
 * @returns {Array<object>} New story objects.
 */
export function assignHotspots(stories, gazetteer) {
  const index = gazetteerIndex(Array.isArray(gazetteer) ? gazetteer : []);
  const groups = new Map();
  // One key, one label: the first story's spelling of a shared place name.
  const labels = new Map();
  const assigned = (stories || []).map((story) => {
    const location = story?.location;
    if (
      !location ||
      story.kind === 'development' ||
      !Number.isFinite(location.lat) ||
      !Number.isFinite(location.lon)
    )
      return { story };
    const hotspot = hotspotFor(location, index);
    if (!labels.has(hotspot.key)) labels.set(hotspot.key, hotspot.label);
    hotspot.label = labels.get(hotspot.key);
    if (!hotspot.at) {
      const members = groups.get(hotspot.key) || [];
      members.push(location);
      groups.set(hotspot.key, members);
    }
    return { story, hotspot };
  });
  const averages = new Map(
    [...groups].map(([key, members]) => [key, averagePosition(members)]),
  );
  return assigned.map(({ story, hotspot }) => {
    if (!hotspot) return { ...story };
    const { at, ...rest } = hotspot;
    const position = at
      ? { lat: at.lat, lon: at.lon }
      : averages.get(hotspot.key);
    return { ...story, hotspot: { ...rest, ...position } };
  });
}
