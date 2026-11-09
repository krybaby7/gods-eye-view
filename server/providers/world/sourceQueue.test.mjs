import assert from 'node:assert/strict';
import test from 'node:test';
import { runWorldSources } from './sourceQueue.js';

test('a source waits outside its HTTP deadline while another source uses its declared host', async () => {
  const release = Promise.withResolvers();
  const started = [];
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
        if (id === 'people') await release.promise;
      },
    },
  );
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ['people', 'independent']);
  } finally {
    release.resolve();
    await work;
  }
  assert.deepEqual(started, ['people', 'independent', 'facilities']);
});
