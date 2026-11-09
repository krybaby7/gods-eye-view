import { TextDecoder } from 'node:util';
import { readResponseTextCapped } from '../../common/http.js';
import { makeRelation, relationResult } from '../relations.js';
import { fetchResponse } from './common.js';
import { columnIndices, csvRows } from './csv.js';

const RELEASE = '39';
const YEAR = '2024';
const SESSION = 79;
const DOI = 'https://doi.org/10.7910/DVN/LEJUQZ';
const AGREEMENT = 'https://dataverse.harvard.edu/api/access/datafile/11837234';
const IDEAL_POINTS =
  'https://dataverse.harvard.edu/api/access/datafile/14098429';
const LIMIT = 170_000_000;

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

export async function fetchObservations({ fetchImpl, registry, data }) {
  const signal = AbortSignal.timeout(180_000);
  const codes = await readResponseTextCapped(
    await fetchResponse(fetchImpl, IDEAL_POINTS, signal),
    3_000_000,
    signal,
  );
  const response = await fetchResponse(fetchImpl, AGREEMENT, signal);
  if (
    Number(response.headers.get('content-length')) > LIMIT ||
    !response.body
  ) {
    await response.body?.cancel();
    throw new Error('Unexpected Voeten agreement download size');
  }
  async function* boundedLines() {
    const decoder = new TextDecoder();
    let bytes = 0;
    let pending = '';
    for await (const chunk of response.body) {
      signal.throwIfAborted();
      bytes += chunk.byteLength;
      if (bytes > LIMIT)
        throw new Error('Voeten agreement download exceeds size limit');
      const lines = (pending + decoder.decode(chunk, { stream: true })).split(
        '\n',
      );
      pending = lines.pop();
      if (pending.length > 64_000)
        throw new Error('Voeten agreement CSV line exceeds size limit');
      yield* lines;
    }
    pending += decoder.decode();
    if (pending) yield pending;
  }
  const relations = await votingRelations(
    codes,
    boundedLines(),
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
