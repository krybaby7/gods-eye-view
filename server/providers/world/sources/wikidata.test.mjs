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
    seat: item('Q1'),
    since: '2024-01-01T00:00:00Z',
    ...extra,
  });

test('maps India, China, Japan, the UK and Kosovo while rejecting disputed countries and keeping ties', async () => {
  const adapter = await import('./wikidata.js');
  const fullRegistry = await loadWorldRegistry();
  const registry = {
    countries: fullRegistry.countries.filter(({ iso3 }) =>
      ['IND', 'CHN', 'JPN', 'GBR', 'KOS', 'SAH'].includes(iso3),
    ),
  };
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
    row('CHN', 'defence-minister', 'Q24', { since: '2025-01-01' }),
    row('JPN', 'head-of-government', 'Q31'),
    row('GBR', 'head-of-state', 'Q41'),
    row('KOS', 'head-of-state', 'Q51'),
    row('SAH', 'head-of-state', 'Q61'),
    binding({
      iso: 'IND',
      role: 'government',
      government: item('Q99'),
      governmentLabel: 'Republic',
    }),
  ];
  const { data, count } = await adapter.fetchObservations({
    registry,
    now,
    fetchImpl: async () =>
      new Response(JSON.stringify({ results: { bindings: rows } })),
  });
  assert.equal(count, 8);
  assert.deepEqual(
    data.actors.map(({ country, role, id }) => [country, role, id]),
    [
      ['CHN', 'foreign-minister', 'Q21'],
      ['CHN', 'foreign-minister', 'Q22'],
      ['CHN', 'defence-minister', 'Q24'],
      ['GBR', 'head-of-state', 'Q41'],
      ['IND', 'head-of-state', 'Q10'],
      ['IND', 'head-of-government', 'Q11'],
      ['JPN', 'head-of-government', 'Q31'],
      ['KOS', 'head-of-state', 'Q51'],
    ],
  );
  assert.equal(data.actors[4].imageFile, 'India portrait.jpg');
  assert.equal(data.actors[4].office, 'President');
  assert.equal(data.actors[4].since, '2022-07-25');
  assert.deepEqual(data.actors[5].accounts, {
    x: 'https://x.com/public_office',
    bluesky: 'https://bsky.app/profile/office.example.org',
    youtube: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
  });
  assert.deepEqual(data.governments.IND, ['Republic']);
  assert.equal(data.governments.JPN, undefined);
});

test('an empty directory keeps the last result and fresh results are not rechecked early', async () => {
  const adapter = await import('./wikidata.js');
  const registry = { countries: [{ iso3: 'IND' }] };
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
  assert.equal(
    adapter.shouldCheck({
      lastCheckedAt: now.toISOString(),
      now: new Date(+now + 6 * 86_400_000),
    }),
    false,
  );
});
test('posts one role and up to 40 countries per request, in sequence', async () => {
  const adapter = await import('./wikidata.js');
  const registry = {
    countries: Array.from({ length: 41 }, (_, i) => ({
      iso3:
        i === 40
          ? 'KOS'
          : 'A' + String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)),
    })),
  };
  const seen = [];
  const queryShapes = [];
  let reading = false;
  let lastFinished;
  const { count } = await adapter.fetchObservations({
    registry,
    now,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://query.wikidata.org/sparql');
      assert.equal(options.method, 'POST');
      assert.equal(
        options.headers['Content-Type'],
        'application/x-www-form-urlencoded',
      );
      assert.equal(reading, false);
      if (lastFinished) assert.ok(performance.now() - lastFinished >= 250);
      const query = new URLSearchParams(options.body).get('query');
      const bound = query.includes('VALUES (?iso ?seat');
      const codes = bound
        ? query
            .match(/VALUES \(\?iso \?seat(?: \?person)?\) \{([^}]+)\}/)[1]
            .match(/"[A-Z]{3}"/g)
        : query.match(/VALUES \?iso \{([^}]+)\}/)[1].match(/"[A-Z]{3}"/g);
      const roles = query.match(
        /"(?:government|head-of-state|head-of-government|foreign-minister|defence-minister)"/g,
      );
      assert.equal(roles.length, 1);
      if (!bound) {
        seen.push([roles[0].slice(1, -1), codes.length]);
        queryShapes.push({
          role: roles[0].slice(1, -1),
          kosovo: query.includes('BIND(wd:Q1246 AS ?country)'),
          nested: query.includes('SELECT ?iso ?country WHERE'),
          boundOrder: query.includes('hint:Query hint:optimizer "None"'),
        });
      }
      reading = true;
      return new Response(
        new ReadableStream({
          async start(controller) {
            await new Promise((resolve) => setTimeout(resolve, 1));
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({
                  results: {
                    bindings: [
                      row(codes[0].slice(1, -1), roles[0].slice(1, -1), 'Q10'),
                    ],
                  },
                }),
              ),
            );
            reading = false;
            lastFinished = performance.now();
            controller.close();
          },
        }),
      );
    },
  });
  assert.equal(count, 8);
  assert.equal(queryShapes.filter(({ kosovo }) => kosovo).length, 5);
  assert.ok(queryShapes.every(({ kosovo, nested }) => kosovo === nested));
  assert.ok(
    queryShapes.every(
      ({ role, boundOrder }) => boundOrder === (role !== 'government'),
    ),
  );
  assert.deepEqual(seen, [
    ['government', 40],
    ['government', 1],
    ['head-of-state', 40],
    ['head-of-government', 40],
    ['foreign-minister', 40],
    ['defence-minister', 40],
    ['head-of-state', 1],
    ['head-of-government', 1],
    ['foreign-minister', 1],
    ['defence-minister', 1],
  ]);
});

