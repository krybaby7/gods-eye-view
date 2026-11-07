import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const toolkit = () => import('./toolkit.js');
const server = () => import('./toolkit-mcp.js');
const message = (method, params) => ({ jsonrpc: '2.0', id: 1, method, params });
const call = (name, args) => message('tools/call', { name, arguments: args });

test('builds the exact allowlist and exposes only configured loopback live tools', async () => {
  const { createSearchToolkit } = await toolkit();
  assert.equal(createSearchToolkit({ SEARCH_TOOLKIT: 'off' }), null);
  const config = createSearchToolkit({}, 'http://[::1]:4322');
  assert.equal(config.apiBase, 'http://[::1]:4322');
  assert.deepEqual(config.tools, [
    'mcp__gev_search__wikidata_places',
    'mcp__gev_search__aircraft_in_area',
    'mcp__gev_search__vessels_in_area',
    'mcp__gev_search__get_active_fires',
  ]);
  const external = createSearchToolkit(
    {
      SEARCH_MCP_API_BASE: 'https://example.com',
      SEARCH_RELIEFWEB_APPNAME: 'approved-abc',
    },
    'http://127.0.0.1:4321',
  );
  assert.deepEqual(external.tools, [
    'mcp__gev_search__wikidata_places',
    'mcp__gev_search__reliefweb_reports',
  ]);
  assert.deepEqual(createSearchToolkit({}).tools, [
    'mcp__gev_search__wikidata_places',
  ]);
  assert.equal(
    createSearchToolkit(
      { SEARCH_MCP_API_BASE: 'http://localhost:5182' },
      'http://[::1]:4322',
    ).apiBase,
    'http://localhost:5182',
  );
  for (const origin of [
    'http://127.0.0.1/api',
    'http://user@localhost',
    'http://localhost/#',
  ]) {
    assert.equal(
      createSearchToolkit({ SEARCH_MCP_API_BASE: origin }).apiBase,
      null,
    );
  }
  assert.ok(
    !createSearchToolkit({
      SEARCH_RELIEFWEB_APPNAME: 'REPLACE-WITH-APP-NAME',
    }).tools.includes('mcp__gev_search__reliefweb_reports'),
  );
});

test('uses the bound listener family and port for live tools', async () => {
  const { boundToolkitOrigin } = await toolkit();
  assert.equal(
    boundToolkitOrigin({ address: '127.0.0.1', port: 4174 }),
    'http://127.0.0.1:4174',
  );
  assert.equal(
    boundToolkitOrigin({ address: '::1', port: 5182 }, true),
    'https://[::1]:5182',
  );
  assert.equal(
    boundToolkitOrigin({ address: '0.0.0.0', port: 4174 }),
    'http://127.0.0.1:4174',
  );
  assert.equal(
    boundToolkitOrigin({ address: '::', port: 4174 }),
    'http://[::1]:4174',
  );
  assert.equal(boundToolkitOrigin({ address: '192.0.2.1', port: 4173 }), null);
  assert.equal(boundToolkitOrigin(null), null);
});

test('lists and dispatches only the intended tools and hides globe resources', async () => {
  const { createToolkitServer } = await server();
  let requests = 0;
  const mcp = createToolkitServer({
    apiBase: 'http://localhost:4173',
    fetchImpl: () => {
      requests++;
      throw new Error('Unexpected request');
    },
  });
  const init = (await mcp.handle(message('initialize'))).result;
  assert.equal(init.capabilities.resources, undefined);
  assert.equal(init.instructions, undefined);
  const list = (await mcp.handle(message('tools/list'))).result.tools;
  assert.deepEqual(list.map(({ name }) => name).sort(), [
    'aircraft_in_area',
    'get_active_fires',
    'vessels_in_area',
    'wikidata_places',
  ]);
  for (const tool of [
    'show_in_gods_eye_view',
    'panel_request',
    'reliefweb_reports',
  ])
    assert.ok((await mcp.handle(call(tool, {}))).error);
  assert.ok((await mcp.handle(message('resources/list'))).error);
  assert.ok(
    (await mcp.handle(message('resources/read', { uri: 'ui://example' })))
      .error,
  );
  assert.equal(requests, 0);
});

test('queries the official Wikidata API and returns bounded coordinates and Q pages', async () => {
  const { createToolkitServer } = await server();
  const actions = [];
  const mcp = createToolkitServer({
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, 'https://www.wikidata.org');
      assert.equal(url.pathname, '/w/api.php');
      assert.equal(options.redirect, 'error');
      assert.match(options.headers['User-Agent'], /GodsEyeView\/.*github\.com/);
      const action = url.searchParams.get('action');
      actions.push(action);
      return Response.json(
        action === 'wbsearchentities'
          ? {
              search: [
                {
                  id: 'Q85',
                  label: 'Cairo',
                  description: 'capital of Egypt',
                  url: 'https://invalid.example/',
                },
                { id: 'bad', label: 'Ignore' },
              ],
            }
          : {
              claims: {
                P625: [
                  {
                    rank: 'deprecated',
                    mainsnak: {
                      datavalue: {
                        value: {
                          latitude: 1,
                          longitude: 1,
                          globe: 'http://www.wikidata.org/entity/Q2',
                        },
                      },
                    },
                  },
                  {
                    rank: 'normal',
                    mainsnak: {
                      datavalue: {
                        value: {
                          latitude: 30.04,
                          longitude: 31.24,
                          globe: 'http://www.wikidata.org/entity/Q2',
                        },
                      },
                    },
                  },
                ],
              },
            },
      );
    },
  });
  const result = (await mcp.handle(call('wikidata_places', { query: 'Cairo' })))
    .result;
  assert.equal(result.isError, false);
  assert.deepEqual(actions, ['wbsearchentities', 'wbgetclaims']);
  assert.deepEqual(result.structuredContent.sources, [
    {
      url: 'https://www.wikidata.org/wiki/Q85',
      title: 'Cairo',
      snippet: 'capital of Egypt',
    },
  ]);
  assert.deepEqual(result.structuredContent.results[0].coordinates, {
    lat: 30.04,
    lon: 31.24,
  });
});

