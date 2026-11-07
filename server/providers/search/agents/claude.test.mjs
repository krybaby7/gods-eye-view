import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const importAdapter = () => import('./claude.js');
const fakeCli = fileURLToPath(
  new URL('./fixtures/fake-cli.mjs', import.meta.url),
);

test('reads paired successful results and final Claude usage', async () => {
  const { parseClaudeResearch } = await importAdapter();
  const parsed = parseClaudeResearch(
    await readFile(
      new URL('./fixtures/research.jsonl', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(
    parsed.sources.map((source) => source.url),
    ['https://example.com/news', 'https://example.org/good'],
  );
  assert.equal(parsed.agentModel, 'claude-sonnet-test');
  assert.deepEqual(parsed.usage, {
    durationMs: 50,
    inputTokens: 10,
    outputTokens: 20,
    costUsd: 0.02,
  });
  assert.match(parsed.notes, /invented/);
  assert.throws(
    () =>
      parseClaudeResearch(
        '{"type":"result","subtype":"error","result":"private result"}',
      ),
    { code: 'SEARCH_AGENT_FAILED' },
  );
});

test('takes map data only from structured output', async () => {
  const { parseClaudeMap } = await importAdapter();
  const parsed = parseClaudeMap(
    await readFile(new URL('./fixtures/map.json', import.meta.url), 'utf8'),
  );
  assert.equal(parsed.json.label, 'Example');
  assert.equal(parsed.agentModel, 'claude-sonnet-test');
  assert.throws(
    () => parseClaudeMap('{"type":"result","subtype":"success","result":"{}"}'),
    { code: 'SEARCH_MAP_INVALID' },
  );
});

test('Claude argv omits unsupported bounds while retaining map shape and instructions', async () => {
  const { buildClaudeArgs } = await importAdapter();
  const { MAP_SCHEMA } = await import('../mapper.js');
  const args = buildClaudeArgs({ step: 'map', schema: MAP_SCHEMA });
  const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.label.maxLength, undefined);
  assert.match(schema.properties.label.description, /40 characters/);
  assert.equal(schema.properties.findings.maxItems, undefined);
  assert.match(schema.properties.findings.description, /60 items/);
  assert.equal(
    schema.properties.findings.items.properties.lat.minimum,
    undefined,
  );
  assert.match(
    schema.properties.findings.items.properties.lat.description,
    /-90/,
  );
});

test('uses Claude structured tool results and requires successful HTTP status for fetches', async () => {
  const { parseClaudeResearch } = await importAdapter();
  const calls = [
    {
      type: 'tool_use',
      id: 'search',
      name: 'WebSearch',
      input: { query: 'test' },
    },
    {
      type: 'tool_use',
      id: 'fetch',
      name: 'WebFetch',
      input: { url: 'https://example.com/start' },
    },
    {
      type: 'tool_use',
      id: 'redirect',
      name: 'WebFetch',
      input: { url: 'https://example.com/redirect' },
    },
  ];
  const event = (id, structured) => ({
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: id, content: 'plain response' },
      ],
    },
    tool_use_result: structured,
  });
  const jsonl = [
    { type: 'assistant', message: { content: calls } },
    event('search', {
      results: [
        'model text https://example.com/unverified',
        {
          tool_use_id: 'nested',
          content: [{ url: 'https://example.com/result' }],
        },
      ],
    }),
    event('fetch', {
      code: 200,
      url: 'https://example.com/end',
      result: 'Body',
    }),
    event('redirect', {
      code: 302,
      url: 'https://example.com/redirect',
      result: 'Redirect',
    }),
    { type: 'result', subtype: 'success', result: 'Notes' },
  ]
    .map((line) => JSON.stringify(line))
    .join('\n');
  assert.deepEqual(
    parseClaudeResearch(jsonl).sources.map(({ url }) => url),
    ['https://example.com/result', 'https://example.com/end'],
  );
});

