import assert from 'node:assert/strict';
import test from 'node:test';
import { runWorldSources } from './sourceQueue.js';

test('a source waits outside its HTTP deadline while another source uses its declared host', async () => {
  const release = Promise.withResolvers();
  const started = [];
  const deadlines = new Map();
  const ids = ['people', 'facilities', 'independent'];
  const work = runWorldSources(
    ids.map((id) => ({ id })),
    {
      adapters: {
        people: { requestHost: 'query.wikidata.org' },
        facilities: { requestHost: 'query.wikidata.org' },
      },
      dependencies: {},
      completed: new Map(),
      async run(id) {
        started.push(id);
        const deadline = AbortSignal.timeout(id === 'people' ? 5_000 : 20);
        deadlines.set(id, deadline);
        if (id === 'people') await release.promise;
        return !deadline.aborted;
      },
    },
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(started, ['people', 'independent']);
    assert.equal(deadlines.has('facilities'), false);
  } finally {
    release.resolve();
    await work;
  }
  assert.deepEqual(started, ['people', 'independent', 'facilities']);
  assert.equal(deadlines.get('facilities').aborted, false);
});
