import { readFile } from 'node:fs/promises';
import { conditionFlag, conditionResult } from '../conditionEvents.js';
import { countryIds } from './liveFeedCommon.js';

const DATA = new URL(
  '../../../../public/world/curated/debt-distress.json',
  import.meta.url,
);
const LABELS = {
  'in-distress': 'In debt distress',
  'high-risk': 'High risk of debt distress',
};

export const debtDistress = {
  shouldCheck: () => true,
  async fetchObservations({ registry, now, data }) {
    const rows = JSON.parse(await readFile(DATA, 'utf8'));
    const supported = countryIds(registry);
    const flags = rows
      .filter(
        (row) => supported.has(row.iso3) && Object.hasOwn(LABELS, row.rating),
      )
      .map((row) =>
        conditionFlag('live-debt-dsa', {
          iso3: row.iso3,
          slot: 'C5',
          date: row.assessmentDate,
          source: row.source,
          sourceName: 'IMF–World Bank LIC DSA',
          dateChecked: row.dateChecked,
          label: LABELS[row.rating] + ' (' + row.scope + ')',
          reviewed: row.reviewed,
        }),
      );
    return conditionResult(flags, data, now);
  },
};
