import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWorldRegistry } from '../registry.js';
import { coupFlags, gdelt, gdeltBatch, gdeltFlags } from './liveGovernance.js';
import { fipsCountry, iso2Country } from './liveCountryCodes.js';

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

test('Powell and Thyne aliases resolve the published historical spellings', () => {
  const csv = [
    'country,year,month,day,coup',
    'Congo,2026,9,1,1',
    'Sao Tome and Principe,2026,9,2,1',
    'Swaziland,2026,9,3,1',
  ].join('\n');
  assert.deepEqual(
    coupFlags(csv, now, [], 'https://example.org/coups').map(
      ({ iso3 }) => iso3,
    ),
    ['COG', 'STP', 'SWZ'],
  );
});

test('GDELT and IODA crosswalks cover every sovereign country in the full registry', async () => {
  const { countries } = await loadWorldRegistry();
  const states = countries
    .filter(({ kind }) => kind === 'state')
    .map(({ iso3 }) => iso3);
  for (const crosswalk of [fipsCountry, iso2Country]) {
    const covered = new Set(Object.values(crosswalk));
    assert.deepEqual(
      states.filter((iso3) => !covered.has(iso3)),
      [],
    );
  }
  assert.equal(fipsCountry.RI, 'SRB');
  assert.equal(fipsCountry.AO, 'AGO');
});

test('GDELT deduplicates articles and publisher subdomains within 72 hours', () => {
  function event(id, root, fips, domain = 'one.example', article = id) {
    const fields = Array(61).fill('');
    Object.assign(fields, {
      0: id,
      1: '20261109',
      5: 'ACTOR' + id,
      12: 'MIL',
      15: 'TARGET',
      26: root + '0',
      28: root,
      52: 'India',
      53: fips,
      54: fips + id,
      60: 'https://' + domain + '/article/' + article,
    });
    return fields.join('\t');
  }
  const csv = [
    event('9001', '14', 'IN'),
    event('9001', '14', 'IN'),
    event('9002', '14', 'IN', 'two.example'),
    event('9004', '14', 'IN', 'news.three.co.uk'),
    event('9005', '14', 'IN', 'sport.three.co.uk'),
    event('9006', '14', 'IN', 'www.three.co.uk'),
    event('9007', '14', 'IN', 'www.one.example', '9001'),
    event('9010', '19', 'CA'),
    event('9011', '19', 'NZ'),
    event('9012', '19', 'EI'),
    event('9003', '19', ''),
  ].join('\n');
  const batch = gdeltBatch(csv, '2026-11-09T00:00:00.000Z', now, [
    ...countries,
    { iso3: 'CAN' },
    { iso3: 'NZL' },
    { iso3: 'IRL' },
  ]);
  const flags = gdeltFlags([batch, batch], now);
  assert.equal(batch.events.filter(([, iso]) => iso !== 'IND').length, 3);
  assert.deepEqual(
    flags.map(({ iso3, slot, stage }) => [iso3, slot, stage]),
    [['IND', 'C6', 'reported']],
  );
  assert.equal(flags[0].eventCount, 5);
  assert.equal(flags[0].sourceDomains.length, 3);
  assert.equal(flags[0].sourceUrls.length, 3);
  assert.equal(flags[0].evidence, 'news-derived, low confidence');
  assert.deepEqual(gdeltFlags([batch], new Date(+now + 72 * 3_600_000)), []);
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
  assert.deepEqual(result.data.flags, []);
});

test('GDELT rejects future and more than 72 hour old archive timestamps', async () => {
  for (const stamp of ['20261109011500', '20261106004500', '20261109005500']) {
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

test('GDELT does not count five articles about one coded event as five events', () => {
  const rows = Array.from({ length: 5 }, (_, i) => {
    const f = Array(61).fill('');
    Object.assign(f, {
      0: String(100 + i),
      1: '20261109',
      5: 'GOV' + i,
      6: 'GOVERNMENT',
      12: 'MIL',
      15: 'OPP',
      16: 'OPPOSITION',
      26: '19' + i,
      28: '19',
      52: 'London',
      53: 'UK',
      54: 'UKH9',
      58: String(500 + i),
      56: '51.5',
      57: '-0.1',
      60: `https://news${i}.example/story`,
    });
    return f.join('\t');
  });
  const batch = gdeltBatch(rows.join('\n'), '2026-11-09T00:00:00.000Z', now, [
    { iso3: 'GBR' },
  ]);
  assert.equal(batch.events.length, 5);
  assert.deepEqual(gdeltFlags([batch], now), []);
});

test('GDELT counts protests without a second actor across five ADM1 areas', () => {
  const rows = Array.from({ length: 5 }, (_, i) => {
    const fields = Array(61).fill('');
    Object.assign(fields, {
      0: String(300 + i),
      1: '20261109',
      5: 'PROTESTERS',
      26: '140',
      28: '14',
      52: 'India',
      53: 'IN',
      54: 'IN' + i,
      60: `https://source${i % 3}.example/protest-${i}`,
    });
    return fields.join('\t');
  });
  const batch = gdeltBatch(
    rows.join('\n'),
    '2026-11-09T00:00:00.000Z',
    now,
    countries,
  );
  assert.deepEqual(
    gdeltFlags([batch], now).map(({ iso3, slot, eventCount }) => [
      iso3,
      slot,
      eventCount,
    ]),
    [['IND', 'C6', 5]],
  );
});

test('GDELT fight codes require a coded armed actor for the conflict slot', () => {
  const rows = Array.from({ length: 10 }, (_, i) => {
    const fields = Array(61).fill('');
    Object.assign(fields, {
      0: String(200 + i),
      1: '20261109',
      5: `ACTOR${i}`,
      15: 'TARGET',
      22: i < 5 ? 'CVL' : 'INS',
      26: '193',
      28: '19',
      52: 'London',
      53: i < 5 ? 'UK' : 'CA',
      54: String(i),
      60: `https://source${i % 3}.example/story-${i}`,
    });
    return fields.join('\t');
  });
  const batch = gdeltBatch(rows.join('\n'), '2026-11-09T00:00:00.000Z', now, [
    { iso3: 'GBR' },
    { iso3: 'CAN' },
  ]);
  const flags = gdeltFlags([batch], now);
  assert.deepEqual(
    flags.map(({ iso3, eventCount }) => [iso3, eventCount]),
    [['CAN', 5]],
  );
});

test('GDELT flags three protest events in one ADM1 across three dates', () => {
  const batches = [7, 8, 9].map((day) => {
    const row = Array(61).fill('');
    Object.assign(row, {
      0: String(day),
      1: '2026110' + day,
      5: 'PROTESTERS',
      28: '14',
      52: 'New Delhi',
      53: 'IN',
      54: 'IN07',
      60: 'https://publisher-' + day + '.example/article',
    });
    return gdeltBatch(
      row.join('\t'),
      '2026-11-0' + day + 'T00:00:00.000Z',
      now,
      countries,
    );
  });
  assert.deepEqual(gdeltFlags(batches.slice(0, 2), now), []);
  const [flag] = gdeltFlags(batches, now);
  assert.equal(flag?.eventCount, 3);
  assert.equal(flag?.reviewed, false);
  assert.match(flag.rule, /3 distinct events from 3 source domains/);
  assert.equal(flag.expiresAt, '2026-11-10T00:00:00.000Z');
});
