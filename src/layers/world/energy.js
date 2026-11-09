import marine from '../../data/local_data/natural_earth/marine.json' with { type: 'json' };
import { scoreColor } from './model.js';

const marineShapes = new Map(
  marine.features.map(({ name, polygons }) => [name, polygons]),
);
const referenceGates = [
  {
    id: 'chokepoint1',
    name: 'Suez Canal',
    reference: 'suez',
    coordinates: [32.34, 30.45],
  },
  {
    id: 'chokepoint2',
    name: 'Panama Canal',
    reference: 'panama',
    coordinates: [-79.7, 9.13],
  },
  {
    id: 'chokepoint4',
    name: 'Bab el-Mandeb Strait',
    reference: 'bab-el-mandeb',
    marineName: 'Bab el Mandeb',
  },
  {
    id: 'chokepoint5',
    name: 'Strait of Malacca',
    reference: 'malacca',
    marineName: 'Strait of Malacca',
  },
  {
    id: 'chokepoint6',
    name: 'Strait of Hormuz',
    reference: 'hormuz',
    coordinates: [56.48, 26.58],
  },
  {
    id: 'chokepoint7',
    name: 'Cape of Good Hope',
    reference: 'cape-of-good-hope',
    coordinates: [18.47, -34.36],
  },
  {
    id: 'chokepoint10',
    name: 'Øresund',
    reference: 'danish-straits',
    marineName: 'Øresund',
    proxy:
      'Øresund traffic is a proxy for the Danish Straits. Great Belt and Little Belt are outside this gauge.',
  },
  {
    id: 'eia-dardanelles',
    name: 'Dardanelles Strait',
    reference: 'dardanelles',
    marineName: 'Dardanelles',
    proxy:
      'EIA measures the Dardanelles. The separate PortWatch Bosporus gauge covers a different strait.',
  },
];

function marinePoint(name) {
  const polygon = marineShapes.get(name)?.[0];
  if (!polygon?.length) return null;
  return polygon.reduce(
    ([x, y], [lon, lat]) => [
      x + lon / polygon.length,
      y + lat / polygon.length,
    ],
    [0, 0],
  );
}

const eiaAlternatives = {
  suez: 'The Cape of Good Hope can bypass Suez and SUMED. EIA estimates around 15 additional days for Arabian Sea to Europe oil tanker routes.',
  panama:
    'EIA gives the Trans-Panama crude pipeline a capacity of 864,000 barrels per day. Marine alternatives include Cape Horn and the Strait of Magellan.',
  'bab-el-mandeb':
    'Oil and LNG vessels can divert around the Cape of Good Hope.',
  malacca: 'The Sunda and Lombok Straits provide alternative sea routes.',
  hormuz:
    'EIA estimates that Saudi Arabia’s East–West pipeline and the UAE’s Abu Dhabi pipeline together could provide around 4.7 million barrels per day of bypass capacity during a disruption.',
  'danish-straits':
    'The Kiel Canal is an alternative for smaller tankers, mostly carrying petroleum products.',
  dardanelles:
    'Türkiye has LNG terminals outside the Dardanelles and can also import natural gas by pipeline.',
};

const staticGates = referenceGates.map(({ marineName, ...gate }) => ({
  ...gate,
  coordinates: marinePoint(marineName) ?? gate.coordinates,
  geometrySource: marineName
    ? 'Natural Earth marine geometry'
    : 'Approximate map marker from EIA reference geography',
  alternative: eiaAlternatives[gate.reference],
  days: [],
  history: [],
  events: [],
  status: 'unknown',
}));
const preferredMarineNames = new Map([
  ['chokepoint3', 'Bosporus'],
  ['chokepoint8', 'Strait of Gibraltar'],
  ['chokepoint11', 'Taiwan Strait'],
  ['chokepoint14', 'Luzon Strait'],
  ['chokepoint26', 'Bering Strait'],
]);

export function energyGates(snapshot) {
  const gates = new Map(staticGates.map((gate) => [gate.id, gate]));
  for (const gate of snapshot.features?.portwatch?.gates ?? []) {
    const fallback = gates.get(gate.id);
    const marineCoordinates = marinePoint(
      preferredMarineNames.get(gate.id) ?? gate.name,
    );
    const natural =
      fallback?.geometrySource === 'Natural Earth marine geometry';
    gates.set(gate.id, {
      ...fallback,
      ...gate,
      name: fallback?.name ?? gate.name,
      coordinates:
        marineCoordinates ??
        (natural ? fallback.coordinates : gate.coordinates),
      geometrySource:
        marineCoordinates || natural
          ? 'Natural Earth marine geometry'
          : 'IMF PortWatch coordinates',
    });
  }
  return [...gates.values()];
}

