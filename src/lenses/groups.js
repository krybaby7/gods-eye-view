/**
 * The one table the Layers menu and the presets both read.
 *
 * Each group is a column block in the menu and, unless `preset` is false, one
 * preset that switches its whole group. Layer ids are the catalog's own and are
 * never renamed here; `name` is only what the row says.
 *
 * Rows with `opensPanel` are tools, not switches: Search layers opens its panel
 * and never starts a search, so it is left out of its group's preset.
 */
function row(id, name, extra = {}) {
  return Object.freeze({ id, name, ...extra });
}

function group(id, label, column, hotkey, icon, rows, extra = {}) {
  return Object.freeze({
    id,
    label,
    column,
    hotkey,
    icon,
    rows: Object.freeze(rows),
    preset: true,
    ...extra,
  });
}

export const LAYER_GROUPS = Object.freeze([
  group('air', 'Air', 1, 1, '✈', [
    row('flights', 'Live flights'),
    row('military', 'Military flights'),
    row('local-adsb', 'Your own receiver'),
  ]),
  group('sea', 'Sea', 1, 2, '⚓', [
    row('ais-live-vessels', 'Live vessels'),
    row('telegeography-submarine-cables', 'Submarine cables'),
  ]),
  // Order matters: the Space preset switches launches first, so the Context
  // baseline is captured before its satellite intent, and leaving Space does
  // not restore that new intent.
  group('space', 'Space', 1, 3, '◎', [
    row('rocket-launches', 'Space missions, 30 days'),
    row('satellites', 'Satellites'),
  ]),
  group('hazards', 'Hazards and weather', 2, 4, '⚠', [
    row('earthquakes', 'Earthquakes, 24 hours'),
    row('local-firms', 'Active fires'),
    row('fire-perimeters', 'Fire perimeters'),
    row('weather-cyclones', 'Cyclone advisories'),
    row('weather-radar', 'Rain radar'),
    row('weather-satellite', 'Satellite clouds'),
    row('weather-lightning', 'Lightning'),
    row('wind', 'Wind'),
  ]),
  group('security', 'Security', 2, 5, '⌖', [
    row('military-installations', 'Mapped installations'),
  ]),
  group('infrastructure', 'Infrastructure', 3, 6, '▤', [
    row('local-datacenters', 'Data centres'),
    row('local-dams', 'Dams'),
  ]),
  group('city', 'City', 3, 7, '▦', [
    row('traffic', 'Street traffic'),
    row('transit', 'Transit'),
    row('bikeshare', 'Bike share'),
    row('cctv', 'Cameras'),
    row('street-level', 'Street level'),
    row('alpr-cameras', 'Number-plate cameras'),
  ]),
  group('tools', 'Tools', 1, 8, '◉', [
    row('directions', 'Directions'),
    row('recent-imagery', 'Recent imagery'),
    row('radio', 'Radio'),
    row('searches', 'Search layers', { opensPanel: 'searches-panel' }),
  ]),
  // The War Monitor keeps its own row and switch, apart from the presets.
  group('news', 'News', 2, null, null, [row('news', 'War Monitor')], {
    preset: false,
  }),
]);

/**
 * Layers the frame itself switches (World is a view of the bottom bar, not a
 * row), so "Switch all off" in the layers menu leaves them as they are.
 */
export const FRAME_LAYER_IDS = Object.freeze(['world']);

/**
 * Layers that keep working by code, share link and command but have no row:
 * the World Board opens from its own view, and the rest are driven by another
 * surface (awareness by the cockpit, Bhote Koshi by its scene).
 */
export const LAYERS_WITHOUT_ROWS = Object.freeze([
  ...FRAME_LAYER_IDS,
  'military-awareness',
  'bhote-koshi-2026',
  'bhote-koshi-locator',
]);

/** Heading for any catalog layer this table does not name yet. */
export const OTHER_LAYERS_LABEL = 'Other layers';

const ROW_BY_ID = new Map(
  LAYER_GROUPS.flatMap((entry) =>
    entry.rows.map((layerRow) => [
      layerRow.id,
      { group: entry, row: layerRow },
    ]),
  ),
);

/** The group and row that name a layer, or null when the table does not. */
export function layerRowFor(layerId) {
  return ROW_BY_ID.get(layerId) ?? null;
}

/** Layer ids a group's preset switches (tool rows that open a panel are left out). */
export function presetLayerIds(entry) {
  return entry.rows
    .filter((layerRow) => !layerRow.opensPanel)
    .map((layerRow) => layerRow.id);
}
