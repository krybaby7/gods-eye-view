import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchObservations } from './wikidata.js';

const now = new Date('2026-11-09T12:00:00Z');
const item = (id) => 'http://www.wikidata.org/entity/' + id;
const binding = (values) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value }]),
  );
const row = (iso, role, id, extra = {}) =>
  binding({
    iso,
    role,
    person: item(id),
    personLabel: id + ' fixture',
    office: item('Q1'),
    seat: item('Q1'),
    officeLabel: 'President',
    since: '2025-01-01T00:00:00Z',
    ...extra,
  });
const reply = (bindings) => Response.json({ results: { bindings } });
const registry = (...codes) => ({ countries: codes.map((iso3) => ({ iso3 })) });
const roleOf = (body) =>
  body.get('query').match(/BIND\("([^"]+)" AS \?role/)[1];

test('requires a dated, open person office statement and keeps the latest start including ties', async () => {
  const { data } = await fetchObservations({
    registry: registry('IND'),
    now,
    fetchImpl: async (_url, { body }) => {
      const role = roleOf(body);
      if (role !== 'foreign-minister') return reply([]);
      const query = body.get('query');
      if (!query.includes('VALUES (?iso ?seat'))
        return reply([row('IND', role, 'Q14')]);
      if (query.includes('SELECT DISTINCT ?iso ?role ?seat ?person')) {
        assert.match(query, /\?seat p:P1308 \?nomination/);
        return reply([row('IND', role, 'Q14'), row('IND', role, 'Q15')]);
      }
      assert.doesNotMatch(query, /\?statement ps:P39 \?seat\s*\./);
      assert.match(query, /\?person p:P39 \?statement/);
      assert.match(query, /ps:P39 \?office/);
      assert.match(query, /pq:P580 \?since/);
      assert.match(query, /pq:P582/);
      assert.match(query, /pq:P1366/);
      return reply([
        row('IND', role, 'Q10'),
        row('IND', role, 'Q11', { since: '' }),
        row('IND', role, 'Q12', { since: '2026-01-01', end: '2026-12-01' }),
        row('IND', role, 'Q13', {
          since: '2026-01-01',
          replacedBy: item('Q14'),
        }),
        row('IND', role, 'Q14', {
          since: '2026-01-01',
          officeLabel: 'Foreign minister',
        }),
        row('IND', role, 'Q15', {
          since: '2026-01-01',
          nature: item('Q4676846'),
        }),
        row('IND', role, 'Q16', { since: '2027-01-01' }),
      ]);
    },
  });
  assert.deepEqual(
    data.actors.map(({ id }) => id),
    ['Q14', 'Q15'],
  );
  assert.equal(data.actors[0].office, 'Foreign minister');
  assert.equal(data.actors[1].acting, true);
});

test('keeps government forms without actors and sorts specific forms first', async () => {
  const { data } = await fetchObservations({
    registry: registry('CHE'),
    now,
    fetchImpl: async (_url, { body }) => {
      if (roleOf(body) !== 'government') return reply([]);
      assert.match(body.get('query'), /p:P122 \?form/);
      assert.match(body.get('query'), /\?form ps:P122 \?government/);
      assert.match(body.get('query'), /\?form pq:P580 \?start/);
      assert.match(body.get('query'), /\?form pq:P582 \?end/);
      return reply([
        binding({
          iso: 'CHE',
          role: 'government',
          government: item('Q1'),
          governmentLabel: 'Democracy',
        }),
        binding({
          iso: 'CHE',
          role: 'government',
          government: item('Q2'),
          governmentLabel: 'Federal republic',
          governmentParent: item('Q1'),
        }),
      ]);
    },
  });
  assert.deepEqual(data.governments.CHE, ['Federal republic', 'Democracy']);
});

