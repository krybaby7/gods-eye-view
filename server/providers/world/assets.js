import { readFile } from 'node:fs/promises';
import { registerWorldSources } from './refreshRegistry.js';
import { ngaPorts } from './sources/nga-ports.js';
import { ourAirports } from './sources/ourairports.js';
import { wikidataAssets } from './sources/wikidata-assets.js';
import { wriPower } from './sources/wri-power.js';

const curatedPath = new URL('../../../public/world/curated/', import.meta.url);

async function readRows(name) {
  const data = JSON.parse(
    await readFile(new URL(name + '.json', curatedPath), 'utf8'),
  );
  return data.rows;
}

export async function readCuratedAssets() {
  const [bases, fabs, nuclearBadges] = await Promise.all([
    readRows('foreign-bases'),
    readRows('semiconductor-fabs'),
    readRows('nuclear-weapons'),
  ]);
  const rows = [
    ...bases.map((row) => ({
      ...row,
      source: 'curated-assets',
      licence: 'Curated facts with government citations',
      operator: null,
      capacity: null,
      canInterrupt: [],
      owners: [],
    })),
    ...fabs.map(({ owners, ownerCountry, ...row }) => {
      const group = owners[0];
      const reportedGroup = group
        ? { name: group.actor, country: group.country, share: group.share }
        : null;
      // Intel's filing expressly retains title to this specific asset. Other
      // reported group stakes refer to subsidiaries or group affiliations.
      const title =
        row.id === 'asset_intel-fab-34'
          ? [{ ...group, verified: row.reviewed === true }]
          : [];
      return {
        ...row,
        source: 'curated-assets',
        licence: 'Curated facts from company filings',
        reportedGroup,
        ownerCountry: title[0]?.country ?? null,
        owners: title,
        capacity: null,
        canInterrupt: [],
      };
    }),
  ];
  return { rows, nuclearBadges };
}

const curated = {
  shouldCheck: ({ data }) => !data,
  async fetchObservations() {
    const data = await readCuratedAssets();
    return {
      data,
      count: data.rows.length + data.nuclearBadges.length,
      unit: 'draft fact',
    };
  },
};

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
