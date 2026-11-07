import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
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
  const { agents, log } = await testAgents(t, { FAKE_MODE: 'tree' });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const run = agents
    .get('claude')
    .research({ question: 'wait', signal: controller.signal });
  const rejected = assert.rejects(run, { code: 'SEARCH_AGENT_CANCELED' });
  const marker = log + '.child';
  const deadline = Date.now() + 2_000;
  while ((await readFile(marker, 'utf8').catch(() => null)) === null) {
    assert.ok(Date.now() < deadline, 'fake child did not start');
    await delay(20);
  }
  controller.abort();
  await rejected;
  await delay(950);
  assert.equal(await readFile(marker, 'utf8'), 'started');
});
