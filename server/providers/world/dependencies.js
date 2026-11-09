import { readFile } from 'node:fs/promises';
import { registerWorldSources } from './refreshRegistry.js';
import * as fred from './sources/fred.js';
import { portwatch } from './sources/portwatch.js';

const referencePath = new URL(
  '../../../public/world/curated/eia-chokepoints.json',
  import.meta.url,
);

export async function readEnergyReference() {
  return JSON.parse(await readFile(referencePath, 'utf8'));
}

export function dependencyShares({ crossing, seaborne, total }) {
  const ratio = (denominator) =>
    Number.isFinite(crossing) &&
    Number.isFinite(denominator) &&
    crossing >= 0 &&
    denominator > 0 &&
    crossing <= denominator
      ? crossing / denominator
      : null;
  return { seaborne: ratio(seaborne), all: ratio(total) };
}

const eia = {
  shouldCheck: ({ data }) => !data,
  async fetchObservations() {
    const data = await readEnergyReference();
    return {
      data,
      count: data.rows.length,
      unit: 'published transit estimate',
    };
  },
};

const dependencies = {
  shouldCheck: ({ data }) => !data,
  async fetchObservations() {
    const reason =
      'Route exposure is unavailable until bilateral trade can be routed and calibrated against published EIA volumes.';
    return {
      data: { mode: 'unavailable', rows: [], reason },
      count: 0,
      unit: 'dependency',
      detail: reason,
    };
  },
};

registerWorldSources({
  'eia-chokepoints': eia,
  'energy-dependencies': dependencies,
  portwatch,
  fred,
});
