import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createSearchAgents } from '../server/providers/search/agents/index.js';
import { createSearchContext } from '../server/providers/search/context.js';
import { createSearchService } from '../server/providers/search/index.js';
import { fixtureDependencies } from './bench-searches.fixtures.mjs';

const QUESTIONS = [
  { id: 'crypto', category: 'news', question: "What's going on with crypto?" },
  {
    id: 'sudan',
    category: 'news',
    question: 'What are the latest humanitarian developments in Sudan?',
  },
  {
    id: 'shipping',
    category: 'news',
    question:
      'What has happened recently to commercial shipping in the Red Sea?',
  },
  {
    id: 'climate',
    category: 'statements',
    question: 'Who is saying what about funding climate adaptation?',
  },
  {
    id: 'ai',
    category: 'statements',
    question: 'What are regulators saying about the enforcement of AI rules?',
  },
  {
    id: 'ceasefire',
    category: 'statements',
    question: 'What are the mediators saying about a ceasefire in Gaza?',
  },
  {
    id: 'lithium',
    category: 'places',
    question: "Where are the world's lithium mines?",
  },
  {
    id: 'cables',
    category: 'places',
    question:
      'Where are the major submarine cable landing stations around the Mediterranean?',
  },
];
const MODES = { baseline: 'off', toolkit: 'on' };
const AGENT = 'claude';
const DEFAULT_URL = 'http://127.0.0.1:4173';
const DEFAULT_OUT = 'qa-artifacts/searches/benchmark.json';
const DEFAULT_TIMEOUT_MS = 600_000;
const TERMINAL_FAILURES = new Set([
  'timeout',
  'agent_unavailable',
  'invalid_map',
  'failed',
  'cancelled',
  'interrupted',
]);

function loopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    return null;
  return url.origin;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--fixtures' || flag === '--help') {
      options[flag.slice(2)] = true;
    } else if (
      (flag === '--url' || flag === '--out') &&
      argv[i + 1] &&
      !argv[i + 1].startsWith('--')
    ) {
      options[flag.slice(2)] = argv[++i];
    } else {
      throw new Error(
        'Expected --fixtures, --url <loopback origin>, --out <file>, or --help.',
      );
    }
  }
  if (options.url && !loopbackOrigin(options.url))
    throw new Error('--url must be an HTTP(S) loopback origin.');
  return options;
}

function liveDependencies(cacheDir, env) {
  const agents = createSearchAgents({ cacheDir, env });
  let status;
  // Each service accepts one ask. Keep its admission check for snapshots so
  // polling cannot launch more Claude authentication subprocesses.
  return {
    ...createSearchContext({ cacheDir }),
    agents: {
      ...agents,
      status: (options) => (status ??= agents.status(options)),
    },
  };
}

function runMetrics(search, elapsedMs, failure = null) {
  const { run, findings = [], sources = [] } = search ?? {};
  const ok = run?.status === 'ok' && !failure;
  const checkedBy = { 'tool-result': 0, fetch: 0 };
  for (const source of sources) {
    if (Object.hasOwn(checkedBy, source.checkedBy))
      checkedBy[source.checkedBy]++;
  }
  return {
    status: ok ? 'ok' : 'failed',
    failure: ok ? null : (failure ?? 'failed'),
    durationMs: run?.usage?.durationMs ?? elapsedMs,
    sourceCount: run?.sourceCount ?? sources.length,
    mapped: findings.filter(({ location }) => location).length,
    listOnly:
      run?.listOnly ?? findings.filter(({ location }) => !location).length,
    droppedNoSource: run?.droppedNoSource ?? null,
    checkedBy,
    agentModel: run?.agentModel ?? null,
    inputTokens: run?.usage?.inputTokens ?? null,
    outputTokens: run?.usage?.outputTokens ?? null,
    costUsd: run?.usage?.costUsd ?? null,
  };
}

async function measure(service, question, { timeoutMs, pollMs }) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const { id, runId } = await service.ask({ question, agent: AGENT });
  while (elapsed() <= timeoutMs + 15_000) {
    const { searches, agents } = await service.snapshot();
    const search = searches.find((entry) => entry.id === id);
    if (search?.run?.id === runId && search.status !== 'running') {
      const reason = search.run.error?.reason ?? search.error?.reason;
      return runMetrics(
        search,
        elapsed(),
        TERMINAL_FAILURES.has(reason) ? reason : null,
      );
    }
    if (!agents.claude.busy)
      return runMetrics(search, elapsed(), 'missing_terminal_run');
    await delay(pollMs);
  }
  return runMetrics(null, elapsed(), 'benchmark_timeout');
}

