import assert from 'node:assert/strict';
import test from 'node:test';
import './phase-3.js';
import { worldFeatureViews } from './refreshRegistry.js';
import { fetchObservations as curated } from './sources/relationsCurated.js';
import { classifyDiplomacy } from '../../../src/layers/world/relations.js';

test('keeps only lens inputs on the board and reads heavy relation details per country', () => {
  const { summary, detail } = worldFeatureViews.get('diplomacy');
  const relation = (type, from, to) => ({
    type,
    from,
    to,
    sources: ['https://example.com/'],
    detail: 'proof',
  });
  const features = {
    'relations-diplomatic': {
      relations: [relation('diplomatic_relation', 'USA', 'GBR')],
    },
    'relations-voting': {
      relations: [
        relation('un_alignment', 'USA', 'GBR'),
        relation('un_alignment', 'AUS', 'IND'),
      ],
    },
    'relations-ucdp': { relations: [relation('armed_conflict', 'USA', 'GBR')] },
  };
  assert.equal(
    summary['relations-voting'](features['relations-voting']),
    undefined,
  );
  assert.equal(
    summary['relations-ucdp'](features['relations-ucdp']).relations,
    undefined,
  );
  assert.deepEqual(
    summary['relations-diplomatic'](features['relations-diplomatic']),
    { pairs: [['USA', 'GBR']] },
  );
  const selected = detail({ country: 'USA', features }).features;
  assert.equal(selected['relations-voting'].relations.length, 1);
  assert.equal(selected['relations-voting'].relations[0].detail, 'proof');
});

test('official AU and Arab League rosters keep membership distinct from suspension', async () => {
  const { data } = await curated({});
  const au = data.relations.filter(
    ({ to, type }) => to === 'AU' && type === 'bloc_membership',
  );
  const arab = data.relations.filter(
    ({ to, type }) => to === 'Arab League' && type === 'bloc_membership',
  );
  assert.equal(au.length, 55);
  assert.equal(arab.length, 22);
  assert.equal(
    au.find(({ from }) => from === 'GNB').membershipStatus,
    'suspended',
  );
  assert.equal(
    au.find(({ from }) => from === 'GIN').membershipStatus,
    'resumed',
  );
  assert.equal(
    arab.find(({ from }) => from === 'SYR').statusSince,
    '2023-05-07',
  );
});

test('the three Makkah pact parties paint as allies and former Qatar rivals are excluded', async () => {
  const {
    data: { relations },
  } = await curated({});
  const pact = relations.find(({ id }) => id === 'rel_makkah');
  assert.deepEqual(pact?.participants, ['SAU', 'TUR', 'PAK']);
  assert.equal(pact.start, '2026-08-07');
  assert.match(pact.detail, /5 November 2026/);
  for (const [a, b] of [
    ['SAU', 'TUR'],
    ['SAU', 'PAK'],
    ['TUR', 'PAK'],
  ])
    assert.equal(classifyDiplomacy(a, b, relations), 'ally');
  assert.notEqual(classifyDiplomacy('SAU', 'QAT', relations), 'rival');
  assert.equal(classifyDiplomacy('CHN', 'IND', relations), 'rival');
  assert.equal(classifyDiplomacy('MYS', 'SGP', relations), 'rival');
  assert.equal(relations.filter(({ type }) => type === 'rivalry').length, 44);
});
