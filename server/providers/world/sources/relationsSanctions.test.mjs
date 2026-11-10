import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zipFixture } from './fixtures/zipFixture.mjs';
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

function ukOdt(regimes) {
  const paragraph = (...fields) =>
    '<text:p>' +
    fields.map((field) => '<text:span>' + field + '</text:span>').join('') +
    '</text:p>';
  return (
    '<office:document-content><office:body><office:text>' +
    paragraph('UK SANCTIONS LIST PUBLICATION') +
    regimes
      .map(
        ([regime, ids]) =>
          paragraph(regime) +
          paragraph('ENTITY') +
          ids
            .map(
              (id, index) =>
                paragraph(index + 1 + '.') +
                paragraph(
                  'Primary Name:',
                  'Synthetic alias in China',
                  'Unique Id:',
                  id,
                ),
            )
            .join(''),
      )
      .join('') +
    '</office:text></office:body></office:document-content>'
  );
}

const ukXml = ukOdt([
  [
    'THE RUSSIA (SANCTIONS) (EU EXIT) REGULATIONS 2019',
    ['RUS001', 'RUS001', 'RUS002'],
  ],
  [
    'THE GLOBAL HUMAN RIGHTS &amp; OTHER SANCTIONS REGULATIONS 2020',
    ['GHR001'],
  ],
  ['THE IRAN (SANCTIONS) REGULATIONS 2023', ['IRN001']],
  ['THE IRAN (SANCTIONS) (NUCLEAR) (EU EXIT) REGULATIONS 2019', ['IRN001']],
]);
const ukZip = zipFixture('content.xml', ukXml);
const ofacCsv =
  '1001,"Fixture vessel",Vessel,"CUBA] [SDGT",-0-,-0-,-0-,-0-,-0-,-0-,-0-,Panama\r\n' +
  '1002,"Fixture second entity",Entity,"RUSSIA-EO14024] [RUSSIA-EO14024",-0-,-0-,-0-,-0-,-0-,-0-,-0-,-0-\r\n' +
  '1003,"Fixture third entity",Entity,SDGT,-0-,-0-,-0-,-0-,-0-,-0-,-0-,Russia\r\n\x1a';