async function testAgents(t, env = {}, options = {}) {
  const { createSearchAgents } = await import('./index.js');
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'gev-search-test-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const log = path.join(cacheDir, 'log.json');
  const { FAKE_AUTH_METHOD: authMethod, FAKE_MODE: mode, ...extraEnv } = env;
  const agents = createSearchAgents({
    cacheDir,
    executable: process.execPath,
    executableArgs: [fakeCli, JSON.stringify({ log, authMethod, mode })],
    env: { ...process.env, ...extraEnv },
    ...options,
  });
  return { agents, log, cacheDir };
}

test('uses stdin, restricted argv and a separate empty scratch directory for each step', async (t) => {
  const { agents, log, cacheDir } = await testAgents(t, {
    ANTHROPIC_API_KEY: 'fake-key',
    SEARCH_TOOLKIT: 'off',
    SEARCH_CLAUDE_MODEL: 'sonnet',
  });
  const adapter = agents.get('claude');
  await adapter.research({ question: 'literal ; shell marker' });
  const research = JSON.parse(await readFile(log, 'utf8'));
  const schema = { type: 'object' };
  await adapter.mapFindings({ prompt: 'example prompt', schema });
  const map = JSON.parse(await readFile(log, 'utf8'));
  assert.deepEqual(research.files, []);
  assert.deepEqual(map.files, []);
  assert.notEqual(research.cwd, map.cwd);
  assert.deepEqual(await readdir(path.join(cacheDir, 'search-runs')), []);
  for (const entry of [research, map]) {
    assert.ok(entry.args.includes('--restricted'));
    assert.ok(entry.args.includes('--no-chrome'));
    assert.ok(entry.args.includes('--no-session-persistence'));
    assert.ok(entry.args.includes('--strict-mcp-config'));
    assert.equal(
      entry.args[entry.args.indexOf('--mcp-config') + 1],
      '{"mcpServers":{}}',
    );
    assert.ok(entry.args.includes('dontAsk'));
    assert.ok(entry.args.includes('sonnet'));
    assert.equal(entry.apiKey, undefined);
  }
  assert.equal(
    research.args[research.args.indexOf('--tools') + 1],
    'WebSearch,WebFetch',
  );
  assert.equal(
    research.args[research.args.indexOf('--allowedTools') + 1],
    'WebSearch,WebFetch',
  );
  assert.equal(
    research.args[research.args.indexOf('--disallowedTools') + 1],
    'mcp__*',
  );
  assert.ok(!research.args.some((arg) => arg.includes('shell marker')));
  assert.match(research.prompt, /literal ; shell marker/);
  assert.equal(map.args[map.args.indexOf('--tools') + 1], '');
  assert.equal(
    map.args[map.args.indexOf('--json-schema') + 1],
    JSON.stringify(schema),
  );
  assert.equal(map.prompt, 'example prompt');
});

test('publishes subscription sign-in status only and never selects Codex', async (t) => {
  const { agents } = await testAgents(t);
  const status = await agents.status();
  assert.deepEqual(status.claude, {
    installed: true,
    signedIn: true,
    disabledReason: null,
  });
  assert.deepEqual(status.codex, {
    installed: false,
    signedIn: false,
    disabledReason: 'Not available yet',
  });
  assert.equal(agents.get('codex'), null);
  const nonSubscription = await testAgents(t, { FAKE_AUTH_METHOD: 'console' });
  assert.equal((await nonSubscription.agents.status()).claude.signedIn, false);
});

test('status checks coalesce and cache briefly but a fresh check probes again', async (t) => {
  const { agents, log } = await testAgents(t);
  const [first, second] = await Promise.all([agents.status(), agents.status()]);
  assert.deepEqual(first, second);
  assert.deepEqual(await agents.status(), first);
  assert.equal(await readFile(log, 'utf8'), 'version\nauth\n');
  assert.deepEqual(await agents.status({ fresh: true }), first);
  assert.equal(await readFile(log, 'utf8'), 'version\nauth\nversion\nauth\n');
});

