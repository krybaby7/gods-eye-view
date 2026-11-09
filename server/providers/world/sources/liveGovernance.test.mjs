import assert from 'node:assert/strict';
import test from 'node:test';
import { coupFlags, gdeltBatch, gdeltFlags } from './liveGovernance.js';

const now = new Date('2026-11-09T01:00:00Z');
const countries = [
  { iso3: 'NER', name: 'Niger' },
  { iso3: 'IND', name: 'India' },
];

test('Powell and Thyne date and outcome remain visible without stale rows', () => {
  const csv =
    'country,ccode,ccode_gw,ccode_polity,year,month,day,coup,version\nNiger,436,,,2026,8,29,1,V2026.08.29\nIndia,750,,,2026,6,1,2,V2026.08.29';
  const flags = coupFlags(csv, now, countries, 'https://example.org/coups');
  assert.equal(flags.length, 1);
  assert.equal(flags[0].date, '2026-08-29');
  assert.match(flags[0].label, /Coup attempt reported/);
});

test('GDELT attributes by action geography and explains sampled coverage', () => {
  function event(id, root, fips) {
    const fields = Array(61).fill('');
    Object.assign(fields, {
      0: id,
      1: '20261109',
      7: 'NER',
      28: root,
      52: 'India',
      53: fips,
    });
    return fields.join('\t');
  }
  const csv = [
    event('9001', '14', 'IN'),
    event('9001', '14', 'IN'),
    event('9002', '19', 'IN'),
    event('9003', '19', ''),
  ].join('\n');
  const batch = gdeltBatch(csv, '2026-11-09T00:00:00.000Z', now, countries);
  assert.deepEqual(batch.counts, { IND: [1, 1] });
  const flags = gdeltFlags([batch], 'https://example.org/gdelt');
  assert.deepEqual(
    flags.map(({ iso3, slot, stage }) => [iso3, slot, stage]),
    [
      ['IND', 'C2', 'reported'],
      ['IND', 'C6', 'reported'],
    ],
  );
  assert(
    flags.every(({ label }) => /reported.*1 sampled.*15-minute/i.test(label)),
  );
});
