import {
  registerWorldFeatureView,
  registerWorldSources,
} from './refreshRegistry.js';
import * as curated from './sources/relationsCurated.js';
import * as ucdp from './sources/relationsUcdp.js';
import * as voting from './sources/relationsVoting.js';
import { blocAdapter, diplomacyAdapter } from './sources/relationsWikidata.js';
import {
  ofacSanctions,
  ukSanctions,
  unSanctions,
} from './sources/relationsSanctions.js';

registerWorldSources({
  'relations-curated': curated,
  'relations-ucdp': ucdp,
  'relations-voting': voting,
  'relations-blocs': blocAdapter,
  'relations-diplomatic': diplomacyAdapter,
  'relations-sanctions-un': unSanctions,
  'relations-sanctions-uk': ukSanctions,
  'relations-sanctions-ofac': ofacSanctions,
});

const lensSanctions = ({ relations, ...data }) => ({
  ...data,
  relations: (relations ?? [])
    .filter(({ scope }) => scope === 'state')
    .map(
      ({
        id,
        type,
        from,
        to,
        directed,
        scope,
        programme,
        programmeId,
        sources,
        dateChecked,
      }) => ({
        id,
        type,
        from,
        to,
        directed,
        scope,
        programme,
        programmeId,
        sources,
        dateChecked,
      }),
    ),
});

registerWorldFeatureView('diplomacy', {
  summary: {
    'relations-voting': () => undefined,
    'relations-blocs': () => undefined,
    'relations-ucdp': ({ relations, sourceVersion }) => ({
      sourceVersion,
      historicalDyads: (relations ?? []).filter(
        ({ type }) => type === 'armed_conflict',
      ).length,
      houthiActors: (relations ?? [])
        .filter(({ type }) => type === 'armed_conflict')
        .flatMap((row) =>
          ['from', 'to'].flatMap((side) =>
            /Government of Yemen \(North Yemen\)/.test(
              row[side + 'Label'] ?? '',
            )
              ? [
                  {
                    id: row.id,
                    actor: row[side],
                    states: row[side + 'Actors'] ?? [],
                  },
                ]
              : [],
          ),
        ),
    }),
    'relations-diplomatic': ({ relations }) => ({
      pairs: (relations ?? [])
        .filter(({ end }) => !end)
        .map(({ from, to }) => [from, to]),
    }),
    'relations-sanctions-un': lensSanctions,
    'relations-sanctions-uk': lensSanctions,
    'relations-sanctions-ofac': lensSanctions,
  },
  detail({ country, features }) {
    return {
      features: Object.fromEntries(
        Object.entries(features).flatMap(([id, data]) => {
          if (!id.startsWith('relations-')) return [];
          const relations = (data.relations ?? []).filter(
            (row) =>
              country &&
              (row.from === country ||
                row.to === country ||
                row.fromActors?.includes(country) ||
                row.toActors?.includes(country) ||
                row.participants?.includes(country)),
          );
          return [[id, { ...data, relations }]];
        }),
      ),
    };
  },
});
