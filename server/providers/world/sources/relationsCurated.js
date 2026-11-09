import { readFile } from 'node:fs/promises';
import { relationResult } from '../relations.js';

export function shouldCheck() {
  // Small checked-in tables can change between app releases.
  return true;
}

export async function fetchObservations({ data }) {
  const relations = (
    await Promise.all(
      ['alliances', 'territorial-disputes', 'ruptures'].map(async (name) => {
        const file = new URL(
          '../../../../public/world/curated/' + name + '.json',
          import.meta.url,
        );
        return JSON.parse(await readFile(file, 'utf8'));
      }),
    )
  ).flat();
  return relationResult(relations, data, 'Curated');
}
