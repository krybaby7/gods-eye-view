import { readFile } from 'node:fs/promises';
import { conditionFlag, conditionResult } from '../conditionEvents.js';
import { countryIds } from './liveFeedCommon.js';

const DATA = new URL(
  '../../../../public/world/curated/debt-distress.json',
  import.meta.url,
);
export const debtDistress = {
  version: 2,
  shouldCheck: () => true,
  async fetchObservations({ registry, now, data }) {
    const { rows } = JSON.parse(await readFile(DATA, 'utf8'));
    const supported = countryIds(registry);
    const flags = rows
      .filter(
        (row) =>
          supported.has(row.countryCode) &&
          row.classification === 'in-debt-distress',
      )
      .map((row) =>
        conditionFlag('live-debt-dsa', {
          iso3: row.countryCode,
          slot: 'C5',
          date: row.asOf,
          dsaMonth: row.dsaMonth,
          source: row.sourceUrl,
          sourceLocator: row.sourceLocator,
          sourceName: 'IMF–World Bank LIC DSA',
          dateChecked: row.checkedAt,
          label: 'In external debt distress',
          reviewed: row.reviewed,
        }),
      );
    return conditionResult(flags, data, now);
  },
};