test('preserves independent co-princes, staggered council members, and shared executive offices', async () => {
  const { data } = await fetchObservations({
    registry: registry('USA', 'MEX', 'GHA', 'AND', 'CHE', 'SMR'),
    now,
    fetchImpl: async (_url, { body }) => {
      const role = roleOf(body);
      if (!role.startsWith('head-of-')) return reply([]);
      const query = body.get('query');
      for (const [country, office] of [
        ['USA', 'Q11696'],
        ['MEX', 'Q628004'],
        ['GHA', 'Q2672728'],
      ]) {
        assert.ok(query.includes(`"${country}" wd:${office}`));
      }
      assert.doesNotMatch(query, /\bp:P6\b/);
      const rows = [
        row('USA', role, 'Q22686', {
          personLabel: 'Donald Trump',
          seat: item('Q11696'),
          office: item('Q11696'),
          since: '2025-01-20',
          officeLabel: 'President of the United States',
        }),
        row('MEX', role, 'Q5771800', {
          personLabel: 'Claudia Sheinbaum',
          seat: item('Q628004'),
          office: item('Q628004'),
          since: '2024-10-01',
          officeLabel: 'President of Mexico',
        }),
        row('GHA', role, 'Q358577', {
          personLabel: 'John Mahama',
          seat: item('Q2672728'),
          office: item('Q2672728'),
          since: '2025-01-07',
          officeLabel: 'President of Ghana',
        }),
        row('CHE', role, 'Q11', {
          seat: item('Q11811941'),
          since: '2017-11-01',
        }),
        row('CHE', role, 'Q12', { seat: item('Q11811941') }),
      ];
      if (role === 'head-of-state') {
        rows.push(
          row('AND', role, 'Q13', {
            seat: item('Q19808845'),
            since: '2017-05-14',
          }),
          row('AND', role, 'Q14', { seat: item('Q19808790') }),
          row('SMR', role, 'Q15', {
            seat: item('Q258045'),
            personLabel: 'Gerardo Giovagnoli',
          }),
          row('SMR', role, 'Q16', { seat: item('Q258045') }),
        );
      }
      return reply(rows);
    },
  });
  const holders = (iso3, role) =>
    data.actors
      .filter((actor) => actor.country === iso3 && actor.role === role)
      .map(({ id }) => id)
      .sort();
  assert.deepEqual(holders('AND', 'head-of-state'), ['Q13', 'Q14']);
  assert.deepEqual(holders('CHE', 'head-of-state'), ['Q11', 'Q12']);
  assert.deepEqual(holders('SMR', 'head-of-state'), ['Q15', 'Q16']);
  assert.deepEqual(
    holders('USA', 'head-of-state'),
    holders('USA', 'head-of-government'),
  );
  for (const [country, id] of [
    ['USA', 'Q22686'],
    ['MEX', 'Q5771800'],
    ['GHA', 'Q358577'],
  ]) {
    for (const role of ['head-of-state', 'head-of-government']) {
      assert.deepEqual(holders(country, role), [id]);
    }
  }
});

test('preserves a prior partial person-statement directory on rederive timeout', async () => {
  const prior = {
    actors: [
      { id: 'Q10', since: '2026-01-01', acting: false, source: 'wikidata' },
    ],
  };
  const result = await fetchObservations({
    registry: registry('IND'),
    now,
    data: prior,
    rederive: true,
    fetchImpl: async (_url, { body }) => {
      if (roleOf(body) === 'government')
        return reply([
          binding({
            iso: 'IND',
            role: 'government',
            government: item('Q2'),
            governmentLabel: 'Republic',
          }),
        ]);
      throw new DOMException('Deadline', 'TimeoutError');
    },
  });
  assert.match(result.error, /three consecutive timeouts/);
  assert.deepEqual(result.data?.governments.IND, ['Republic']);
});

test('stops after three consecutive timeouts and preserves the last directory', async () => {
  let calls = 0;
  const result = await fetchObservations({
    registry: registry('IND'),
    now,
    data: { actors: [{ id: 'Q1' }], governments: {} },
    fetchImpl: async () => {
      calls++;
      throw new DOMException('Deadline', 'TimeoutError');
    },
  });
  assert.equal(calls, 3);
  assert.match(result.error, /Deadline/);
  assert.equal(result.data, undefined);
});

test('adds the independently verified missing co-regent for the published term only', async () => {
  const load = (date) =>
    fetchObservations({
      registry: registry('SMR'),
      now: new Date(date),
      fetchImpl: async (_url, { body }) => {
        const role = roleOf(body);
        return reply(
          role === 'head-of-state'
            ? [
                row('SMR', role, 'Q50', {
                  since: '2026-10-01',
                  personLabel: 'William Casali',
                }),
              ]
            : [],
        );
      },
    });
  const current = await load('2026-11-09T12:00:00Z');
  const curated = current.data.actors.find(
    ({ name }) => name === 'Gerardo Giovagnoli',
  );
  assert.ok(curated?.sourceUrl);
  assert.equal(curated.reviewed, false);
  const next = await load('2027-04-01T12:00:00Z');
  assert.ok(
    next.data.actors.every(({ name }) => name !== 'Gerardo Giovagnoli'),
  );
});

