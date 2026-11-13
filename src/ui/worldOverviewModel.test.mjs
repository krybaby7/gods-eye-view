import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alertLine,
  conditionLine,
  dependencyLine,
  leadershipLine,
  overviewLines,
  relationsLine,
  standoutLine,
} from './worldOverviewModel.js';

const conditionRow = (slot, area, score, kind = 'measured') => ({
  slot,
  area,
  section: 'condition',
  score,
  words: { kind: { kind: score === null ? 'unknown' : kind }, trend: {} },
});

const sheet = {
  iso3: 'IND',
  name: 'India',
  disputed: false,
  condition: { score: 24, label: 'Society' },
  rows: [
    conditionRow('C1', 'Governing continuity', 55),
    conditionRow('C2', 'Security and control', 97, 'estimate'),
    conditionRow('C3', 'Essential services', 90),
    conditionRow('C4', 'Household security', 89, 'forecast'),
    conditionRow('C5', 'Fiscal and payment continuity', null),
    conditionRow('C6', 'Societal cooperation', 24),
  ],
};
const countryIndex = [
  { iso3: 'IND', name: 'India' },
  { iso3: 'PAK', name: 'Pakistan' },
  { iso3: 'CHN', name: 'China' },
  { iso3: 'JPN', name: 'Japan' },
  { iso3: 'USA', name: 'United States' },
];

test('the Condition line names the weakest bar and keeps unknown bars unknown', () => {
  const line = conditionLine(sheet);
  assert.equal(line.target, 'condition');
  assert.equal(
    line.text,
    'Weakest bar: Society, weak at 24. 5 of 6 bars have a figure.',
  );
  assert.equal(line.bars.length, 6);
  assert.deepEqual(line.bars[4], {
    slot: 'C5',
    name: 'Fiscal and payment continuity',
    score: null,
    band: 'Unknown',
    kind: 'unknown',
  });
  assert.equal(line.bars[1].kind, 'estimate');
  assert.equal(
    conditionLine({ ...sheet, condition: { score: null, label: 'Condition' } })
      .text,
    '5 of 6 bars have a figure, too few to name a weakest bar.',
  );
});

const people = (actors) => ({ features: { wikidata: { actors } } });

test('who runs it reads the recorded officeholders with date and source', () => {
  const line = leadershipLine(
    people([
      {
        id: 'Q1',
        name: 'Person A',
        country: 'IND',
        role: 'head-of-government',
        since: '2014-05-26',
        asOf: '2026-11-08',
        source: 'wikidata',
      },
      {
        id: 'Q2',
        name: 'Person B',
        country: 'IND',
        role: 'head-of-state',
        acting: true,
        stale: true,
      },
      { id: 'Q3', name: 'Elsewhere', country: 'PAK', role: 'head-of-state' },
    ]),
    sheet,
  );
  assert.equal(
    line.text,
    'Person A, head of government since 26 May 2014. Person B, head of state, acting.',
  );
  assert.equal(
    line.caption,
    'as of 8 Nov 2026 · Wikidata · may be out of date',
  );
  assert.equal(line.target, 'people');
  const shared = leadershipLine(
    people([
      { id: 'Q1', name: 'Person C', country: 'IND', role: 'head-of-state' },
      {
        id: 'Q1',
        name: 'Person C',
        country: 'IND',
        role: 'head-of-government',
      },
    ]),
    sheet,
  );
  assert.equal(shared.text, 'Person C, head of state and government.');
  assert.equal(shared.caption, null);
  assert.equal(
    leadershipLine(people([]), sheet).text,
    'No head of state or government is recorded in the loaded sources.',
  );
  assert.equal(
    leadershipLine(
      people([
        { id: 'Q2', name: 'Person B', country: 'IND', role: 'head-of-state' },
      ]),
      sheet,
    ).text,
    'Head of government not recorded. Person B, head of state.',
  );
  assert.equal(
    leadershipLine({}, sheet).text,
    'Officeholders are not loaded yet.',
  );
  const disputed = leadershipLine({}, { ...sheet, disputed: true });
  assert.equal(disputed.target, null);
});

test('the standout line opens the tab of the weakest area', () => {
  const line = standoutLine(sheet);
  assert.equal(line.target, 'condition');
  assert.match(line.text, /^Strongest: security and control, strong at 97/);
  assert.match(line.text, /none is picked as moving fastest\.$/);
});

