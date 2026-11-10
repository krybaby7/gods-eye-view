import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import checkAssets from '../../../../scripts/world-fact-checks/assets.mjs';
import { zipOneEntry } from '../../../../src/testSupport/zipFixture.mjs';
import { assetCountryResolver } from './asset-common.js';
import { parseOurAirports } from './ourairports.js';
import { parsePowerPlants } from './wri-power.js';
import {
  parseWpiFeatureLayer,
  parseWorldPortIndex,
  worldPortLayer,
} from './nga-ports.js';
import { parseWikidataAssets, wikidataAssets } from './wikidata-assets.js';
import { readCuratedAssets } from '../assets.js';
import {
  worldAdapters,
  worldFeatureViews,
  worldRefreshSteps,
} from '../refreshRegistry.js';
import { loadWorldRegistry } from '../registry.js';

const now = new Date('2026-11-09T00:00:00Z');
const country = (value) =>
  ({ US: 'USA', USA: 'USA', NLD: 'NLD', NL: 'NLD', CHN: 'CHN' })[value];
const options = { country, now };

test('WRI retains every historical plant and preserves names without inferring ownership nationality', () => {
  const csv =
    'country,name,gppd_idnr,capacity_mw,latitude,longitude,primary_fuel,owner\n' +
    'USA,River Unit,WRI0001,200,39,-93,Hydro,Example Energy\nUSA,Small,WRI0002,5,34,-93,Wind,\nUSA,Atomic,WRI0003,200,34,-93,Nuclear,';
  const [asset, small, nuclear] = parsePowerPlants(csv, options);
  assert.equal(small.capacity.value, 5);
  assert.equal(nuclear.fuel, 'Nuclear');
  assert.equal(asset.status, 'unknown');
  assert.equal(asset.historical, true);
  assert.deepEqual(asset.geometry.coordinates, [-93, 39]);
  assert.deepEqual(asset.owners, [
    { actor: 'Example Energy', country: null, share: null, verified: false },
  ]);
  assert.equal(asset.operator, null);
});

test('OurAirports selects only large airports with scheduled service and preserves geography', () => {
  const csv =
    'id,ident,type,name,latitude_deg,longitude_deg,iso_country,scheduled_service\n' +
    '1,KAAA,large_airport,Example International,40,-75,US,yes\n2,KBBB,large_airport,Private Hub,38,-90,US,no\n3,KCCC,medium_airport,Regional Hub,38,-90,US,yes';
  const [asset, extra] = parseOurAirports(csv, options);
  assert.equal(extra, undefined);
  assert.equal(asset.locatedIn, 'USA');
  assert.equal(asset.operator, null);
  assert.deepEqual(asset.owners, []);
  assert.match(asset.sourceUrl, /ourairports.com\/airports\/KAAA/);
});

test('WPI joins an unambiguous geographically matched P137 operator without creating ownership', () => {
  const payload = {
    ports: [
      {
        portNumber: 1,
        portName: 'ROTTERDAM',
        latitude: 51.9,
        longitude: 4.4,
        countryCode: 'NL',
        harborSize: 'L',
      },
      {
        portNumber: 2,
        portName: 'EXAMPLE',
        latitude: 52,
        longitude: 5,
        countryCode: 'NL',
        harborSize: 'M',
      },
    ],
  };
  const match = {
    name: 'Port of Rotterdam',
    iso3: 'NLD',
    coordinates: [4.4, 51.9],
    operator: 'Port Authority',
    sourceUrl: 'https://www.wikidata.org/wiki/Q123',
  };
  const [asset, extra] = parseWorldPortIndex(payload, {
    ...options,
    operatorCandidates: [match],
  });
  assert.equal(extra, undefined);
  assert.equal(asset.operator, 'Port Authority');
  assert.equal(asset.operatorSourceUrl, match.sourceUrl);
  assert.deepEqual(asset.owners, []);
  assert.equal(
    parseWorldPortIndex(payload, {
      ...options,
      operatorCandidates: [
        match,
        {
          ...match,
          operator: 'Other',
          sourceUrl: 'https://www.wikidata.org/wiki/Q987',
        },
      ],
    })[0].operator,
    null,
  );
  assert.equal(
    parseWorldPortIndex(payload, {
      ...options,
      operatorCandidates: [{ ...match, coordinates: [50, 0] }],
    })[0].operator,
    null,
  );
});

