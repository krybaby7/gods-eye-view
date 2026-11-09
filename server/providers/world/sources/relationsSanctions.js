import { readFile } from 'node:fs/promises';
import { makeRelation, relationResult } from '../relations.js';
import { monthIndex, releaseDue } from './common.js';
import { csvRows } from './csv.js';
import { downloadWorldFile } from './download.js';
import { ukSanctionsRecords } from './ukSanctionsOdt.js';
import { zipEntryChunks } from './zip.js';

const CHECKED = '2026-11-09';
const MAX_BYTES = 75_000_000;
const UK_XML_LIMIT = 50_000_000;
const UN_COMMITTEES = 'https://main.un.org/securitycouncil/en/sanctions/';
const UK_PUBLICATIONS = 'https://www.gov.uk/government/publications/';
const OFAC_PROGRAMMES =
  'https://ofac.treasury.gov/sanctions-programs-and-country-information/';
const UN_FALLBACK = new Set(['KP', 'LY', 'YE', 'SS']);

const lists = {
  un: {
    actor: 'UN',
    estimatedBytes: 2_200_000,
    url: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
    reference:
      'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list',
    path: (id) => UN_COMMITTEES + id,
    rows: [
      ['KP', 'PRK', '1718', 'DPRK sanctions under resolution 1718'],
      ['LY', 'LBY', '1970', 'Libya sanctions under resolution 1970'],
      ['YE', 'YEM', '2140', 'Yemen sanctions under resolution 2140'],
      ['SS', 'SSD', '2206', 'South Sudan sanctions under resolution 2206'],
      ['IQ', 'IRQ', '1518', 'Iraq sanctions under resolution 1518'],
      ['CD', 'COD', '1533', 'DR Congo sanctions under resolution 1533'],
      ['SD', 'SDN', '1591', 'Sudan sanctions under resolution 1591'],
      ['IR', 'IRN', '1737', 'Iran sanctions under resolution 1737'],
      ['GB', 'GNB', '2048', 'Guinea-Bissau sanctions under resolution 2048'],
      ['HT', 'HTI', '2653', 'Haiti sanctions under resolution 2653'],
      [
        'CF',
        'CAF',
        '2745',
        'Central African Republic sanctions under resolution 2745',
      ],
    ],
    read: unRecords,
  },
  uk: {
    actor: 'GBR',
    estimatedBytes: 1_400_000,
    url: 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.odt',
    reference: UK_PUBLICATIONS + 'the-uk-sanctions-list',
    path: (id) => UK_PUBLICATIONS + id + '-sanctions-guidance',
    rows: [
      [
        'Belarus',
        'BLR',
        'republic-of-belarus',
        'Belarus sanctions',
        ['The Republic of Belarus (Sanctions) (EU Exit) Regulations 2019'],
      ],
      [
        'Iran',
        'IRN',
        'iran',
        'Iran sanctions',
        ['The Iran (Sanctions) Regulations 2023'],
      ],
      [
        'Iran (Nuclear)',
        'IRN',
        'iran-nuclear',
        'Iran nuclear sanctions',
        ['The Iran (Sanctions) (Nuclear) (EU Exit) Regulations 2019'],
      ],
      [
        "Democratic People's Republic of Korea",
        'PRK',
        'democratic-peoples-republic-of-korea',
        'DPRK sanctions',
        [
          "The Democratic People's Republic of Korea (Sanctions) (EU Exit) Regulations 2019",
        ],
      ],
      [
        'Myanmar',
        'MMR',
        'myanmar',
        'Myanmar sanctions',
        ['The Myanmar (Sanctions) Regulations 2021'],
      ],
      [
        'Russia',
        'RUS',
        'russia',
        'Russia sanctions',
        ['The Russia (Sanctions) (EU Exit) Regulations 2019'],
      ],
      [
        'Venezuela',
        'VEN',
        'venezuela',
        'Venezuela sanctions',
        ['The Venezuela (Sanctions) (EU Exit) Regulations 2019'],
      ],
      [
        'Libya',
        'LBY',
        'libya',
        'Libya sanctions',
        ['The Libya (Sanctions) (EU Exit) Regulations 2020'],
      ],
      [
        'Sudan',
        'SDN',
        'sudan',
        'Sudan sanctions',
        ['The Sudan (Sanctions) (EU Exit) Regulations 2020'],
      ],
      [
        'South Sudan',
        'SSD',
        'south-sudan',
        'South Sudan sanctions',
        ['The South Sudan (Sanctions) (EU Exit) Regulations 2019'],
      ],
    ],
    read: ukSanctionsRecords,
  },
  ofac: {
    actor: 'USA',
    estimatedBytes: 5_900_000,
    url: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV',
    reference:
      'https://ofac.treasury.gov/specially-designated-nationals-list-sdn-list/program-tag-definitions-for-ofac-sanctions-lists',
    path: (id) => OFAC_PROGRAMMES + id,
    rows: [
      ['BELARUS', 'BLR', 'belarus-sanctions', 'Belarus sanctions'],
      ['BELARUS-EO14038', 'BLR', 'belarus-sanctions', 'Belarus sanctions'],
      ['CUBA', 'CUB', 'cuba-sanctions', 'Cuba sanctions'],
      ['IRAN', 'IRN', 'iran-sanctions', 'Iran sanctions'],
      ['IRAN-EO13846', 'IRN', 'iran-sanctions', 'Iran sanctions'],
      ['DPRK', 'PRK', 'north-korea-sanctions', 'North Korea sanctions'],
      ['DPRK2', 'PRK', 'north-korea-sanctions', 'North Korea sanctions'],
      ['DPRK3', 'PRK', 'north-korea-sanctions', 'North Korea sanctions'],
      ['DPRK4', 'PRK', 'north-korea-sanctions', 'North Korea sanctions'],
      ['BURMA-EO14014', 'MMR', 'burma', 'Burma sanctions'],
      [
        'RUSSIA-EO14024',
        'RUS',
        'russian-harmful-foreign-activities-sanctions',
        'Russian harmful foreign activities sanctions',
      ],
      [
        'VENEZUELA',
        'VEN',
        'venezuela-related-sanctions',
        'Venezuela-related sanctions',
      ],
      [
        'VENEZUELA-EO13884',
        'VEN',
        'venezuela-related-sanctions',
        'Venezuela-related sanctions',
      ],
    ],
    read: ofacRecords,
  },
};

