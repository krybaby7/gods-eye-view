import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createSearchService } from '../server/providers/search/index.js';

const script = fileURLToPath(new URL('./bench-searches.mjs', import.meta.url));
const exec = promisify(execFile);

async function reportPath(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gev-bench-searches-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'report.json');
}

test('fixture CLI records matched Claude runs across eight questions', async (t) => {
  const out = await reportPath(t);
  const noNetwork =
    'data:text/javascript,' +
    encodeURIComponent(
      "import { Socket } from 'node:net'; import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module';" +
        "Socket.prototype.connect = cp.spawn = () => { throw Error('Fixture I/O is disabled'); }; syncBuiltinESMExports();",
    );
  const { stdout } = await exec(
    process.execPath,
    [
      '--import',
      noNetwork,
      script,
      '--fixtures',
      '--url',
      'http://127.0.0.1:1',
      '--out',
      out,
    ],
    { env: { ...process.env, SEARCH_TOOLKIT: 'off' }, timeout: 30_000 },
  );
  const raw = await readFile(out, 'utf8');
  const report = JSON.parse(raw);
  assert.equal(report.fixtures, true);
  assert.equal(report.runs.length, 16);
  assert.equal(new Set(report.runs.map(({ question }) => question)).size, 8);
  assert.deepEqual(
    new Set(report.runs.map(({ category }) => category)),
    new Set(['news', 'statements', 'places']),
  );
  for (let i = 0; i < report.runs.length; i += 2) {
    const [baseline, toolkit] = report.runs.slice(i, i + 2);
    assert.equal(baseline.question, toolkit.question);
    assert.equal(baseline.mode, 'baseline');
    assert.equal(toolkit.mode, 'toolkit');
    assert.equal(baseline.agent, 'claude');
    assert.equal(toolkit.agent, 'claude');
    for (const [run, sources, mapped] of [
      [baseline, 2, 1],
      [toolkit, 3, 2],
    ]) {
      assert.equal(run.status, 'ok');
      assert.equal(run.sourceCount, sources);
      assert.equal(run.mapped, mapped);
      assert.equal(run.listOnly, 1);
      assert.equal(run.droppedNoSource, 1);
      assert.deepEqual(run.checkedBy, { 'tool-result': sources, fetch: 0 });
      assert.ok(Number.isFinite(run.durationMs));
      assert.ok(run.inputTokens > 0 && run.outputTokens > 0 && run.costUsd > 0);
    }
  }
  assert.match(stdout, /16 succeeded, 0 failed/);
  assert.doesNotMatch(raw, /https?:\/\/|fixture research notes/);
});

test('a terminal failure is sanitized and retained alongside subsequent runs', async (t) => {
  const out = await reportPath(t);
  const { runBenchmark } = await import('./bench-searches.mjs');
  let count = 0;
  let disposed = 0;
  const report = await runBenchmark({
    fixtures: true,
    out,
    log: () => {},
    createService: (options) => {
      if (count++ === 0) {
        options.agents.get('claude').mapFindings = async () => {
          throw Object.assign(new Error('secret raw error'), {
            code: 'SEARCH_MAP_INVALID',
          });
        };
      }
      const service = createSearchService(options);
      return {
        ...service,
        async dispose() {
          await service.dispose();
          disposed++;
        },
      };
    },
  });
  const raw = await readFile(out, 'utf8');
  assert.equal(disposed, 16);
  assert.equal(report.runs[0].status, 'failed');
  assert.equal(report.runs[0].failure, 'invalid_map');
  assert.equal(report.runs[0].costUsd, 0.01);
  assert.equal(report.runs[0].inputTokens, 1_250);
  assert.equal(report.runs.at(-1).status, 'ok');
  assert.deepEqual(JSON.parse(raw), report);
  assert.doesNotMatch(raw, /secret raw error/);
});