test('merges completed batches and keeps the cached role for a long Retry-After', async () => {
  const adapter = await import('./wikidata.js');
  const registry = { countries: [{ iso3: 'IND' }] };
  const oldState = { id: 'Q1', country: 'IND', role: 'head-of-state' };
  const oldGovernment = {
    id: 'Q2',
    country: 'IND',
    role: 'head-of-government',
  };
  const data = {
    actors: [oldState, oldGovernment],
    governments: { IND: 'Republic' },
  };
  let calls = 0;
  const result = await adapter.fetchObservations({
    registry,
    now,
    data,
    fetchImpl: async (_url, { body }) => {
      calls += 1;
      const query = body.get('query');
      if (query.includes('"head-of-state"'))
        return new Response(
          JSON.stringify({
            results: { bindings: [row('IND', 'head-of-state', 'Q10')] },
          }),
        );
      if (!query.includes('"head-of-government"'))
        return Response.json({ results: { bindings: [] } });
      return new Response('', {
        status: 503,
        headers: { 'Retry-After': 'Mon, 09 Nov 2026 12:05:00 GMT' },
      });
    },
  });
  assert.equal(calls, 5);
  assert.match(result.error, /HTTP 503/);
  assert.deepEqual(
    result.data.actors.map(({ id }) => id),
    ['Q10', 'Q2'],
  );
  assert.deepEqual(result.data.governments, {});
});
test('refreshes later roles after a batch fails and keeps only the failed role from cache', async () => {
  const adapter = await import('./wikidata.js');
  const registry = { countries: [{ iso3: 'IND' }] };
  const result = await adapter.fetchObservations({
    registry,
    now,
    data: {
      actors: [
        { id: 'Q1', country: 'IND', role: 'head-of-state' },
        { id: 'Q2', country: 'IND', role: 'head-of-government' },
        { id: 'Q3', country: 'IND', role: 'foreign-minister' },
      ],
    },
    fetchImpl: async (_url, { body }) => {
      const query = body.get('query');
      if (query.includes('"head-of-state"'))
        return new Response('', { status: 504 });
      const rows = query.includes('"head-of-government"')
        ? [row('IND', 'head-of-government', 'Q20')]
        : [];
      return new Response(JSON.stringify({ results: { bindings: rows } }));
    },
  });
  assert.match(result.error, /4 of 5 Wikidata batches completed.*HTTP 504/);
  assert.deepEqual(
    result.data.actors.map(({ id }) => id),
    ['Q1', 'Q20'],
  );
});
test('subdivides a gateway failure and retains cached actors only in an unrecovered slice', async () => {
  const adapter = await import('./wikidata.js');
  const registry = {
    countries: ['AAA', 'AAB', 'AAC', 'AAD'].map((iso3) => ({ iso3 })),
  };
  const cached = { id: 'Q2', country: 'AAC', role: 'head-of-state' };
  const stale = { id: 'Q1', country: 'AAA', role: 'head-of-state' };
  const calls = [];
  const result = await adapter.fetchObservations({
    registry,
    now,
    data: { actors: [stale, cached] },
    fetchImpl: async (_url, { body }) => {
      const query = body.get('query');
      const role = query.match(/BIND\("([^"]+)" AS \?role/)[1];
      if (query.includes('VALUES (?iso ?seat'))
        return Response.json({
          results: { bindings: [row('AAA', role, 'Q10')] },
        });
      const countries = [
        ...query.match(/VALUES \?iso \{([^}]+)\}/)[1].matchAll(/"([^"]+)"/g),
      ].map((match) => match[1]);
      calls.push([role, countries]);
      if (role !== 'head-of-state')
        return new Response('{"results":{"bindings":[]}}');
      if (countries.length === 4) return new Response('', { status: 502 });
      if (countries.includes('AAC'))
        throw new DOMException('Deadline', 'TimeoutError');
      return new Response(
        JSON.stringify({ results: { bindings: [row('AAA', role, 'Q10')] } }),
      );
    },
  });
  assert.equal(calls.length, 7);
  assert.deepEqual(calls.slice(-2), [
    ['head-of-state', ['AAA', 'AAB']],
    ['head-of-state', ['AAC', 'AAD']],
  ]);
  assert.deepEqual(
    result.data.actors.map(({ id }) => id),
    ['Q10', 'Q2'],
  );
  assert.match(result.error, /Deadline/);
  assert.match(result.detail, /1 of 2 recovery slices/);
});

test('limits recovery calls during a sustained Wikidata gateway outage', async () => {
  const adapter = await import('./wikidata.js');
  const registry = {
    countries: Array.from({ length: 81 }, (_, i) => ({
      iso3: 'A' + String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)),
    })),
  };
  let calls = 0;
  const result = await adapter.fetchObservations({
    registry,
    now,
    fetchImpl: async () => {
      calls += 1;
      return new Response('', { status: 502 });
    },
  });
  assert.equal(calls, 23);
  assert.match(result.error, /HTTP 502/);
  assert.match(result.detail, /0 of 8 recovery slices/);
});
