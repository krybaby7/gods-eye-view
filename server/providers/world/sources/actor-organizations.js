import { readFile } from 'node:fs/promises';
import { actorSourceDue } from './actor-fetch.js';

const TABLE = new URL(
  '../../../../public/world/curated/actor-organizations.json',
  import.meta.url,
);

export const shouldCheck = (context) => actorSourceDue(context, 7 * 24);

export async function fetchObservations() {
  const { organizations, notes } = JSON.parse(await readFile(TABLE, 'utf8'));
  return {
    data: { organizations, notes },
    count: Object.keys(organizations).length,
    unit: 'organization',
  };
}
