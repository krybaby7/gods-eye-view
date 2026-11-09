import assert from 'node:assert/strict';
import test from 'node:test';
import { assetCountryResolver } from './asset-common.js';
import { parseOurAirports } from './ourairports.js';
import { parsePowerPlants } from './wri-power.js';
import { parseWpiFeatureLayer, parseWorldPortIndex } from './nga-ports.js';
import { parseWikidataAssets, wikidataAssets } from './wikidata-assets.js';
import { readCuratedAssets } from '../assets.js';
import { worldAdapters, worldRefreshSteps } from '../refreshRegistry.js';
import { loadWorldRegistry } from '../registry.js';

const now = new Date('2026-11-09T00:00:00Z');
const country = (value) =>
  ({ US: 'USA', USA: 'USA', NLD: 'NLD', NL: 'NLD', CHN: 'CHN' })[value];
const options = { country, now };

test('WRI preserves historical ownership names without attributing company nationality or current status', () => {
  const csv =
    'country,name,gppd_idnr,capacity_mw,latitude,longitude,primary_fuel,owner\n' +
    'USA,River Unit,WRI0001,200,39,-93,Hydro,Example Energy\nUSA,Small,WRI0002,5,34,-93,Wind,\nUSA,Atomic,WRI0003,200,34,-93,Nuclear,';
  const [asset, extra] = parsePowerPlants(csv, options);
  assert.equal(extra, undefined);
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

test('country crosswalk keeps overseas territory and Kosovo separate and maps grouped UK shapes', async () => {
  const resolve = await assetCountryResolver({
    countries: [
      { iso3: 'GBR', shapeIds: ['GBR', 'ENG', 'SCT'] },
      { iso3: 'GIB', shapeIds: ['GIB'] },
      { iso3: 'KOS', shapeIds: ['KOS'] },
      { iso3: 'SSD', shapeIds: ['SDS'] },
    ],
  });
  for (const [key, value] of [
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
  assert.ok(!fab.owners.some((owner) => owner.verified));
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
    if (calls.length === 2)
      return new Response('', {
        status: 503,
        headers: { 'Retry-After': '120' },
      });
    return new Response(JSON.stringify({ results: { bindings: [binding] } }));
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
  assert.equal(calls.length, 2);
  assert.match(calls[0], /Q134447/);
  assert.match(calls[0], /OPTIONAL\s*\{\s*\?item wdt:P625/);
  assert.match(calls[0], /VALUES \?iso \{[^}]*"AAA"/);
  assert.doesNotMatch(calls[0], /"ABO"/);
  assert.match(calls[1], /VALUES \?iso \{ "ABO" \}/);
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

test('a manual refresh reloads asset reviews even with a cached hand table', () => {
  assert.equal(
    worldAdapters['curated-assets'].shouldCheck({ data: { rows: [] } }),
    true,
  );
});
