import assert from 'node:assert/strict';
import test from 'node:test';
import { wikidataRelations } from './relationsWikidata.js';
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

test('folds diplomatic seeds symmetrically, preserving qualified history', () => {
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
  const rows = wikidataRelations('diplomacy', entries, ['IND', 'CHN']);
  assert.deepEqual(
    rows.map(({ from, to, start, end }) => [from, to, start, end]),
    [
      ['CHN', 'IND', '1950', null],
      ['CHN', 'IND', null, '1962'],
    ],
  );
  assert(rows.every(({ type }) => type === 'diplomatic_relation'));
});
