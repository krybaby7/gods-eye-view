import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { makeRelation, relationResult } from '../relations.js';
import { columnIndices, csvRecords, csvRows } from './csv.js';
import { downloadWorldFile } from './download.js';

const RELEASE = '39';
const YEAR = '2024';
const SESSION = 79;
const DOI = 'https://doi.org/10.7910/DVN/LEJUQZ';
const AGREEMENT = 'https://dataverse.harvard.edu/api/access/datafile/11837234';
const IDEAL_POINTS =
  'https://dataverse.harvard.edu/api/access/datafile/14098429';
const LIMIT = 170_000_000;

export const estimatedBytes = 147_000_000;

export async function votingRelations(idealPoints, lines, countryIds) {
  const countries = new Set(countryIds);
  const codeRows = csvRows(idealPoints);
  const [code, iso, year] = columnIndices(codeRows.next().value, [
    'ccode',
    'iso3c',
    'year',
  ]);
  const mapping = new Map();
  for (const row of codeRows) {
    if (row[year] === YEAR && countries.has(row[iso]))
      mapping.set(row[code], row[iso]);
  }

  const pairs = new Map();
  let indices;
  for await (const line of lines) {
    if (!indices) {
      indices = columnIndices(csvRows(line).next().value, [
        'session.x',
        'ccode1',
        'ccode2',
        'agree',
        'year',
      ]);
      continue;
    }
    // The original CSV puts the session immediately after its numeric row ID.
    if (!/^"?\d+"?,79,/.test(line)) continue;
    const row = csvRows(line).next().value;
    const [session, codeA, codeB, raw, period] = indices.map(
      (index) => row[index],
    );
    const a = mapping.get(codeA);
    const b = mapping.get(codeB);
    const agreement = raw?.trim() ? Number(raw) : NaN;
    if (
      Number(session) !== SESSION ||
      period !== YEAR ||
      !a ||
      !b ||
      a === b ||
      !(agreement >= 0 && agreement <= 1)
    )
      continue;
    const [from, to] = [a, b].sort();
    const id = 'rel_un_vote_' + from + '_' + to;
    pairs.set(
      id,
      makeRelation({
        id,
        type: 'un_alignment',
        from,
        to,
        agreement,
        session: SESSION,
        period,
        detail:
          'United Nations General Assembly agreement on final passage votes.',
        sources: [DOI, AGREEMENT],
        sourceVersion: RELEASE,
      }),
    );
  }
  if (!pairs.size)
    throw new Error('No Voeten agreement rows found for session ' + SESSION);
  return [...pairs.values()];
}

export function shouldCheck({ data }) {
  return data?.sourceVersion !== RELEASE;
}

export async function fetchObservations({
  fetchImpl,
  registry,
  data,
  cacheDirectory,
  onProgress,
  signal,
}) {
  const options = { fetchImpl, cacheDirectory, signal, immutable: true };
  const mapping = await downloadWorldFile(IDEAL_POINTS, {
    ...options,
    maxBytes: 3_000_000,
  });
  const codes = await readFile(mapping.path, { encoding: 'utf8', signal });
  const agreement = await downloadWorldFile(AGREEMENT, {
    ...options,
    maxBytes: LIMIT,
    onProgress,
  });
  const relations = await votingRelations(
    codes,
    csvRecords(createReadStream(agreement.path, { signal })),
    registry.countries.map(({ iso3 }) => iso3),
  );
  const result = relationResult(
    relations,
    data,
    'Voeten UN voting',
    'AgreementScores.csv ends at session 79 (2024) in Dataverse v39.',
  );
  result.data.sourceVersion = RELEASE;
  return result;
}
