import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDiplomacy, relationsBetween } from './relations.js';

const relation = (type, from, to, extra = {}) => ({ type, from, to, ...extra });
const vote = (agreement, session = 80) =>
  relation('un_alignment', 'IND', 'PAK', { agreement, session });
const india = (rows) => classifyDiplomacy('IND', 'PAK', rows);

test('diplomacy uses precedence regardless of source order', () => {
  const partner = vote(0.8);
  const rival = vote(0.3, 81);
  const ally = relation('alliance', 'IND', 'PAK');
  const sanctions = relation('sanctions', 'PAK', 'IND', { directed: true });
  const war = relation('armed_conflict', 'IND', 'PAK');
  const rows = [war, sanctions, ally, rival, partner];
  assert.equal(india(rows.toReversed()), 'at-war');
  assert.equal(india(rows.slice(1)), 'sanctions');
  assert.equal(india(rows.slice(2)), 'ally');
  assert.equal(india(rows.slice(3)), 'rival');
  assert.equal(india(rows.slice(4)), 'partner');
});

test('missing evidence is unknown and active diplomatic contact supports neutral', () => {
  assert.equal(india([]), null);
  assert.equal(
    india([relation('diplomatic_relation', 'PAK', 'IND')]),
    'neutral',
  );
  assert.equal(india([vote(0.4)]), 'neutral');
  assert.equal(india([vote(0.799)]), 'neutral');
  assert.equal(india([relation('sanctions', 'UN', 'PAK')]), null);
  assert.equal(
    india([
      relation('armed_conflict', 'IND', 'ucdp:group', {
        hostCountries: ['PAK'],
      }),
    ]),
    null,
  );
  assert.equal(
    india([relation('armed_conflict', 'IND', 'PAK', { end: '2024' })]),
    null,
  );
});

test('multilateral scope makes NATO allies and Quad partners without projecting disputes or bloc membership', () => {
  const rows = [
    relation('alliance', 'NATO', 'NATO', {
      participants: ['USA', 'GBR', 'FRA'],
    }),
    relation('diplomatic_partnership', 'QUAD', 'QUAD', {
      participants: ['IND', 'AUS', 'USA', 'JPN'],
    }),
    relation('bloc_membership', 'IND', 'SCO'),
    relation('bloc_membership', 'PAK', 'SCO'),
    relation('territorial_dispute', 'IND', 'CHN', {
      participants: ['IND', 'CHN', 'PAK'],
    }),
  ];
  assert.equal(classifyDiplomacy('USA', 'GBR', rows), 'ally');
  assert.equal(classifyDiplomacy('IND', 'JPN', rows), 'partner');
  assert.equal(classifyDiplomacy('IND', 'PAK', rows), null);
  assert.equal(relationsBetween('USA', 'FRA', rows).length, 1);
  assert.equal(classifyDiplomacy('IND', 'IND', rows), null);
});
test('uses only opposing coalition members and excludes frozen CSTO participation', () => {
  const war = relation('armed_conflict', 'ucdp:coalition', 'PAK', {
    fromActors: ['USA', 'GBR'],
    toActors: ['PAK'],
  });
  const csto = relation('alliance', 'CSTO', 'CSTO', {
    participants: ['ARM', 'RUS', 'BLR'],
  });
  assert.equal(classifyDiplomacy('USA', 'GBR', [war]), null);
  assert.equal(classifyDiplomacy('GBR', 'PAK', [war]), 'at-war');
  assert.equal(classifyDiplomacy('ARM', 'RUS', [csto]), null);
  assert.equal(classifyDiplomacy('BLR', 'RUS', [csto]), 'ally');
});
