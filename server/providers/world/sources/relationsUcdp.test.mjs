import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipFixture } from './fixtures/zipFixture.mjs';
import { fetchObservations, ucdpRelations } from './relationsUcdp.js';

const header =
  'conflict_id,location,side_a,side_a_id,side_b,side_b_id,year,intensity_level,type_of_conflict,start_date2,start_prec2,gwno_a,gwno_b,side_a_2nd,side_b_2nd,gwno_a_2nd,gwno_b_2nd';
const conflict =
  'conflict_id,year,ep_end,ep_end_date,ep_end_prec,version\n10,2025,0,,,26.1\n11,2025,1,2025-05-10,1,26.1';
const country = (iso3, name) => ({ iso3, name, kind: 'state' });
const countries = [
  country('IND', 'India'),
  country('PAK', 'Pakistan'),
  country('USA', 'United States'),
  country('GBR', 'United Kingdom'),
  country('YEM', 'Yemen'),
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

test('keeps the Houthi actor separate from Yemen and records secondary support on the supported side', () => {
  const rows = ucdpRelations(
    conflict,
    [
      'dyad_id,' + header,
      '500,10,Yemen,Government of Yemen (North Yemen),123,Government of Pakistan,1,2025,1,4,2025-01-01,1,678,770,,Government of United States of America,,2',
    ].join('\n'),
    countries,
  );
  assert.equal(rows[0].from, 'ucdp:actor:123');
  assert.deepEqual(rows[0].fromActors, []);
  assert.equal(rows[1].type, 'support_to_party');
  assert.deepEqual([rows[1].from, rows[1].to], ['USA', 'PAK']);
});

test('UCDP relations reuses both versioned ZIPs and reports aggregate bytes', async (t) => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'world-ucdp-relations-'));
  t.after(() => rm(cacheDirectory, { recursive: true, force: true }));
  const files = [
    zipFixture('conflict.csv', conflict),
    zipFixture('dyads.csv', dyads),
  ];
  const requests = [];
  const progress = [];
  const context = {
    cacheDirectory,
    registry: { countries },
    onProgress: (event) => progress.push(event),
    fetchImpl: async (url) => {
      requests.push(url);
      const body = files[url.includes('dyadic') ? 1 : 0];
      return new Response(body, {
        headers: { 'Content-Length': String(body.length) },
      });
    },
  };
  const first = await fetchObservations(context);
  const second = await fetchObservations(context);
  assert.deepEqual(first.data, second.data);
  assert.equal(requests.length, 2);
  assert.equal(progress.at(-1)?.bytes, files[0].length + files[1].length);
});
