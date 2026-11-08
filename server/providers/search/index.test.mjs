import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSearchService, MAX_VISIBLE_SEARCHES } from './index.js';

async function setup(t, options = {}) {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'gev-search-api-'));
  const inputs = [];
  const adapter = {
    async research(input) {
      inputs.push(input);
      if (options.research) await options.research(input);
      return {
        notes: 'A report',
        sources: [{ url: 'https://example.com/report' }],
        usage: { inputTokens: 3 },
      };
    },
    async mapFindings(input) {
      if (options.mapFindings) return options.mapFindings(input);
      return {
        json: { label: 'Reports', summary: [], groups: [], findings: [] },
        usage: { inputTokens: 4 },
        agentModel: 'test',
      };
    },
  };
  const agents = {
    get: (id) => (id === 'claude' ? adapter : null),
    status: async () => ({
      claude: { installed: true, signedIn: true, disabledReason: null },
    }),
  };
  const service = createSearchService({ cacheDir, agents, ...options });
  const server = createServer(service.handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await service.dispose();
    await new Promise((resolve) => server.close(resolve));
    await rm(cacheDir, { recursive: true, force: true });
  });
  const request = async (route = '', method = 'GET', body, headers) => {
    const response = await fetch(
      'http://127.0.0.1:' + server.address().port + '/api/searches' + route,
      {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers,
      },
    );
    return [response.status, await response.json()];
  };
  return { request, inputs, service };
}

async function until(request, predicate) {
  for (let i = 0; i < 60; i++) {
    const [, data] = await request();
    if (predicate(data)) return data;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Expected search status did not arrive');
}

test('gates routes and runs research then map, with snapshots, usage and revision tokens', async (t) => {
  const { request, inputs } = await setup(t);
  assert.equal(
    (await request('', 'GET', undefined, { origin: 'https://example.org' }))[0],
    403,
  );
  assert.equal((await request('/other/more'))[0], 404);
  assert.equal(
    (await request('', 'POST', { question: 'x', agent: 'codex' }))[0],
    503,
  );
  assert.equal(
    (await request('', 'POST', { question: 'x'.repeat(501) }))[0],
    400,
  );
  assert.equal(
    (await request('', 'POST', { question: 'x'.repeat(20000) }))[0],
    413,
  );
  const [status, { id, runId }] = await request('', 'POST', {
    question: '  A question?  ',
  });
  assert.equal(status, 202);
  const data = await until(
    request,
    ({ searches }) => searches[0]?.status === 'ready',
  );
  const search = data.searches[0];
  assert.equal(search.question, '  A question?  ');
  assert.equal(search.run.usage.inputTokens, 7);
  assert.equal(search.run.agentModel, 'test');
  assert.equal(search.label, 'Reports');
  assert.equal(search.colorIndex, 0);
  assert.equal(search.visible, true);
  assert.equal(data.defaultAgent, 'claude');
  assert.equal(data.agents.codex.signedIn, false);
  assert.deepEqual(await request('?rev=' + data.revision), [
    200,
    { unchanged: true },
  ]);
  assert.notEqual(
    (await request('?asOf=2026-01-01&rev=' + data.revision))[1].revision,
    data.revision,
  );
  assert.equal(
    (await request('/' + id + '/runs/' + runId))[1].search.run.id,
    runId,
  );
  const [, next] = await request('/' + id + '/update', 'POST');
  await until(request, ({ searches }) => searches[0]?.run?.id === next.runId);
  assert.equal(inputs[1].since, search.run.finishedAt);
  assert.deepEqual(
    (
      await request('/' + id + '/changes?from=' + runId + '&to=' + next.runId)
    )[1],
    { added: [], seenAgain: [], notSeenSince: [] },
  );
});

test('reports an invalid map field and retains the mapping step usage', async (t) => {
  const { request } = await setup(t, {
    mapFindings: () => ({
      json: {
        label: 'Reports',
        summary: [],
        groups: [],
        findings: [
          {
            kind: 'event',
            title: 'A finding',
            summary: 'A report',
            sourceIds: ['s1'],
            lat: 10,
          },
        ],
      },
      usage: { inputTokens: 4, outputTokens: 3 },
      agentModel: 'test-map-model',
    }),
  });
  assert.equal(
    (await request('', 'POST', { question: 'A question?' }))[0],
    202,
  );
  const {
    searches: [search],
  } = await until(request, ({ searches }) => searches[0]?.status === 'failed');
  assert.equal(search.run.error.reason, 'invalid_map');
  assert.match(
    search.run.error.message,
    /map\.findings\[0\].*both latitude and longitude/,
  );
  assert.equal(search.run.usage.inputTokens, 7);
  assert.equal(search.run.usage.outputTokens, 3);
  assert.equal(search.run.agentModel, 'test-map-model');
  assert.deepEqual(search.findings, []);
});

test('reserves one slot per agent, cancels through the signal and retries with a new run', async (t) => {
  let calls = 0;
  const { request } = await setup(t, {
    research({ signal }) {
      if (++calls > 1) return;
      return new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        }),
      );
    },
  });
  const asks = await Promise.all([
    request('', 'POST', { question: 'One' }),
    request('', 'POST', { question: 'Two' }),
  ]);
  assert.deepEqual(asks.map(([status]) => status).sort(), [202, 409]);
  const { id, runId } = asks.find(([status]) => status === 202)[1];
  await until(request, ({ agents }) => agents.claude.busy && calls === 1);
  assert.equal((await request('/' + id + '/cancel', 'POST'))[0], 202);
  const stopped = await until(
    request,
    ({ searches }) => searches[0]?.status === 'failed',
  );
  assert.equal(stopped.searches[0].error.reason, 'cancelled');
  const [, retry] = await request('/' + id + '/retry', 'POST');
  assert.notEqual(retry.runId, runId);
  await until(request, ({ searches }) => searches[0]?.run?.id === retry.runId);
});

