import assert from 'node:assert/strict';
import test from 'node:test';
import { votingRelations } from './relationsVoting.js';

test('uses publisher country codes for the newest available agreement session', async () => {
  const codes =
    'ccode,iso3c,year\n2,USA,2024\n750,IND,2024\n710,CHN,2024\n710,CHN,2025';
  const lines = [
    '"","session.x","ccode1","ccode2","agree","year"',
    '"1",78,2,750,0.99,2023',
    '"2",79,2,750,0.55,2024',
    '"3",79,750,2,0.55,2024',
    '"4",79,750,710,0.39,2024',
    '"5",79,2,999,0.99,2024',
  ];
  const rows = await votingRelations(codes, lines, ['USA', 'IND', 'CHN']);
  assert.deepEqual(
    rows.map(({ from, to, agreement, session }) => [
      from,
      to,
      agreement,
      session,
    ]),
    [
      ['IND', 'USA', 0.55, 79],
      ['CHN', 'IND', 0.39, 79],
    ],
  );
});
