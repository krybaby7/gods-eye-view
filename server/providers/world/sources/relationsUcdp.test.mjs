import test from 'node:test';
import assert from 'node:assert/strict';
import { ucdpRelations } from './relationsUcdp.js';

const header =
  'conflict_id,location,side_a,side_a_id,side_b,side_b_id,year,intensity_level,type_of_conflict,start_date2,start_prec2,gwno_a,gwno_b';
const conflict =
  'conflict_id,year,ep_end,ep_end_date,ep_end_prec,version\n10,2025,0,,,26.1\n11,2025,1,2025-05-10,1,26.1';
const country = (iso3, name) => ({ iso3, name, kind: 'state' });
const countries = [
  country('IND', 'India'),
  country('PAK', 'Pakistan'),
  country('USA', 'United States'),
  country('GBR', 'United Kingdom'),
];
const dyads = [
  'dyad_id,' + header,
  '100,10,Pakistan,Government of Pakistan,1,Armed Group,12,2025,1,3,2025-01-01,3,770,',
  '200,11,India,Government of India,5,Government of Pakistan,1,2025,1,2,2025-05-07,1,750,770',
  '300,10,Pakistan,"Government of United Kingdom, Government of United States of America","2,3",Government of Pakistan,1,2025,1,2,2025-01-01,3,"200,2",770',
  '400,10,Pakistan,Government of Pakistan,1,Armed Group,12,2024,1,3,2024-01-01,3,770,',
].join('\n');

test('maps armed group actors independently of where a conflict occurs', () => {
  const rows = ucdpRelations(conflict, dyads, countries);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].from, 'PAK');
  assert.equal(rows[0].to, 'ucdp:actor:12');
  assert.equal(rows[0].toLabel, 'Armed Group');
  assert.equal(rows[0].start, '2025');
});

test('preserves country coalitions and reported episode end', () => {
  const rows = ucdpRelations(conflict, dyads, countries);
  assert.deepEqual(rows[2].fromActors, ['GBR', 'USA']);
  assert.deepEqual(rows[2].toActors, ['PAK']);
  assert.equal(rows[1].end, '2025-05-10');
});
