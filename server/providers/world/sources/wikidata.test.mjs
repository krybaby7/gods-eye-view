import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWorldRegistry } from '../registry.js';

const now = new Date('2026-11-09T12:00:00Z');
const binding = (values) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value }]),
  );
const item = (id) => 'http://www.wikidata.org/entity/' + id;
const row = (iso, role, id, extra = {}) =>
  binding({
    iso,
    role,
    person: item(id),
    personLabel: id + ' fixture',
    ...extra,
  });

test('maps India, China, Japan, the UK and Kosovo while rejecting disputed or ambiguous officeholders', async () => {
  const adapter = await import('./wikidata.js');
  const registry = await loadWorldRegistry();
  const rows = [
    row('IND', 'head-of-state', 'Q10', {
      since: '2022-07-25T00:00:00Z',
      officeLabel: 'President',
      image:
        'http://commons.wikimedia.org/wiki/Special:FilePath/India%20portrait.jpg',
    }),
    row('IND', 'head-of-government', 'Q11', {
      x: 'public_office',
      bluesky: 'office.example.org',
      youtube: 'UCabcdefghijklmnopqrstuv',
      governmentLabel: 'Republic',
    }),
    row('IND', 'head-of-government', 'Q12', {
      since: '2022-01-01T00:00:00Z',
      end: '2024-01-01T00:00:00Z',
    }),
    row('IND', 'head-of-government', 'Q13', { since: '2027-01-01T00:00:00Z' }),
    row('CHN', 'foreign-minister', 'Q21'),
    row('CHN', 'foreign-minister', 'Q22'),
    row('CHN', 'defence-minister', 'Q23', {
      rank: 'http://wikiba.se/ontology#PreferredRank',
    }),
    row('CHN', 'defence-minister', 'Q24'),
    row('JPN', 'head-of-government', 'Q31'),
    row('GBR', 'head-of-state', 'Q41'),
    row('KOS', 'head-of-state', 'Q51'),
    row('SAH', 'head-of-state', 'Q61'),
  ];
  const { data, count } = await adapter.fetchObservations({
    registry,
    now,
    fetchImpl: async () =>
      new Response(JSON.stringify({ results: { bindings: rows } })),
  });
  assert.equal(count, 6);
  assert.deepEqual(
    data.actors.map(({ country, role, id }) => [country, role, id]),
    [
      ['CHN', 'defence-minister', 'Q23'],
      ['GBR', 'head-of-state', 'Q41'],
      ['IND', 'head-of-state', 'Q10'],
      ['IND', 'head-of-government', 'Q11'],
      ['JPN', 'head-of-government', 'Q31'],
      ['KOS', 'head-of-state', 'Q51'],
    ],
  );
  assert.equal(data.actors[2].imageFile, 'India portrait.jpg');
  assert.equal(data.actors[2].office, 'President');
  assert.equal(data.actors[2].since, '2022-07-25');
  assert.deepEqual(data.actors[3].accounts, {
    x: 'https://x.com/public_office',
    bluesky: 'https://bsky.app/profile/office.example.org',
    youtube: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
  });
  assert.equal(data.governments.IND, 'Republic');
  assert.equal(data.governments.JPN, undefined);
});

test('an empty directory keeps the last result and rate limits block early retries', async () => {
  const adapter = await import('./wikidata.js');
  const registry = await loadWorldRegistry();
  const old = { actors: [{ id: 'Q1' }], governments: {} };
  const response = (body, init) => async () => new Response(body, init);
  const empty = await adapter.fetchObservations({
    registry,
    now,
    data: old,
    fetchImpl: response('{"results":{"bindings":[]}}'),
  });
  assert.ok(empty.error);
  assert.equal(empty.data, undefined);
  const limited = await adapter.fetchObservations({
    registry,
    now,
    data: old,
    fetchImpl: response('', { status: 429, headers: { 'Retry-After': '180' } }),
  });
  assert.deepEqual(limited.data.actors, old.actors);
  assert.equal(
    adapter.shouldCheck({ data: limited.data, now: new Date(+now + 120_000) }),
    false,
  );
  assert.equal(
    adapter.shouldCheck({ data: limited.data, now: new Date(+now + 200_000) }),
    true,
  );
  assert.equal(
    adapter.shouldCheck({
      lastCheckedAt: now.toISOString(),
      now: new Date(+now + 6 * 86_400_000),
    }),
    false,
  );
});