test('Wikidata keeps operator and referenced title separate and preserves ambiguous geometry as null', () => {
  const b = (row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, { value }]),
    );
  const fields = {
    item: 'http://www.wikidata.org/entity/Q100',
    itemLabel: 'Launch facility',
    kind: 'spaceport',
    iso: 'USA',
    operator: 'http://www.wikidata.org/entity/Q200',
    operatorLabel: 'Operator A',
    owner: 'http://www.wikidata.org/entity/Q300',
    ownerLabel: 'Owner B',
    ownerIso: 'CHN',
    ownerReference: 'https://example.gov/title',
    point: 'Point(-90 30)',
  };
  const build = (bindings) =>
    parseWikidataAssets({ results: { bindings } }, options).rows[0];
  const row = build([b(fields)]);
  assert.equal(row.operator, 'Operator A');
  assert.equal(row.owners[0].verified, true);
  assert.equal(row.owners[0].country, 'CHN');
  assert.equal(
    build([b({ ...fields, ownerReference: '' })]).owners[0].verified,
    false,
  );
  assert.equal(
    build([b(fields), b({ ...fields, point: 'Point(-91 31)' })]).geometry,
    null,
  );
});

test('Wikidata links company home countries with evidence and removes Q-ID labels', () => {
  const sourceRow = {
    item: 'http://www.wikidata.org/entity/Q100',
    itemLabel: 'Launch site',
    kind: 'spaceport',
    iso: 'USA',
    owner: 'http://www.wikidata.org/entity/Q200',
    ownerLabel: 'A company',
    ownerIsCompany: 'true',
    ownerHomeIso: 'CHN',
    ownerHqIso: 'USA',
    operator: 'http://www.wikidata.org/entity/Q300',
    operatorLabel: 'B company',
    operatorIsCompany: 'true',
    operatorHqIso: 'NLD',
  };
  const b = (row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, { value }]),
    );
  const { rows } = parseWikidataAssets(
    {
      results: {
        bindings: [
          b(sourceRow),
          b({
            ...sourceRow,
            item: 'http://www.wikidata.org/entity/Q101',
            itemLabel: 'Q101',
          }),
        ],
      },
    },
    options,
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(
    rows[0].owners.map(({ country, role, homeCountrySourceUrl }) => [
      country,
      role,
      homeCountrySourceUrl,
    ]),
    [
      ['CHN', 'owner', 'https://www.wikidata.org/wiki/Q200#P17'],
      ['NLD', 'operator', 'https://www.wikidata.org/wiki/Q300#P159'],
    ],
  );
  assert.ok(rows[0].owners.every(({ sourceUrl }) => sourceUrl));
});

test('Hammaguir is a closed site in Algeria with a closure citation', () => {
  const binding = Object.fromEntries(
    Object.entries({
      item: 'http://www.wikidata.org/entity/Q100',
      itemLabel: 'Hammaguir launch site',
      kind: 'spaceport',
      iso: 'FRA',
    }).map(([key, value]) => [key, { value }]),
  );
  const {
    rows: [site],
  } = parseWikidataAssets(
    { results: { bindings: [binding] } },
    {
      ...options,
      country: (value) => value,
    },
  );
  assert.equal(site.locatedIn, 'DZA');
  assert.equal(site.status, 'closed');
  assert.equal(site.statusAsOf, '1967-07-01');
  assert.equal(
    site.statusSourceUrl,
    'https://www.esa.int/esapub/hsr/HSR_37.pdf',
  );
  assert.equal(site.reviewed, false);
});

