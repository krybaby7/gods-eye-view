import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorldService } from './index.js';
import { loadWorldRegistry } from './registry.js';

test('scoped live refreshes leave the dataset and its scores unchanged', async () => {
  const registry = await loadWorldRegistry();
  registry.sources.push({ id: 'gdacs' });
  let now = new Date('2026-11-09T00:00:00Z');
  let state = { board: null, observations: [], turns: [], lastCheckedAt: {} };
  let datasetCalls = 0;
  let liveCalls = 0;
  let liveDue = true;
  const service = createWorldService({
    now: () => now,
    loadRegistry: async () => registry,
    store: {
      read: async () => state,
      write: async (next) => {
        state = next;
      },
    },
    adapters: {
      worldbank: {
        shouldCheck: () => true,
        async fetchObservations() {
          datasetCalls++;
          return {
            observations: [
              {
                indicator: 'condition.immunisation',
                iso3: 'IND',
                period: '2024',
                value: 85 + datasetCalls,
                method: 'observed',
                retrievedAt: now.toISOString(),
              },
            ],
          };
        },
      },
      gdacs: {
        live: true,
        shouldCheck: () => liveDue,
        async fetchObservations() {
          liveCalls++;
          const active = liveCalls % 2 !== 0;
          return {
            data: { active },
            changes: [
              {
                iso3: 'IND',
                text: active ? 'Red alert set' : 'Red alert cleared',
                kind: 'condition-flag',
                action: active ? 'set' : 'cleared',
              },
            ],
          };
        },
      },
    },
  });
  const premature = await service.refresh('gdacs');
  assert.equal(premature.turn, null);
  assert.equal(premature.progress, null);
  assert.equal(liveCalls, 0);
  assert.equal(await service.refresh('worldbank'), null);

  await service.refresh();
  await service.whenIdle();
  const first = await service.snapshot();
  assert.equal(first.turn.number, 1);
  assert.equal(first.features.gdacs.active, true);
  assert.equal(first.turn.newEvents, 1);
  const score = first.countries.IND.slots.C3.score;
  assert.ok(Number.isFinite(score));

  now = new Date('2026-11-09T00:15:00Z');
  await service.refresh('gdacs');
  await service.whenIdle();
  const scoped = await service.snapshot();
  assert.equal(scoped.turn.number, 2);
  assert.deepEqual(
    scoped.turn.sources.map(({ id }) => id),
    ['gdacs'],
  );
  assert.equal(scoped.countries.IND.slots.C3.score, score);
  assert.equal(scoped.features.gdacs.active, false);
  assert.equal(scoped.turn.statusChanges, 1);
  assert.equal(scoped.turn.newEvents, 0);
  assert.equal(datasetCalls, 1);
  assert.equal(liveCalls, 2);

  liveDue = false;
  await service.refresh('gdacs');
  await service.whenIdle();
  assert.equal((await service.snapshot()).turn.number, 2);
});
