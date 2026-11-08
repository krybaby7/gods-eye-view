import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';

const now = new Date('2026-11-08T10:00:00Z');
const registry = {
  indicators: [
    {
      id: 'economy.gdp_ppp',
      source: 'worldbank',
      sourceCode: 'NY.GDP.MKTP.PP.CD',
    },
    { id: 'condition.inflation', source: 'imf', sourceCode: 'PCPIPCH' },
    {
      id: 'condition.conflict_deaths',
      source: 'ucdp',
      sourceCode: 'Candidate',
    },
    { id: 'condition.polarisation', source: 'vdem', sourceCode: 'v2cacamps' },
  ],
  countries: [
    {
      iso3: 'ALD',
      name: 'Åland',
      kind: 'territory',
      dataIso3: 'FIN',
      aliases: { worldbank: 'FIN' },
    },
    { iso3: 'FIN', name: 'Finland', kind: 'state' },
    {
      iso3: 'KOS',
      name: 'Kosovo',
      kind: 'state',
      aliases: { worldbank: 'XKX', imf: 'UVK', vdem: 'XKX' },
    },
    { iso3: 'PAK', name: 'Pakistan', kind: 'state' },
    { iso3: 'AFG', name: 'Afghanistan', kind: 'state' },
    { iso3: 'KHM', name: 'Cambodia', kind: 'state' },
    { iso3: 'CAN', name: 'Canada', kind: 'state' },
    { iso3: 'USA', name: 'United States', kind: 'state' },
    { iso3: 'WLD', name: 'World', kind: 'state' },
  ],
};

const fixture = (name) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const fixtureFetch = (responses) => async (url) => {
  const path = String(url);
  assert.ok(Object.hasOwn(responses, path), `Unexpected URL: ${path}`);
  return new Response(await responses[path]);
};

test('World Bank keeps mapped latest values, population and release metadata', async () => {
  const { fetchObservations } = await import('./worldbank.js');
  const root = 'https://api.worldbank.org/v2/country/all';
  const fetchImpl = fixtureFetch({
    [`${root}?format=json&per_page=400`]: fixture('wb-countries.json'),
    [`${root}/indicator/NY.GDP.MKTP.PP.CD?format=json&per_page=20000&mrnev=1`]:
      fixture('wb-gdp.json'),
    [`${root}/indicator/SP.POP.TOTL?format=json&per_page=20000&mrnev=1`]:
      fixture('wb-population.json'),
  });
  const result = await fetchObservations({ fetchImpl, registry, now });
  assert.deepEqual(
    result.observations.map(({ iso3, indicator }) => [iso3, indicator]),
    [
      ['FIN', 'economy.gdp_ppp'],
      ['KOS', 'economy.gdp_ppp'],
      ['FIN', 'population.total'],
      ['KOS', 'population.total'],
    ],
  );
  assert.equal(result.observations[0].publishedAt, '2026-10-08');
  assert.equal(result.observations[0].period, '2025');
  assert.equal(result.observations[0].retrievedAt, now.toISOString());
  assert.equal(result.observations[0].method, 'observed');
});

test('IMF keeps current-year forecasts, respects aliases and omits unavailable vintage', async () => {
  const { fetchObservations } = await import('./imf.js');
  const fetchImpl = fixtureFetch({
    'https://www.imf.org/external/datamapper/api/v1/PCPIPCH?periods=2026,2027':
      fixture('imf-inflation.json'),
  });
  const result = await fetchObservations({ fetchImpl, registry, now });
  assert.deepEqual(result.observations, [
    {
      iso3: 'KOS',
      indicator: 'condition.inflation',
      value: 6.8,
      period: '2026',
      publishedAt: null,
      retrievedAt: now.toISOString(),
      sourceVersion: null,
      method: 'source-forecast',
    },
  ]);
});

const candidateRoot = 'https://ucdp.uu.se/downloads/';
const candidateCsv =
  'id,country,country_id,date_start,date_end,best,source_article';
const population = [
  {
    iso3: 'PAK',
    indicator: 'population.total',
    value: 2_000_000,
    period: '2025',
  },
  {
    iso3: 'PAK',
    indicator: 'population.total',
    value: 1_000_000,
    period: '2024',
  },
  {
    iso3: 'AFG',
    indicator: 'population.total',
    value: 2_000_000,
    period: '2025',
  },
  {
    iso3: 'KHM',
    indicator: 'population.total',
    value: 2_000_000,
    period: '2025',
  },
  {
    iso3: 'CAN',
    indicator: 'population.total',
    value: 4_000_000,
    period: '2025',
  },
  {
    iso3: 'USA',
    indicator: 'population.total',
    value: 4_000_000,
    period: '2025',
  },
];

