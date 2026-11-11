import assert from 'node:assert/strict';
import test from 'node:test';
import checkRelations from './world-fact-checks/relations.mjs';

test('the war fact rejects a stale event included with current evidence', async () => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const evidence = {
    a: 'RUS',
    b: 'UKR',
    sourceUrl: 'https://ucdp.uu.se/downloads/',
  };
  const rows = await checkRelations({
    board: {
      features: {
        relations: {
          relations: [
            {
              type: 'current_armed_conflict',
              from: 'RUS',
              to: 'UKR',
              events: [
                { ...evidence, id: 'current', date: today },
                { ...evidence, id: 'stale', date: '2000-01-01' },
              ],
            },
          ],
        },
      },
    },
    getDetail: async () => null,
  });
  assert.equal(
    rows.find(({ id }) => id === 'relations-current-war-pairs').pass,
    false,
  );
});
test('Rio Treaty evidence leaves Venezuela inactive with every other party', async () => {
  const { fetchObservations } =
    await import('../server/providers/world/sources/relationsCurated.js');
  const { data } = await fetchObservations({});
  const rows = await checkRelations({
    board: { features: { 'relations-curated': data } },
    getDetail: async () => null,
  });
  const row = rows.find(({ id }) => id === 'relations-venezuela-rio-treaty');
  assert.equal(row?.pass, true);
  assert.deepEqual(row.found.allies, []);
});

test('the three required rivalry pairs are measured with their source rows', async () => {
  const { fetchObservations } =
    await import('../server/providers/world/sources/relationsCurated.js');
  const { data } = await fetchObservations({});
  const rows = await checkRelations({
    board: { features: { 'relations-curated': data } },
    getDetail: async () => null,
  });
  for (const id of [
    'relations-rivalry-CHN-IND',
    'relations-rivalry-GUY-VEN',
    'relations-rivalry-ISR-SYR',
  ]) {
    const check = rows.find((row) => row.id === id);
    assert.equal(check?.pass, true, id);
    assert.equal(check.found.mapClass, 'rival', id);
  }
});

test('Greece has a sourced rivalry cue in the NATO relation card facts', async () => {
  const { fetchObservations } =
    await import('../server/providers/world/sources/relationsCurated.js');
  const { data } = await fetchObservations({});
  const rows = await checkRelations({
    board: { features: { 'relations-curated': data } },
    getDetail: async () => null,
  });
  const cue = rows.find(({ id }) => id === 'relations-allied-rivalry-GRC-TUR');
  assert.equal(cue?.pass, true);
  assert.equal(cue.found.mapClass, 'ally');
  assert.ok(
    cue.found.sources.some((url) => url.startsWith('https://www.mfa.gr/')),
  );
});