test('DOE WPI uses the unique named feature layer even when its ID changes', () => {
  assert.match(
    worldPortLayer({
      layers: [
        { id: 17, name: 'Nautical Ports' },
        { id: 91, name: 'World Port Index' },
      ],
    }),
    /FeatureServer\/91$/,
  );
  assert.throws(() => worldPortLayer({ layers: [] }), /one World Port Index/);
});

test('the asset board projects markers while country detail includes full attributed rows', async () => {
  const data = await readCuratedAssets();
  const view = worldFeatureViews.get('assets');
  const marker = view.summary['curated-assets'](data).rows.find(
    ({ id }) => id === 'asset_intel-fab-34',
  );
  assert.equal(marker.sourceUrl, undefined);
  assert.equal(marker.owners[0].country, 'USA');
  const detail = view.detail({
    country: 'USA',
    features: { 'curated-assets': data },
  });
  assert.ok(detail.rows.find(({ id }) => id === marker.id).owners[0].sourceUrl);
  assert.deepEqual(
    view.detail({ features: { 'curated-assets': data } }).rows,
    [],
  );
});

test('country crosswalk keeps overseas territory and Kosovo separate and maps grouped UK shapes', async () => {
  const resolve = await assetCountryResolver(await loadWorldRegistry());
  for (const [key, value] of [
    ['FIN', 'FIN'],
    ['BR', 'BRA'],
    ['FR', 'FRA'],
    ['AU', 'AUS'],
    ['KZ', 'KAZ'],
    ['GB', 'GBR'],
    ['GIB', 'GIB'],
    ['GI', 'GIB'],
    ['XKX', 'KOS'],
    ['SS', 'SSD'],
  ]) {
    assert.equal(resolve(key), value, key);
  }
  assert.equal(resolve('NAI'), null);
});

test('curated packs keep all rows and distinguish draft corporate attribution from legal title', async () => {
  const { rows, nuclearBadges } = await readCuratedAssets();
  assert.equal(
    rows.filter((asset) => asset.type === 'military_base').length,
    101,
  );
  assert.equal(rows.filter((asset) => asset.type === 'fab').length, 50);
  assert.equal(nuclearBadges.length, 9);
  assert.ok(
    [...rows, ...nuclearBadges].every(
      (row) => row.reviewed === false && row.sourceUrl,
    ),
  );
  assert.ok(
    rows.some(({ type, geometry }) => type === 'military_base' && geometry),
  );
  assert.ok(rows.some(({ type, geometry }) => type === 'fab' && geometry));
  assert.ok(rows.some(({ geometry }) => !geometry));
  assert.ok(
    rows.every(
      ({ geometry, coordinateSourceUrl }) =>
        Boolean(geometry) === Boolean(coordinateSourceUrl),
    ),
  );
  for (const code of ['GBR', 'RUS', 'TUR', 'CHN', 'FRA', 'AUS', 'ITA']) {
    assert.ok(
      rows.some(({ sendingCountry }) => sendingCountry === code),
      code,
    );
  }
  assert.ok(
    rows
      .filter(({ type }) => type === 'military_base')
      .every(({ ownerCountry, owners }) => !ownerCountry && !owners.length),
  );
  const base = rows.find(({ name }) => name === 'Camp Lemonnier');
  assert.equal(base.sendingCountry, 'USA');
  assert.equal(base.locatedIn, 'DJI');
  assert.deepEqual(base.owners, []);
  const fab = rows.find(({ name }) => name === 'Fab 23');
  assert.ok(fab.operator);
  assert.ok(
    fab.owners.some(
      (owner) =>
        owner.country && owner.sourceUrl && owner.verified && !owner.reviewed,
    ),
  );
  const hambantota = rows.find(
    ({ id }) => id === 'asset_hambantota-port-concession',
  );
  assert.equal(hambantota.owners[0].share, 0.65);
  assert.match(hambantota.owners[0].basis, /Effective equity/);
  assert.ok(rows.every((asset) => asset.canInterrupt.length === 0));
});