test('alerts list live flags with source and date, never cleared ones', () => {
  const snapshot = {
    features: {
      'live-gdacs': {
        flags: [
          {
            iso3: 'IND',
            label: 'Red GDACS flood alert',
            sourceName: 'GDACS',
            date: '2026-11-08',
          },
          {
            iso3: 'IND',
            label: 'INR down 20%',
            sourceName: 'Frankfurter',
            date: '2026-11-08',
            status: 'stale',
            staleSince: '2026-11-09',
          },
          {
            iso3: 'IND',
            label: 'Third',
            sourceName: 'X',
            date: '2026-11-01',
            status: 'active',
          },
          {
            iso3: 'IND',
            label: 'Fourth',
            sourceName: 'Y',
            date: '2026-11-02',
          },
          { iso3: 'PAK', label: 'Elsewhere' },
        ],
        inactiveFlags: [
          { iso3: 'IND', label: 'Old', status: 'cleared' },
          { iso3: 'IND', label: 'Expired', status: 'no-recent-data' },
        ],
      },
    },
  };
  const line = alertLine(snapshot, sheet);
  // The stale and the expired flags are neither counted nor shown.
  assert.equal(line.title, '3 alerts');
  assert.equal(line.count, 3);
  assert.equal(
    line.text,
    'Red GDACS flood alert · GDACS · 2026-11-08. Third · X · 2026-11-01. And 1 more.',
  );
  assert.doesNotMatch(line.text, /INR|Expired|Old/);
  const expiredOnly = alertLine(
    {
      features: {
        'live-gdacs': {
          flags: [{ iso3: 'IND', label: 'Stale one', status: 'stale' }],
          inactiveFlags: [
            { iso3: 'IND', label: 'Expired', status: 'no-recent-data' },
          ],
        },
      },
    },
    sheet,
  );
  assert.equal(expiredOnly.count, 0);
  assert.equal(expiredOnly.title, 'Alerts');
  assert.equal(
    expiredOnly.text,
    'No current alerts for this country in the loaded sources.',
  );
  const quiet = alertLine({ features: {} }, sheet);
  assert.equal(quiet.count, 0);
  assert.equal(
    quiet.text,
    'No current alerts for this country in the loaded sources.',
  );
});

test('allies, rivals and recent armed conflict come only from documented relations', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  const snapshot = {
    countryIndex,
    features: {
      'relations-curated': {
        relations: [
          {
            id: 'r1',
            type: 'alliance',
            from: 'QUAD',
            to: 'QUAD',
            participants: ['IND', 'JPN', 'USA'],
            instrument: 'The Quad',
          },
          {
            id: 'r2',
            type: 'rivalry',
            from: 'IND',
            to: 'CHN',
            sources: ['s1'],
          },
          {
            id: 'r3',
            type: 'rivalry',
            from: 'PAK',
            to: 'IND',
            sources: ['s2'],
          },
          { id: 'r4', type: 'rivalry', from: 'IND', to: 'JPN', sources: [] },
          {
            id: 'r5',
            type: 'alliance',
            from: 'IND',
            to: 'USA',
            end: '2020-01-01',
          },
        ],
      },
      'live-ucdp-saved': {
        bilateralEvents: [
          {
            id: 'e1',
            a: 'IND',
            b: 'PAK',
            date: '2026-10-01',
            sourceUrl: 'https://ucdp.uu.se/event/1',
          },
        ],
      },
    },
  };
  const line = relationsLine(snapshot, sheet, now);
  assert.equal(line.target, 'relations');
  assert.equal(
    line.text,
    'Armed conflict in the past 90 days with Pakistan. Allied through The Quad. Rivals: China and Pakistan.',
  );
  assert.equal(
    relationsLine({ countryIndex, features: {} }, sheet, now).text,
    'No alliance, rivalry or armed conflict is documented in the loaded sources.',
  );
});

test('a rival who also sanctions the country is still named', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  const cuba = { ...sheet, iso3: 'CUB', name: 'Cuba' };
  const snapshot = {
    countryIndex: [...countryIndex, { iso3: 'CUB', name: 'Cuba' }],
    features: {
      'relations-curated': {
        relations: [
          {
            id: 'rivalry-usa-cub',
            type: 'rivalry',
            from: 'USA',
            to: 'CUB',
            sources: ['s1', 's2'],
          },
          {
            id: 'tiar',
            type: 'alliance',
            from: 'TIAR',
            to: 'TIAR',
            participants: ['USA', 'CUB'],
            inactiveParticipants: ['CUB'],
            instrument: 'Rio Treaty',
          },
        ],
      },
      'relations-sanctions-ofac': {
        relations: [
          {
            id: 'ofac-cuba',
            type: 'sanctions',
            scope: 'state',
            from: 'USA',
            to: 'CUB',
            programme: 'CUBA',
          },
        ],
      },
    },
  };
  assert.equal(
    relationsLine(snapshot, cuba, now).text,
    'Rivals: United States.',
  );
});

