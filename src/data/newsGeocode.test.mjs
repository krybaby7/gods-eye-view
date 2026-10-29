import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizePlaceName,
  placeNamesForPrompt,
  resolvePlace,
} from '../../server/providers/news/geocode.js';

const theater = JSON.parse(
  readFileSync(
    new URL('../../public/news/theaters/iran-israel-us.json', import.meta.url),
    'utf8',
  ),
);
const gazetteer = theater.gazetteer;

const fixture = [
  {
    name: 'Khan Younis',
    lat: 31.3462,
    lon: 34.306,
    precision: 'city',
    aliases: ['Khan Yunis', 'خان يونس', 'חאן יונס'],
  },
  {
    name: 'Gaza Strip',
    lat: 31.42,
    lon: 34.37,
    precision: 'region',
    aliases: ['Gaza'],
  },
  {
    name: 'Natanz enrichment site',
    lat: 33.7243,
    lon: 51.727,
    precision: 'site',
    aliases: ['Natanz FEP', 'تأسیسات نطنز'],
  },
  {
    name: "Be'eri",
    lat: 31.4236,
    lon: 34.4931,
    precision: 'locality',
    aliases: ['Beeri'],
  },
  {
    name: 'Al-Mawasi',
    lat: 31.355,
    lon: 34.265,
    precision: 'locality',
    aliases: [],
  },
];

test('normalization folds case, Latin diacritics, apostrophes and punctuation', () => {
  assert.equal(normalizePlaceName('  Kürecik  '), 'kurecik');
  assert.equal(normalizePlaceName("Be'eri"), 'beeri');
  assert.equal(normalizePlaceName('Sana’a'), 'sanaa');
  assert.equal(normalizePlaceName('Tel Aviv-Yafo'), 'tel aviv yafo');
  assert.equal(normalizePlaceName(null), '');
});

test('normalization folds Arabic, Persian and Hebrew spellings', () => {
  // Hamza-on-alef, tatweel and harakat fold to the bare letters.
  assert.equal(normalizePlaceName('أَصفهان'), normalizePlaceName('اصفهان'));
  assert.equal(normalizePlaceName('غـزة'), normalizePlaceName('غزه'));
  // Persian yeh/kaf match their Arabic forms; ZWNJ separates like a space.
  assert.equal(normalizePlaceName('ایران'), normalizePlaceName('ايران'));
  assert.equal(normalizePlaceName('خرم‌آباد'), normalizePlaceName('خرم آباد'));
  // Hebrew niqqud and geresh disappear.
  assert.equal(
    normalizePlaceName('יְרוּשָׁלַיִם'),
    normalizePlaceName('ירושלים'),
  );
  assert.equal(normalizePlaceName('ג׳נין'), normalizePlaceName('גנין'));
});

test('exact names and aliases resolve in every script', () => {
  const expected = {
    lat: 31.3462,
    lon: 34.306,
    precision: 'city',
    method: 'gazetteer',
    name: 'Khan Younis',
  };
  for (const spelling of [
    'Khan Younis',
    'khan yunis',
    'KHAN-YUNIS',
    'خان يونس',
    'خانْ يونس',
    'חאן יונס',
  ])
    assert.deepEqual(resolvePlace(spelling, fixture), expected, spelling);
  assert.equal(
    resolvePlace('تاسیسات نطنز', fixture).name,
    'Natanz enrichment site',
  );
  assert.equal(resolvePlace('Beeri', fixture).name, "Be'eri");
  assert.equal(resolvePlace("Be'eri", fixture).name, "Be'eri");
});

test('a leading article is optional on either side', () => {
  assert.equal(resolvePlace('Mawasi', fixture).name, 'Al-Mawasi');
  assert.equal(resolvePlace('el-Mawasi', fixture).name, 'Al-Mawasi');
  assert.equal(resolvePlace('the Gaza Strip', fixture).name, 'Gaza Strip');
});

test('the longest contained name wins over a broader one', () => {
  const hit = resolvePlace(
    'Nasser hospital area, Khan Yunis, southern Gaza',
    fixture,
  );
  assert.equal(hit.name, 'Khan Younis');
  assert.equal(hit.precision, 'city');
  assert.equal(resolvePlace('central Gaza', fixture).name, 'Gaza Strip');
});

test('across separate mentions the finest precision wins', () => {
  const hit = resolvePlace('Gaza, near the Natanz FEP', fixture);
  assert.equal(hit.name, 'Natanz enrichment site');
  assert.equal(hit.precision, 'site');
});

test('contained matching respects word boundaries', () => {
  // "Gaza" must not match inside another word.
  assert.equal(resolvePlace('Gazaland', fixture), null);
});

test('unknown, empty and non-string places return null', () => {
  assert.equal(resolvePlace('Atlantis', fixture), null);
  assert.equal(resolvePlace('', fixture), null);
  assert.equal(resolvePlace(undefined, fixture), null);
  assert.equal(resolvePlace(42, fixture), null);
  assert.equal(resolvePlace('Gaza', []), null);
  assert.equal(resolvePlace('Gaza', null), null);
});

test('the real theater gazetteer resolves its seed hints', () => {
  for (const [spelling, name] of [
    ['strait of hormuz', 'Strait of Hormuz'],
    ['Al Hudaydah', 'Hodeidah'],
    ['Natanz', 'Natanz'],
    ['Fordo', 'Fordow enrichment site'],
    ['TLV', 'Ben Gurion Airport'],
    ['Tehran FIR', 'Iran'],
    ['الضاحية الجنوبية', 'Dahiyeh'],
    ['بندرعباس', 'Bandar Abbas'],
    ['רפיח', 'Rafah'],
    ['Jabalia refugee camp', 'Jabalia'],
    ['Bint Jbeil, southern Lebanon', 'Bint Jbeil'],
  ])
    assert.equal(resolvePlace(spelling, gazetteer)?.name, name, spelling);
});

test('prompt names carry names and Latin aliases, never coordinates', () => {
  const lines = placeNamesForPrompt(fixture);
  assert.deepEqual(lines, [
    'Khan Younis (Khan Yunis)',
    'Gaza Strip (Gaza)',
    'Natanz enrichment site (Natanz FEP)',
    // An alias that folds to the name adds nothing to the prompt.
    "Be'eri",
    'Al-Mawasi',
  ]);
  const real = placeNamesForPrompt(gazetteer).join('\n');
  assert.doesNotMatch(real, /\d+\.\d+/);
  assert.match(real, /^Tehran \(Teheran\)$/m);
  assert.deepEqual(placeNamesForPrompt(null), []);
});

test('with prompt-flagged rows the prompt lists only those, by name; matching still uses every row', () => {
  const flagged = [
    { ...fixture[0], prompt: true },
    fixture[1],
    { ...fixture[2], prompt: true },
    fixture[3],
  ];
  assert.deepEqual(placeNamesForPrompt(flagged), [
    'Khan Younis',
    'Natanz enrichment site',
  ]);
  // A truthy value that is not true flags nothing.
  assert.equal(
    placeNamesForPrompt([{ ...fixture[0], prompt: 'yes' }, fixture[1]]).length,
    2,
  );
  assert.equal(resolvePlace('Gaza', flagged)?.name, 'Gaza Strip');
  assert.equal(resolvePlace('خان يونس', flagged)?.name, 'Khan Younis');
  assert.equal(resolvePlace('Beeri', flagged)?.name, "Be'eri");
});