test('cancels and times out subprocesses and cleans scratch directories', async (t) => {
  const { agents, cacheDir } = await testAgents(
    t,
    { FAKE_MODE: 'hang' },
    { timeoutMs: 150 },
  );
  const adapter = agents.get('claude');
  await assert.rejects(adapter.research({ question: 'wait' }), {
    code: 'SEARCH_AGENT_TIMEOUT',
  });
  await assert.rejects(
    adapter.research({ question: 'cancel', signal: AbortSignal.timeout(50) }),
    { code: 'SEARCH_AGENT_CANCELED' },
  );
  assert.deepEqual(await readdir(path.join(cacheDir, 'search-runs')), []);
});

test('caps stdout and keeps subprocess failures private', async (t) => {
  const failed = await testAgents(t, { FAKE_MODE: 'fail' });
  const overflowing = await testAgents(
    t,
    { FAKE_MODE: 'overflow' },
    { maxOutputBytes: 1024 },
  );
  for (const { agents } of [failed, overflowing]) {
    await assert.rejects(
      agents.get('claude').research({ question: 'test' }),
      (error) => {
        assert.equal(error.code, 'SEARCH_AGENT_FAILED');
        assert.doesNotMatch(error.message, /private model response|xxx/);
        return true;
      },
    );
  }
});

test('cancel stops descendants as well as the CLI', async (t) => {
  const listening = (port) =>
    new Promise((resolve, reject) => {
      const connection = createConnection({ host: '127.0.0.1', port });
      connection.once('connect', () => {
        connection.end();
        resolve(true);
      });
      connection.once('error', (error) => {
        if (error.code === 'ECONNREFUSED') resolve(false);
        else reject(error);
      });
      connection.setTimeout(2_000, () =>
        connection.destroy(new Error('Descendant socket timed out')),
      );
    });
  const { agents, log } = await testAgents(t, { FAKE_MODE: 'tree' });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const run = agents
    .get('claude')
    .research({ question: 'wait', signal: controller.signal });
  const rejected = assert.rejects(run, { code: 'SEARCH_AGENT_CANCELED' });
  const marker = log + '.child';
  const startDeadline = Date.now() + 8_000;
  let port;
  while (!(port = Number(await readFile(marker, 'utf8').catch(() => 0)))) {
    assert.ok(Date.now() < startDeadline, 'fake child did not start');
    await delay(20);
  }
  assert.ok(await listening(port), 'descendant listens before cancellation');
  controller.abort();
  await rejected;
  const stopDeadline = Date.now() + 4_000;
  while (await listening(port)) {
    assert.ok(
      Date.now() < stopDeadline,
      'descendant still listens after cancellation',
    );
    await delay(20);
  }
});

test('writes and cleans the private toolkit config for research only', async (t) => {
  const { agents, log, cacheDir } = await testAgents(t, {
    SEARCH_TOOLKIT: '',
    SEARCH_MCP_API_BASE: 'http://127.0.0.1:4321',
    SEARCH_RELIEFWEB_APPNAME: 'approved-abc',
    UNRELATED_KEY: 'never-pass',
  });
  const adapter = agents.get('claude');
  await adapter.research({ question: 'Cairo' });
  const research = JSON.parse(await readFile(log, 'utf8'));
  const configPath = research.args[research.args.indexOf('--mcp-config') + 1];
  assert.equal(path.dirname(configPath), research.cwd);
  assert.deepEqual(research.files, [path.basename(configPath)]);
  assert.equal(research.appname, undefined);
  assert.deepEqual(Object.keys(research.mcpConfig.mcpServers), ['gev_search']);
  const server = research.mcpConfig.mcpServers.gev_search;
  assert.equal(server.command, process.execPath);
  assert.deepEqual(server.env, {
    GEV_SEARCH_API_BASE: 'http://127.0.0.1:4321',
    GEV_SEARCH_RELIEFWEB_APPNAME: 'approved-abc',
  });
  assert.equal(
    research.args[research.args.indexOf('--tools') + 1],
    'WebSearch,WebFetch',
  );
  assert.deepEqual(
    research.args[research.args.indexOf('--allowedTools') + 1].split(','),
    [
      'WebSearch',
      'WebFetch',
      'mcp__gev_search__wikidata_places',
      'mcp__gev_search__reliefweb_reports',
      'mcp__gev_search__aircraft_in_area',
      'mcp__gev_search__vessels_in_area',
      'mcp__gev_search__get_active_fires',
    ],
  );
  assert.match(research.prompt, /Wikidata/);
  assert.match(research.prompt, /ReliefWeb/);
  assert.match(research.prompt, /aircraft, vessels, and fires/);
  await adapter.mapFindings({ prompt: 'map', schema: { type: 'object' } });
  const map = JSON.parse(await readFile(log, 'utf8'));
  assert.deepEqual(map.files, []);
  assert.deepEqual(map.mcpConfig, { mcpServers: {} });
  assert.equal(map.args[map.args.indexOf('--disallowedTools') + 1], 'mcp__*');
  assert.deepEqual(await readdir(path.join(cacheDir, 'search-runs')), []);
});