test('the largest dependency is modelled and says so', () => {
  const modelled = {
    countryIndex,
    features: {
      'energy-dependencies': {
        mode: 'modelled',
        label: 'Modelled from 2024 BACI trade, benchmarked against EIA.',
        minorImporterFloor: 1,
        energyImports: { IND: 100, JPN: 0.5 },
        energyExposure: {
          IND: [
            { gate: 'chokepoint6', item: 'crude oil', shares: { all: 0.28 } },
            { gate: 'chokepoint1', item: 'crude oil', shares: { all: 0.32 } },
          ],
          CHN: [],
        },
      },
    },
  };
  const line = dependencyLine(modelled, sheet);
  assert.match(
    line.text,
    /^About 32% of India's energy imports pass .+, mostly crude oil\.$/,
  );
  assert.equal(line.kind, 'estimate');
  assert.equal(line.target, 'exposure');
  assert.match(line.caption, /^Modelled/);
  const minor = dependencyLine(modelled, {
    ...sheet,
    iso3: 'JPN',
    name: 'Japan',
  });
  assert.match(minor.text, /imports too little energy/);
  // A draft threshold is a data state: a plain caption, not a dashed edge.
  assert.equal(minor.caption, 'Draft threshold');
  assert.equal(minor.kind, undefined);
  assert.equal(
    dependencyLine(modelled, { ...sheet, iso3: 'CHN', name: 'China' }).text,
    'The route model assigns no energy imports through the monitored chokepoints.',
  );
  // The compact model keeps every importer's exposure, so a country it leaves
  // out is one the model finds no seaborne imports for.
  assert.equal(
    dependencyLine(modelled, { ...sheet, iso3: 'PAK', name: 'Pakistan' }).text,
    'The route model finds no seaborne energy imports for Pakistan.',
  );
  // A model that is not built yet never reads as an absence.
  const pending = dependencyLine(
    {
      features: {
        'energy-dependencies': {
          mode: 'pending',
          period: '2024',
          label: 'Refresh to rebuild energy exposure',
          rebuildRequired: true,
        },
      },
    },
    sheet,
  );
  assert.equal(
    pending.text,
    'The energy route model is not built yet. A Refresh builds it.',
  );
  assert.equal(pending.caption, 'Refresh to rebuild energy exposure');
  assert.equal(
    dependencyLine(
      {
        features: {
          'energy-dependencies': { mode: 'unavailable', reason: 'No BACI' },
        },
      },
      sheet,
    ).text,
    'The energy route model is not available, so no dependency can be named.',
  );
  assert.equal(
    dependencyLine(
      {
        countryIndex,
        features: { 'energy-dependencies': { mode: 'fixture' } },
      },
      sheet,
    ).text,
    'The route model holds no energy trade rows for India.',
  );
  const fixture = {
    countryIndex,
    features: {
      'energy-dependencies': {
        mode: 'fixture',
        rows: [
          {
            provider: 'USA',
            dependent: 'IND',
            route: [],
            shares: { all: 0.4 },
          },
        ],
      },
    },
  };
  const supplier = dependencyLine(fixture, sheet);
  assert.equal(
    supplier.text,
    "About 40% of India's energy imports come from United States.",
  );
  assert.equal(supplier.caption, 'Synthetic fixture data');
  assert.equal(
    dependencyLine({ features: {} }, sheet).text,
    'Energy trade routes are not loaded yet.',
  );
});

test('a band word in the Overview follows the rounded score it is shown with', () => {
  const rounded = {
    ...sheet,
    condition: { score: 19.6, label: 'Society' },
    rows: [conditionRow('C6', 'Societal cooperation', 19.6)],
  };
  const line = conditionLine(rounded);
  assert.equal(line.bars[0].band, 'Weak');
  assert.equal(
    line.text,
    'Weakest bar: Society, weak at 20. 1 of 1 bars have a figure.',
  );
});

test('the standout line marks a named forecast in words and in look', () => {
  const measured = standoutLine({
    ...sheet,
    rows: [
      conditionRow('C3', 'Essential services', 90),
      // A forecast that is neither strongest nor weakest marks nothing.
      conditionRow('C4', 'Household security', 50, 'forecast'),
      conditionRow('C6', 'Societal cooperation', 24),
    ],
  });
  assert.equal(measured.kind, undefined);
  assert.equal(measured.caption, undefined);
  const line = standoutLine(sheet);
  assert.equal(line.kind, 'estimate');
  const forecastWeakest = standoutLine({
    ...sheet,
    rows: [
      conditionRow('C3', 'Essential services', 90),
      conditionRow('C4', 'Household security', 12, 'forecast'),
    ],
  });
  assert.match(
    forecastWeakest.text,
    /Weakest: household security, very weak at 12 \(a forecast\)\./,
  );
  assert.equal(forecastWeakest.kind, 'estimate');
  assert.equal(forecastWeakest.caption, 'Includes a forecast or an estimate');
  // The strongest here (97) is the source's own estimate.
  assert.match(
    line.text,
    /^Strongest: security and control, strong at 97 \(the source's own estimate\)\./,
  );
});

test('the overview has six lines in order', () => {
  assert.deepEqual(
    overviewLines({ features: {}, countryIndex }, sheet).map(({ id }) => id),
    [
      'condition',
      'leadership',
      'standouts',
      'alerts',
      'relations',
      'dependency',
    ],
  );
});
