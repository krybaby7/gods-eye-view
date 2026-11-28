const LAYERS = {
  'weather-radar': 'Rain radar',
  earthquakes: 'Earthquakes, 24 hours',
};

const COMMANDS = {
  'preset:hazards': 'Open Hazards and weather preset',
  'menu:today': 'Open Today',
  'menu:sources': 'Open data sources and keys',
  'menu:display': 'Open Display',
  'menu:tools': 'Open Tools',
  'menu:layers': 'Open Layers',
  'menu:presets': 'Open Presets',
  'menu:tour': 'Show the tour',
};

function normalized(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
}

function validCenter(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

function cityCenter(city) {
  const { southwest, northeast } = city.viewBounds ?? {};
  if (
    !validCenter(southwest?.lat, southwest?.lng) ||
    !validCenter(northeast?.lat, northeast?.lng)
  )
    return null;
  const lat = (southwest.lat + northeast.lat) / 2;
  const east =
    northeast.lng < southwest.lng ? northeast.lng + 360 : northeast.lng;
  const lng = (((southwest.lng + east) / 2 + 540) % 360) - 180;
  return { kind: 'place', name: city.name, lat, lng };
}

export function boardSearchGroups(
  query,
  { countries = {}, cities = {}, availableLayers, availableCommands } = {},
) {
  const search = normalized(query);
  if (!search) return [];
  const matches = (text) => normalized(text).includes(search);
  const rank = ({ label, target }) => {
    const name = normalized(label);
    if (name === search || target.iso3?.toLowerCase() === search) return 0;
    return name.startsWith(search) ? 1 : 2;
  };
  const countriesFound = Object.entries(countries).flatMap(([iso3, country]) =>
    /^[A-Z]{3}$/.test(iso3) &&
    country?.name &&
    country.kind !== 'disputed' &&
    (matches(country.name) || normalized(iso3) === search)
      ? [
          {
            id: `country-${iso3}`,
            label: country.name,
            target: { kind: 'country', iso3 },
          },
        ]
      : [],
  );
  const placesFound = Object.entries(cities).flatMap(([id, city]) => {
    const target = city.name && matches(city.name) && cityCenter(city);
    return target ? [{ id: `place-${id}`, label: city.name, target }] : [];
  });
  const layersFound = Object.entries(LAYERS)
    .filter(([id, label]) => availableLayers?.has(id) && matches(label))
    .map(([id, label]) => ({
      id: `layer-${id}`,
      label: `Open ${label} control`,
      target: { kind: 'layer', id },
    }));
  const commandsFound = Object.entries(COMMANDS)
    .filter(([id, label]) => availableCommands?.has(id) && matches(label))
    .map(([id, label]) => ({ id, label, target: { kind: 'command', id } }));
  return [
    ['Countries', countriesFound],
    ['Places', placesFound],
    ['Layers', layersFound],
    ['Presets', commandsFound.filter(({ id }) => id.startsWith('preset:'))],
    ['Menu', commandsFound.filter(({ id }) => id.startsWith('menu:'))],
  ]
    .filter(([, rows]) => rows.length)
    .map(([label, rows]) => ({
      label,
      rows: rows
        .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
        .slice(0, 5),
    }));
}

export function isLocalityQuery(query) {
  return (
    /^[\p{L}\p{M}][\p{L}\p{M} '\u2019,-]{1,89}$/u.test(query.trim()) &&
    !/^(?:search layers(?: with claude)?|claude|war monitor)$/u.test(
      normalized(query),
    ) &&
    !/\b(?:military|bases?|barracks|airfields?|airports?|arsenals?|bunkers?|installations?|missiles?|radar|naval|garrisons?|silos?)\b/u.test(
      normalized(query),
    )
  );
}

export function boardPlaceFromGeocode(place) {
  if (
    !validCenter(place?.lat, place?.lng) ||
    !place.name ||
    !Array.isArray(place.types)
  )
    return null;
  const broadType = place.types.find(
    (type) => type === 'locality' || type === 'country',
  );
  if (
    !broadType ||
    place.types.some((type) => type !== broadType && type !== 'political')
  )
    return null;
  return {
    kind: broadType === 'country' ? 'country' : 'place',
    name: place.name,
    lat: place.lat,
    lng: place.lng,
  };
}
