import assert from 'node:assert/strict';
import test from 'node:test';
import { programmeRelations } from './relationsSanctions.js';

test('emits only documented targeted programme records and keeps direction', () => {
  const html =
    '<a href="/government/publications/russia-sanctions-guidance">Russia</a><a href="/guidance/global-human-rights">Nationality or address in China</a>';
  const rows = programmeRelations('uk', html);
  assert.deepEqual(
    rows.map(({ from, to, directed }) => [from, to, directed]),
    [['GBR', 'RUS', true]],
  );
  assert.match(rows[0].detail, /selective/i);
  assert.equal(rows[0].reviewed, false);
});

test('does not turn an empty or unrecognized catalogue into a complete empty result', () => {
  assert.throws(
    () => programmeRelations('uk', '<html>Unavailable</html>'),
    /no recognized/i,
  );
});