test('UCDP requires twelve complete released months and deduplicates revised events', async () => {
  const { fetchObservations } = await import('./ucdp.js');
  const fetchImpl = fixtureFetch({
    [candidateRoot]: fixture('ucdp-latest.html'),
    [`${candidateRoot}olddw.html`]: fixture('ucdp-history.html'),
    [`${candidateRoot}candidateged/GEDEvent_v26_01_26_09.csv`]: Promise.all([
      fixture('ucdp-2026.csv'),
      fixture('ucdp-candidate-excerpt.csv'),
    ]).then(
      ([synthetic, recorded]) =>
        synthetic.trimEnd() + '\n' + recorded.split(/\r?\n/)[1] + ',\n',
    ),
    [`${candidateRoot}candidateged/GEDEvent_v25_01_25_12.csv`]: `${candidateCsv}\n900001,Pakistan,770,2025-12-29,2026-01-02,8,"has, comma"\n900002,Pakistan,770,2025-09-30,2025-09-30,99,"old"\n607309,Cambodia (Kampuchea),811,2025-12-08 00:00:00.000,2025-12-08 00:00:00.000,2,\n`,
  });
  const result = await fetchObservations({
    fetchImpl,
    registry,
    now,
    observations: population,
  });
  assert.deepEqual(
    result.observations.map(({ iso3, value, period }) => [iso3, value, period]),
    [
      ['PAK', 20, '2026-09'],
      ['AFG', 9, '2026-09'],
      ['KHM', 1, '2026-09'],
      ['CAN', 0, '2026-09'],
    ],
  );
  assert.equal(result.observations[0].method, 'source-estimate');
  assert.match(
    result.observations[0].sourceVersion,
    /25\.01\.25\.12.*26\.01\.26\.09/,
  );
  assert.match(result.detail, /2025-10.*2026-09/);
});

test('UCDP reports missing coverage before publishing zeroes', async () => {
  const { fetchObservations } = await import('./ucdp.js');
  const fetchImpl = fixtureFetch({
    [candidateRoot]: fixture('ucdp-latest.html'),
    [`${candidateRoot}olddw.html`]: '',
  });
  await assert.rejects(
    fetchObservations({ fetchImpl, registry, now, observations: population }),
    /12.*months/i,
  );
});

const vdemRoot = 'https://www.v-dem.net/';
const vdemPage = `${vdemRoot}data/the-v-dem-dataset/`;
const vdemFile = `${vdemRoot}media/datasets/V-Dem-CY-Core-v16_csv.zip`;

function csvZip(name, csv) {
  const filename = Buffer.from(name);
  const data = Buffer.from(csv);
  const compressed = deflateRawSync(data);
  const local = Buffer.alloc(30);
  const central = Buffer.alloc(46);
  const end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + compressed.length, 16);
  return Buffer.concat([local, filename, compressed, central, filename, end]);
}

test('V-Dem reads the exact Core variable and keeps the latest nonempty year', async () => {
  const { fetchObservations } = await import('./vdem.js');
  const fetchImpl = fixtureFetch({
    [vdemPage]: fixture('vdem-release.html'),
    [vdemFile]: csvZip(
      'V-Dem-CY-Core-v16.csv',
      'country_name,country_text_id,year,v2cacamps,v2cacamps_ord\r\nFinland,FIN,2024,-1.2,2\r\nFinland,FIN,2025,,4\r\nKosovo,XKX,2025,0,4\r\n',
    ),
  });
  const result = await fetchObservations({ fetchImpl, registry, now });
  assert.deepEqual(
    result.observations.map(
      ({ iso3, value, period, publishedAt, sourceVersion }) => [
        iso3,
        value,
        period,
        publishedAt,
        sourceVersion,
      ],
    ),
    [
      ['FIN', -1.2, '2024', '2026-03', 'v16'],
      ['KOS', 0, '2025', '2026-03', 'v16'],
    ],
  );
});

