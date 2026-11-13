import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  bandWord,
  claimKind,
  figureText,
  meaningSentence,
  periodText,
  rowCaption,
  scoreWords,
  standouts,
  trendReading,
  worldComparison,
} from './worldWords.js';

const indicators = JSON.parse(
  readFileSync(new URL('../../public/world/indicators.json', import.meta.url)),
);
const byId = (id) => indicators.find((indicator) => indicator.id === id);
const polarisation = byId('condition.polarisation');
const gdp = byId('economy.gdp_ppp');
const deaths = byId('condition.conflict_deaths');

test('band words follow the approved ranges and unknown is never a band', () => {
  assert.equal(bandWord(0), 'Very weak');
  assert.equal(bandWord(19.4), 'Very weak');
  assert.equal(bandWord(20), 'Weak');
  assert.equal(bandWord(39.9), 'Weak');
  assert.equal(bandWord(40), 'Midrange');
  assert.equal(bandWord(59), 'Midrange');
  assert.equal(bandWord(60), 'Solid');
  assert.equal(bandWord(79), 'Solid');
  assert.equal(bandWord(80), 'Strong');
  assert.equal(bandWord(100), 'Strong');
  assert.equal(bandWord(null), 'Unknown');
  assert.equal(bandWord(Number.NaN), 'Unknown');
});

test('periods and figures read as words', () => {
  assert.equal(periodText('2024'), '2024');
  assert.equal(periodText('2026-10'), 'Oct 2026');
  assert.equal(periodText('2026-11-08'), '8 Nov 2026');
  assert.equal(periodText(null), null);
  assert.equal(figureText(2.08, 'interval score'), '2.08');
  assert.equal(figureText(-3.81, 'interval score'), '−3.81');
  assert.equal(figureText(130.8, '% of GDP'), '130.8% of GDP');
  assert.equal(figureText(73, 'years'), '73 years');
  assert.equal(figureText(1e10, 'US$'), '10 billion US$');
  assert.equal(figureText(null, 'US$'), null);
});

test('a measurement, an estimate, a forecast, a stale value and an unknown each say what they are', () => {
  assert.deepEqual(claimKind({ score: 50, method: 'observed' }), {
    kind: 'measured',
    label: null,
    stale: false,
  });
  assert.equal(
    claimKind({ score: 50, method: 'source-estimate' }).label,
    "the source's own estimate",
  );
  assert.equal(
    claimKind({ score: 50, method: 'source-forecast' }).kind,
    'forecast',
  );
  assert.equal(claimKind({ score: 50, stale: true }).stale, true);
  assert.equal(claimKind({ score: null, stale: true }).kind, 'unknown');
  const caption = (fields) =>
    rowCaption({ period: '2025', source: 'V-Dem', score: 24, ...fields });
  assert.equal(caption({ method: 'observed' }), '2025 · V-Dem');
  assert.equal(
    caption({ method: 'source-estimate' }),
    "2025 · V-Dem · the source's own estimate",
  );
  assert.equal(
    caption({ method: 'source-forecast', period: '2026' }),
    '2026 · V-Dem · forecast',
  );
  assert.equal(caption({ stale: true }), '2025 · V-Dem · stale');
  assert.equal(
    caption({ score: null, period: null }),
    'No published period · V-Dem · unknown',
  );
});

test('the meaning sentence reads the stored value against the published scale', () => {
  assert.equal(
    meaningSentence(polarisation, {
      score: 24,
      period: '2025',
      observation: { value: 2.08, method: 'source-estimate' },
    }),
    "Political polarisation was 2.08 in 2025, the source's own estimate; on the board's scale 3.94 or more scores 0 and −3.81 or less scores 100.",
  );
  assert.equal(
    meaningSentence(gdp, {
      score: 86,
      period: '2019',
      stale: true,
      observation: { value: 1e13, method: 'observed' },
    }),
    "GDP, PPP (current international dollars) was 10 trillion international $ in 2019, now stale; on the board's scale 10 billion international $ or less scores 0 and 31.6 trillion international $ or more scores 100.",
  );
  assert.match(
    meaningSentence(deaths, {
      score: 90,
      period: '2026-10',
      observation: { value: 0.3, method: 'source-forecast' },
    }),
    /in Oct 2026, forecast; on the board's scale 999 deaths per million people or more scores 0 and 0 deaths per million people or less scores 100\.$/,
  );
  assert.equal(
    meaningSentence(polarisation, { score: null }),
    'No published value is held for political polarisation, so the bar is hatched and is not counted as low.',
  );
  assert.match(
    meaningSentence(polarisation, {
      score: null,
      observation: { value: 1 },
    }),
    /shown as unknown, never as low/,
  );
});

const snapshot = {
  indicators,
  countries: {
    IND: { kind: 'state', slots: { C6: { score: 24 } } },
    PAK: { kind: 'state', slots: { C6: { score: 50 } } },
    CHN: { kind: 'state', slots: { C6: { score: 10 } } },
    BRA: { kind: 'state', slots: { C6: { score: 60 } } },
    USA: { kind: 'state', slots: { C6: { score: null } } },
    GRL: { kind: 'territory', slots: { C6: { score: 99 } } },
    ATA: { kind: 'disputed', slots: {} },
  },
};

