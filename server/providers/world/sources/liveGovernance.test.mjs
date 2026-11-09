import assert from 'node:assert/strict';
import test from 'node:test';
import { coupFlags, gdelt, gdeltBatch, gdeltFlags } from './liveGovernance.js';

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

function gdeltManifest(stamp) {
  return new Response(
    '10 0123456789abcdef0123456789abcdef https://data.gdeltproject.org/gdeltv2/' +
      stamp +
      '.export.CSV.zip',
  );
}

test('GDELT samples a current manifest on a delayed turn even with several gaps', async () => {
  const actual = new Date('2026-11-09T02:03:00Z');
  const date = '2026-11-09T02:00:00.000Z';
  const earlier = '2026-11-09T00:45:00.000Z';
  const batches = [earlier, date, '2026-11-09T03:00:00.000Z'].map((date) => ({
    date,
    counts: { IND: [1, 0] },
    records: 1,
  }));
  const result = await gdelt.fetchObservations({
    now,
    currentTime: () => actual,
    registry: { countries },
    data: { batches },
    fetchImpl(url) {
      assert.match(url, /lastupdate\.txt$/);
      return gdeltManifest('20261109020000');
    },
  });
  assert.deepEqual(
    result.data.batches.map(({ date }) => date),
    [earlier, date],
  );
  assert.equal(result.data.flags[0].sampledFiles, 2);
});

test('GDELT rejects future and more than seven day old archive timestamps', async () => {
  for (const stamp of ['20261109011500', '20261102004500', '20261109005500']) {
    await assert.rejects(
      gdelt.fetchObservations({
        now,
        registry: { countries },
        fetchImpl(url) {
          assert.match(url, /lastupdate\.txt$/);
          return gdeltManifest(stamp);
        },
      }),
      /outside the sampling window/,
    );
  }
});

test('GDELT leaves the publisher’s upcoming batch unused and tolerates a missing completed export', async () => {
  const date = '2026-11-09T00:30:00.000Z';
  const calls = [];
  const result = await gdelt.fetchObservations({
    now: new Date('2026-11-09T00:56:00.000Z'),
    registry: { countries },
    data: { batches: [{ date, counts: { IND: [1, 0] }, records: 1 }] },
    fetchImpl(url) {
      calls.push(url.split('/').at(-1));
      return url.endsWith('lastupdate.txt')
        ? gdeltManifest('20261109010000')
        : new Response(null, { status: 404 });
    },
  });
  assert.deepEqual(calls, ['lastupdate.txt', '20261109004500.export.CSV.zip']);
  assert.deepEqual(
    result.data.batches.map(({ date }) => date),
    [date],
  );
});
