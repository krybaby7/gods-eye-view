import { readFile } from 'node:fs/promises';
import {
  registerWorldFeatureView,
  registerWorldSources,
} from './refreshRegistry.js';
import { ngaPorts } from './sources/nga-ports.js';
import { ourAirports } from './sources/ourairports.js';
import { wikidataAssets } from './sources/wikidata-assets.js';
import { wriPower } from './sources/wri-power.js';

const curatedPath = new URL('../../../public/world/curated/', import.meta.url);
const sourceIds = [
  'wri-power',
  'wikidata-assets',
  'nga-ports',
  'ourairports',
  'curated-assets',
];

async function readTable(name) {
  return JSON.parse(
    await readFile(new URL(name + '.json', curatedPath), 'utf8'),
  );
}

function curatedOwners(row, fallbackRole) {
  return (row.owners ?? []).map((owner) => ({
    ...owner,
    role: owner.role ?? fallbackRole,
    sourceUrl: owner.sourceUrl ?? row.sourceUrl,
    reviewed: row.reviewed === true,
    verified: Boolean(owner.country && (owner.sourceUrl ?? row.sourceUrl)),
  }));
}

export async function readCuratedAssets() {
  const [bases, fabs, nuclear, ports] = await Promise.all([
    readTable('foreign-bases'),
    readTable('semiconductor-fabs'),
    readTable('nuclear-weapons'),
    readTable('port-attributions'),
  ]);
  const rows = [
    ...bases.rows.map((row) => ({
      ...row,
      source: 'curated-assets',
      licence: 'Curated facts with government citations',
      operator: null,
      capacity: null,
      canInterrupt: [],
      owners: curatedOwners(row, 'owner'),
    })),
    ...fabs.rows.map((row) => ({
      ...row,
      source: 'curated-assets',
      licence: 'Curated facts from company filings',
      owners: curatedOwners(row, 'affiliation'),
      capacity: null,
      canInterrupt: [],
    })),
    ...ports.rows.map((row) => ({
      geometry: null,
      jurisdiction: null,
      ...row,
      type: 'port',
      status: 'unknown',
      source: 'curated-assets',
      licence: 'Curated facts with company citations',
      reviewed: false,
      lastVerified: '2026-11-09',
      owners: curatedOwners(row, 'investor'),
      capacity: null,
      canInterrupt: [],
    })),
  ];
  return { rows, nuclearBadges: nuclear.rows };
}

const curated = {
  version: 2,
  shouldCheck: () => true,
  async fetchObservations() {
    const data = await readCuratedAssets();
    return {
      data,
      count: data.rows.length + data.nuclearBadges.length,
      unit: 'draft fact',
    };
  },
};

function countsByCountry(rows, key) {
  const counts = {};
  for (const row of rows) {
    const code = row[key];
    if (code) counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

function assetMarkers(id, data) {
  const rows = data.rows ?? [];
  if (id === 'wri-power' || id === 'ourairports') {
    const visible =
      id === 'wri-power'
        ? rows.filter(
            ({ capacity, fuel }) =>
              capacity?.value >= 100 && fuel !== 'Nuclear',
          )
        : rows;
    return {
      markers: visible.map(({ id, name, locatedIn, geometry, status }) => [
        id,
        name,
        locatedIn,
        geometry?.coordinates[0] ?? null,
        geometry?.coordinates[1] ?? null,
        status,
      ]),
      countsByCountry: countsByCountry(rows, 'locatedIn'),
      countsBySourceCountry: countsByCountry(rows, 'sourceCountry'),
    };
  }
  return {
    rows: rows.map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      locatedIn: row.locatedIn,
      geometry: row.geometry,
      ...(row.status !== 'unknown' && { status: row.status }),
      ...(row.sendingCountry && { sendingCountry: row.sendingCountry }),
      ...(row.reviewed === false && { reviewed: false }),
      ...(row.owners?.some((owner) => owner.verified && owner.country) && {
        owners: row.owners
          .filter((owner) => owner.verified && owner.country)
          .map(({ country, verified, role, reviewed }) => ({
            country,
            verified,
            role,
            reviewed,
          })),
      }),
    })),
    ...(data.nuclearBadges && { nuclearBadges: data.nuclearBadges }),
  };
}

registerWorldFeatureView('assets', {
  summary: Object.fromEntries(
    sourceIds.map((id) => [id, (data) => assetMarkers(id, data)]),
  ),
  detail({ country, features }) {
    return {
      rows: country
        ? sourceIds.flatMap((id) =>
            (features[id]?.rows ?? []).filter(
              (row) =>
                row.locatedIn === country ||
                (row.status !== 'closed' &&
                  (row.sendingCountry === country ||
                    row.owners?.some(
                      (owner) => owner.verified && owner.country === country,
                    ))),
            ),
          )
        : [],
      nuclearBadges: country
        ? (features['curated-assets']?.nuclearBadges ?? []).filter(
            ({ countryCode }) => countryCode === country,
          )
        : [],
    };
  },
});

registerWorldSources(
  {
    'wri-power': wriPower,
    'wikidata-assets': wikidataAssets,
    'nga-ports': ngaPorts,
    ourairports: ourAirports,
    'curated-assets': curated,
  },
  { 'nga-ports': 'wikidata-assets' },
);
