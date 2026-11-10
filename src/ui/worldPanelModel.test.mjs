import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  countrySheet,
  describeWorldHover,
  worldLegend,
  worldTurn,
} from './worldPanelModel.js';

const load = (name) =>
  JSON.parse(
    readFileSync(new URL(`../../public/world/${name}.json`, import.meta.url)),
  );
const snapshot = {
  indicators: load('indicators'),
  sources: load('sources'),
  asOf: '2026-11-08',
  countryIndex: [{ iso3: 'ATA', name: 'Antarctica', kind: 'disputed' }],
  countries: {
    USA: {
      name: 'United States',
      condition: { slot: 'C5', score: 16, period: '2026' },
      dataAge: 2022.5,
      coverage: { known: 1, total: 18 },
      retrievedAt: '2026-11-07T08:50:01Z',
      slots: {
        C5: {
          score: 16,
          period: '2026',
          stale: true,
          observation: {
            value: 130.8,
            method: 'source-forecast',
            url: 'javascript:alert(1)',
          },
        },
      },
    },
  },
};

test('sheet exposes coverage, forecast provenance and the actual formula', () => {
  const sheet = countrySheet(snapshot, 'USA');
  assert.equal(
    sheet.coverage,
    '1 of 18 indicators have a published value · fetched 2026-11-07',
  );
  assert.equal(sheet.condition.label, 'Fiscal');
  const row = sheet.rows.find(({ slot }) => slot === 'C5');
  assert.deepEqual(row.flags, ['Weakest', 'Stale', 'Source forecast']);
  assert.equal(row.value, '130.8% of GDP');
  assert.equal(row.rawValue, 130.8);
  assert.equal(row.sourceUrl, 'https://www.imf.org/external/datamapper/');
  assert.equal(row.formula, '100 × (1 − clip((x − 30) ÷ (150 − 30), 0, 1))');
  assert.equal(row.draft, true);
});

test('disputed territories can have a sheet without inventing scores', () => {
  const sheet = countrySheet(snapshot, 'ATA');
  assert.equal(sheet.name, 'Antarctica');
  assert.equal(sheet.disputed, true);
  assert.equal(sheet.condition.score, null);
  assert.equal(sheet.rows.length, 18);
  assert.ok(sheet.rows.every((row) => row.flags.includes('Unknown')));
  assert.deepEqual(sheet.rows.find(({ slot }) => slot === 'S12').flags, [
    'Unknown',
    'Low conf.',
  ]);
});

test('hover reflects the active lens, exact data-year median and forecast period', () => {
  assert.deepEqual(
    describeWorldHover({ ...snapshot, lens: 'condition' }, 'USA'),
    {
      name: 'United States',
      value: 'Weakest bar · Fiscal 16 / 100 (2026, source forecast)',
    },
  );
  assert.equal(
    describeWorldHover({ ...snapshot, lens: 'data-age' }, 'USA').value,
    'Typical data year 2022.5 (3.5 years old)',
  );
  assert.equal(
    describeWorldHover({ ...snapshot, lens: 'strength', area: 'S12' }, 'ATA')
      .value,
    'Unknown · disputed territory',
  );
});

test('legend follows the strength area or age scale', () => {
  assert.equal(
    worldLegend({ ...snapshot, lens: 'strength', area: 'S12' }).name,
    'Strength · Culture',
  );
  assert.deepEqual(worldLegend({ ...snapshot, lens: 'data-age' }).stops, [
    '8+ years old',
    '4 years old',
    'Current year',
  ]);
});

test('the country turn list includes source notices and selected country changes', () => {
  const turn = {
    number: 2,
    changes: [
      { iso3: 'USA', text: 'U.S. changed' },
      { iso3: 'GBR', text: 'U.K. changed' },
      { iso3: null, text: 'IMF failed.' },
    ],
  };
  assert.deepEqual(worldTurn(turn), {
    label: 'Turn 2',
    summary: '2 countries changed · 1 source notice',
    changes: ['U.S. changed', 'U.K. changed', 'IMF failed.'],
  });
  assert.deepEqual(worldTurn(turn, 'USA').changes, [
    'U.S. changed',
    'IMF failed.',
  ]);
  assert.equal(
    worldTurn({ number: 1, newObservations: 6, changes: [] }).summary,
    '6 observations loaded',
  );
});
