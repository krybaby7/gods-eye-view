import assert from 'node:assert/strict';
import test from 'node:test';
import { diplomacyAdapter, wikidataRelations } from './relationsWikidata.js';
const value = (value) => ({ value });
const binding = (iso, item, statement, extra = {}) =>
  Object.fromEntries(
    Object.entries({
      s: 'http://www.wikidata.org/entity/Q' + iso,
      iso,
      item: 'http://www.wikidata.org/entity/' + item,
      statement,
      ...extra,
    }).map(([key, val]) => [key, value(val)]),
  );

test('keeps qualifier precision and rejects non-member observer assertions', () => {
  const entries = [
    binding('TLS', 'Q7768', 'tls', {
      start: '2025-10-26T00:00:00Z',
      startPrecision: '11',
    }),
    binding('AUS', 'Q7768', 'aus'),
    binding('FIN', 'Q7184', 'fin', {
      start: '2023-01-01T00:00:00Z',
      startPrecision: '9',
    }),
  ];
  const rows = wikidataRelations('blocs', entries, ['TLS', 'AUS', 'FIN']);
  assert.equal(
    rows.find(({ from, to }) => from === 'TLS' && to === 'ASEAN').start,
    '2025-10-26',
  );
  assert.equal(
    rows.find(({ from, to }) => from === 'FIN' && to === 'NATO').start,
    '2023',
  );
  assert(!rows.some(({ from, to }) => from === 'AUS' && to === 'ASEAN'));
});

test('folds diplomatic assertions symmetrically, preserving qualified history and retrieval date', () => {
  const entries = [
    binding('IND', 'Q0', 'i', {
      other: 'CHN',
      start: '1950-01-01T00:00:00Z',
      startPrecision: '9',
    }),
    binding('CHN', 'Q0', 'c', { other: 'IND' }),
    binding('CHN', 'Q0', 'd', {
      other: 'IND',
      end: '1962-01-01T00:00:00Z',
      endPrecision: '9',
    }),
  ];
  const rows = wikidataRelations(
    'diplomacy',
    entries,
    ['IND', 'CHN'],
    new Date('2026-11-09'),
  );
  assert.deepEqual(
    rows.map(({ from, to, start, end }) => [from, to, start, end]),
    [
      ['CHN', 'IND', '1950', null],
      ['CHN', 'IND', null, '1962'],
    ],
  );
  assert(rows.every(({ type }) => type === 'diplomatic_relation'));
  assert(
    rows.every(
      ({ evidence, dateChecked }) =>
        evidence === 'wikidata-assertion' && dateChecked === '2026-11-09',
    ),
  );
});
test('diplomatic rows mark missing dates and retain month precision where available', () => {
  const rows = wikidataRelations(
    'diplomacy',
    [
      binding('IND', 'Q0', 'i', { other: 'CHN' }),
      binding('PAK', 'Q0', 'p', {
        other: 'CHN',
        start: '1951-05-01T00:00:00Z',
        startPrecision: '10',
      }),
    ],
    ['IND', 'CHN', 'PAK'],
  );
  assert.match(rows[0].detail, /undated/i);
  assert.equal(rows[1].start, '1951-05');
  assert.doesNotMatch(rows[1].detail, /undated/i);
});

test('a diplomacy version change relabels fresh saved rows and checks Wikidata when due', async () => {
  const bindingRow = binding('IND', 'Q0', 'i', { other: 'CHN' });
  const [saved] = wikidataRelations('diplomacy', [bindingRow], ['IND', 'CHN']);
  const now = new Date('2026-11-10');
  const context = {
    now,
    rederive: true,
    registry: { countries: [{ iso3: 'IND' }, { iso3: 'CHN' }] },
    data: { relations: [{ ...saved, detail: 'Legacy undated text' }] },
  };
  const fresh = await diplomacyAdapter.fetchObservations({
    ...context,
    lastCheckedAt: '2026-11-09',
    fetchImpl: () =>
      assert.fail('Fresh saved qualifiers need no upstream request'),
  });
  assert.equal(fresh.checkedRelease, false);
  assert.match(fresh.data.relations[0].detail, /^Undated/);
  let pulls = 0;
  const due = await diplomacyAdapter.fetchObservations({
    ...context,
    lastCheckedAt: '2026-11-01',
    fetchImpl: async () => {
      pulls++;
      return Response.json({ results: { bindings: [bindingRow] } });
    },
  });
  assert.equal(pulls, 1);
  assert.notEqual(due.checkedRelease, false);
});
