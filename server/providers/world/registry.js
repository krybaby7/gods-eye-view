import { readFile } from 'node:fs/promises';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
}

function indexCountries(
  features,
  { groups, overrides, territories, disputed },
) {
  const shapes = new Map();
  for (const feature of features) {
    const { iso } = feature;
    if (!/^[A-Z]{3}$/.test(iso) || shapes.has(iso)) {
      throw new Error(
        `Missing or duplicate World Board shape ID: ${feature.name} (${iso})`,
      );
    }
    shapes.set(iso, feature);
  }

  for (const id of [...Object.keys(overrides), ...territories, ...disputed]) {
    if (!shapes.has(id)) throw new Error(`Unknown World Board shape ID: ${id}`);
  }

  const countries = new Map();
  const grouped = new Set();
  for (const { iso3, country } of groups) {
    const shapeIds = features
      .filter((feature) => feature.country === country)
      .map(({ iso }) => iso);
    if (!shapeIds.includes(iso3) || shapeIds.some((id) => grouped.has(id))) {
      throw new Error(`Invalid World Board map unit group: ${country}`);
    }
    for (const id of shapeIds) grouped.add(id);
    countries.set(iso3, {
      iso3,
      name: country,
      shapeIds,
      kind: 'state',
      capital: null,
      aliases: {},
    });
  }

  for (const [id, feature] of shapes) {
    if (grouped.has(id)) continue;
    const kind = disputed.includes(id)
      ? 'disputed'
      : territories.includes(id)
        ? 'territory'
        : 'state';
    const country = {
      iso3: id,
      name: feature.name,
      shapeIds: [id],
      kind,
      capital: null,
      aliases: {},
      ...overrides[id],
    };
    if (countries.has(country.iso3))
      throw new Error(`Duplicate World Board country: ${country.iso3}`);
    countries.set(country.iso3, country);
  }
  return [...countries.values()].sort((a, b) =>
    a.iso3.localeCompare(b.iso3, 'en'),
  );
}

export async function loadWorldRegistry() {
  const [indicators, sources, countryConfig, pack] = await Promise.all([
    readJson('../../../public/world/indicators.json'),
    readJson('../../../public/world/sources.json'),
    readJson('../../../public/world/countries.json'),
    readJson('../../../src/data/local_data/natural_earth/countries.json'),
  ]);
  return {
    indicators,
    sources,
    countries: indexCountries(pack.features, countryConfig),
  };
}
