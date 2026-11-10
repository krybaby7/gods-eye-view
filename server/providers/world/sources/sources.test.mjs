import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { crc32, deflateRawSync } from 'node:zlib';
import { createWorldFetch } from './transport.js';

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

test('queued IMF series gets a new request deadline after the first body finishes', async (t) => {
  const { fetchObservations } = await import('./imf.js');
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', () => timeout.call(AbortSignal, 400));
  const calls = [];
  const fetchImpl = createWorldFetch((url, { signal }) => {
    const code = new URL(url).pathname.split('/').at(-1);
    calls.push(code);
    return new Response(
      new ReadableStream({
        async pull(controller) {
          try {
            await delay(260, null, { signal });
            controller.enqueue(
              Buffer.from(
                JSON.stringify({
                  values: { [code]: { UVK: { 2026: 6 } } },
                }),
              ),
            );
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      }),
    );
  });
  const result = await fetchObservations({
    fetchImpl,
    now,
    registry: {
      ...registry,
      indicators: [
        ...registry.indicators,
        { id: 'condition.debt', source: 'imf', sourceCode: 'GGXWDG_NGDP' },
      ],
    },
  });
  assert.deepEqual(calls, ['PCPIPCH', 'GGXWDG_NGDP']);
  assert.equal(result.observations.length, 2);
});

const candidateRoot = 'https://ucdp.uu.se/downloads/';
const candidateCsv =
  'id,country,country_id,date_start,date_end,best,source_article';
async function candidateCache(t) {
  const directory = await mkdtemp(join(tmpdir(), 'gev-ucdp-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
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

test('UCDP requires twelve complete released months and deduplicates revised events', async (t) => {
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
    [`${candidateRoot}candidateged/GEDEvent_v25_01_25_12.csv`]: `${candidateCsv}\n900001,Pakistan,770,2025-12-29,2026-01-02,8,"has, comma"\n900002,Pakistan,770,2025-09-30,2025-09-30,99,"old"\n607309,Cambodia (Kampuchea),811,2025-12-08 00:00:00.000,2025-12-08 00:00:00.000,2,\n607310,Canada,20,2025-09-30,2025-09-30,1,\n`,
  });
  const result = await fetchObservations({
    fetchImpl,
    registry,
    now,
    observations: population,
    cacheDirectory: await candidateCache(t),
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
  assert.equal(result.data.period, '2026-09');
  assert.equal(result.data.deathsByIso3.PAK, 40);
  assert.equal(result.data.deathsByIso3.AFG, 18);
  assert.equal(result.data.deathsByIso3.KHM, 2);
  assert.equal(result.data.deathsByIso3.CAN, 0);
  assert.equal(Object.hasOwn(result.data.deathsByIso3, 'FIN'), false);
  assert.equal(Object.hasOwn(result.data.deathsByIso3, 'USA'), false);
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

test('UCDP evicts a corrupt ZIP and reuses the corrected release across turns', async (t) => {
  const { fetchObservations } = await import('./ucdp.js');
  const archive = `${candidateRoot}candidateged/GEDEvent_v25_11_26_10.zip`;
  const csv = `${candidateCsv}\n900001,Pakistan,770,2026-09-01,2026-09-01,25,\n`;
  const bytes = csvZip('events.csv', csv);
  const broken = Buffer.from(bytes);
  broken.writeUInt32LE(0, broken.readUInt32LE(broken.length - 6) + 16);
  const fixtureRequest = fixtureFetch({
    [candidateRoot]: `<a href="${archive}">Candidate CSV archive</a>`,
    [`${candidateRoot}olddw.html`]: '',
  });
  let requests = 0;
  const progress = [];
  const context = {
    fetchImpl(url) {
      if (url === archive)
        return new Response(++requests === 1 ? broken : bytes);
      return fixtureRequest(url);
    },
    registry,
    now,
    observations: population,
    cacheDirectory: await candidateCache(t),
    onProgress(download) {
      progress.push(download.bytes);
    },
  };
  await assert.rejects(
    fetchObservations(context),
    /ZIP CSV failed integrity check/,
  );
  assert.deepEqual(await readdir(context.cacheDirectory), []);
  const first = await fetchObservations(context);
  const second = await fetchObservations(context);
  assert.equal(requests, 2);
  assert.equal(first.data.deathsByIso3.PAK, 25);
  assert.deepEqual(first, second);
  assert.deepEqual(progress, [broken.length, bytes.length, bytes.length]);
  const rebuilt = await fetchObservations({
    ...context,
    lastCheckedAt: now.toISOString(),
    data: { period: first.data.period },
    observations: [...population, ...first.observations],
    rederive: true,
    fetchImpl: () => assert.fail('A complete legacy release is already cached'),
  });
  assert.deepEqual(rebuilt, { ...first, checkedRelease: false });
  const nextArchive = archive.replace('26_10', '26_11');
  const next = await fetchObservations({
    ...context,
    now: new Date('2026-12-01T00:00:00Z'),
    lastCheckedAt: now.toISOString(),
    data: first.data,
    rederive: true,
    fetchImpl: fixtureFetch({
      [candidateRoot]: `<a href="${nextArchive}">November archive</a>`,
      [`${candidateRoot}olddw.html`]: '',
      [nextArchive]: bytes,
    }),
  });
  assert.equal(next.data.period, '2026-11');
});

const vdemRoot = 'https://www.v-dem.net/';
const vdemPage = `${vdemRoot}data/the-v-dem-dataset/`;
const vdemFile = `${vdemRoot}media/datasets/V-Dem-CY-FullOthers-v16_csv.zip`;

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

async function vdemTestDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'world-vdem-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('V-Dem reads the exact Full+Others variable and keeps the latest nonempty year', async (t) => {
  const { fetchObservations } = await import('./vdem.js');
  const cacheDirectory = await vdemTestDirectory(t);
  const fetchImpl = fixtureFetch({
    [vdemPage]: fixture('vdem-release.html'),
    [vdemFile]: csvZip(
      'V-Dem-CY-Full+Others-v16.csv',
      'country_name,country_text_id,year,v2cacamps,v2cacamps_ord\r\n"Finland, ""land of\r\nthousand lakes""",FIN,2024,-1.2,2\r\nFinland,FIN,2025,,4\r\nKosovo,XKX,2025,0,4\r\n',
    ),
  });
  const result = await fetchObservations({
    fetchImpl,
    registry,
    now,
    cacheDirectory,
  });
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

test('V-Dem reports that the exact variable is absent from Full+Others', async (t) => {
  const { fetchObservations } = await import('./vdem.js');
  const cacheDirectory = await vdemTestDirectory(t);
  const fetchImpl = fixtureFetch({
    [vdemPage]: fixture('vdem-release.html'),
    [vdemFile]: csvZip(
      'V-Dem-CY-Full+Others-v16.csv',
      await fixture('vdem-core-header.csv'),
    ),
  });
  const result = await fetchObservations({
    fetchImpl,
    registry,
    now,
    cacheDirectory,
  });
  assert.deepEqual(result.observations, []);
  assert.match(result.detail, /C6 unavailable.*Full\+Others.*v2cacamps/);
});

test('V-Dem reports a declared download over 200 MB before reading it', async (t) => {
  const { fetchObservations } = await import('./vdem.js');
  const cacheDirectory = await vdemTestDirectory(t);
  const fetchImpl = async (url) => {
    if (String(url) === vdemPage)
      return new Response(await fixture('vdem-release.html'));
    assert.equal(String(url), vdemFile);
    return new Response('', { headers: { 'Content-Length': '200000001' } });
  };
  const result = await fetchObservations({
    fetchImpl,
    registry,
    now,
    cacheDirectory,
  });
  assert.deepEqual(result.observations, []);
  assert.match(result.detail, /C6 unavailable.*200 MB/);
});

test('V-Dem reuses the cached versioned archive and reports bytes', async (t) => {
  const { fetchObservations } = await import('./vdem.js');
  const cacheDirectory = await vdemTestDirectory(t);
  const archive = csvZip(
    'V-Dem-CY-Full+Others-v16.csv',
    'country_text_id,year,v2cacamps\r\nFIN,2025,1',
  );
  let downloads = 0;
  const fetchImpl = async (url) => {
    if (String(url) === vdemPage)
      return new Response(await fixture('vdem-release.html'));
    assert.equal(String(url), vdemFile);
    downloads += 1;
    return new Response(archive, {
      headers: { 'Content-Length': String(archive.length) },
    });
  };
  const progress = [];
  const context = {
    fetchImpl,
    registry,
    now,
    cacheDirectory,
    onProgress: (event) => progress.push(event),
  };
  const first = await fetchObservations(context);
  const second = await fetchObservations(context);
  assert.deepEqual(first.observations, second.observations);
  assert.equal(downloads, 1);
  assert.equal(progress.at(-1)?.bytes, archive.length);
  const rebuilt = await fetchObservations({
    ...context,
    lastCheckedAt: now.toISOString(),
    data: { sourceVersion: first.data.sourceVersion },
    observations: first.observations,
    rederive: true,
    fetchImpl: () =>
      assert.fail('The archived V-Dem release is already cached'),
  });
  assert.deepEqual(rebuilt, { ...first, checkedRelease: false });
});

test('V-Dem reuses the February check until March and checks for the March release in April', async (t) => {
  const { fetchObservations, shouldCheck } = await import('./vdem.js');
  const cacheDirectory = await vdemTestDirectory(t);
  const release = await fixture('vdem-release.html');
  const february = new Date('2027-02-15T00:00:00Z');
  const checked = await fetchObservations({
    now: february,
    registry,
    cacheDirectory,
    fetchImpl: fixtureFetch({
      [vdemPage]: release,
      [vdemFile]: csvZip(
        'V-Dem-CY-Full+Others-v16.csv',
        'country_text_id,year,v2cacamps\nFIN,2025,1',
      ),
    }),
  });
  const context = {
    registry,
    cacheDirectory,
    lastCheckedAt: february.toISOString(),
    data: checked.data,
    observations: checked.observations,
    rederive: true,
  };
  assert.equal(shouldCheck({ ...context, now: february }), false);
  const rebuilt = await fetchObservations({
    ...context,
    now: february,
    fetchImpl: () => assert.fail('February release is already cached'),
  });
  assert.deepEqual(rebuilt, { ...checked, checkedRelease: false });
  const march = new Date('2027-03-01T00:00:00Z');
  assert.equal(shouldCheck({ ...context, now: march }), true);
  const april = new Date('2027-04-15T00:00:00Z');
  const refreshed = await fetchObservations({
    ...context,
    now: april,
    fetchImpl: fixtureFetch({
      [vdemPage]: release
        .replaceAll('v16', 'v17')
        .replaceAll('March 2026', 'March 2027'),
      [vdemFile.replace('v16', 'v17')]: csvZip(
        'V-Dem-CY-Full+Others-v17.csv',
        'country_text_id,year,v2cacamps\nFIN,2026,2',
      ),
    }),
  });
  assert.equal(refreshed.data.sourceVersion, 'v17');
  assert.equal(refreshed.observations[0].value, 2);
});

test('V-Dem keeps an intact ZIP missing the expected CSV until the release changes', async (t) => {
  const { fetchObservations } = await import('./vdem.js');
  const cacheDirectory = await vdemTestDirectory(t);
  const release = await fixture('vdem-release.html');
  let version = 'v16';
  const downloads = [];
  const context = {
    registry,
    now,
    cacheDirectory,
    fetchImpl(url) {
      if (url === vdemPage)
        return new Response(release.replaceAll('v16', version));
      assert.equal(url, vdemFile.replace('v16', version));
      downloads.push(version);
      const name =
        version === 'v16' ? 'renamed.csv' : 'V-Dem-CY-Full+Others-v17.csv';
      return new Response(
        csvZip(name, 'country_text_id,year,v2cacamps\nFIN,2025,1'),
      );
    },
  };
  await assert.rejects(fetchObservations(context), /CSV file missing from ZIP/);
  await assert.rejects(fetchObservations(context), /CSV file missing from ZIP/);
  assert.deepEqual(downloads, ['v16']);
  version = 'v17';
  assert.equal((await fetchObservations(context)).observations[0].value, 1);
  assert.deepEqual(downloads, ['v16', 'v17']);
});

test('legacy download cleanup keeps current, recent and tagged archives and runs once', async (t) => {
  const { cleanupLegacyWorldDownloads } = await import('./legacyDownloads.js');
  const cacheDirectory = await vdemTestDirectory(t);
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  async function seed(url, age, source) {
    const key = createHash('sha256').update(url).digest('hex');
    const file = join(cacheDirectory, key);
    await writeFile(file, 'legacy archive');
    await writeFile(file + '.json', JSON.stringify({ size: 14, source }));
    await utimes(file, age, age);
    return key;
  }
  const vdem = await seed(vdemFile, old);
  const ucdp = await seed(
    `${candidateRoot}candidateged/GEDEvent_v25_11_26_10.zip`,
    old,
  );
  const tagged = await seed(vdemFile.replace('v16', 'v15'), old, 'vdem');
  const recent = await seed('https://source.test/recent', new Date());
  const obsolete = await seed('https://source.test/obsolete', old);
  const features = {
    vdem: { sourceVersion: 'v16' },
    ucdp: { period: '2026-10' },
  };
  const observations = [
    {
      indicator: 'condition.conflict_deaths',
      period: '2026-10',
      sourceVersion: 'UCDP Candidate 25.11.26.10',
    },
  ];
  await cleanupLegacyWorldDownloads(cacheDirectory, features, observations);
  const retained = [vdem, ucdp, tagged, recent];
  let files = await readdir(cacheDirectory);
  for (const key of retained) {
    assert.ok(files.includes(key));
    assert.ok(files.includes(key + '.json'));
  }
  assert.ok(!files.includes(obsolete));
  assert.ok(!files.includes(obsolete + '.json'));
  await utimes(join(cacheDirectory, recent), old, old);
  await cleanupLegacyWorldDownloads(cacheDirectory, features, observations);
  files = await readdir(cacheDirectory);
  assert.ok(files.includes(recent));
});

test('V-Dem evicts a ZIP after a CRC failure and downloads it on the next turn', async (t) => {
  const { fetchObservations } = await import('./vdem.js');
  const cacheDirectory = await vdemTestDirectory(t);
  const archive = csvZip(
    'V-Dem-CY-Full+Others-v16.csv',
    'country_text_id,year,v2cacamps\r\nFIN,2025,1',
  );
  const broken = Buffer.from(archive);
  broken.writeUInt32LE(0, broken.readUInt32LE(broken.length - 6) + 16);
  let requests = 0;
  const context = {
    async fetchImpl(url) {
      if (url === vdemPage)
        return new Response(await fixture('vdem-release.html'));
      assert.equal(url, vdemFile);
      return new Response(++requests === 1 ? broken : archive);
    },
    registry,
    now,
    cacheDirectory,
  };
  await assert.rejects(
    fetchObservations(context),
    /ZIP CSV failed integrity check/,
  );
  assert.deepEqual(await readdir(cacheDirectory), []);
  assert.equal((await fetchObservations(context)).observations[0].value, 1);
  assert.equal(requests, 2);
});

test('V-Dem evicts a ZIP with a truncated directory', async (t) => {
  const { fetchObservations } = await import('./vdem.js');
  const cacheDirectory = await vdemTestDirectory(t);
  await assert.rejects(
    fetchObservations({
      fetchImpl: fixtureFetch({
        [vdemPage]: fixture('vdem-release.html'),
        [vdemFile]: csvZip(
          'V-Dem-CY-Full+Others-v16.csv',
          'country_text_id,year,v2cacamps\nFIN,2025,1',
        ).subarray(0, -5),
      }),
      registry,
      now,
      cacheDirectory,
    }),
    { code: 'ZIP_INTEGRITY', message: 'ZIP end of directory not found' },
  );
  assert.deepEqual(await readdir(cacheDirectory), []);
});

test('V-Dem retains the current and previous release archives', async (t) => {
  const { fetchObservations } = await import('./vdem.js');
  const cacheDirectory = await vdemTestDirectory(t);
  const releasePage = await fixture('vdem-release.html');
  const files = new Set();
  for (const version of [16, 17, 18]) {
    const url = vdemFile.replace('v16', `v${version}`);
    const key = createHash('sha256').update(url).digest('hex');
    if (version > 16) files.add(key).add(key + '.json');
    await fetchObservations({
      fetchImpl: fixtureFetch({
        [vdemPage]: releasePage.replaceAll('v16', `v${version}`),
        [url]: csvZip(
          `V-Dem-CY-Full+Others-v${version}.csv`,
          'country_text_id,year,v2cacamps\r\nFIN,2025,1',
        ),
      }),
      registry,
      now,
      cacheDirectory,
    });
  }
  assert.deepEqual(new Set(await readdir(cacheDirectory)), files);
});

test('streaming a ZIP entry from disk checks its CRC', async (t) => {
  const { zipEntryChunks } = await import('./zip.js');
  const cacheDirectory = await vdemTestDirectory(t);
  const archive = csvZip('data.csv', 'row,column\r\n1,2');
  const central = archive.readUInt32LE(archive.length - 6);
  archive.writeUInt32LE(0, central + 16);
  const archivePath = join(cacheDirectory, 'data.zip');
  await writeFile(archivePath, archive);
  await assert.rejects(async () => {
    for await (const chunk of zipEntryChunks(archivePath, () => true, 1024))
      assert.ok(chunk.length > 0);
  }, /ZIP CSV failed integrity check/);
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
  const priorCoreCheck = {
    now,
    lastCheckedAt: '2026-03-31T00:00:00Z',
    observations: [],
  };
  assert.equal(vdem(priorCoreCheck), true);
  assert.equal(
    vdem({ ...priorCoreCheck, data: { sourceVersion: 'v16' } }),
    false,
  );
});
test('UCDP reports unmapped event locations before inferring country totals', async (t) => {
  const { fetchObservations } = await import('./ucdp.js');
  const fetchImpl = fixtureFetch({
    [candidateRoot]: fixture('ucdp-latest.html'),
    [`${candidateRoot}olddw.html`]: fixture('ucdp-history.html'),
    [`${candidateRoot}candidateged/GEDEvent_v26_01_26_09.csv`]: `${candidateCsv}\n900001,Unmapped location,999,2026-09-01,2026-09-01,9,\n`,
    [`${candidateRoot}candidateged/GEDEvent_v25_01_25_12.csv`]: candidateCsv,
  });
  await assert.rejects(
    fetchObservations({
      fetchImpl,
      registry,
      now,
      observations: population,
      cacheDirectory: await candidateCache(t),
    }),
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
