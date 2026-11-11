import assert from 'node:assert/strict';
import test from 'node:test';
import { railFixture } from './railTestFixture.mjs';
import { renderRelationsTab } from './worldRelationsTab.js';
import { renderRelationCard } from './worldRelationCard.js';

test('shows grouped UCDP support with a dyad count and a mission cue only where documented', () => {
  const support = {
    id: 'support-caf',
    type: 'support_to_party',
    directed: true,
    from: 'CHN',
    to: 'CAF',
    toLabel: 'Government of Central African Republic',
    period: '2025',
    dyadIds: ['16562', '18287', '18304'],
    unMission: 'MINUSCA',
  };
  const other = {
    ...support,
    id: 'support-pak',
    to: 'PAK',
    toLabel: 'Government of Pakistan',
    dyadIds: ['100'],
    unMission: undefined,
  };
  const snapshot = {
    selected: 'CHN',
    countryIndex: [{ iso3: 'CHN', name: 'China' }],
    features: { 'relations-ucdp': { relations: [support, other] } },
  };
  const { document, find } = railFixture();
  const panel = renderRelationsTab({
    document,
    snapshot,
    sheetModel: { iso3: 'CHN' },
  });
  assert.equal(
    find(({ dataset }) => dataset.worldRelation === support.id, panel)
      .textContent,
    'Government of Central African Republic · 3 dyads (UN mission troop contributor, per UCDP)',
  );
  assert.equal(
    find(({ dataset }) => dataset.worldRelation === other.id, panel)
      .textContent,
    'Government of Pakistan · 1 dyad',
  );
  const card = renderRelationCard({ document, snapshot, id: support.id });
  assert.equal(
    card.children.filter(({ textContent }) =>
      textContent?.includes(support.toLabel),
    ).length,
    1,
  );
  assert.ok(
    find(
      ({ textContent }) =>
        textContent?.includes(
          '3 dyads (UN mission troop contributor, per UCDP)',
        ),
      card,
    ),
  );
});
