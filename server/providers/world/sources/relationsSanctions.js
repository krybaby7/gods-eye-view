import { readResponseTextCapped } from '../../common/http.js';
import { makeRelation, relationResult } from '../relations.js';
import { fetchResponse, monthIndex, releaseDue } from './common.js';

const CHECKED = '2026-11-09';
const UN_BASE = 'https://main.un.org';
const UK_BASE = 'https://www.gov.uk';
const OFAC_BASE = 'https://ofac.treasury.gov';
const OFAC_DIRECTORY = '/sanctions-programs-and-country-information';
const UK_PUBLICATIONS = '/government/publications/';
const UN_DIRECTORY = '/securitycouncil/en/sanctions/';
const LISTS = {
  uk: {
    actor: 'GBR',
    catalogue:
      UK_BASE +
      '/government/collections/uk-sanctions-regimes-under-the-sanctions-act',
    path: (id) => UK_PUBLICATIONS + id + '-sanctions-guidance',
    rows: [
      ['BLR', 'republic-of-belarus', 'Belarus sanctions'],
      ['IRN', 'iran', 'Iran sanctions'],
      ['IRN', 'iran-nuclear', 'Iran nuclear sanctions'],
      ['PRK', 'democratic-peoples-republic-of-korea', 'DPRK sanctions'],
      ['MMR', 'myanmar', 'Myanmar sanctions'],
      ['RUS', 'russia', 'Russia sanctions'],
      ['VEN', 'venezuela', 'Venezuela sanctions'],
      ['LBY', 'libya', 'Libya sanctions'],
      ['SDN', 'sudan', 'Sudan sanctions'],
      ['SSD', 'south-sudan', 'South Sudan sanctions'],
    ],
  },
  ofac: {
    actor: 'USA',
    catalogue: OFAC_BASE + OFAC_DIRECTORY,
    path: (id) => OFAC_DIRECTORY + '/' + id,
    rows: [
      ['BLR', 'belarus-sanctions', 'Belarus sanctions'],
      ['CUB', 'cuba-sanctions', 'Cuba sanctions'],
      ['IRN', 'iran-sanctions', 'Iran sanctions'],
      ['PRK', 'north-korea-sanctions', 'North Korea sanctions'],
      ['MMR', 'burma', 'Burma sanctions'],
      ['RUS', 'russia-related-sanctions', 'Russia-related sanctions'],
      [
        'RUS',
        'russian-harmful-foreign-activities-sanctions',
        'Russian harmful foreign activities sanctions',
      ],
      ['VEN', 'venezuela-related-sanctions', 'Venezuela-related sanctions'],
    ],
  },
  un: {
    actor: 'UN',
    catalogue: UN_BASE + UN_DIRECTORY + 'information',
    path: (id) => UN_DIRECTORY + id,
    rows: [
      ['PRK', '1718', 'DPRK sanctions under resolution 1718'],
      ['LBY', '1970', 'Libya sanctions under resolution 1970'],
      ['YEM', '2140', 'Yemen sanctions under resolution 2140'],
      ['SSD', '2206', 'South Sudan sanctions under resolution 2206'],
    ],
  },
};

export function programmeRelations(kind, html) {
  const { actor, catalogue, path, rows } = LISTS[kind];
  const links =
    html === null
      ? null
      : new Set(
          Array.from(html.matchAll(/\bhref=["']([^"']+)["']/gi), ([, href]) =>
            URL.parse(href, catalogue)?.pathname.replace(/\/$/, ''),
          ),
        );
  const relations = rows.flatMap(([to, id, programme]) => {
    const pathname = path(id);
    if (links && !links.has(pathname)) return [];
    return makeRelation({
      id: 'rel_sanctions_' + kind + '_' + id,
      type: 'sanctions',
      directed: true,
      from: actor,
      ...(actor === 'UN' && { fromLabel: 'UN Security Council' }),
      to,
      programme,
      detail:
        'Country-linked sanctions programme. Measures may be selective, such as designations, restrictions or embargoes defined by the instrument.',
      sources: [new URL(pathname, catalogue).href, catalogue],
      dateChecked: CHECKED,
      reviewed: false,
    });
  });
  if (!relations.length)
    throw new Error(
      'No recognized country programmes in the ' + kind + ' catalogue',
    );
  return relations;
}

function adapter(kind, name) {
  return {
    shouldCheck(context) {
      return !context.data || releaseDue(context, monthIndex);
    },
    async fetchObservations({ fetchImpl, data }) {
      const signal = AbortSignal.timeout(20_000);
      const catalogue = LISTS[kind].catalogue;
      try {
        const response = await fetchResponse(fetchImpl, catalogue, signal);
        const html = await readResponseTextCapped(response, 3_000_000, signal);
        return relationResult(programmeRelations(kind, html), data, name);
      } catch (error) {
        if (kind !== 'un' || data) throw error;
        return {
          ...relationResult(
            programmeRelations(kind, null),
            data,
            name,
            'Last independently cited committee programmes.',
          ),
          error: error.message,
        };
      }
    },
  };
}

export const unSanctions = adapter('un', 'UN Security Council');
export const ukSanctions = adapter('uk', 'UK sanctions');
export const ofacSanctions = adapter('ofac', 'OFAC');