test('documented NGA endpoint normalizes DMS coordinates and large harbor code', () => {
  const payload = {
    ports: [
      {
        portNumber: 760,
        portName: 'Example port',
        countryCode: 'NL',
        latitude: '51°30\'00"N',
        longitude: '04°15\'00"E',
        harborSize: 'L',
      },
    ],
  };
  assert.deepEqual(
    parseWorldPortIndex(payload, options)[0].geometry.coordinates,
    [4.25, 51.5],
  );
});

test('Wikidata posts bounded host batches, keeps unaffected results, and defers a 503 with Retry-After', async () => {
  const calls = [];
  const binding = Object.fromEntries(
    Object.entries({
      item: 'http://www.wikidata.org/entity/Q100',
      itemLabel: 'Nuclear plant',
      kind: 'nuclear_plant',
      iso: 'AAA',
      point: 'Point(-90 30)',
    }).map(([key, value]) => [key, { value }]),
  );
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://query.wikidata.org/sparql');
    assert.equal(options.method, 'POST');
    calls.push(new URLSearchParams(options.body).get('query'));
    if (calls.length === 3)
      return new Response('', {
        status: 503,
        headers: { 'Retry-After': '120' },
      });
    return Response.json({
      results: { bindings: calls.length === 1 ? [] : [binding] },
    });
  };
  const countries = Array.from({ length: 41 }, (_, i) => ({
    iso3: 'A' + String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)),
  }));
  const oldSite = { id: 'asset_wd-Q90', type: 'spaceport', locatedIn: 'AAA' };
  const oldPlant = {
    id: 'asset_wd-Q99',
    type: 'nuclear_plant',
    locatedIn: 'AAA',
  };
  const result = await wikidataAssets.fetchObservations({
    registry: { countries },
    now,
    fetchImpl,
    data: { rows: [oldSite, oldPlant] },
  });
  assert.equal(calls.length, 3);
  assert.match(calls[0], /VALUES \?portName/);
  assert.match(calls[1], /Q134447/);
  assert.match(calls[1], /OPTIONAL\s*\{\s*\?item wdt:P625/);
  assert.match(calls[1], /VALUES \?iso \{[^}]*"AAA"/);
  assert.doesNotMatch(calls[1], /"ABO"/);
  assert.match(calls[2], /VALUES \?iso \{ "ABO" \}/);
  assert.match(result.error, /HTTP 503/);
  assert.deepEqual(
    result.data.rows.map(({ id }) => id),
    ['asset_wd-Q100', oldSite.id],
  );
  assert.equal(
    wikidataAssets.shouldCheck({
      now: new Date(+now + 119000),
      data: result.data,
    }),
    false,
  );
  assert.equal(
    wikidataAssets.shouldCheck({
      now: new Date(+now + 121000),
      data: result.data,
    }),
    true,
  );
});

