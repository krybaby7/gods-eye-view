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
        row('USA', role, 'Q10', { seat: item('Q11696') }),
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

test('a long Retry-After skips only its batch and a short one is retried', async () => {
  const calls = [];
  const { data, error } = await fetchObservations({
    registry: registry('IND'),
    now,
    fetchImpl: async (_url, { body }) => {
      const role = roleOf(body);
      calls.push(role);
      if (calls.length < 3)
        return new Response(null, {
          status: 503,
          headers: { 'Retry-After': calls.length === 1 ? '120' : '0' },
        });
      return reply(role === 'head-of-state' ? [row('IND', role, 'Q10')] : []);
    },
  });
  assert.deepEqual(calls.slice(0, 3), [
    'government',
    'head-of-state',
    'head-of-state',
  ]);
  assert.equal(data.actors[0].id, 'Q10');
  assert.match(error, /HTTP 503/);
});
