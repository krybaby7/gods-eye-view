import { TextDecoder } from 'node:util';
import supportMissions from '../../../../public/world/curated/ucdp-support-missions.json' with { type: 'json' };
import { makeRelation, relationResult } from '../relations.js';
import { columnIndices, csvRows } from './csv.js';
import { downloadWorldFile } from './download.js';
import { zipEntryChunks } from './zip.js';

const RELEASE = '26.1';
const YEAR = '2025';
const URLS = [
  'https://ucdp.uu.se/downloads/ucdpprio/ucdp-prio-acd-261-csv.zip',
  'https://ucdp.uu.se/downloads/dyadic/ucdp-dyadic-261-csv.zip',
];
const LIMIT = 10_000_000;
export const estimatedBytes = 100_000;
export const requestHost = 'ucdp.uu.se';
export const version = 3;
export const downloadUrls = () => URLS;
const DATASET = 'https://ucdp.uu.se/downloads/#armedconflict';
const HOUTHI = 'Government of Yemen (North Yemen)';
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
  'side_a_2nd',
  'side_b_2nd',
  'gwno_a_2nd',
  'gwno_b_2nd',
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
      if (government === HOUTHI) continue;
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
  const support = new Map();
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
    supportA,
    supportB,
    gwSupportA,
    gwSupportB,
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
        fromLabel: a === HOUTHI ? 'Houthi movement (' + HOUTHI + ')' : a,
        toLabel: b === HOUTHI ? 'Houthi movement (' + HOUTHI + ')' : b,
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
        sources: [DATASET],
        sourceVersion: RELEASE,
      }),
    );
    for (const [label, codes, party, partyLabel, partyId, direction] of [
      [supportA, gwSupportA, from, a, aId, 'a'],
      [supportB, gwSupportB, to, b, bId, 'b'],
    ]) {
      if (!label) continue;
      // UCDP identifies mission contributors in its conflict narrative. The
      // annual CSV lists all secondary supporters without their support reason.
      const mission = supportMissions.find(
        (row) =>
          row.release === RELEASE &&
          row.year === year &&
          row.conflictId === conflict &&
          row.supportedParty === party.actor,
      );
      const identity = party.actor.startsWith('ucdp:side:')
        ? 'coalition:' + (partyId || partyLabel)
        : party.actor;
      const end = episodes.get(conflict);
      for (const supporter of side(label, id, codes, names, id, direction)
        .actors) {
        const missionSupport =
          mission && !mission.otherSupporters.includes(supporter);
        const unMission = missionSupport ? mission.mission : undefined;
        const key = supporter + ':' + identity;
        const existing = support.get(key);
        if (existing) {
          if (!existing.dyadIds.includes(id)) existing.dyadIds.push(id);
          if (end === null || (existing.end !== null && end > existing.end))
            existing.end = end;
          if (existing.unMission !== unMission) {
            delete existing.unMission;
            delete existing.dateChecked;
            delete existing.reviewed;
          }
          if (missionSupport && !existing.sources.includes(mission.source))
            existing.sources.push(mission.source);
          continue;
        }
        support.set(
          key,
          makeRelation({
            id: 'rel_ucdp_support_' + id + '_' + direction + '_' + supporter,
            type: 'support_to_party',
            directed: true,
            from: supporter,
            to: party.actor,
            toActors: party.actors,
            toLabel:
              partyLabel === HOUTHI
                ? 'Houthi movement (' + HOUTHI + ')'
                : partyLabel,
            period: year,
            end,
            dyadIds: [id],
            ...(missionSupport && {
              unMission,
              dateChecked: mission.dateChecked,
              reviewed: mission.reviewed,
            }),
            detail:
              'UCDP ' +
              year +
              ' records the state as a secondary warring party supporting this side.',
            sources: missionSupport ? [DATASET, mission.source] : [DATASET],
            sourceVersion: RELEASE,
          }),
        );
      }
    }
  }
  if (!result.length)
    throw new Error('No UCDP dyads found in the expected annual release');
  return [...result, ...support.values()];
}

export function shouldCheck(context) {
  return context.rederive || context.data?.sourceVersion !== RELEASE;
}

async function readCsv(path, signal) {
  const decoder = new TextDecoder();
  let csv = '';
  for await (const chunk of zipEntryChunks(
    path,
    (name) => name.endsWith('.csv'),
    LIMIT,
    signal,
  )) {
    csv += decoder.decode(chunk, { stream: true });
  }
  return csv + decoder.decode();
}

export async function fetchObservations({
  fetchImpl,
  registry,
  data,
  cacheDirectory,
  onProgress,
  signal,
}) {
  const options = {
    fetchImpl,
    cacheDirectory,
    signal,
    immutable: true,
    format: 'zip',
    maxBytes: LIMIT,
  };
  const first = await downloadWorldFile(URLS[0], { ...options, onProgress });
  const second = await downloadWorldFile(URLS[1], {
    ...options,
    onProgress(progress) {
      onProgress?.({
        ...progress,
        bytes: first.bytes + progress.bytes,
        totalBytes:
          progress.totalBytes === null
            ? null
            : first.bytes + progress.totalBytes,
      });
    },
  });
  const conflict = await readCsv(first.path, signal);
  const dyads = await readCsv(second.path, signal);
  const result = relationResult(
    ucdpRelations(conflict, dyads, registry.countries),
    data,
    'UCDP',
  );
  result.data.sourceVersion = RELEASE;
  if (first.reused && second.reused) result.checkedRelease = false;
  return result;
}