test('legacy Wikidata cache runs the owner query and resumes only unfinished batches', async () => {
  const registry = { countries: [{ iso3: 'FIN' }] };
  const previous = {
    rows: [{ id: 'asset_wd-Q77', type: 'spaceport', locatedIn: 'FIN' }],
    bindings: [],
  };
  const context = { registry, now, data: previous, lastCheckedAt: now };
  assert.equal(wikidataAssets.shouldCheck(context), true);
  const binding = Object.fromEntries(
    Object.entries({
      item: 'http://www.wikidata.org/entity/Q100',
      itemLabel: 'Fixture nuclear plant',
      kind: 'nuclear_plant',
      iso: 'FIN',
      owner: 'http://www.wikidata.org/entity/Q200',
      ownerLabel: 'Company',
      ownerIsCompany: 'true',
      ownerHomeIso: 'FIN',
    }).map(([key, value]) => [key, { value }]),
  );
  const reply = (bindings) => Response.json({ results: { bindings } });
  const first = [];
  const partial = await wikidataAssets.fetchObservations({
    ...context,
    rederive: true,
    fetchImpl(_url, { body }) {
      first.push(body.get('query'));
      if (first.length === 1) return reply([]);
      return first.length === 2
        ? reply([binding])
        : new Response(null, {
            status: 429,
            headers: { 'Retry-After': '120' },
          });
    },
  });
  assert.match(first[0], /VALUES \?portName/);
  assert.match(first[1], /ps:P127/);
  assert.match(first[1], /ps:P137/);
  assert.equal(first.length, 3);
  assert.equal(partial.data.rows[0].owners[0].verified, true);
  assert.ok(partial.data.rows.some(({ id }) => id === 'asset_wd-Q77'));
  assert.equal(
    wikidataAssets.shouldCheck({ ...context, data: partial.data }),
    false,
  );
  const later = new Date(+now + 121_000);
  assert.equal(
    wikidataAssets.shouldCheck({ ...context, now: later, data: partial.data }),
    true,
  );

  const resumed = [];
  const complete = await wikidataAssets.fetchObservations({
    ...context,
    now: later,
    data: partial.data,
    fetchImpl(_url, { body }) {
      resumed.push(body.get('query'));
      return reply([]);
    },
  });
  assert.equal(resumed.length, 1);
  assert.doesNotMatch(resumed.join(' '), /Q134447/);
  assert.deepEqual(
    complete.data.rows.map(({ id }) => id),
    ['asset_wd-Q100'],
  );
  assert.equal(complete.data.rows[0].owners[0].verified, true);
  const queryFingerprint = createHash('sha256')
    .update(JSON.stringify(first.map((query) => query.replace(/\r\n/g, '\n'))))
    .digest('hex');
  // Keep the existing version fingerprints. Add an entry after incrementing
  // QUERY_VERSION whenever the emitted SPARQL changes.
  const queryFingerprints = {
    1: '0343166ed647e96c1d4e34d7c414bca2b22b3438669ee72baf32298a9bc69a67',
  };
  assert.equal(
    queryFingerprint,
    queryFingerprints[complete.data.queryVersion],
    'Wikidata asset SPARQL changed. Bump QUERY_VERSION and pin the new fingerprint.',
  );
  assert.equal(
    wikidataAssets.shouldCheck({
      now: later,
      lastCheckedAt: later,
      data: complete.data,
    }),
    false,
  );
  assert.equal(
    wikidataAssets.shouldCheck({
      now: later,
      lastCheckedAt: later,
      data: complete.data,
      rederive: true,
    }),
    true,
  );
  const rebuilt = await wikidataAssets.fetchObservations({
    ...context,
    now: later,
    lastCheckedAt: later,
    data: complete.data,
    rederive: true,
    fetchImpl() {
      assert.fail('Local derivation must reuse fresh query bindings');
    },
  });
  assert.equal(rebuilt.data.rows[0].owners[0].verified, true);
});

test('asset archive URLs protect the current files during legacy cleanup', () => {
  const layer =
    'https://arcgis.netl.doe.gov/server/rest/services/Hosted/CCS_EJ_SJ_Data/FeatureServer/91';
  assert.match(
    worldAdapters['wri-power'].downloadUrls()[0],
    /globalpowerplantdatabasev130\.zip$/,
  );
  assert.match(worldAdapters.ourairports.downloadUrls()[0], /airports\.csv$/);
  assert.deepEqual(worldAdapters['nga-ports'].downloadUrls(), []);
  assert.equal(
    new URL(worldAdapters['nga-ports'].downloadUrls({ layer })[0]).pathname,
    new URL(layer).pathname + '/query',
  );
});

