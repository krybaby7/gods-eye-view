import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createClaudeNewsModel } from '../../server/providers/news/digest/claude.js';
import {
  prepareBrief,
  runBrief,
} from '../../server/providers/news/digest/brief.js';
import { runDigest } from '../../server/providers/news/digest/runner.js';

const fakeCli = fileURLToPath(
  new URL(
    '../../server/providers/search/agents/fixtures/fake-cli.mjs',
    import.meta.url,
  ),
);
const nowMs = Date.parse('2026-11-08T10:00:00Z');
const theater = {
  id: 'fixture',
  brief: [],
  gazetteer: Array.from({ length: 120 }, (_, i) => ({
    name: i === 0 ? 'Bandar Abbas' : 'Port District ' + i,
    aliases: ['Bay ' + i],
  })),
  categories: [{ id: 'events' }],
};

async function fixture(t, output, options = {}) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'gev-news-claude-test-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const log = path.join(cacheDir, 'log.json');
  const reply = path.join(cacheDir, 'reply.json');
  await writeFile(
    reply,
    JSON.stringify({
      type: 'result',
      subtype: options.failure ? 'error' : 'success',
      is_error: options.failure === true,
      structured_output: output,
      duration_ms: 65_000,
      usage: { input_tokens: 70_000, output_tokens: 14_300 },
      total_cost_usd: 0.123456,
    }),
  );
  const adapter = createClaudeNewsModel({
    executable: process.execPath,
    executableArgs: [
      fakeCli,
      JSON.stringify({
        log,
        reply,
        mode: options.mode,
        exitCode: options.failure ? 1 : 0,
      }),
    ],
    env: { ...process.env, ANTHROPIC_API_KEY: 'must-not-leak' },
    timeoutMs: options.timeoutMs,
  });
  return {
    ...adapter,
    log,
    readLog: async () => JSON.parse(await readFile(log, 'utf8')),
  };
}

const digestInput = (callModel) => ({
  callModel,
  theater,
  nowMs,
  sourcesById: new Map(),
  openStories: [],
  newItems: [],
  knownItemIds: new Set(),
});

test('digest sends a full input over stdin and records Claude usage separately', async (t) => {
  const stories = Array.from({ length: 80 }, (_, i) => ({
    id: i < 60 ? 'story' + i : null,
    title: 'Blast reported at port district ' + i,
    summary:
      'Reporting describes a blast heard by witnesses near the port. '.repeat(
        6,
      ),
    category: 'events',
    placeName: 'Port District ' + i,
    lat: 27.2,
    lon: 56.3,
    eventAt: new Date(nowMs).toISOString(),
    itemIds: Array.from({ length: 5 }, (_, j) => 'item' + (i * 5 + j)),
    claims: Array.from({ length: 5 }, (_, j) => ({
      text:
        'Witness ' + j + ' described a blast and an evacuation near the port.',
      actor: null,
      type: 'occurrence',
      itemIds: ['item' + (i * 5 + j)],
    })),
    whatsNew: 'New reporting added details from additional witnesses.',
    contradictions: ['Reports give conflicting times for the blast.'],
    status: 'open',
    kind: 'event',
    actorIds: [],
  }));
  assert.ok(JSON.stringify({ stories }).length > 100_000);
  const { callModel, readLog } = await fixture(t, { stories });
  const newItems = Array.from({ length: 400 }, (_, i) => ({
    id: 'item' + i,
    sourceId: 'wire',
    title: 'Headline ' + i,
    snippet: 'Detail '.repeat(70),
    publishedAt: new Date(nowMs).toISOString(),
  }));
  const openStories = Array.from({ length: 60 }, (_, i) => ({
    id: 'story' + i,
    status: 'open',
    title: 'Story ' + i,
    category: 'events',
    itemIds: [],
    claims: [],
    updatedAt: new Date(nowMs).toISOString(),
  }));
  const result = await runDigest({
    ...digestInput(callModel),
    newItems,
    openStories,
    knownItemIds: new Set(newItems.map(({ id }) => id)),
  });
  assert.equal(result.stories.length, 80);
  assert.equal(result.processedItemIds.length, 400);
  assert.equal(result.openStoryIds.length, 60);
  assert.equal(result.cost.costUsd, 0);
  assert.deepEqual(result.planUsage, {
    durationMs: 65_000,
    inputTokens: 70_000,
    outputTokens: 14_300,
    costUsd: 0.123456,
  });
  const {
    args,
    prompt,
    apiKey,
    maxOutputTokens,
    files,
    mcpConfig,
    cwd,
    systemPrompt,
  } = await readLog();
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.ok(
    args.includes('--restricted') && args.includes('--strict-mcp-config'),
  );
  assert.ok(!args.includes('--bare'));
  assert.deepEqual(mcpConfig, { mcpServers: {} });
  assert.match(systemPrompt, /Bandar Abbas \(Bay 0\)/);
  assert.deepEqual(
    JSON.parse(args[args.indexOf('--json-schema') + 1]).required,
    ['stories'],
  );
  assert.ok(prompt.length > 32_767);
  assert.equal(apiKey, undefined);
  assert.equal(maxOutputTokens, '64000');
  assert.deepEqual(files, ['instructions.txt']);
  await assert.rejects(stat(cwd), { code: 'ENOENT' });
});

test('brief uses its own structured schema and existing citation validation', async (t) => {
  const { callModel, readLog } = await fixture(t, {
    headline: { text: 'Reported event', storyIds: ['known', 'invented'] },
  });
  const prepared = prepareBrief({
    theater,
    nowMs,
    stories: [],
    previousBrief: null,
    coverage: null,
  });
  prepared.storyIds = ['known'];
  const result = await runBrief({ callModel, prepared, theater, nowMs });
  assert.deepEqual(result.brief.headline.storyIds, ['known']);
  const { args } = await readLog();
  assert.ok(
    JSON.parse(args[args.indexOf('--json-schema') + 1]).required.includes(
      'headline',
    ),
  );
  assert.equal(args[args.indexOf('--tools') + 1], '');
});

test('Claude rejects a malformed structured reply', async (t) => {
  const { callModel } = await fixture(t, []);
  await assert.rejects(runDigest(digestInput(callModel)), {
    code: 'malformed_output',
  });
});

test('Claude bounds model runs and cancels an active child', async (t) => {
  const timed = await fixture(t, null, { mode: 'hang', timeoutMs: 150 });
  await assert.rejects(runDigest(digestInput(timed.callModel)), {
    code: 'timeout',
  });
  const pending = await fixture(t, null, { mode: 'hang' });
  const controller = new AbortController();
  const result = runDigest({
    ...digestInput(pending.callModel),
    signal: controller.signal,
  });
  const rejected = assert.rejects(result, { code: 'cancelled' });
  try {
    for (let attempt = 0; attempt < 500; attempt++) {
      if (await pending.readLog().catch(() => null)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal((await pending.readLog()).args[0], '-p');
  } finally {
    controller.abort();
  }
  await rejected;
});

test('Claude failure retains reported plan usage without exposing raw output', async (t) => {
  const { callModel } = await fixture(
    t,
    { secret: 'do not log' },
    { failure: true },
  );
  await assert.rejects(runDigest(digestInput(callModel)), {
    code: 'model_error',
    planUsage: {
      durationMs: 65_000,
      inputTokens: 70_000,
      outputTokens: 14_300,
      costUsd: 0.123456,
    },
  });
});
