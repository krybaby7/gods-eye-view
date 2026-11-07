import assert from 'node:assert/strict';
import { test } from 'node:test';

test('research prompt includes localizable guidance and update context', async () => {
  const { buildResearchPrompt } = await import('./research.js');
  const prompt = buildResearchPrompt({
    question: 'What changed?',
    now: new Date('2026-11-07'),
    since: '2026-11-05T15:00:00Z',
    previousFindings: [{ id: 'f_a', title: 'Earlier' }],
  });
  assert.match(prompt, /2026-11-07/);
  assert.match(prompt, /since 2026-11-05/i);
  assert.match(prompt, /Earlier/);
  assert.match(prompt, /two weeks/i);
  assert.match(prompt, /primary/i);
  assert.match(prompt, /globe/i);
});

test('research canonicalizes, ranks and caps tool results without probing URLs in notes', async () => {
  const { collectResearchSources } = await import('./research.js');
  const list = Array.from({ length: 90 }, (_, i) => ({
    url: 'https://example.com/article-' + i,
    date: '2026-11-06',
  }));
  list.unshift({
    url: 'https://www.example.com/article-89?utm_source=test',
    title: 'Duplicate',
  });
  list.push(
    { url: 'http://localhost/private' },
    { url: 'https://user:pass@example.com/private' },
  );
  const fetchImpl = () =>
    assert.fail('do not probe when provenance is available');
  const result = await collectResearchSources({
    notes:
      'https://example.com/article-89 twice https://example.com/article-89; https://invented.example',
    sources: list,
    fetchImpl,
  });
  assert.equal(result.length, 80);
  assert.equal(result[0].id, 's1');
  assert.equal(result[0].canonicalUrl, 'https://example.com/article-89');
  assert.ok(result.every((row) => row.checkedBy === 'tool-result'));
  assert.deepEqual(
    await collectResearchSources({
      notes: 'https://invented.example',
      sources: [],
      fetchImpl,
    }),
    [],
  );
});

test('fallback checks one bounded GET path and drops cross-host redirects and local URLs', async () => {
  const { collectResearchSources } = await import('./research.js');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal);
    if (url.endsWith('/cross'))
      return Response.redirect('https://cross.example/');
    if (url.endsWith('/same'))
      return Response.redirect('https://example.com/ok');
    if (url.endsWith('/large'))
      return new Response('x', { headers: { 'content-length': '9999999' } });
    return new Response('page');
  };
  const result = await collectResearchSources({
    notes:
      'https://example.com/cross https://example.com/same https://127.0.0.1/local https://example.com/large https://169.254.169.254/meta',
    fetchImpl,
  });
  assert.deepEqual(calls.sort(), [
    'https://example.com/cross',
    'https://example.com/large',
    'https://example.com/ok',
    'https://example.com/same',
  ]);
  assert.deepEqual(
    result.map(({ url, checkedBy }) => ({ url, checkedBy })),
    [{ url: 'https://example.com/ok', checkedBy: 'fetch' }],
  );
});