test('closed foreign ownership is available from both country asset details', () => {
  const row = {
    id: 'closed-fixture',
    locatedIn: 'FIN',
    status: 'closed',
    owners: [{ verified: true, country: 'CHN' }],
  };
  const features = { 'wikidata-assets': { rows: [row] } };
  for (const country of ['CHN', 'FIN'])
    assert.deepEqual(
      worldFeatureViews.get('assets').detail({ country, features }).rows,
      [row],
    );
});

test('curated port dates are read from the cited rows', async () => {
  const rows = (await readCuratedAssets()).rows.filter(
    ({ type }) => type === 'port',
  );
  const source = JSON.parse(
    await readFile(
      new URL(
        '../../../../public/world/curated/port-attributions.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const original = source.rows.find(({ id }) => id === row.id);
    assert.match(original.lastVerified, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(row.lastVerified, original.lastVerified);
    assert.equal(row.reviewed, false);
  }
  const kumport = source.rows.find(({ id }) => id === 'asset_kumport-terminal');
  assert.match(kumport.owners[0].basis, /2015 acquisition announcement/);
});

test('reads the DOE WPI mirror geometry and rejects truncated feature layers', () => {
  const features = [
    {
      attributes: {
        wpinumber: 8210,
        main_port_name: 'Baltimore',
        wpi_cc: 'United States',
        harbor_size_code: 'Large',
      },
      geometry: { x: -76.58, y: 39.26 },
    },
  ];
  const [port] = parseWpiFeatureLayer({ features }, options);
  assert.equal(port.id, 'asset_nga-8210');
  assert.deepEqual(port.geometry.coordinates, [-76.58, 39.26]);
  assert.throws(
    () =>
      parseWpiFeatureLayer({ features, exceededTransferLimit: true }, options),
    /truncated/,
  );
});

test('asset adapters register all five sources and enrich ports only after the Wikidata check', async () => {
  const registry = await loadWorldRegistry();
  for (const id of [
    'wri-power',
    'wikidata-assets',
    'nga-ports',
    'ourairports',
    'curated-assets',
  ]) {
    const rows = registry.sources.filter((source) => source.id === id);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].licence && rows[0].access && rows[0].releaseRhythm);
    assert.equal(typeof worldAdapters[id].fetchObservations, 'function');
  }
  assert.equal(worldRefreshSteps['nga-ports'], 'wikidata-assets');
});

test('WRI and OurAirports rederive corrected counts from legacy download files without upstream requests', async (t) => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'gev-assets-cache-'));
  t.after(() => rm(cacheDirectory, { recursive: true, force: true }));
  const registry = await loadWorldRegistry();
  const context = {
    registry,
    now,
    cacheDirectory,
    fetchImpl(url) {
      return new Response(
        url.endsWith('.zip')
          ? zipOneEntry(
              'global_power_plant_database.csv',
              'country,name,gppd_idnr,capacity_mw,latitude,longitude,primary_fuel,owner\nFIN,Test Plant,123,5,60,23,Nuclear,',
            )
          : 'id,ident,type,name,latitude_deg,longitude_deg,iso_country,scheduled_service\n1,TEST,large_airport,Test Airport,-7,-40,BR,yes',
      );
    },
  };
  for (const [id, country] of [
    ['wri-power', 'FIN'],
    ['ourairports', 'BRA'],
  ]) {
    const adapter = worldAdapters[id];
    assert.equal(adapter.version, 2);
    const first = await adapter.fetchObservations(context);
    assert.equal(
      adapter.shouldCheck({
        now,
        lastCheckedAt: now,
        data: first.data,
        rederive: true,
      }),
      true,
    );
    const rebuilt = await adapter.fetchObservations({
      ...context,
      rederive: true,
      fetchImpl: () => assert.fail('Legacy input is already cached'),
    });
    assert.deepEqual(
      rebuilt,
      id === 'ourairports' ? { ...first, checkedRelease: false } : first,
    );
    assert.equal(rebuilt.data.rows[0].locatedIn, country);
    if (id === 'ourairports') {
      const downloaded = await adapter.fetchObservations({
        ...context,
        cacheDirectory: join(cacheDirectory, 'missing'),
        rederive: true,
      });
      assert.deepEqual(downloaded, first);
    }
  }
});

