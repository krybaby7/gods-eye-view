import assert from 'node:assert/strict';
import test from 'node:test';
import checkPeople from './world-fact-checks/people.mjs';

test('People measures a single attributed portrait, disagreement counts and stale counts', async () => {
  const murmu = {
    country: 'IND',
    role: 'head-of-state',
    name: 'Droupadi Murmu',
    id: 'Q19901232',
    imageFile: 'Portrait.jpg',
    source: 'wikidata',
    asOf: '2026-11-10',
    stale: false,
  };
  const check = async (actors, portraits) =>
    new Map(
      (
        await checkPeople({
          board: {
            features: {
              wikidata: { actors },
              'wikimedia-commons': { portraits },
            },
          },
          getDetail: async () => null,
        })
      ).map((fact) => [fact.id, fact]),
    );
  const portrait = {
    thumbnail:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/portrait.jpg',
    author: 'Photographer',
    licence: 'CC BY 4.0',
  };
  const accepted = await check([murmu], { 'Portrait.jpg': portrait });
  assert.equal(
    accepted.get('people-IND-head-of-state-corroborated').pass,
    true,
  );
  assert.equal(accepted.get('people-office-disagreements').found.after, 0);
  assert.equal(accepted.get('people-stale-cues').found.after, 0);
  const missing = await check([murmu], {});
  assert.equal(
    missing.get('people-IND-head-of-state-corroborated').pass,
    false,
  );
  const conflict = await check(
    [{ ...murmu, stale: true, disagreement: { name: 'Other Person' } }],
    { 'Portrait.jpg': portrait },
  );
  assert.equal(
    conflict.get('people-IND-head-of-state-corroborated').pass,
    false,
  );
  assert.equal(conflict.get('people-office-disagreements').found.after, 1);
  assert.equal(conflict.get('people-stale-cues').found.after, 1);
});

test('People reports an unavailable expectation file as not measured', async () => {
  const [result] = await checkPeople({
    board: {},
    getDetail: async () => null,
    samplePath: new URL('./not-a-real-people-sample.json', import.meta.url),
  });
  assert.equal(result.pass, null);
  assert.match(result.found.reason, /people-sample\.json.*not found/);
});

test('People keeps 30 countries and accepts only verified name variants with dated evidence', async () => {
  const actors = [
    {
      country: 'IND',
      role: 'defence-minister',
      name: 'Rajnath Singh',
      source: 'wikidata',
      asOf: '2024-07-01',
    },
    {
      country: 'PHL',
      role: 'head-of-state',
      name: 'Bongbong Marcos',
      source: 'wikidata',
      asOf: '2022-06-30',
    },
    {
      country: 'JPN',
      role: 'defence-minister',
      name: 'Shinjiro Koizumi',
      source: 'official',
      asOf: '2026-09-18',
      disagreement: {
        name: 'Gen Nakatani',
        source: 'cia-world-leaders',
        asOf: '2025-05-23',
      },
    },
  ];
  const checks = await checkPeople({
    board: { features: { wikidata: { actors } }, countryIndex: [] },
    getDetail: async () => null,
  });
  for (const id of [
    'people-IND-defence-minister',
    'people-PHL-head-of-state',
    'people-JPN-defence-minister-dated',
  ]) {
    assert.equal(checks.find((check) => check.id === id)?.pass, true, id);
  }
  assert.equal(new Set(checks.map(({ id }) => id)).size, checks.length);
  const sample = checks.find(({ id }) => id === 'people-four-office-sample');
  assert.equal(sample.found.total, 120);
  assert.equal(sample.found.countries, 30);
  assert.match(sample.expected, /90%/);
  const sources = checks.find(({ id }) => id === 'people-office-source-counts');
  assert.equal(sources.found.disagreements, 1);
});
