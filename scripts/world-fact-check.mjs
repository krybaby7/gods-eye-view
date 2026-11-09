import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

const modules = new URL('./world-fact-checks/', import.meta.url);
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

function readApi(origin, route, encoding = 'identity') {
  const target = new URL(route, origin);
  if (
    target.origin !== origin.origin ||
    !/^\/api\/world(?:\/|$)/.test(target.pathname)
  ) {
    throw new Error(
      `Fact checks can read only the local World Board API: ${route}`,
    );
  }
  const get = origin.protocol === 'https:' ? httpsGet : httpGet;
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const req = get(
      target,
      { headers: { 'Accept-Encoding': encoding } },
      (res) => {
        const chunks = [];
        res.on('error', reject);
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            if (res.statusCode !== 200)
              throw new Error(`${route}: HTTP ${res.statusCode}`);
            const wire = Buffer.concat(chunks);
            const contentEncoding =
              res.headers['content-encoding'] ?? 'identity';
            const raw = contentEncoding === 'gzip' ? gunzipSync(wire) : wire;
            resolve({
              body: JSON.parse(raw),
              bytes: wire.length,
              rawBytes: raw.length,
              encoding: contentEncoding,
              elapsedMs: Math.round(performance.now() - started),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.setTimeout(15_000, () => req.destroy(new Error(`${route}: timed out`)));
    req.on('error', reject);
  });
}

function display(value) {
  return typeof value === 'string'
    ? value
    : (JSON.stringify(value) ?? 'Unavailable');
}

function markdownCell(value) {
  return display(value).replaceAll('|', '\\|').replaceAll(/\r?\n/g, '<br>');
}

export async function runFactChecks({ url, out, trace, print = console.log }) {
  const origin = new URL(url);
  if (
    !loopback.has(origin.hostname) ||
    !['http:', 'https:'].includes(origin.protocol)
  ) {
    throw new Error('--url must be a loopback HTTP or HTTPS server.');
  }
  const tracePath = trace ?? resolve(out, '..', 'refresh-requests.json');
  const evidence = await readFile(tracePath, 'utf8').then(
    JSON.parse,
    (error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    },
  );
  const checks = [];
  const measure = (route, encoding) => readApi(origin, route, encoding);
  let initial;
  try {
    initial = await measure('/api/world');
  } catch (error) {
    checks.push({
      id: 'board-available',
      expected: 'HTTP 200 and JSON',
      found: error.message,
      source: origin.href,
      pass: false,
    });
  }
  const detailCache = new Map();
  function getDetail(country, lens) {
    const params = new URLSearchParams({ lens });
    if (country) params.set('country', country);
    const route = `/api/world/detail?${params}`;
    if (!detailCache.has(route)) {
      detailCache.set(
        route,
        measure(route, 'gzip').then(({ body }) => body.data),
      );
    }
    return detailCache.get(route);
  }
  const files = (await readdir(modules))
    .filter((name) => name.endsWith('.mjs'))
    .sort();
  for (const file of files) {
    try {
      const { default: check } = await import(new URL(file, modules));
      const rows = await check({
        board: initial?.body,
        initial,
        measure,
        getDetail,
        trace: evidence,
      });
      if (
        !Array.isArray(rows) ||
        !rows.length ||
        rows.some(
          (row) => !row.id || !row.source || typeof row.pass !== 'boolean',
        )
      ) {
        throw new Error(
          'A check module must return evidence rows with id, source and pass.',
        );
      }
      checks.push(...rows);
    } catch (error) {
      checks.push({
        id: file,
        expected: 'Checks return evidence',
        found: error.message,
        source: `scripts/world-fact-checks/${file}`,
        pass: false,
      });
    }
  }
  for (const { id, expected, found, source, checkedOn, pass } of checks) {
    print(
      `${pass ? 'PASS' : 'FAIL'} ${id} | expected ${display(expected)} | found ${display(found)} | ${display(source)}${checkedOn ? ` (${checkedOn})` : ''}`,
    );
  }
  const result = {
    url: origin.origin,
    checkedAt: new Date().toISOString(),
    pass: checks.every(({ pass }) => pass),
    checks,
  };
  const lines = [
    '# World Board live fact checks',
    '',
    `Server ${result.url}, checked ${result.checkedAt}.`,
    '',
    '| Check | Expected | Found | Source | Date checked | Result |',
    '| --- | --- | --- | --- | --- | --- |',
    ...checks.map(
      ({ id, expected, found, source, checkedOn, pass }) =>
        `| ${[id, expected, found, source, checkedOn ?? '—', pass ? 'PASS' : 'FAIL'].map(markdownCell).join(' | ')} |`,
    ),
    '',
  ];
  await mkdir(out, { recursive: true });
  await Promise.all([
    writeFile(
      join(out, 'fact-checks.json'),
      JSON.stringify(result, null, 2) + '\n',
    ),
    writeFile(join(out, 'fact-checks.md'), lines.join('\n')),
  ]);
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const { values } = parseArgs({
      options: {
        url: { type: 'string' },
        out: { type: 'string' },
        trace: { type: 'string' },
      },
    });
    if (!values.url || !values.out) {
      throw new Error(
        'Usage: node scripts/world-fact-check.mjs --url URL --out DIR [--trace FILE]',
      );
    }
    if (!(await runFactChecks(values)).pass) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
