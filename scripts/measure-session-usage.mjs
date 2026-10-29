#!/usr/bin/env node
/**
 * Sum what a Claude Code session spent: tokens per model (input, cache
 * writes, cache reads, output), API calls, sub-agent runs and wall-clock
 * time, read from the session transcript Claude Code keeps on disk, plus an
 * estimated cost from a price table you can override.
 *
 *   node scripts/measure-session-usage.mjs <session-id | path/to/session.jsonl> [more...]
 *     [--project <project-dir>] [--prices <prices.json>] [--json]
 *
 * The session id is the file name Claude Code writes under
 * ~/.claude/projects/<project-slug>/<session-id>.jsonl; its sub-agents are
 * read from <session-id>/subagents/**.jsonl beside it. Several sessions can
 * be passed (an orchestrated run that used linked sessions). Sidechain
 * records inside the main file (older Claude Code versions) are counted
 * once, as sub-agent usage.
 *
 * Prices are USD per million tokens. Cache writes are priced by TTL from
 * `usage.cache_creation` (5-minute writes at 1.25x input, 1-hour writes at
 * 2x input) unless the price table gives explicit `cacheWrite5m` /
 * `cacheWrite1h` values. Edit PRICES or pass --prices when rates change.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * USD per million tokens, from the Claude pricing page as read on
 * 2026-10-29 (the Sonnet 5.5 cache-read rate there is $0.10; an older
 * model table said $0.20). Check the page when a run matters.
 */
const PRICES = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  // The rate for prompts up to 100K tokens. A request whose prompt is
  // larger is billed at five times these on every token, which this
  // script does not model: keep Haiku sub-agents under 100K.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const targets = args.filter(
  (arg, index) =>
    !arg.startsWith('--') &&
    !['--project', '--prices'].includes(args[index - 1]),
);
const asJson = args.includes('--json');
if (!targets.length) {
  console.error(
    'usage: measure-session-usage.mjs <session-id | session.jsonl> [...] [--project <dir>] [--prices <json>] [--json]',
  );
  process.exit(2);
}
const prices = flag('--prices')
  ? { ...PRICES, ...JSON.parse(readFileSync(flag('--prices'), 'utf8')) }
  : PRICES;

/** Claude Code's project slug: the working directory with each non-alphanumeric character replaced by '-'. */
function projectDir() {
  const explicit = flag('--project');
  if (explicit) return explicit;
  const slug = process.cwd().replace(/[^A-Za-z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug);
}

function resolveSession(target) {
  if (target.endsWith('.jsonl') && existsSync(target)) {
    return {
      id: path.basename(target, '.jsonl'),
      file: target,
      dir: path.join(path.dirname(target), path.basename(target, '.jsonl')),
    };
  }
  const dir = projectDir();
  const file = path.join(dir, `${target}.jsonl`);
  if (!existsSync(file)) {
    console.error(`no transcript at ${file}`);
    process.exit(2);
  }
  return { id: target, file, dir: path.join(dir, target) };
}

function readRecords(file) {
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* partial line */
    }
  }
  return out;
}

