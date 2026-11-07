import assert from 'node:assert/strict';
import { test } from 'node:test';

const valid = {
  label: 'Brief',
  summary: [{ text: 'A quoted fact.', sourceIds: ['s1'] }],
  groups: [{ id: 'g1', label: 'News' }],
  findings: [
    {
      kind: 'statement',
      title: 'Statement',
      summary: 'A person spoke.',
      groupId: 'g1',
      actor: 'Person',
      place: { name: 'Lima', basis: 'said-here' },
      sourceIds: ['s1'],
    },
  ],
};

test('map receives source ids, names and notes with URL text removed', async () => {
  const { runMapStep, MAP_SCHEMA } = await import('./mapper.js');
  const adapter = {
    async mapFindings({ prompt, schema }) {
      assert.match(prompt, /s1/);
      assert.match(prompt, /example\.com/);
      assert.match(prompt, /Lima/);
      assert.match(prompt, /f_previous/);
      assert.match(prompt, /\[s1\]/);
      assert.doesNotMatch(
        prompt,
        /https?:\/\/|www\.example\.com|private\/page/,
      );
      assert.equal(schema, MAP_SCHEMA);
      return { json: valid, usage: {}, agentModel: 'claude' };
    },
  };
  const result = await runMapStep(adapter, {
    question: 'What is at https://example.com/private/page?',
    notes:
      '[a link](https://example.com/private/page?utm_source=notes), www.example.com/private/page.',
    sources: [
      {
        id: 's1',
        domain: 'example.com',
        url: 'https://example.com/private/page',
        title: 'Title',
        snippet: 'https://example.com/private/page',
      },
    ],
    gazetteer: [{ name: 'Lima' }],
    previousFindings: [
      { id: 'f_previous', title: 'Earlier', place: { name: 'Lima' } },
    ],
  });
  assert.deepEqual(result, { mapped: valid, usage: {}, agentModel: 'claude' });
});

test('map validation rejects URLs, model-owned extras and overlong collections', async () => {
  const { parseMappedFindings } = await import('./mapper.js');
  assert.deepEqual(parseMappedFindings(JSON.stringify(valid)), valid);
  const variants = [
    { ...valid, label: 'https://example.com' },
    { ...valid, label: 'example.com/link' },
    { ...valid, groups: Array(7).fill(valid.groups[0]) },
    { ...valid, findings: Array(61).fill(valid.findings[0]) },
    {
      ...valid,
      findings: [{ ...valid.findings[0], verification: 'verified' }],
    },
  ];
  for (const value of variants)
    assert.throws(() => parseMappedFindings(value), {
      code: 'SEARCH_MAP_INVALID',
    });
});
