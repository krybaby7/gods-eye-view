import assert from 'node:assert/strict';
import test from 'node:test';
import './phase-3.js';
import { worldAdapters } from './refreshRegistry.js';
import { loadWorldRegistry } from './registry.js';

test('all Phase 3 adapters have attributed source definitions and load curated data', async () => {
  const registry = await loadWorldRegistry();
  const phase = registry.sources.filter(({ id }) =>
    id.startsWith('relations-'),
  );
  assert.equal(phase.length, 8);
  for (const {
    id,
    url,
    licence,
    access,
    releaseRhythm,
    attribution,
    marks,
  } of phase) {
    assert.ok(worldAdapters[id]?.fetchObservations);
    assert.ok(url && licence && access && releaseRhythm && attribution);
    assert.ok(Array.isArray(marks));
  }
  const { data } = await worldAdapters['relations-curated'].fetchObservations({
    registry,
  });
  const { relations } = data;
  assert.equal(new Set(relations.map(({ id }) => id)).size, relations.length);
  assert.ok(
    relations.some(
      ({ type, from, to }) =>
        type === 'rivalry' && from === 'USA' && to === 'CHN',
    ),
  );
  assert.ok(
    relations.some(
      ({ type, from, membershipStatus }) =>
        type === 'bloc_membership' &&
        from === 'SDN' &&
        membershipStatus === 'suspended',
    ),
  );
  assert.ok(
    data.relations.every(
      ({ reviewed, dateChecked, sources }) =>
        reviewed === false && dateChecked && sources.length,
    ),
  );
});
