import assert from 'node:assert/strict';
import test from 'node:test';
import { makeRelation, relationResult } from './relations.js';

test('makes attributed dated records without assigning undocumented dates', () => {
  const input = {
    id: 'rel_example',
    type: 'alliance',
    from: 'FRA',
    to: 'GRC',
    detail: 'Test',
    sources: ['https://example.org'],
  };
  assert.deepEqual(makeRelation(input), {
    directed: false,
    start: null,
    end: null,
    conditions: null,
    evidence: 'documented',
    ...input,
  });
});

test('reports substantive relation additions and removals without retrieval date churn', () => {
  const previous = {
    relations: [
      { id: 'stable', detail: 'Same', retrievedAt: 'old' },
      { id: 'removed', detail: 'Removed' },
    ],
  };
  const result = relationResult(
    [
      { id: 'stable', detail: 'Same', retrievedAt: 'new' },
      { id: 'added', detail: 'Added' },
    ],
    previous,
    'Test',
  );
  assert.equal(result.count, 2);
  assert.equal(result.data.relations.length, 2);
  assert.deepEqual(result.changes, [
    {
      iso3: null,
      text: 'Test relations changed (1 added, 1 removed, 0 updated).',
    },
  ]);
});
