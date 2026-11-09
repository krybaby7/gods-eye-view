import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyDiplomacy,
  currentRelations,
  relationsBetween,
} from './relations.js';

const relation = (type, from, to, extra = {}) => ({ type, from, to, ...extra });
const vote = (agreement, session = 80) =>
  relation('un_alignment', 'IND', 'PAK', { agreement, session });
const india = (rows, now) => classifyDiplomacy('IND', 'PAK', rows, now);

test('diplomacy uses precedence regardless of source order', () => {
  const partner = relation('diplomatic_partnership', 'IND', 'PAK', {
    sources: ['https://example.com'],
  });
  const rival = relation('rivalry', 'IND', 'PAK', {
    sources: ['https://example.com'],
  });
  const ally = relation('alliance', 'IND', 'PAK');
  const sanctions = relation('sanctions', 'PAK', 'IND', {
    directed: true,
    scope: 'state',
  });
  const war = relation('current_armed_conflict', 'IND', 'PAK', {
    events: [
      {
        id: '2',
        a: 'IND',
        b: 'PAK',
        date: '2026-11-01',
        sourceUrl: 'https://ucdp.uu.se/',
      },
    ],
  });
  const rows = [war, sanctions, ally, rival, partner];
  assert.equal(india(rows.toReversed(), '2026-11-09'), 'at-war');
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
  assert.equal(india([vote(0.1)]), null);
  assert.equal(india([vote(0.99)]), null);
  assert.equal(
    india([relation('sanctions', 'IND', 'PAK', { scope: 'persons' })]),
    null,
  );
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
      sources: ['https://example.com'],
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
  assert.equal(classifyDiplomacy('GBR', 'PAK', [war]), null);
  assert.equal(classifyDiplomacy('ARM', 'RUS', [csto]), null);
  assert.equal(classifyDiplomacy('BLR', 'RUS', [csto]), 'ally');
});

test('only valid dated UCDP evidence paints an exact opposing state pair', () => {
  const date = '2026-11-09T12:00:00Z';
  const event = (id, day, a = 'IND', b = 'PAK') => ({
    id,
    a,
    b,
    date: day,
    sourceUrl: 'https://ucdp.uu.se/',
  });
  const snapshot = {
    asOf: date,
    features: {
      'live-ucdp-saved': {
        bilateralEvents: [
          event('new', '2026-11-01'),
          event('old', '2026-01-01', 'USA', 'YEM'),
          event('future', '2026-11-10', 'ISR', 'IRN'),
          event('invalid', '2026-10-32', 'RUS', 'UKR'),
          event('nonstate', '2026-10-30', 'USA', 'ucdp:actor:123'),
        ],
      },
    },
  };
  const rows = currentRelations(snapshot, date);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    rows[0].events.map(({ id }) => id),
    ['new'],
  );
  assert.equal(classifyDiplomacy('IND', 'PAK', rows, date), 'at-war');
  assert.equal(classifyDiplomacy('IND', 'PAK', rows, '2027-03-01'), null);
  assert.equal(classifyDiplomacy('USA', 'YEM', rows, date), null);
});
