import assert from 'node:assert/strict';
import test from 'node:test';
import { gdacsFlags, gdacs } from './liveDisasters.js';
import { faoBanner, cpiRows, imfCpi } from './livePrices.js';
import {
  savedUcdp,
  ucdpStockFlags,
  displacementFlags,
} from './liveDisplacement.js';
import { download } from './liveFeedCommon.js';
import { debtDistress } from './liveDebtDsa.js';

const now = new Date('2026-11-09T10:00:00Z');

test('LIC DSA keeps the index snapshot date, assessment month and source locator separate', async () => {
  const result = await debtDistress.fetchObservations({
    now,
    registry: { countries: [{ iso3: 'COG' }] },
  });
  assert.equal(result.count, 1);
  const [flag] = result.data.flags;
  assert.equal(flag.date, '2026-10-31');
  assert.equal(flag.dsaMonth, '2026-03');
  assert.equal(
    flag.sourceLocator,
    'Congo, Rep. — Risk of external debt distress',
  );
  assert.equal(
    flag.source,
    'https://www.worldbank.org/en/programs/debt-toolkit/dsa',
  );
  assert.equal(flag.reviewed, false);
});

test('an HTTP 429 with Retry-After defers requests across the same publisher origin', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return new Response(null, {
      status: 429,
      headers: { 'Retry-After': '60' },
    });
  };
  await assert.rejects(
    download(fetchImpl, 'https://fixture.invalid/one'),
    /429/,
  );
  await assert.rejects(
    download(fetchImpl, 'https://fixture.invalid/two'),
    /deferred/i,
  );
  assert.equal(attempts, 1);
});
const gdacsFixture =
  '<rss><channel><item><link>https://www.gdacs.org/report.aspx?eventtype=FL&amp;eventid=99</link><gdacs:alertlevel>Red</gdacs:alertlevel><gdacs:eventtype>FL</gdacs:eventtype><gdacs:eventid>99</gdacs:eventid><gdacs:country iso3="IND">India</gdacs:country><gdacs:population value="3456"/><pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate></item><item><gdacs:alertlevel>Orange</gdacs:alertlevel><gdacs:country iso3="PAK">Pakistan</gdacs:country></item></channel></rss><!--End 11/9/2026 12:55:39 AM-->';

test('GDACS red sets an attributed date and a valid quieter update clears it', async () => {
  const rows = gdacsFlags(gdacsFixture, now, new Set(['IND', 'PAK']));
  assert.deepEqual(
    rows.map(({ iso3, slot, date }) => [iso3, slot, date]),
    [['IND', 'C3', '2026-11-08']],
  );
  assert.match(rows[0].label, /3,456 people exposed/);
  assert.match(rows[0].source, /eventid=99/);
  const cleared = await gdacs.fetchObservations({
    now,
    data: { flags: rows },
    registry: { countries: [{ iso3: 'IND' }] },
    fetchImpl: async () =>
      new Response(gdacsFixture.replace('>Red<', '>Orange<')),
  });
  assert.equal(cleared.changes[0].action, 'cleared');
  assert.deepEqual(cleared.data.flags, []);
  assert.equal(cleared.observations, undefined);
  assert.throws(
    () => gdacsFlags('<html>bad</html>', now, new Set(['IND'])),
    /RSS/,
  );
});

test('FAO produces a world banner with two dated monthly levels', () => {
  const result = faoBanner(
    'Date,Food Price Index,Meat\n2026-09,124.0,100\n2026-10,127.1,110',
  );
  assert.equal(result.date, '2026-10');
  assert.equal(result.previousDate, '2026-09');
  assert.match(result.label, /127.1.*up 2.5%/i);
});

test('IMF CPI reads only matching monthly all-items index series', () => {
  const csv =
    'REF_AREA,INDICATOR,FREQ,TIME_PERIOD,OBS_VALUE\nIND,CPI_IX,M,2026-09,120\nIND,CPI_IX,A,2026,122\nARG,FOOD,M,2026-09,125';
  assert.deepEqual(cpiRows(csv), [
    { iso3: 'IND', period: '2026-09', value: 120 },
  ]);
});

test('IMF requests the public headline index and compares matching SDMX calendar months', async () => {
  const csv = [
    'STRUCTURE[;],STRUCTURE_ID,ACTION,COUNTRY,INDEX_TYPE,COICOP_1999,TYPE_OF_TRANSFORMATION,FREQUENCY,TIME_PERIOD,OBS_VALUE',
    'dataflow,IMF.STA:CPI(5.0.0),R,IND,CPI,_T,IX,M,2025-M09,100',
    'dataflow,IMF.STA:CPI(5.0.0),R,IND,CPI,_T,IX,M,2026-M09,125',
    'dataflow,IMF.STA:CPI(5.0.0),R,IND,CPI,CP01,IX,M,2026-M09,200',
    'dataflow,IMF.STA:CPI(5.0.0),R,IND,CPI,_T,PC_CP_A_PT,M,2026-M09,99',
    'dataflow,IMF.STA:CPI(5.0.0),R,IND,CPI,_T,IX,M,2026-M10,',
  ].join('\n');
  const result = await imfCpi.fetchObservations({
    now,
    registry: { countries: [{ iso3: 'IND' }] },
    fetchImpl(requested) {
      const url = new URL(requested);
      assert.equal(url.hostname, 'api.imf.org');
      assert.match(url.pathname, /\/\*\.CPI\._T\.IX\.M$/);
      assert.equal(url.searchParams.get('c[TIME_PERIOD]'), 'ge:2025-M06');
      return new Response(csv);
    },
  });
  assert.equal(result.data.records, 2);
  assert.equal(result.data.flags[0].date, '2026-09');
  assert.match(result.data.flags[0].label, /25\.0%/);
});

test('UNHCR reports dated displacement stocks and keeps missing coverage unknown', () => {
  const rows = [
    { year: 2025, coa_iso: 'SDN', coo_iso: 'SDN', idps: 200000 },
    { year: 2025, coa_iso: 'SDN', coo_iso: 'IND', idps: 5 },
  ];
  const flags = displacementFlags(rows, new Set(['SDN', 'IND']));
  assert.equal(flags[0].iso3, 'SDN');
  assert.match(flags[0].label, /200,000.*stock/i);
  assert.equal(flags.length, 1);
});

test('UCDP uses 25 recorded deaths as an inclusive draft threshold', async () => {
  const {
    data: { flags },
  } = await savedUcdp.fetchObservations({
    features: {
      ucdp: {
        period: '2026-10',
        deathsByIso3: { IND: 25, PAK: 24, USA: 25.9, JPN: '40', SDN: 0 },
      },
    },
    now,
  });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].iso3, 'IND');
  assert.equal(flags[0].recordedDeaths, 25);
  assert.equal(flags[0].date, '2026-10');
  assert.equal(flags[0].periodStart, '2025-11');
  assert.match(flags[0].label, /25.*draft threshold/i);
});

test('UCDP waits for released raw totals in older caches and ignores out-of-window periods', async () => {
  const result = await savedUcdp.fetchObservations({
    observations: [
      {
        iso3: 'IND',
        indicator: 'condition.conflict_deaths',
        period: '2026-10',
        value: 100,
      },
    ],
    now,
  });
  assert.deepEqual(result.data.flags, []);
  for (const period of ['2026-12', '2026-07', '2026-00']) {
    assert.deepEqual(
      ucdpStockFlags({ period, deathsByIso3: { IND: 500 } }, now),
      [],
    );
  }
});