test('uses the snapshot time zone for both available days and the selected day', async (t) => {
  const { request } = await setup(t, {
    now: () => Date.parse('2026-11-05T23:30:00.000Z'),
  });
  assert.equal((await request('', 'POST', { question: 'Reports?' }))[0], 202);
  const utc = await until(
    request,
    ({ searches }) => searches[0]?.status === 'ready',
  );
  assert.deepEqual(utc.days, ['2026-11-05']);

  const zone = '?timeZone=Europe%2FBerlin';
  const [status, local] = await request(zone + '&rev=' + utc.revision);
  assert.equal(status, 200);
  assert.notEqual(local.revision, utc.revision);
  assert.deepEqual(local.days, ['2026-11-06']);
  assert.equal(local.searches[0].run.finishedAt, '2026-11-05T23:30:00.000Z');
  const [, previous] = await request(zone + '&asOf=2026-11-05');
  assert.deepEqual(previous.searches, []);
  const [, selected] = await request(zone + '&asOf=2026-11-06');
  assert.equal(selected.searches[0].run.id, local.searches[0].run.id);
});

test('rejects a snapshot time zone that is not an IANA identifier', async (t) => {
  const { request } = await setup(t);
  for (const timeZone of ['Europe/Unknown', '+01:00', '']) {
    const [status, result] = await request(
      '?timeZone=' + encodeURIComponent(timeZone),
    );
    assert.equal(status, 400);
    assert.equal(result.error, 'invalid_request');
  }
});

test('allocates the lowest free colour and refuses a ninth visible search', async (t) => {
  const { request } = await setup(t, { mutationRate: 40 });
  const ids = [];
  for (let index = 0; index <= MAX_VISIBLE_SEARCHES; index++) {
    const [status, result] = await request('', 'POST', {
      question: 'Search ' + index,
    });
    assert.equal(status, 202);
    ids.push(result.id);
    await until(request, ({ agents }) => !agents.claude.busy);
  }
  const [, data] = await request();
  assert.equal(
    data.searches.filter(({ visible }) => visible).length,
    MAX_VISIBLE_SEARCHES,
  );
  const url = '/' + ids.at(-1);
  assert.equal((await request(url, 'PATCH', { visible: true }))[0], 409);
  assert.equal(
    (await request('/' + ids[1], 'PATCH', { visible: false }))[0],
    200,
  );
  assert.equal((await request(url, 'PATCH', { visible: true }))[0], 200);
  const [, next] = await request();
  assert.equal(next.searches.find(({ id }) => id === ids.at(-1)).colorIndex, 1);
});

test('maps sources with contextual publisher names and gazetteer, then places and removes a finding', async (t) => {
  let mapperPrompt;
  const geocoded = [];
  let warStories = [];
  const { request } = await setup(t, {
    loadContext: async () => ({
      gazetteer: [],
      mapGazetteers: [[{ name: 'Lima' }]],
      nameSources: (sources) =>
        sources.map((source) => ({ ...source, publisher: 'Example News' })),
    }),
    geocode: async (name) => {
      geocoded.push(name);
      return { lat: -9, lon: -70, name, precision: 'city' };
    },
    loadWarStories: async () => warStories,
    mapFindings: async ({ prompt }) => {
      mapperPrompt = prompt;
      return {
        json: {
          label: 'Places',
          summary: [{ text: 'A place was reported.', sourceIds: ['s1'] }],
          groups: [{ id: 'g1', label: 'Places' }],
          findings: [
            {
              kind: 'place',
              title: 'A place',
              summary: 'A place was reported.',
              place: { name: 'Unknown Place', basis: 'located-here' },
              groupId: 'g1',
              sourceIds: ['s1'],
            },
          ],
        },
      };
    },
  });
  const [, { id, runId }] = await request('', 'POST', { question: 'Places?' });
  const first = await until(
    request,
    ({ searches }) => searches[0]?.status === 'ready',
  );
  assert.match(mapperPrompt, /Lima/);
  assert.match(mapperPrompt, /Example News/);
  assert.deepEqual(geocoded, ['Unknown Place']);
  const finding = first.searches[0].findings[0];
  assert.equal(finding.location.lat, -9);
  warStories = [
    {
      id: 'story',
      title: 'Related story',
      theaterId: 'theater',
      urls: ['https://example.com/report'],
    },
  ];
  const [, linked] = await request('?rev=' + first.revision);
  assert.notEqual(linked.revision, first.revision);
  assert.equal(linked.searches[0].findings[0].warMonitor[0].id, 'story');
  assert.equal(
    (await request('/' + id + '/findings/' + finding.id, 'DELETE'))[0],
    200,
  );
  assert.deepEqual(
    (await request('/' + id + '/runs/' + runId))[1].search.findings,
    [],
  );
});

test('stops the agent at timeout and preserves independent read and mutation quotas', async (t) => {
  let aborted = false;
  const { request } = await setup(t, {
    timeoutMs: 25,
    mutationRate: 1,
    research({ signal }) {
      return new Promise((resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(signal.reason);
          },
          { once: true },
        ),
      );
    },
  });
  assert.equal(
    (await request('', 'POST', { question: 'Time me out' }))[0],
    202,
  );
  assert.equal(
    (await request('', 'POST', { question: 'Rate limit me' }))[0],
    429,
  );
  const data = await until(
    request,
    ({ searches }) => searches[0]?.status === 'failed',
  );
  assert.equal(data.searches[0].error.reason, 'timeout');
  assert.equal(aborted, true);
  assert.equal(data.agents.claude.busy, false);
});