async function writeReport(out, report) {
  const tmp = out + '.' + process.pid + '.tmp';
  try {
    await writeFile(tmp, JSON.stringify(report, null, 2) + '\n');
    await rename(tmp, out);
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function runBenchmark({
  fixtures = false,
  url,
  out = DEFAULT_OUT,
  log = console.log,
  createService = createSearchService,
} = {}) {
  let baseEnv = {};
  if (!fixtures) {
    const { loadEnv } = await import('vite');
    const root = fileURLToPath(new URL('..', import.meta.url));
    baseEnv = { ...loadEnv('development', root, ''), ...process.env };
    baseEnv.SEARCH_MCP_API_BASE = loopbackOrigin(
      url ?? baseEnv.SEARCH_MCP_API_BASE ?? DEFAULT_URL,
    );
    if (!baseEnv.SEARCH_MCP_API_BASE)
      throw new Error(
        'SEARCH_MCP_API_BASE must be an HTTP(S) loopback origin.',
      );
  }
  const configuredTimeout = Number(baseEnv.SEARCH_RUN_TIMEOUT_MS);
  const timeoutMs =
    Number.isSafeInteger(configuredTimeout) &&
    configuredTimeout > 0 &&
    configuredTimeout <= 2_147_483_647
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS;
  const report = {
    fixtures,
    startedAt: new Date().toISOString(),
    plannedRuns: QUESTIONS.length * 2,
    runs: [],
  };
  await mkdir(path.dirname(out), { recursive: true });
  await writeReport(out, report);
  for (const entry of QUESTIONS) {
    for (const [mode, setting] of Object.entries(MODES)) {
      const started = performance.now();
      const cacheDir = await mkdtemp(
        path.join(os.tmpdir(), 'gev-bench-searches-'),
      );
      log(
        '[' +
          (report.runs.length + 1) +
          '/' +
          report.plannedRuns +
          '] ' +
          AGENT +
          ' ' +
          mode +
          ' — ' +
          entry.question,
      );
      const env = { ...baseEnv, SEARCH_TOOLKIT: setting };
      let service;
      let metrics;
      try {
        const dependencies = fixtures
          ? fixtureDependencies(entry, setting === 'on')
          : liveDependencies(cacheDir, env);
        // Service warnings can contain paths and upstream errors. Persist only
        // the normalized terminal status and metrics for this benchmark.
        service = createService({
          cacheDir,
          env,
          timeoutMs,
          logger: {},
          ...dependencies,
        });
        metrics = await measure(service, entry.question, {
          timeoutMs,
          pollMs: fixtures ? 5 : 250,
        });
      } catch (error) {
        const reason =
          error?.code === 'agent_unavailable'
            ? 'agent_unavailable'
            : 'benchmark_error';
        metrics = runMetrics(
          null,
          Math.round(performance.now() - started),
          reason,
        );
      }
      report.runs.push({ ...entry, agent: AGENT, mode, ...metrics });
      try {
        await writeReport(out, report);
      } finally {
        try {
          await service?.dispose();
        } finally {
          await rm(cacheDir, { recursive: true, force: true });
        }
      }
      log(
        metrics.status === 'ok'
          ? '  ' +
              metrics.durationMs +
              ' ms, ' +
              metrics.sourceCount +
              ' sources, ' +
              metrics.mapped +
              ' mapped'
          : '  failed (' + metrics.failure + ')',
      );
    }
  }
  const failed = report.runs.filter(({ status }) => status !== 'ok').length;
  log(
    report.runs.length -
      failed +
      ' succeeded, ' +
      failed +
      ' failed. Report ' +
      path.resolve(out),
  );
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(
        'Usage: node scripts/bench-searches.mjs [--fixtures] [--url <loopback origin>] [--out <file>]',
      );
    } else {
      const { runs } = await runBenchmark(options);
      if (runs.some(({ status }) => status !== 'ok')) process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      'Search benchmark stopped (' +
        (error?.code ?? 'configuration or I/O error') +
        ').',
    );
    process.exitCode = 1;
  }
}