test('accepts only paired successful toolkit result URLs from enabled tools', async () => {
  const { parseClaudeResearch } = await importAdapter();
  const prefix = 'mcp__gev_search__';
  const calls = [
    [
      'wikidata_places',
      {
        sources: [
          { url: 'https://www.wikidata.org/wiki/Q85', title: 'Cairo' },
          { url: 'https://www.wikidata.org.example.org/wiki/Q85' },
          { url: 'http://www.wikidata.org/wiki/Q86' },
        ],
      },
    ],
    [
      'get_active_fires',
      {
        view: { url: 'http://localhost:4173/#something' },
        sources: [
          { url: 'http://localhost:4173/' },
          { url: 'https://firms.modaps.eosdis.nasa.gov/map/' },
          { url: 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/key/' },
        ],
      },
    ],
    [
      'reliefweb_reports',
      { sources: [{ url: 'https://reliefweb.int/node/42' }] },
    ],
    [
      'wikidata_places',
      { sources: [{ url: 'https://www.wikidata.org/wiki/Q42' }] },
      true,
    ],
    [
      'panel_request',
      { sources: [{ url: 'https://www.wikidata.org/wiki/Q33' }] },
    ],
  ];
  const jsonl = [
    {
      type: 'assistant',
      message: {
        content: calls.map(([name], index) => ({
          type: 'tool_use',
          id: String(index),
          name: prefix + name,
          input: { url: 'https://www.wikidata.org/wiki/Q34' },
        })),
      },
    },
    {
      type: 'user',
      message: {
        content: calls.map(([, data, is_error], index) => ({
          type: 'tool_result',
          tool_use_id: String(index),
          is_error,
          content: [
            { type: 'text', text: 'Context' },
            { type: 'text', text: JSON.stringify(data) },
          ],
        })),
      },
    },
    {
      type: 'result',
      subtype: 'success',
      result: 'https://www.wikidata.org/wiki/Q999999',
    },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');
  assert.deepEqual(
    parseClaudeResearch(jsonl, [
      prefix + 'wikidata_places',
      prefix + 'get_active_fires',
    ]).sources.map(({ url }) => url),
    [
      'https://www.wikidata.org/wiki/Q85',
      'https://firms.modaps.eosdis.nasa.gov/map/',
    ],
  );
});

test('reads an exact JSON toolkit payload from a single text result', async () => {
  const { parseClaudeResearch } = await importAdapter();
  const name = 'mcp__gev_search__reliefweb_reports';
  const data = JSON.stringify({
    sources: [{ url: 'https://reliefweb.int/node/42' }],
  });
  const jsonl = (content) =>
    [
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'one', name }] },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'one', content }],
        },
      },
      { type: 'result', subtype: 'success', result: 'Notes' },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
  assert.deepEqual(parseClaudeResearch(jsonl(data), [name]).sources, [
    { url: 'https://reliefweb.int/node/42' },
  ]);
  assert.deepEqual(
    parseClaudeResearch(jsonl('Other text: ' + data), [name]).sources,
    [],
  );
});