test('V-Dem reports that the exact variable is absent from Core', async () => {
  const { fetchObservations } = await import('./vdem.js');
  const fetchImpl = fixtureFetch({
    [vdemPage]: fixture('vdem-release.html'),
    [vdemFile]: csvZip(
      'V-Dem-CY-Core-v16.csv',
      await fixture('vdem-core-header.csv'),
    ),
  });
  const result = await fetchObservations({ fetchImpl, registry, now });
  assert.deepEqual(result.observations, []);
  assert.match(result.detail, /C6 unavailable.*Core.*v2cacamps/);
});

test('V-Dem reports a declared download over 200 MB before reading it', async () => {
  const { fetchObservations } = await import('./vdem.js');
  const fetchImpl = async (url) => {
    if (String(url) === vdemPage)
      return new Response(await fixture('vdem-release.html'));
    assert.equal(String(url), vdemFile);
    return new Response('', { headers: { 'Content-Length': '200000001' } });
  };
  const result = await fetchObservations({ fetchImpl, registry, now });
  assert.deepEqual(result.observations, []);
  assert.match(result.detail, /C6 unavailable.*200 MB/);
});

test('release checks honor the source month, WEO seasons and the current-year rollover', async () => {
  const { shouldCheck: wb } = await import('./worldbank.js');
  const { shouldCheck: imf } = await import('./imf.js');
  const { shouldCheck: ucdp } = await import('./ucdp.js');
  const { shouldCheck: vdem } = await import('./vdem.js');
  for (const shouldCheck of [wb, imf, ucdp, vdem]) {
    assert.equal(shouldCheck({ now }), true);
    assert.equal(
      shouldCheck({ now, lastCheckedAt: '2026-11-01T00:00:00Z' }),
      false,
    );
  }
  assert.equal(wb({ now, lastCheckedAt: '2026-10-31T00:00:00Z' }), true);
  assert.equal(ucdp({ now, lastCheckedAt: '2026-10-31T00:00:00Z' }), true);
  assert.equal(imf({ now, lastCheckedAt: '2026-10-31T00:00:00Z' }), false);
  assert.equal(imf({ now, lastCheckedAt: '2026-09-30T00:00:00Z' }), true);
  assert.equal(
    imf({ now: new Date('2027-01-01'), lastCheckedAt: '2026-12-31' }),
    true,
  );
  assert.equal(vdem({ now, lastCheckedAt: '2026-03-31T00:00:00Z' }), false);
  assert.equal(vdem({ now, lastCheckedAt: '2026-02-28T00:00:00Z' }), true);
});
test('UCDP reports unmapped event locations before inferring country totals', async () => {
  const { fetchObservations } = await import('./ucdp.js');
  const fetchImpl = fixtureFetch({
    [candidateRoot]: fixture('ucdp-latest.html'),
    [`${candidateRoot}olddw.html`]: fixture('ucdp-history.html'),
    [`${candidateRoot}candidateged/GEDEvent_v26_01_26_09.csv`]: `${candidateCsv}\n900001,Unmapped location,999,2026-09-01,2026-09-01,9,\n`,
    [`${candidateRoot}candidateged/GEDEvent_v25_01_25_12.csv`]: candidateCsv,
  });
  await assert.rejects(
    fetchObservations({ fetchImpl, registry, now, observations: population }),
    /Unmapped UCDP Candidate event countries: Unmapped location/,
  );
});

test('World Bank retries transient transport failures and retains independent series on partial failure', async () => {
  const { fetchObservations } = await import('./worldbank.js');
  let economyAttempts = 0;
  let seriesAttempts = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/NY.GDP.MKTP.PP.CD?')) {
      seriesAttempts++;
      return new Response('', { status: 503 });
    }
    if (url.includes('/SP.POP.TOTL?'))
      return new Response(await fixture('wb-population.json'));
    if (++economyAttempts === 1) throw new TypeError('fetch failed');
    return new Response(await fixture('wb-countries.json'));
  };
  const result = await fetchObservations({ fetchImpl, registry, now });
  assert.equal(economyAttempts, 2);
  assert.equal(seriesAttempts, 2);
  assert.ok(result.observations.length > 0);
  assert.ok(
    result.observations.every(
      ({ indicator }) => indicator === 'population.total',
    ),
  );
  assert.match(result.error, /NY\.GDP\.MKTP\.PP\.CD.*503/);
});

test('UCDP cannot mark the release checked before World Bank population is available', async () => {
  const { fetchObservations } = await import('./ucdp.js');
  await assert.rejects(
    fetchObservations({
      fetchImpl: () => assert.fail('no download without denominators'),
      registry,
      now,
    }),
    /World Bank population/,
  );
});