test('reads recent ReliefWeb reports with the approved appname and drops off-domain URLs', async () => {
  const { createToolkitServer } = await server();
  const mcp = createToolkitServer({
    appname: 'approved-abc',
    fetchImpl: async (url, options) => {
      assert.equal(
        url.href,
        'https://api.reliefweb.int/v2/reports?appname=approved-abc',
      );
      const body = JSON.parse(options.body);
      assert.deepEqual(body.sort, ['date.created:desc']);
      assert.match(body.filter.value.from, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(body.query.value, 'Sudan');
      return Response.json({
        data: [
          {
            fields: { url: 'https://reliefweb.int/node/1234', title: 'Report' },
          },
          { fields: { url: 'https://reliefweb.int.example.org/report/a/b' } },
          { fields: { url: 'http://reliefweb.int/report/a/b' } },
        ],
      });
    },
  });
  const result = (
    await mcp.handle(call('reliefweb_reports', { query: 'Sudan' }))
  ).result;
  assert.equal(result.isError, false);
  assert.deepEqual(
    result.structuredContent.sources.map(({ url }) => url),
    ['https://reliefweb.int/node/1234'],
  );
});

test('rejects oversized provider bodies without leaking upstream content', async () => {
  const { createToolkitServer } = await server();
  const mcp = createToolkitServer({
    fetchImpl: async () => new Response('private'.repeat(100_000)),
  });
  const result = (await mcp.handle(call('wikidata_places', { query: 'Cairo' })))
    .result;
  assert.equal(result.isError, true);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('queries existing read-only GEV tools through the loopback app API', async () => {
  const { createToolkitServer } = await server();
  const requests = [];
  const mcp = createToolkitServer({
    apiBase: 'http://127.0.0.1:4321',
    fetchImpl: async (url, init) => {
      assert.equal(url.origin, 'http://127.0.0.1:4321');
      assert.equal(init.redirect, 'error');
      requests.push(url.pathname);
      const payload = {
        '/api/flights': { states: [] },
        '/api/vessels': { rows: [] },
        '/api/firms': {
          fires: Array.from({ length: 26 }, () => ({ lat: 1, lon: 1 })),
        },
      }[url.pathname];
      assert.ok(payload, 'unexpected route');
      return Response.json(payload);
    },
  });
  const args = { area: { bbox: [0, 0, 2, 2] }, limit: 200 };
  for (const name of [
    'aircraft_in_area',
    'vessels_in_area',
    'get_active_fires',
  ]) {
    const result = (await mcp.handle(call(name, args))).result;
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.view, undefined);
    assert.deepEqual(result.structuredContent.sources, []);
    if (name === 'get_active_fires') {
      assert.equal(result.structuredContent.rows.length, 25);
      assert.equal(result.structuredContent.truncated, true);
    }
  }
  assert.deepEqual(requests, ['/api/flights', '/api/vessels', '/api/firms']);
});

test('boots the generated Node MCP command from a separate directory over stdio', async () => {
  const { createSearchToolkit } = await toolkit();
  const { command, args, env } = createSearchToolkit(
    {
      SEARCH_MCP_API_BASE: 'http://localhost:4321',
      SEARCH_RELIEFWEB_APPNAME: 'approved-abc',
    },
    [],
  ).config.mcpServers.gev_search;
  const subprocess = spawnSync(command, args, {
    cwd: process.env.TEMP || process.env.TMPDIR || process.cwd(),
    env: { ...process.env, ...env },
    input: JSON.stringify(message('tools/list')) + '\n',
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(
    subprocess.status,
    0,
    subprocess.stderr || subprocess.error?.message,
  );
  const { result } = JSON.parse(subprocess.stdout);
  assert.deepEqual(result.tools.map(({ name }) => name).sort(), [
    'aircraft_in_area',
    'get_active_fires',
    'reliefweb_reports',
    'vessels_in_area',
    'wikidata_places',
  ]);
});

test('caps simultaneous Wikidata coordinate requests at three', async () => {
  const { createToolkitServer } = await server();
  let inFlight = 0;
  let maximum = 0;
  const mcp = createToolkitServer({
    fetchImpl: async (url) => {
      if (url.searchParams.get('action') === 'wbsearchentities') {
        return Response.json({
          search: Array.from({ length: 5 }, (_, i) => ({
            id: 'Q' + (i + 1),
          })),
        });
      }
      maximum = Math.max(maximum, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return Response.json({ claims: {} });
    },
  });
  const { result } = await mcp.handle(
    call('wikidata_places', { query: 'Port', limit: 5 }),
  );
  assert.equal(result.structuredContent.sources.length, 5);
  assert.ok(maximum <= 3, 'Too many simultaneous requests');
});