async function sanctionsCache(t) {
  const path = await mkdtemp(join(tmpdir(), 'world-sanctions-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('UN counts committee prefixes from permanent references in both sections', async () => {
  const result = await programmeRelations('un', await fixture('un.xml'));
  assert.deepEqual(result.coverage, {
    records: 3,
    mappedRecords: 2,
    programmes: 2,
    mappedProgrammes: 1,
    thematicProgrammes: 1,
    thematicDetails: [
      {
        programmeId: 'QD',
        programme: 'ISIL (Da’esh), Al-Qaida and associates',
        scope: 'persons',
        sources: ['https://main.un.org/securitycouncil/en/sanctions/1267'],
        dateChecked: null,
        reviewed: false,
      },
    ],
    unmapped: [],
    unmappedProgrammes: 0,
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
  const split = ukXml.indexOf('</text:p>') + 7;
  const result = await programmeRelations('uk', [
    Buffer.from(ukXml.slice(0, split)),
    Buffer.from(ukXml.slice(split)),
  ]);
  assert.deepEqual(result.coverage, {
    records: 4,
    mappedRecords: 3,
    programmes: 4,
    mappedProgrammes: 3,
    thematicProgrammes: 0,
    unmapped: ['THE GLOBAL HUMAN RIGHTS & OTHER SANCTIONS REGULATIONS 2020'],
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
  const result = await programmeRelations('ofac', ofacCsv);
  assert.deepEqual(result.coverage, {
    records: 3,
    mappedRecords: 2,
    programmes: 3,
    mappedProgrammes: 2,
    thematicProgrammes: 1,
    unmapped: [],
    unmappedProgrammes: 0,
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

test('an intact list with no covered programmes yields explicit zero coverage', async () => {
  const result = await programmeRelations('uk', [
    Buffer.from(
      ukOdt([['THE GLOBAL HUMAN RIGHTS SANCTIONS REGULATIONS 2020', ['A001']]]),
    ),
  ]);
  assert.equal(result.relations.length, 0);
  assert.equal(result.coverage.unmappedProgrammes, 0);
  assert.equal(result.coverage.thematicProgrammes, 1);
});

test('an unexpected or truncated publication rejects without accepting partial data', async () => {
  await assert.rejects(
    programmeRelations('uk', [Buffer.from('<html>Unavailable</html>')]),
    /UK Sanctions List/i,
  );
  await assert.rejects(
    programmeRelations('un', '<CONSOLIDATED_LIST>'),
    /consolidated list/i,
  );
  await assert.rejects(
    programmeRelations(
      'ofac',
      ofacCsv.replace(
        '1003,"Fixture third entity",Entity,SDGT',
        '1003,"Fixture third entity",Entity',
      ),
    ),
    /OFAC SDN designation/,
  );
  await assert.rejects(
    programmeRelations('uk', [
      Buffer.from(ukXml.replace('</office:document-content>', '')),
    ]),
    /incomplete UK Sanctions List/i,
  );
});

test('adapters request official compact list files and expose coverage summaries', async (t) => {
  const cacheDirectory = await sanctionsCache(t);
  for (const [adapter, body, url] of [
    [
      unSanctions,
      await fixture('un.xml'),
      'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
    ],
    [
      ukSanctions,
      ukZip,
      'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.odt',
    ],
    [
      ofacSanctions,
      ofacCsv,
      'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV',
    ],
  ]) {
    const progress = [];
    const result = await adapter.fetchObservations({
      cacheDirectory,
      onProgress: (event) => progress.push(event),
      fetchImpl: async (requested) => {
        assert.equal(requested, url);
        return new Response(body, {
          headers: { 'Last-Modified': 'Fri, 06 Nov 2026 19:33:18 GMT' },
        });
      },
    });
    assert.equal(result.data.format, 'published-list');
    assert.match(result.detail, /mapped.*unmapped/i);
    assert(
      result.data.relations.every(({ sources }) => !sources.includes(url)),
    );
    assert(
      result.data.relations.every(
        ({ dateChecked }) => dateChecked === '2026-11-06',
      ),
    );
    assert.equal(progress.at(-1)?.bytes, Buffer.byteLength(body));
  }
});

test('first UN failure keeps four cited committee rows with no published-list counts', async (t) => {
  const result = await unSanctions.fetchObservations({
    cacheDirectory: await sanctionsCache(t),
    fetchImpl: async () => new Response('', { status: 202 }),
  });
  assert.match(result.error, /HTTP 202/);
  assert.equal(result.data.format, 'committee-fallback');
  assert.equal(result.data.relations.length, 4);
  assert(
    result.data.relations.every(
      (row) => !Object.hasOwn(row, 'designationCount'),
    ),
  );
});

test('legacy catalogue state is refreshed immediately and failures never replace verified lists', async (t) => {
  const context = { now: new Date('2026-11-09'), lastCheckedAt: '2026-11-08' };
  const cacheDirectory = await sanctionsCache(t);
  assert.equal(
    ukSanctions.shouldCheck({ ...context, data: { relations: [] } }),
    true,
  );
  const good = await ukSanctions.fetchObservations({
    cacheDirectory,
    fetchImpl: async () => new Response(ukZip),
  });
  assert.equal(ukSanctions.shouldCheck({ ...context, data: good.data }), false);
  const fail = async () => new Response('', { status: 503 });
  await assert.rejects(
    ukSanctions.fetchObservations({
      fetchImpl: fail,
      data: good.data,
      cacheDirectory,
    }),
    /HTTP 503/,
  );
  const migrated = await ukSanctions.fetchObservations({
    fetchImpl: fail,
    cacheDirectory,
    data: { relations: [{ id: 'old-catalogue' }] },
  });
  assert.match(migrated.error, /HTTP 503/);
  assert.deepEqual(migrated.data, { relations: [], format: 'unavailable' });
});
test('exact UK and OFAC tags preserve targeted versus state scope and citations', async () => {
  const uk = await programmeRelations(
    'uk',
    [
      Buffer.from(
        ukOdt([
          ['THE IRAN (SANCTIONS) REGULATIONS 2023', ['IRN001']],
          ['THE SYRIA (SANCTIONS) (EU EXIT) REGULATIONS 2019', ['SYR001']],
        ]),
      ),
    ],
    '2026-11-10',
  );
  assert.deepEqual(
    uk.relations.map(({ to, scope }) => [to, scope]),
    [
      ['IRN', 'state'],
      ['SYR', 'state'],
    ],
  );
  assert.match(uk.relations[0].detail, /interception and monitoring services/);
  assert.match(uk.relations[1].detail, /2025/);
  const ofac = await programmeRelations(
    'ofac',
    ['SSIDES', 'UKRAINE-EO13660', 'BELARUS-EO14038']
      .map(
        (tag, index) =>
          `${index + 1},fixture,Entity,${tag},-0-,-0-,-0-,-0-,-0-,-0-,-0-,-0-`,
      )
      .join('\n'),
    '2026-11-10',
  );
  assert.deepEqual(
    ofac.relations
      .map(({ programmeId, to, scope }) => [programmeId, to, scope])
      .sort(),
    [
      ['BELARUS-EO14038', 'BLR', 'persons'],
      ['SSIDES', 'RUS', 'persons'],
      ['UKRAINE-EO13660', 'RUS', 'persons'],
    ],
  );
  assert.ok(
    ofac.relations
      .find(({ programmeId }) => programmeId === 'BELARUS-EO14038')
      .sources.includes('https://ofac.treasury.gov/recent-actions/20260326'),
  );
});

test('UN covers QD, SO and TA committee programmes without creating country sanctions', async () => {
  const result = await programmeRelations(
    'un',
    `<CONSOLIDATED_LIST>${['QDi.1', 'SOe.1', 'TAi.1']
      .map(
        (reference) =>
          `<INDIVIDUAL><REFERENCE_NUMBER>${reference}</REFERENCE_NUMBER></INDIVIDUAL>`,
      )
      .join('')}</CONSOLIDATED_LIST>`,
  );
  assert.deepEqual(result.relations, []);
  assert.deepEqual(result.coverage.unmapped, []);
  assert.deepEqual(
    result.coverage.thematicDetails.map(({ programmeId, scope }) => [
      programmeId,
      scope,
    ]),
    [
      ['QD', 'persons'],
      ['SO', 'persons'],
      ['TA', 'persons'],
    ],
  );
});
