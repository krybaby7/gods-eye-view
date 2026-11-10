import { readFile } from 'node:fs/promises';
import memberships from '../../../../public/world/curated/bloc-memberships.json' with { type: 'json' };
import { makeRelation, relationResult } from '../relations.js';

export const version = 3;

export function shouldCheck() {
  // Small checked-in tables can change between app releases.
  return true;
}

export async function fetchObservations({ data, registry }) {
  const relations = (
    await Promise.all(
      ['alliances', 'territorial-disputes', 'ruptures', 'rivalries'].map(
        async (name) => {
          const file = new URL(
            '../../../../public/world/curated/' + name + '.json',
            import.meta.url,
          );
          return JSON.parse(await readFile(file, 'utf8'));
        },
      ),
    )
  ).flat();
  const countries = new Set(registry?.countries.map(({ iso3 }) => iso3));
  for (const { id, members, source, statuses } of memberships.blocs) {
    for (const from of members.split(' ')) {
      if (countries.size && !countries.has(from)) continue;
      const [status, statusSince, decision] = statuses[from] ?? [];
      relations.push(
        makeRelation({
          id:
            'rel_curated_bloc_' +
            id.toLowerCase().replace(' ', '-') +
            '_' +
            from,
          type: 'bloc_membership',
          from,
          to: id,
          directed: true,
          detail:
            status === 'suspended'
              ? 'Member state. Participation suspended since ' +
                statusSince +
                '.'
              : status === 'resumed'
                ? 'Member state. Participation resumed on ' + statusSince + '.'
                : 'Member state in the published roster.',
          sources: decision ? [source, decision] : [source],
          ...(status && { membershipStatus: status, statusSince }),
          dateChecked: memberships.checkedOn,
          reviewed: false,
        }),
      );
    }
  }
  return relationResult(relations, data, 'Curated');
}