test('NGA cached rederivation leaves the release unchecked', async (t) => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'gev-nga-cache-'));
  t.after(() => rm(cacheDirectory, { recursive: true, force: true }));
  const registry = await loadWorldRegistry();
  const adapter = worldAdapters['nga-ports'];
  const context = {
    registry,
    now,
    cacheDirectory,
    fetchImpl(url) {
      if (!url.includes('/query?'))
        return Response.json({
          layers: [{ id: 91, name: 'World Port Index' }],
        });
      return Response.json({
        features: [
          {
            attributes: {
              wpinumber: 8210,
              main_port_name: 'Baltimore',
              wpi_cc: 'United States',
              harbor_size_code: 'L',
            },
            geometry: { x: -76.6, y: 39.3 },
          },
        ],
      });
    },
  };
  const first = await adapter.fetchObservations(context);
  const rebuilt = await adapter.fetchObservations({
    ...context,
    data: first.data,
    rederive: true,
    fetchImpl: () => assert.fail('NGA input is already cached'),
  });
  assert.deepEqual(rebuilt, { ...first, checkedRelease: false });
  const downloaded = await adapter.fetchObservations({
    ...context,
    cacheDirectory: join(cacheDirectory, 'missing'),
    data: first.data,
    rederive: true,
  });
  assert.deepEqual(downloaded, first);
});

test('a manual refresh reloads asset reviews even with a cached hand table', () => {
  assert.equal(
    worldAdapters['curated-assets'].shouldCheck({ data: { rows: [] } }),
    true,
  );
});

test('asset facts separate airport measurements and report verified Wikidata owner coverage', async () => {
  const board = {
    features: {
      ourairports: {
        countsBySourceCountry: {
          AE: 7,
          CL: 8,
          FI: 10,
          GB: 17,
          HK: 1,
          IS: 2,
          MT: 1,
          NZ: 4,
          RW: 1,
          SG: 1,
          US: 200,
        },
      },
      'wikidata-assets': {
        rows: [
          { owners: [{ verified: true, country: 'CHN', role: 'owner' }] },
          { owners: [{ verified: true, country: 'USA', role: 'operator' }] },
          { owners: [{ verified: false, country: 'FIN', role: 'owner' }] },
        ],
      },
    },
    turn: {
      sources: [
        {
          id: 'wikidata-assets',
          checked: true,
          status: 'loaded',
          detail: '11 of 11 Wikidata asset batches completed.',
        },
      ],
    },
  };
  const facts = await checkAssets({ board });
  const row = (id) => facts.find((fact) => fact.id === id);
  const airportSample = row('assets-counts-ourairports');
  assert.equal(airportSample.pass, true);
  assert.equal(airportSample.expected.rows, 52);
  assert.equal(airportSample.expected.countryCodesCompared, 11);
  assert.deepEqual(airportSample.found.differences, []);
  assert.ok(row('assets-airport-cache-diagnostic'));
  const coverage = row('assets-wikidata-owner-query');
  assert.equal(coverage.pass, true);
  assert.equal(coverage.found.facilities, 3);
  assert.equal(coverage.found.withVerifiedOwner, 1);
  assert.equal(coverage.found.withVerifiedOperator, 1);
  board.features.ourairports.countsBySourceCountry.AD = 1;
  const mismatched = (await checkAssets({ board })).find(
    ({ id }) => id === airportSample.id,
  );
  assert.equal(mismatched.pass, false);
  assert.deepEqual(mismatched.found.differences, [
    { code: 'AD', publisher: 0, board: 1 },
  ]);
});
