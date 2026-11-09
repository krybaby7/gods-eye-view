import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  programmeRelations,
  unSanctions,
  ukSanctions,
  ofacSanctions,
} from './relationsSanctions.js';

async function fixture(name) {
  return readFile(
    new URL('./fixtures/relations-sanctions-' + name, import.meta.url),
    'utf8',
  );
}

test('UN counts committee prefixes from permanent references in both sections', async () => {
  const result = programmeRelations('un', await fixture('un.xml'));
  assert.deepEqual(result.coverage, {
    records: 3,
    mappedRecords: 2,
    programmes: 2,
    mappedProgrammes: 1,
    unmappedProgrammes: 1,
  });
  assert.deepEqual(
    result.relations.map(
      ({ from, to, directed, programmeId, designationCount }) => [
        from,
        to,
        directed,
        programmeId,
        designationCount,
      ],
    ),
    [['UN', 'PRK', true, 'KP', 2]],
  );
  assert.equal(result.relations[0].reviewed, false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /Fixture individual|KPi\.123|Japan|Malaysia/,
  );
});

test('UK counts unique designation IDs within each listed regime', async () => {
  const result = programmeRelations('uk', await fixture('uk.csv'));
  assert.deepEqual(result.coverage, {
    records: 4,
    mappedRecords: 3,
    programmes: 4,
    mappedProgrammes: 3,
    unmappedProgrammes: 1,
  });
  assert.deepEqual(
    result.relations
      .map(({ to, designationCount }) => [to, designationCount])
      .sort(),
    [
      ['IRN', 1],
      ['IRN', 1],
      ['RUS', 2],
    ],
  );
  assert.doesNotMatch(JSON.stringify(result), /Synthetic|RUS001|Ukraine|Oman/);
});

test('OFAC uses only list programme tags and de-duplicates repeated tags', async () => {
  const result = programmeRelations('ofac', await fixture('ofac.xml'));
  assert.deepEqual(result.coverage, {
    records: 3,
    mappedRecords: 2,
    programmes: 3,
    mappedProgrammes: 2,
    unmappedProgrammes: 1,
  });
  assert.deepEqual(
    result.relations.map(({ to, programmeId, designationCount }) => [
      to,
      programmeId,
      designationCount,
    ]),
    [
      ['CUB', 'CUBA', 1],
      ['RUS', 'RUSSIA-EO14024', 1],
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /Fixture vessel|1001|Panama|SDGT/,
  );
});

test('an intact list with no covered programmes yields explicit zero coverage', () => {
  const result = programmeRelations(
    'uk',
    'Unique ID,Regime Name,Nationality\nA001,Global Human Rights,Russia',
  );
  assert.equal(result.relations.length, 0);
  assert.equal(result.coverage.unmappedProgrammes, 1);
});

test('an unexpected or truncated publication rejects without accepting partial data', async () => {
  assert.throws(
    () => programmeRelations('uk', '<html>Unavailable</html>'),
    /header/i,
  );
  assert.throws(
    () => programmeRelations('un', '<CONSOLIDATED_LIST>'),
    /consolidated list/i,
  );
  const ofac = (await fixture('ofac.xml')).replace(
    '<Record_Count>3</Record_Count>',
    '<Record_Count>4</Record_Count>',
  );
  assert.throws(() => programmeRelations('ofac', ofac), /record count/i);
});

test('adapters request official published list files and expose coverage summaries', async () => {
  for (const [adapter, file, url] of [
    [
      unSanctions,
      'un.xml',
      'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
    ],
    [
      ukSanctions,
      'uk.csv',
      'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv',
    ],
    [
      ofacSanctions,
      'ofac.xml',
      'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML',
    ],
  ]) {
    const result = await adapter.fetchObservations({
      fetchImpl: async (requested) => {
        assert.equal(requested, url);
        return new Response(await fixture(file));
      },
    });
    assert.equal(result.data.format, 'published-list');
    assert.match(result.detail, /mapped.*unmapped/i);
    assert(result.data.relations.every(({ sources }) => sources.includes(url)));
  }
});

test('first UN failure keeps four cited committee rows with no published-list counts', async () => {
  const result = await unSanctions.fetchObservations({
    fetchImpl: async () => new Response('', { status: 202 }),
  });
  assert.match(result.error, /consolidated list/i);
  assert.equal(result.data.format, 'committee-fallback');
  assert.equal(result.data.relations.length, 4);
  assert(
    result.data.relations.every(
      (row) => !Object.hasOwn(row, 'designationCount'),
    ),
  );
});

test('legacy catalogue state is refreshed immediately and failures never replace verified lists', async () => {
  const context = { now: new Date('2026-11-09'), lastCheckedAt: '2026-11-08' };
  assert.equal(
    ukSanctions.shouldCheck({ ...context, data: { relations: [] } }),
    true,
  );
  const good = await ukSanctions.fetchObservations({
    fetchImpl: async () => new Response(await fixture('uk.csv')),
  });
  assert.equal(ukSanctions.shouldCheck({ ...context, data: good.data }), false);
  const fail = async () => new Response('', { status: 503 });
  await assert.rejects(
    ukSanctions.fetchObservations({ fetchImpl: fail, data: good.data }),
    /HTTP 503/,
  );
  const migrated = await ukSanctions.fetchObservations({
    fetchImpl: fail,
    data: { relations: [{ id: 'old-catalogue' }] },
  });
  assert.match(migrated.error, /HTTP 503/);
  assert.deepEqual(migrated.data, { relations: [], format: 'unavailable' });
});
