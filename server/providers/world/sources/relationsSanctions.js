import { readFile, stat } from 'node:fs/promises';
import programmes from '../../../../public/world/curated/sanctions-programmes.json' with { type: 'json' };
import { makeRelation, relationResult } from '../relations.js';
import { monthIndex, releaseDue } from './common.js';
import { csvRows } from './csv.js';
import { downloadWorldFile } from './download.js';
import { ukSanctionsRecords } from './ukSanctionsOdt.js';
import { zipEntryChunks } from './zip.js';

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
    read: ukSanctionsRecords,
  },
  ofac: {
    actor: 'USA',
    estimatedBytes: 5_900_000,
    url: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV',
    reference:
      'https://ofac.treasury.gov/specially-designated-nationals-list-sdn-list/program-tag-definitions-for-ofac-sanctions-lists',
    path: (id) => OFAC_PROGRAMMES + id,
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

function mappedRelation(kind, row, to, designationCount, dateChecked) {
  const { actor, reference, path } = lists[kind];
  const { id, programme, programmeId, scope } = row;
  const fallback = designationCount === undefined;
  const evidence = programmes[kind]?.scopeEvidence?.[programmeId];
  const stableId =
    kind === 'ofac'
      ? programmeId.toLowerCase().replaceAll(/[^a-z\d-]/g, '-') +
        (row.targets.length > 1 ? '_' + to.toLowerCase() : '')
      : id;
  return makeRelation({
    id: 'rel_sanctions_' + kind + '_' + stableId,
    type: 'sanctions',
    directed: true,
    from: actor,
    ...(actor === 'UN' && { fromLabel: 'UN Security Council' }),
    to,
    programme,
    programmeId,
    scope,
    ...(!fallback && { designationCount }),
    detail:
      (evidence?.detail ??
        (scope === 'state'
          ? 'Measures apply to a government or economic sector.'
          : 'This geographic programme targets designated persons, groups or specified regions.')) +
      ' ' +
      (fallback
        ? 'Independently cited committee evidence. A list count is unavailable.'
        : designationCount +
          ' designation record' +
          (designationCount === 1 ? '' : 's') +
          ' in the loaded publication under this programme.'),
    sources: [
      ...(evidence?.sources ?? []),
      path(id),
      programmes[kind]?.source ?? reference,
      reference,
    ].filter((url, index, all) => all.indexOf(url) === index),
    dateChecked,
    reviewed: false,
  });
}

function mappedProgrammes(kind) {
  if (kind === 'ofac')
    return programmes.ofac.mapped.flatMap(
      ([tags, targets, scope, programme, id]) =>
        tags.map((programmeId) => ({
          programmeId,
          targets,
          scope,
          programme,
          id,
        })),
    );
  if (kind === 'uk')
    return programmes.uk.mapped.map(([name, target, id, scope, tail]) => {
      const heading = `The ${name} (Sanctions) ${tail}`;
      const programmeId =
        name === 'Republic of Belarus'
          ? 'Belarus'
          : id === 'iran-nuclear'
            ? 'Iran (Nuclear)'
            : name;
      return {
        programmeId,
        aliases: [heading],
        targets: [target],
        scope,
        programme: programmeId + ' sanctions',
        id,
      };
    });
  return lists.un.rows.map(([programmeId, target, id, programme]) => ({
    programmeId,
    targets: [target],
    id,
    programme,
    scope: ['PRK', 'IRN'].includes(target) ? 'state' : 'persons',
  }));
}

export async function programmeRelations(kind, content, dateChecked = null) {
  const rows = mappedProgrammes(kind);
  const { read } = lists[kind];
  const known = new Map(
    rows.flatMap((row) =>
      [row.programmeId, ...(row.aliases ?? [])].map((name) => [
        normalize(name),
        row,
      ]),
    ),
  );
  const thematic = new Set((programmes[kind]?.thematic ?? []).map(normalize));
  const ids = new Set();
  const observed = new Map();
  const mappedRecords = new Set();
  for await (const [id, names] of read(content)) {
    ids.add(id);
    for (const name of names) {
      const key = normalize(name);
      if (!key) continue;
      const row = known.get(key);
      const canonical = row ? normalize(row.programmeId) : key;
      if (!observed.has(canonical)) observed.set(canonical, new Set());
      observed.get(canonical).add(id);
      if (row) mappedRecords.add(id);
    }
  }
  if (!ids.size || !observed.size)
    throw new Error(
      'Sanctions publication has no designation records with programme identifiers',
    );
  const mapped = rows.filter(({ programmeId }) =>
    observed.has(normalize(programmeId)),
  );
  const relations = mapped.flatMap((row) =>
    row.targets.map((target) =>
      mappedRelation(
        kind,
        row,
        target,
        observed.get(normalize(row.programmeId)).size,
        dateChecked,
      ),
    ),
  );
  const unmapped = [...observed.keys()]
    .filter((tag) => !known.has(tag) && !thematic.has(tag))
    .sort();
  const observedThematic = [...observed.keys()].filter((tag) =>
    thematic.has(tag),
  );
  const thematicDetails =
    kind === 'un' &&
    observedThematic.sort().map((programmeId) => ({
      programmeId,
      ...programmes.un.scopeEvidence[programmeId],
      dateChecked,
      reviewed: false,
    }));
  return {
    relations,
    coverage: {
      records: ids.size,
      mappedRecords: mappedRecords.size,
      programmes: observed.size,
      mappedProgrammes: mapped.length,
      thematicProgrammes: observedThematic.length,
      ...(thematicDetails && { thematicDetails }),
      unmappedProgrammes: unmapped.length,
      unmapped,
    },
  };
}

function adapter(kind, name) {
  const { estimatedBytes, url } = lists[kind];
  return {
    version: 3,
    estimatedBytes,
    downloadUrls: () => [url],
    shouldCheck(context) {
      return (
        context.rederive ||
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
      rederive,
    }) {
      try {
        const { path, lastModified } = await downloadWorldFile(url, {
          fetchImpl,
          cacheDirectory,
          onProgress,
          signal,
          maxBytes: MAX_BYTES,
          immutable: Boolean(rederive || !data),
          ...(kind === 'uk' && { format: 'zip' }),
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
        const modified = Date.parse(lastModified);
        const dateChecked = new Date(
          Number.isFinite(modified) ? modified : (await stat(path)).mtimeMs,
        )
          .toISOString()
          .slice(0, 10);
        const { relations, coverage } = await programmeRelations(
          kind,
          content,
          dateChecked,
        );
        const result = relationResult(
          relations,
          data,
          name,
          coverage.mappedProgrammes +
            ' mapped, ' +
            coverage.thematicProgrammes +
            ' thematic and ' +
            coverage.unmappedProgrammes +
            ' unmapped programmes across ' +
            coverage.records +
            ' published designation records.',
        );
        return {
          ...result,
          data: {
            ...result.data,
            coverage,
            dateChecked,
            format: 'published-list',
          },
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
            ? mappedProgrammes(kind)
                .filter(({ programmeId }) => UN_FALLBACK.has(programmeId))
                .map((row) => mappedRelation(kind, row, row.targets[0]))
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
