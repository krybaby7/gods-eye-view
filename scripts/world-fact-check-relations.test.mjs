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