function normalize(value) {
  return value
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function requireXml(text, root, label) {
  const content = text.trim();
  const opening = new RegExp(
    '^(?:<\\?xml[^?]*\\?>\\s*)?<' + root + '(?:\\s|>)',
  );
  if (!opening.test(content) || !content.endsWith('</' + root + '>')) {
    throw new Error('Unexpected or incomplete ' + label);
  }
}

function* unRecords(text) {
  requireXml(text, 'CONSOLIDATED_LIST', 'UN consolidated list');
  const refs = [
    ...text.matchAll(
      /<REFERENCE_NUMBER>\s*([A-Z]{2}[ie]\.\d+)\s*<\/REFERENCE_NUMBER>/g,
    ),
  ];
  const entries = [...text.matchAll(/<(?:INDIVIDUAL|ENTITY)(?:\s|>)/g)].length;
  if (!entries || refs.length !== entries)
    throw new Error(
      'UN consolidated list reference count did not match its records',
    );
  for (const [, ref] of refs) yield [ref, [ref.slice(0, 2)]];
}

function* ofacRecords(text) {
  // The legacy primary file has no header. ENT_NUM is field 1 and Program is
  // field 4, with multiple tags separated by "] [" and an optional DOS EOF.
  for (const row of csvRows(text.replace(/\x1a\s*$/, ''))) {
    const [id, , , programs] = row;
    if (row.length !== 12 || !/^\d+$/.test(id) || !programs?.trim())
      throw new Error('Unexpected OFAC SDN designation record');
    yield [id, programs.split(/\]\s*\[/)];
  }
}

function mappedRelation(kind, row, programmeId, designationCount) {
  const { actor, url, reference, path } = lists[kind];
  const [, to, id, programme] = row;
  const fallback = designationCount === undefined;
  const stableId = kind === 'ofac' ? programmeId.toLowerCase() : id;
  return makeRelation({
    id: 'rel_sanctions_' + kind + '_' + stableId,
    type: 'sanctions',
    directed: true,
    from: actor,
    ...(actor === 'UN' && { fromLabel: 'UN Security Council' }),
    to,
    programme,
    programmeId,
    ...(!fallback && { designationCount }),
    detail:
      'Country-linked sanctions programme. Measures may be selective. ' +
      (fallback
        ? 'Independently cited committee evidence. A list count is unavailable.'
        : designationCount +
          ' designation record' +
          (designationCount === 1 ? '' : 's') +
          ' in the loaded publication under this programme.'),
    sources: fallback ? [path(id), reference] : [path(id), reference, url],
    dateChecked: CHECKED,
    reviewed: false,
  });
}

export async function programmeRelations(kind, content) {
  const { rows, read } = lists[kind];
  const known = new Map();
  for (const row of rows) {
    for (const name of [row[0], ...(row[4] ?? [])])
      known.set(normalize(name), row);
  }
  const ids = new Set();
  const observed = new Map();
  const mappedRecords = new Set();
  for await (const [id, names] of read(content)) {
    ids.add(id);
    for (const name of names) {
      const key = normalize(name);
      if (!key) continue;
      const row = known.get(key);
      const canonical = row ? normalize(row[0]) : key;
      if (!observed.has(canonical)) observed.set(canonical, new Set());
      observed.get(canonical).add(id);
      if (row) mappedRecords.add(id);
    }
  }
  if (!ids.size || !observed.size)
    throw new Error(
      'Sanctions publication has no designation records with programme identifiers',
    );
  const relations = rows.flatMap((row) => {
    const count = observed.get(normalize(row[0]))?.size;
    return count ? [mappedRelation(kind, row, row[0], count)] : [];
  });
  return {
    relations,
    coverage: {
      records: ids.size,
      mappedRecords: mappedRecords.size,
      programmes: observed.size,
      mappedProgrammes: relations.length,
      unmappedProgrammes: observed.size - relations.length,
    },
  };
}

function adapter(kind, name) {
  const { estimatedBytes, url } = lists[kind];
  return {
    estimatedBytes,
    shouldCheck(context) {
      return (
        context.data?.format !== 'published-list' ||
        releaseDue(context, monthIndex)
      );
    },
    async fetchObservations({
      fetchImpl,
      data,
      cacheDirectory,
      onProgress,
      signal,
    }) {
      try {
        const { path } = await downloadWorldFile(url, {
          fetchImpl,
          cacheDirectory,
          onProgress,
          signal,
          maxBytes: MAX_BYTES,
        });
        const content =
          kind === 'uk'
            ? zipEntryChunks(
                path,
                (entry) => entry === 'content.xml',
                UK_XML_LIMIT,
                signal,
              )
            : await readFile(path, { encoding: 'utf8', signal });
        const { relations, coverage } = await programmeRelations(kind, content);
        const result = relationResult(
          relations,
          data,
          name,
          coverage.mappedProgrammes +
            ' mapped and ' +
            coverage.unmappedProgrammes +
            ' unmapped programmes across ' +
            coverage.records +
            ' published designation records.',
        );
        return {
          ...result,
          data: { ...result.data, coverage, format: 'published-list' },
        };
      } catch (error) {
        if (
          data?.format === 'published-list' ||
          data?.format === 'committee-fallback'
        )
          throw error;
        if (kind !== 'un' && !data) throw error;
        const relations =
          kind === 'un'
            ? lists.un.rows
                .filter(([prefix]) => UN_FALLBACK.has(prefix))
                .map((row) => mappedRelation(kind, row, row[0]))
            : [];
        const result = relationResult(
          relations,
          data,
          name,
          kind === 'un'
            ? 'Initial committee fallback. Published-list coverage is unavailable.'
            : 'Published-list coverage is unavailable.',
        );
        return {
          ...result,
          data: {
            ...result.data,
            format: kind === 'un' ? 'committee-fallback' : 'unavailable',
          },
          error: error.message,
        };
      }
    },
  };
}

export const unSanctions = adapter('un', 'UN Security Council');
export const ukSanctions = adapter('uk', 'UK sanctions');
export const ofacSanctions = adapter('ofac', 'OFAC');
