import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { runFactChecks } from './world-fact-check.mjs';

async function serveBoard(t) {
  const server = createServer((req, res) => {
    const body = JSON.stringify(
      req.url === '/api/world'
        ? { sources: [{ id: 'a' }, { id: 'b' }] }
        : { refresh: null, revision: 1 },
    );
    if (req.headers['accept-encoding'] === 'gzip') {
      res.setHeader('Content-Encoding', 'gzip');
      res.end(gzipSync(body));
    } else res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('reports live board, wire sizes and failures in both evidence files', async (t) => {
  const out = await mkdtemp(join(import.meta.dirname, '.fact-check-test-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const trace = join(out, 'trace.json');
  await writeFile(
    trace,
    JSON.stringify({
      firstBoardMs: 500,
      refresh: {
        sources: 2,
        requests: [
          { path: '/api/world/refresh', bytes: 100 },
          { path: '/api/world/progress', bytes: 100 },
          ...Array.from({ length: 4 }, () => ({
            path: '/api/world',
            bytes: 100,
          })),
        ],
      },
    }),
  );
  const result = await runFactChecks({
    url: await serveBoard(t),
    out,
    trace,
    print() {},
  });
  assert.equal(result.pass, false);
  const saved = JSON.parse(
    await readFile(join(out, 'fact-checks.json'), 'utf8'),
  );
  assert.equal(
    saved.checks.find(({ id }) => id === 'board-raw-size').pass,
    true,
  );
  assert.equal(
    saved.checks.find(({ id }) => id === 'board-compressed-size').pass,
    true,
  );
  assert.equal(
    saved.checks.find(({ id }) => id === 'progress-size').pass,
    true,
  );
  assert.equal(
    saved.checks.find(({ id }) => id === 'refresh-board-fetches').pass,
    false,
  );
  assert.match(
    await readFile(join(out, 'fact-checks.md'), 'utf8'),
    /refresh-board-fetches.*FAIL/,
  );
});

for (const invalidJson of [false, true]) {
  test(`reports ${invalidJson ? 'malformed' : 'missing'} trace measurements as unmeasured`, async (t) => {
    const out = await mkdtemp(join(import.meta.dirname, '.fact-check-test-'));
    t.after(() => rm(out, { recursive: true, force: true }));
    const trace = join(out, 'trace.json');
    if (invalidJson) await writeFile(trace, '{');
    const printed = [];
    const result = await runFactChecks({
      url: await serveBoard(t),
      out,
      trace,
      print: (line) => printed.push(line),
    });
    for (const id of [
      'first-cached-board',
      'refresh-board-fetches',
      'refresh-large-requests',
    ]) {
      const row = result.checks.find((check) => check.id === id);
      assert.equal(row.pass, null);
      assert.match(row.reason, invalidJson ? /invalid JSON/ : /not found/);
      assert.ok(printed.some((line) => line.startsWith(`NOT MEASURED ${id}`)));
    }
    assert.equal(
      result.pass,
      !result.checks.some(({ pass }) => pass === false),
    );
    assert.match(
      await readFile(join(out, 'fact-checks.md'), 'utf8'),
      /refresh-board-fetches.*NOT MEASURED/,
    );
  });
}