test('long Retry-After stops remaining Wikidata batches and keeps completed rows', async () => {
  const calls = [];
  const { data, error } = await fetchObservations({
    registry: registry('IND'),
    now,
    fetchImpl: async (_url, { body }) => {
      const role = roleOf(body);
      calls.push(role);
      if (role === 'government')
        return reply([
          binding({
            iso: 'IND',
            role,
            government: item('Q2'),
            governmentLabel: 'Republic',
          }),
        ]);
      return new Response(null, {
        status: 503,
        headers: { 'Retry-After': '120' },
      });
    },
  });
  assert.deepEqual(calls, ['government', 'head-of-state']);
  assert.deepEqual(data?.governments.IND, ['Republic']);
  assert.match(error, /Retry-After/);
});

test('429 counts towards the same three-strike stop as timeouts', async () => {
  let calls = 0;
  const { error } = await fetchObservations({
    registry: registry('IND'),
    now,
    fetchImpl: async () => {
      calls++;
      if (calls === 2)
        return new Response(null, {
          status: 429,
          headers: { 'Retry-After': '0' },
        });
      throw new DOMException('Deadline', 'TimeoutError');
    },
  });
  assert.equal(calls, 3);
  assert.match(error, /three consecutive/);
});

test('a skipped sitelink lookup keeps the previous person for that role', async () => {
  const prior = {
    ...Object.fromEntries(
      Object.entries(row('IND', 'head-of-state', 'Q10')).map(([key, cell]) => [
        key,
        cell.value,
      ]),
    ),
    id: 'Q10',
    country: 'IND',
    source: 'wikidata',
    since: '2026-01-01',
    acting: false,
    name: 'Prior label',
  };
  const result = await fetchObservations({
    registry: registry('IND'),
    now,
    data: { actors: [prior], method: 'person-p39' },
    fetchImpl: async (_url, { body }) => {
      assert.ok(body, 'the sitelink request is skipped');
      const role = roleOf(body);
      if (role === 'head-of-state')
        return reply([row('IND', role, 'Q10', { personLabel: 'Q10' })]);
      if (role === 'government') return reply([]);
      throw new DOMException('Deadline', 'TimeoutError');
    },
  });
  assert.equal(result.data?.actors[0].name, 'Prior label');
  assert.match(result.detail, /1 of 5 Wikidata batches completed/);
});