test('the world comparison counts only other states with a figure', () => {
  assert.deepEqual(worldComparison(snapshot, polarisation, 'IND'), {
    sentence: 'More polarised than 2 of the 3 other countries with a figure.',
    position: 1 / 3,
  });
  assert.equal(
    worldComparison(snapshot, polarisation, 'BRA').sentence,
    'Less polarised than 3 of the 3 other countries with a figure.',
  );
  assert.equal(
    worldComparison(snapshot, polarisation, 'USA').sentence,
    'Unknown here, so it is not ranked against other countries.',
  );
  assert.equal(
    worldComparison(snapshot, polarisation, 'GRL').sentence,
    'Less polarised than 4 of the 4 other countries with a figure.',
  );
  const pair = {
    countries: {
      IND: snapshot.countries.IND,
      PAK: snapshot.countries.PAK,
    },
  };
  assert.equal(
    worldComparison(pair, polarisation, 'IND').sentence,
    'More polarised than 1 of the 1 other country with a figure.',
  );
  assert.deepEqual(
    worldComparison(
      { countries: { IND: snapshot.countries.IND } },
      polarisation,
      'IND',
    ),
    {
      sentence: 'No other country has a figure to compare with.',
      position: null,
    },
  );
  assert.equal(
    worldComparison(snapshot, { ...polarisation, id: 'new.figure' }, 'IND')
      .sentence,
    'Scores lower than 2 of the 3 other countries with a figure.',
  );
});

test('no trend is drawn without two stored periods, and none is invented', () => {
  const none = 'Earlier years are not stored yet, so no trend is drawn.';
  assert.deepEqual(trendReading({ score: 40 }), {
    sentence: none,
    change: null,
  });
  assert.deepEqual(
    trendReading({
      score: 40,
      history: [{ period: '2024', score: 40, method: 'observed' }],
    }),
    { sentence: none, change: null },
  );
  assert.equal(
    trendReading({ score: 40 }, 2).sentence,
    'This area combines several figures, so no trend is drawn.',
  );
  assert.equal(
    trendReading({ score: null, history: [] }).sentence,
    'Unknown now, so no trend is drawn.',
  );
});

test('a trend reads only the stored periods and says what kind each figure is', () => {
  const better = trendReading({
    score: 54,
    history: [
      { period: '2019', score: 48, method: 'observed' },
      { period: '2021', score: 50, method: 'source-estimate' },
      { period: '2024', score: 54, method: 'source-forecast' },
    ],
  });
  assert.equal(
    better.sentence,
    '6 points better than in 2019 (48 then, 54 now), across 3 stored periods. The latest figure is a forecast by the source. Some earlier figures are estimates or forecasts.',
  );
  assert.equal(better.change.points, 6);
  assert.equal(better.change.since, '2019');
  assert.ok(Math.abs(better.change.perYear - 6 / 5) < 0.01);
  const worse = trendReading({
    score: 40,
    history: [
      { period: '2025-09', score: 41, method: 'observed' },
      { period: '2026-09', score: 40, method: 'source-estimate' },
    ],
  });
  assert.equal(
    worse.sentence,
    "1 point worse than in Sep 2025 (41 then, 40 now), across 2 stored periods. The latest figure is the source's own estimate.",
  );
  assert.equal(
    trendReading({
      score: 40.2,
      history: [
        { period: '2020', score: 40, method: 'observed' },
        { period: '2024', score: 40.2, method: 'observed' },
      ],
    }).sentence,
    'About level since 2020 (40 then, 40 now), across 2 stored periods.',
  );
});

test('every score gets a band, a meaning, a comparison and a trend', () => {
  const words = scoreWords(snapshot, polarisation, 'IND');
  assert.equal(words.band, 'Weak');
  assert.equal(words.kind.kind, 'measured');
  assert.match(words.meaning, /^Political polarisation scores 24 of 100;/);
  assert.match(words.world.sentence, /^More polarised/);
  assert.equal(
    words.trend.sentence,
    'Earlier years are not stored yet, so no trend is drawn.',
  );
  const unknown = scoreWords(snapshot, polarisation, 'USA');
  assert.equal(unknown.band, 'Unknown');
  assert.equal(unknown.kind.kind, 'unknown');
  assert.equal(scoreWords(snapshot, polarisation, 'ATA').band, 'Unknown');
});

const row = (area, section, score, trend = null) => ({
  area,
  section,
  score,
  words: { trend: { change: trend } },
});

test('the standouts name strongest and weakest and pick a fastest only from a trend', () => {
  assert.deepEqual(standouts([row('Energy', 'strength', null)]), {
    sentence: 'No area has a published score yet, so nothing stands out.',
    target: null,
  });
  assert.deepEqual(
    standouts([
      row('Essential services', 'condition', 90),
      row('Societal cooperation', 'condition', 24),
      row('Energy', 'strength', 24.2),
      row('Culture', 'strength', null),
    ]),
    {
      sentence:
        'Strongest: essential services, strong at 90. Weakest: societal cooperation and energy, weak at 24. No area has two stored periods yet, so none is picked as moving fastest.',
      target: 'condition',
    },
  );
  assert.equal(
    standouts([row('Energy', 'strength', 50), row('Food', 'strength', 50)])
      .sentence,
    'Strongest: energy and food, midrange at 50. Every published score is the same, so none is weakest. No area has two stored periods yet, so none is picked as moving fastest.',
  );
  const moving = standouts([
    row('Energy', 'strength', 70, { points: 4, since: '2020', perYear: 1 }),
    row('Food', 'strength', 30, { points: -6, since: '2023', perYear: -6 }),
  ]);
  assert.equal(moving.target, 'strength');
  assert.match(
    moving.sentence,
    /Moving fastest: food, 6 points worse than in 2023\.$/,
  );
  assert.match(
    standouts([
      row('Energy', 'strength', 70, {
        points: 0.2,
        since: '2020',
        perYear: 0.05,
      }),
    ]).sentence,
    /No area has moved by a point or more across its stored periods\.$/,
  );
});
