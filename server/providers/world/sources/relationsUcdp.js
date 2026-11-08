import { TextDecoder } from 'node:util';
import { readResponseBytesCapped } from '../../common/http.js';
import { makeRelation, relationResult } from '../relations.js';
import { fetchResponse } from './common.js';
import { columnIndices, csvRows } from './csv.js';
import { zipEntryChunks } from './zip.js';

const RELEASE = '26.1';
const YEAR = '2025';
const URLS = [
  'https://ucdp.uu.se/downloads/ucdpprio/ucdp-prio-acd-261-csv.zip',
  'https://ucdp.uu.se/downloads/dyadic/ucdp-dyadic-261-csv.zip',
];
const LIMIT = 10_000_000;
const NAME_ALIASES = {
  'Central African Republic': 'CAF',
  'DR Congo': 'COD',
  Myanmar: 'MMR',
  'United States of America': 'USA',
  Russia: 'RUS',
  Syria: 'SYR',
  Iran: 'IRN',
  Turkey: 'TUR',
  Yemen: 'YEM',
  'South Sudan': 'SSD',
  'Bosnia-Herzegovina': 'BIH',
};
const FIELDS = [
  'dyad_id',
  'conflict_id',
  'location',
  'side_a',
  'side_a_id',
  'side_b',
  'side_b_id',
  'year',
  'intensity_level',
  'type_of_conflict',
  'start_date2',
  'start_prec2',
  'gwno_a',
  'gwno_b',
];

function* records(csv, fields) {
  const rows = csvRows(csv);
  const indices = columnIndices(rows.next().value, fields);
  for (const row of rows) yield indices.map((index) => row[index]);
}

function dateAtPrecision(date, precision) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return date.slice(0, precision === '1' ? 10 : precision === '2' ? 7 : 4);
}

function side(label, id, gwno, names, dyadId, direction) {
  const states = new Set();
  if (gwno?.trim()) {
    for (const government of label.split(/,\s+(?=Government of )/)) {
      const name = government
        .replace(/^Government of /, '')
        .replace(/\s+\([^)]*\)$/, '');
      const iso3 = NAME_ALIASES[name] ?? names.get(name);
      if (iso3) states.add(iso3);
    }
  }
  const actors = [...states];
  const coalition = gwno?.split(',').length > 1;
  return {
    actor:
      !coalition && actors.length === 1
        ? actors[0]
        : coalition
          ? 'ucdp:side:' + dyadId + ':' + direction
          : 'ucdp:actor:' + id,
    actors,
  };
}

export function ucdpRelations(conflictCsv, dyadCsv, countries) {
  const names = new Map(
    countries
      .filter(({ kind }) => kind === 'state')
      .map(({ iso3, name }) => [name, iso3]),
  );
  const episodes = new Map();
  for (const [id, year, ended, date, precision, version] of records(
    conflictCsv,
    ['conflict_id', 'year', 'ep_end', 'ep_end_date', 'ep_end_prec', 'version'],
  )) {
    if (year === YEAR && version === RELEASE)
      episodes.set(
        id,
        ended === '1' ? (dateAtPrecision(date, precision) ?? year) : null,
      );
  }
  const result = [];
  for (const [
    id,
    conflict,
    location,
    a,
    aId,
    b,
    bId,
    year,
    intensity,
    kind,
    start,
    precision,
    gwA,
    gwB,
  ] of records(dyadCsv, FIELDS)) {
    if (
      year !== YEAR ||
      !episodes.has(conflict) ||
      !['1', '2'].includes(intensity)
    )
      continue;
    const from = side(a, aId, gwA, names, id, 'a');
    const to = side(b, bId, gwB, names, id, 'b');
    result.push(
      makeRelation({
        id: 'rel_ucdp_' + id,
        type: 'armed_conflict',
        from: from.actor,
        to: to.actor,
        fromActors: from.actors,
        toActors: to.actors,
        fromLabel: a,
        toLabel: b,
        start: dateAtPrecision(start, precision),
        end: episodes.get(conflict),
        period: year,
        detail:
          'UCDP ' +
          year +
          ' dyad ' +
          id +
          ' in conflict ' +
          conflict +
          ' (' +
          location +
          '). ' +
          (intensity === '2'
            ? 'War intensity in the dataset (at least 1,000 battle-related deaths).'
            : 'Reached the 25 battle-related death inclusion threshold.'),
        conditions:
          'Annual record. The latest release covers activity in ' +
          year +
          '. The episode end is the conflict-level end where reported.',
        conflictKind: kind,
        sources: ['https://ucdp.uu.se/downloads/#armedconflict', ...URLS],
        sourceVersion: RELEASE,
      }),
    );
  }
  if (!result.length)
    throw new Error('No UCDP dyads found in the expected annual release');
  return result;
}

export function shouldCheck(context) {
  return context.data?.sourceVersion !== RELEASE;
}

async function readCsv(fetchImpl, url, signal) {
  const response = await fetchResponse(fetchImpl, url, signal);
  const bytes = await readResponseBytesCapped(response, LIMIT, signal);
  const decoder = new TextDecoder();
  let csv = '';
  for await (const chunk of zipEntryChunks(
    bytes,
    (name) => name.endsWith('.csv'),
    LIMIT,
  )) {
    csv += decoder.decode(chunk, { stream: true });
  }
  return csv + decoder.decode();
}

export async function fetchObservations({ fetchImpl, registry, data }) {
  const signal = AbortSignal.timeout(40_000);
  const conflict = await readCsv(fetchImpl, URLS[0], signal);
  const dyads = await readCsv(fetchImpl, URLS[1], signal);
  const result = relationResult(
    ucdpRelations(conflict, dyads, registry.countries),
    data,
    'UCDP',
  );
  result.data.sourceVersion = RELEASE;
  return result;
}