test('Argentina and Bangladesh undated successors are verified but need CIA to settle the role', async () => {
  const role = 'foreign-minister';
  const { mergeOfficeholders } = await import('../officeholders.js');
  const rows = [
    row('ARG', role, 'Q21', {
      since: '2024-01-01',
      personLabel: 'Gerardo Werthein',
    }),
    row('ARG', role, 'Q22', { since: undefined, personLabel: 'Pablo Quirno' }),
    row('BGD', role, 'Q31', {
      since: '2024-01-01',
      personLabel: 'Touhid Hossain',
      end: '2026-02-01',
    }),
    row('BGD', role, 'Q32', {
      since: undefined,
      personLabel: 'Khalilur Rahman',
    }),
    row('BGD', role, 'Q33', {
      since: '2024-01-01',
      personLabel: 'Replaced holder',
      replacedBy: item('Q32'),
    }),
  ];
  let verification;
  const { data } = await fetchObservations({
    registry: registry('ARG', 'BGD'),
    now,
    fetchImpl: async (_url, { body }) => {
      if (roleOf(body) !== role) return reply([]);
      if (body.get('query').includes('?person p:P39 ?statement'))
        verification = body.get('query');
      return reply(rows);
    },
  });
  assert.match(verification, /OPTIONAL\s*\{ \?statement pq:P580 \?since/);
  assert.match(verification, /pq:P582/);
  assert.match(verification, /pq:P1366/);
  assert.match(verification, /\?laterStart > \?since/);
  assert.deepEqual(
    data.actors.map(({ id }) => id),
    ['Q21'],
  );
  assert.deepEqual(
    data.undatedActors.map(({ id }) => id),
    ['Q22', 'Q32'],
  );
  assert.deepEqual(
    mergeOfficeholders(data.actors, [], now, data.undatedActors),
    [],
  );
  const cia = [
    {
      country: 'ARG',
      role,
      name: 'Pablo Quirno',
      asOf: '2025-10-29',
      source: 'cia-world-leaders',
    },
    {
      country: 'BGD',
      role,
      name: 'Khalilur Rahman',
      asOf: '2026-08-31',
      source: 'cia-world-leaders',
    },
  ];
  assert.deepEqual(
    mergeOfficeholders(data.actors, cia, now, data.undatedActors).map(
      ({ id }) => id,
    ),
    ['Q22', 'Q32'],
  );
});

test('resolves office candidates separately and verifies only literal person/seat pairs', async () => {
  const queries = [];
  const role = 'head-of-state';
  const candidate = row('USA', role, 'Q22686', { seat: item('Q11696') });
  const result = await fetchObservations({
    registry: registry('USA'),
    now,
    fetchImpl: async (_url, { body }) => {
      const query = body.get('query');
      if (roleOf(body) !== role) return reply([]);
      queries.push(query);
      return reply([candidate]);
    },
  });
  assert.equal(result.data.actors[0].id, 'Q22686');
  assert.equal(queries.length, 3);
  assert.match(queries[0], /SELECT DISTINCT \?iso \?role \?seat WHERE/);
  assert.match(
    queries[1],
    /VALUES \(\?iso \?seat\)\s*\{\s*\("USA" wd:Q11696\)/,
  );
  assert.doesNotMatch(queries[1], /P298/);
  assert.doesNotMatch(
    queries[0],
    /\?person p:P39 \?statement|\?person wdt:P18/,
  );
  assert.match(
    queries[2],
    /VALUES \(\?iso \?seat \?person\)\s*\{\s*\("USA" wd:Q11696 wd:Q22686\)/,
  );
  assert.doesNotMatch(queries[2], /P1308|P298/);
  assert.match(queries[2], /\?person p:P39 \?statement/);
});

test('uses the verified item�s English sitelink when Wikidata has no English label', async () => {
  const result = await fetchObservations({
    registry: registry('USA'),
    now,
    fetchImpl: async (url, { body }) => {
      if (!body) {
        const request = new URL(url);
        assert.equal(request.hostname, 'www.wikidata.org');
        assert.equal(request.searchParams.get('ids'), 'Q22686');
        assert.equal(request.searchParams.get('sitefilter'), 'enwiki');
        return Response.json({
          entities: {
            Q22686: { sitelinks: { enwiki: { title: 'Donald Trump' } } },
          },
        });
      }
      const role = roleOf(body);
      return reply(
        role === 'head-of-state'
          ? [
              row('USA', role, 'Q22686', {
                seat: item('Q11696'),
                personLabel: 'Q22686',
              }),
            ]
          : [],
      );
    },
  });
  assert.equal(result.data.actors[0].name, 'Donald Trump');
});

test('ministry seat discovery gives explicit jurisdiction precedence over country membership', async () => {
  let discovery;
  await fetchObservations({
    registry: registry('USA'),
    now,
    fetchImpl: async (_url, { body }) => {
      const query = body.get('query');
      if (roleOf(body) === 'foreign-minister') discovery = query;
      return reply([]);
    },
  });
  assert.match(discovery, /\?seat wdt:P1001 \?country/);
  assert.match(
    discovery,
    /\?seat wdt:P17 \?country\s*\.\s*FILTER NOT EXISTS \{ \?seat wdt:P1001 \[\] \}/,
  );
});
test('WDQS candidate branches do not nest UNION nodes', async () => {
  const role = 'head-of-state';
  let candidate;
  await fetchObservations({
    registry: registry('USA'),
    now,
    fetchImpl: async (_url, { body }) => {
      if (roleOf(body) !== role) return reply([]);
      const query = body.get('query');
      if (query.includes('VALUES (?iso ?seat)')) {
        candidate = query;
        return reply([]);
      }
      return reply([row('USA', role, 'Q22686', { seat: item('Q11696') })]);
    },
  });
  assert.ok(candidate);
  let depth = 0;
  for (const token of candidate.match(/\{|\}|\bUNION\b/g)) {
    if (token === '{') depth++;
    else if (token === '}') depth--;
    else
      assert.equal(depth, 1, 'candidate alternatives must be sibling groups');
  }
  assert.match(candidate, /pq:P580 \?candidateSince/);
  assert.match(candidate, /pq:P1365/);
  assert.match(candidate, /wikibase:PreferredRank/);
  assert.match(candidate, /p:P1308/);
});
