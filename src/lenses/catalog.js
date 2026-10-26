function lens(id, label, icon, hotkey, layerIds) {
  return Object.freeze({
    id,
    label,
    icon,
    hotkey,
    layerIds: Object.freeze(layerIds),
  });
}

/** Topic shortcuts over the existing layer catalog; no state is stored here. */
export const LENSES = Object.freeze([
  lens('air', 'Air', '✈', 1, ['flights', 'military', 'local-adsb']),
  lens('sea', 'Sea', '⚓', 2, [
    'ais-live-vessels',
    'telegeography-submarine-cables',
  ]),
  lens('space', 'Space', '◎', 3, ['satellites', 'rocket-launches']),
  lens('conflict', 'Conflict', '⌖', 4, [
    'military',
    'military-installations',
    'local-firms',
  ]),
  lens('hazards', 'Hazards', '⚠', 5, [
    'earthquakes',
    'weather-cyclones',
    'local-firms',
    'fire-perimeters',
    'weather-radar',
    'weather-lightning',
    'wind',
  ]),
  lens('city', 'City', '▦', 6, [
    'traffic',
    'transit',
    'bikeshare',
    'cctv',
    'alpr-cameras',
  ]),
  lens('signals', 'Signals', '◉', 7, ['radio', 'cctv']),
]);