function listJsonl(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listJsonl(full));
    else if (entry.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function emptyRow() {
  return {
    calls: 0,
    input: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    output: 0,
    thinking: 0,
  };
}

function add(row, usage) {
  row.calls++;
  row.input += usage.input_tokens || 0;
  const creation = usage.cache_creation || {};
  const write5m = creation.ephemeral_5m_input_tokens;
  const write1h = creation.ephemeral_1h_input_tokens;
  if (Number.isFinite(write5m) || Number.isFinite(write1h)) {
    row.cacheWrite5m += write5m || 0;
    row.cacheWrite1h += write1h || 0;
  } else row.cacheWrite5m += usage.cache_creation_input_tokens || 0;
  row.cacheRead += usage.cache_read_input_tokens || 0;
  row.output += usage.output_tokens || 0;
  row.thinking += usage.output_tokens_details?.thinking_tokens || 0;
}

function cost(model, row) {
  const price = prices[model];
  if (!price) return null;
  const write5m = price.cacheWrite5m ?? price.input * 1.25;
  const write1h = price.cacheWrite1h ?? price.input * 2;
  return (
    (row.input * price.input +
      row.cacheWrite5m * write5m +
      row.cacheWrite1h * write1h +
      row.cacheRead * price.cacheRead +
      row.output * price.output) /
    1e6
  );
}

/**
 * Tally one transcript. Records with `isSidechain` are sub-agent turns kept
 * in the main file; they are tallied under `subagents` so the main and
 * sub-agent totals never double count.
 */
function tally(records, into, { sidechainInto } = {}) {
  let first = null;
  let last = null;
  for (const record of records) {
    const at = Date.parse(record.timestamp || '');
    if (!Number.isNaN(at) && ['user', 'assistant'].includes(record.type)) {
      first = first === null ? at : Math.min(first, at);
      last = last === null ? at : Math.max(last, at);
    }
    const usage = record.message?.usage;
    if (record.type !== 'assistant' || !usage) continue;
    const model = record.message.model || 'unknown';
    const target = record.isSidechain && sidechainInto ? sidechainInto : into;
    target[model] ??= emptyRow();
    add(target[model], usage);
  }
  return { first, last };
}

const report = {
  sessions: [],
  main: {},
  subagents: {},
  subagentRuns: [],
  firstAt: null,
  lastAt: null,
};
for (const target of targets) {
  const session = resolveSession(target);
  const span = tally(readRecords(session.file), report.main, {
    sidechainInto: report.subagents,
  });
  report.sessions.push({ id: session.id, file: session.file, ...span });
  for (const file of listJsonl(path.join(session.dir, 'subagents'))) {
    const records = readRecords(file);
    const run = {};
    const runSpan = tally(records, run);
    let meta = {};
    const metaFile = file.replace(/\.jsonl$/, '.meta.json');
    if (existsSync(metaFile)) {
      try {
        meta = JSON.parse(readFileSync(metaFile, 'utf8'));
      } catch {
        /* no meta */
      }
    }
    report.subagentRuns.push({
      file: path.relative(session.dir, file),
      agentType: meta.agentType || null,
      description: meta.description || null,
      models: run,
      durationMs:
        runSpan.first !== null && runSpan.last !== null
          ? runSpan.last - runSpan.first
          : null,
    });
    for (const [model, row] of Object.entries(run)) {
      report.subagents[model] ??= emptyRow();
      for (const key of Object.keys(row))
        report.subagents[model][key] += row[key];
    }
  }
  if (span.first !== null)
    report.firstAt =
      report.firstAt === null
        ? span.first
        : Math.min(report.firstAt, span.first);
  if (span.last !== null)
    report.lastAt =
      report.lastAt === null ? span.last : Math.max(report.lastAt, span.last);
}

function totals(groups) {
  const out = {};
  for (const group of groups)
    for (const [model, row] of Object.entries(group)) {
      out[model] ??= emptyRow();
      for (const key of Object.keys(row)) out[model][key] += row[key];
    }
  return out;
}
report.total = totals([report.main, report.subagents]);
const sumCost = (group) =>
  Object.entries(group).reduce(
    (sum, [model, row]) => sum + (cost(model, row) ?? 0),
    0,
  );
report.costUsd = {
  main: sumCost(report.main),
  subagents: sumCost(report.subagents),
  total: sumCost(report.total),
};
report.unpricedModels = Object.keys(report.total).filter(
  (model) => !prices[model],
);
report.wallClockMs =
  report.firstAt !== null && report.lastAt !== null
    ? report.lastAt - report.firstAt
    : null;

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const minutes = (ms) => (ms === null ? '—' : `${(ms / 60_000).toFixed(1)} min`);
function table(title, group) {
  const rows = Object.entries(group);
  if (!rows.length) return;
  console.log(`\n${title}`);
  console.log(
    '| model | calls | input | cache write 5m | cache write 1h | cache read | output (thinking) | est. cost |',
  );
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [model, row] of rows) {
    const usd = cost(model, row);
    console.log(
      `| ${model} | ${row.calls} | ${fmt(row.input)} | ${fmt(row.cacheWrite5m)} | ${fmt(row.cacheWrite1h)} | ${fmt(row.cacheRead)} | ${fmt(row.output)} (${fmt(row.thinking)}) | ${usd === null ? 'no price' : `$${usd.toFixed(2)}`} |`,
    );
  }
}
console.log(
  `Sessions: ${report.sessions.map((s) => s.id).join(', ')} · wall clock ${minutes(report.wallClockMs)} (first user message to last assistant message, idle time included)`,
);
table('Main session', report.main);
table(`Sub-agents (${report.subagentRuns.length} runs)`, report.subagents);
table('Total', report.total);
if (report.subagentRuns.length) {
  console.log('\nSub-agent runs');
  for (const run of report.subagentRuns) {
    const out = Object.values(run.models).reduce((s, r) => s + r.output, 0);
    const models = Object.keys(run.models).join('+') || '?';
    console.log(
      `- ${run.agentType || 'agent'} · ${run.description || run.file} · ${models} · ${minutes(run.durationMs)} · ${fmt(out)} output tokens`,
    );
  }
}
console.log(
  `\nEstimated cost: main $${report.costUsd.main.toFixed(2)} · sub-agents $${report.costUsd.subagents.toFixed(2)} · total $${report.costUsd.total.toFixed(2)}${report.unpricedModels.length ? ` (no price for ${report.unpricedModels.join(', ')})` : ''}`,
);
console.log(
  'Prices are list rates per million tokens; a subscription plan bills differently, so compare runs by tokens first.',
);
