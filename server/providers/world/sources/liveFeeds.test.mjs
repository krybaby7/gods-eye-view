import assert from 'node:assert/strict';
import test from 'node:test';
import { gdacsFlags, gdacs } from './liveDisasters.js';
import { faoBanner, cpiRows } from './livePrices.js';
import { ucdpStockFlags, displacementFlags } from './liveDisplacement.js';

const now = new Date('2026-11-09T10:00:00Z');
const gdacsFixture =
  '<rss><channel><item><link>https://www.gdacs.org/report.aspx?eventtype=FL&amp;eventid=99</link><gdacs:alertlevel>Red</gdacs:alertlevel><gdacs:eventtype>FL</gdacs:eventtype><gdacs:eventid>99</gdacs:eventid><gdacs:country iso3="IND">India</gdacs:country><gdacs:population value="3456"/><pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate></item><item><gdacs:alertlevel>Orange</gdacs:alertlevel><gdacs:country iso3="PAK">Pakistan</gdacs:country></item></channel></rss>';

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

test('UCDP flags reuse dated saved observations without claiming raw fatality counts', () => {
  const flags = ucdpStockFlags(
    [
      {
        iso3: 'IND',
        indicator: 'condition.conflict_deaths',
        value: 2.5,
        period: '2026-10',
      },
      {
        iso3: 'IND',
        indicator: 'condition.conflict_deaths',
        value: 0,
        period: '2026-09',
      },
    ],
    now,
  );
  assert.equal(flags.length, 1);
  assert.match(flags[0].label, /2.5 per million/);
});