export function dependencyRows(snapshot, { dependent, provider, gate } = {}) {
  return (snapshot.features?.['energy-dependencies']?.rows ?? [])
    .filter(
      (row) =>
        (!dependent || row.dependent === dependent) &&
        (!provider || row.provider === provider) &&
        (!gate || row.route.includes(gate)),
    )
    .sort((a, b) => (b.shares.all ?? -1) - (a.shares.all ?? -1));
}

export function countryExposure(snapshot, iso3) {
  return snapshot.features?.['energy-dependencies']?.exposure?.[iso3];
}

export function chokepointExposure(snapshot, gateId) {
  const exposure = snapshot.features?.['energy-dependencies']?.exposure ?? {};
  return Object.entries(exposure)
    .flatMap(([dependent, rows]) =>
      rows
        .filter(({ gate }) => gate === gateId)
        .map((row) => ({ ...row, dependent })),
    )
    .sort((a, b) => b.shares.all - a.shares.all);
}

function exposureShare(country, snapshot) {
  if (snapshot.features?.['energy-dependencies']?.mode === 'modelled') {
    const rows = countryExposure(snapshot, country.iso3);
    return rows && (rows[0]?.shares.all ?? 0);
  }
  return dependencyRows(snapshot, { dependent: country.iso3 })[0]?.shares.all;
}

export function gaugeRatio(gate, dataTo) {
  const latest = gate.days.at(-1);
  return latest?.date === dataTo &&
    Number.isFinite(latest?.counts.total) &&
    gate.baseline7 > 0
    ? latest.counts.total / gate.baseline7
    : null;
}

export function energyColor(country, snapshot) {
  const share = exposureShare(country, snapshot);
  return Number.isFinite(share) ? scoreColor((1 - share) * 100) : null;
}

export function gateReferences(snapshot, gate) {
  const latest = new Map();
  for (const row of snapshot.features?.['eia-chokepoints']?.rows ?? []) {
    if (
      row.routeId === gate.reference &&
      (!latest.has(row.commodity) ||
        latest.get(row.commodity).periodEnd < row.periodEnd ||
        latest.get(row.commodity).year < row.year)
    )
      latest.set(row.commodity, row);
  }
  return [...latest.values()];
}

export function netEnergyImports(snapshot, iso3) {
  const reading = Object.values(snapshot.countries?.[iso3]?.slots ?? {})
    .map(({ observation }) => observation)
    .find((observation) => observation?.indicator === 'energy.net_imports_pct');
  return Number.isFinite(reading?.value)
    ? { value: reading.value, period: reading.period }
    : null;
}

export const energyLens = {
  id: 'energy',
  label: 'Energy',
  order: 30,
  color: energyColor,
  hover(country, snapshot) {
    if (!country || country.kind === 'disputed') return undefined;
    const share = exposureShare(country, snapshot);
    if (!Number.isFinite(share)) return 'Energy exposure · Unknown';
    const pct = new Intl.NumberFormat(undefined, {
      style: 'percent',
      maximumFractionDigits: 1,
    });
    const label =
      snapshot.features?.['energy-dependencies']?.mode === 'fixture'
        ? ' · synthetic fixture'
        : ' · modelled';
    return pct.format(share) + ' of all imports' + label;
  },
  legend: (snapshot) => ({
    name: 'Energy exposure',
    stops: ['100% exposed', '50%', '0%'],
    note:
      snapshot.features?.['energy-dependencies']?.mode === 'fixture'
        ? 'Synthetic fixture · maximum share of all imports'
        : [
            snapshot.features?.['energy-dependencies']?.mode === 'modelled'
              ? '2024 BACI · maximum modelled chokepoint share of all imports'
              : 'Route shares require calibrated trade flows',
            snapshot.features?.portwatch?.dataTo &&
              'Traffic data to ' + snapshot.features.portwatch.dataTo,
          ]
            .filter(Boolean)
            .join(' · '),
  }),
};
