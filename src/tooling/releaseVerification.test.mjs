import assert from 'node:assert/strict';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { verifyRelease } from '../../scripts/verify-release.mjs';
import { createWorldStore } from '../../server/providers/world/store.js';
import { createTurn } from '../../server/providers/world/turn.js';
import { makeFixtureRoot } from './fixtureRoot.mjs';

const origin = 'http://127.0.0.1:4123/';
const entry = [
  '<title>Release fixture</title>',
  '<link rel="stylesheet" href="/cesium/Widgets/widgets.css">',
  '<script src="/cesium/Cesium.js"></script>',
  '<script type="module" src="/assets/index-a.js"></script>',
  "<link href='assets/index-b.css' rel='stylesheet'>",
  '<link rel="modulepreload" href="/assets/shared-c.js">',
].join('\n');

async function fixture(t) {
  const root = await makeFixtureRoot('gev-release-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = path.join(root, 'dist');
  const world = path.join(root, 'world');
  const savedState = path.join(world, 'state.json');
  await mkdir(path.join(dist, 'assets'), { recursive: true });
  await mkdir(path.join(dist, 'cesium', 'Widgets'), { recursive: true });
  const served = new Map([
    ['/', entry],
    ['/cesium/Widgets/widgets.css', 'body { margin: 0; }'],
    ['/cesium/Cesium.js', 'const cesiumFixture = true;'],
    ['/assets/index-a.js', 'export const fixture = true;'],
    ['/assets/index-b.css', 'body { color: red; }'],
    ['/assets/shared-c.js', 'export const shared = true;'],
  ]);
  for (const [route, bytes] of served) {
    const relative = route === '/' ? 'index.html' : route.slice(1);
    await writeFile(path.join(dist, relative), bytes);
  }
  const asOf = '2026-01-02T00:00:00.000Z';
  const countries = { AAA: {}, BBB: {} };
  const turn = createTurn({
    number: 2,
    startedAt: '2026-01-01T23:59:00.000Z',
    endedAt: asOf,
    sources: [],
    previous: countries,
    countries,
    newObservations: 0,
  });
  await createWorldStore({ cacheDir: root }).write({
    board: { asOf, countries },
    observations: [],
    turns: [turn],
    lastCheckedAt: {},
  });
  const calls = [];
  const fetchImpl = async (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, new URL(origin).origin);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    calls.push(target.pathname);
    return new Response(served.get(target.pathname), {
      status: served.has(target.pathname) ? 200 : 404,
    });
  };
  return {
    root,
    dist,
    savedState,
    options: { url: origin, dist, savedState, fetchImpl },
    calls,
    served,
  };
}

test('matches the entry, its five assets and nonempty saved World Board metadata', async (t) => {
  const { options, calls } = await fixture(t);
  assert.deepEqual(await verifyRelease(options), {
    entryFiles: 1,
    assetFiles: 5,
    world: { turn: 2, asOf: '2026-01-02T00:00:00.000Z', countries: 2 },
  });
  assert.deepEqual(calls, [
    '/',
    '/cesium/Widgets/widgets.css',
    '/cesium/Cesium.js',
    '/assets/index-a.js',
    '/assets/index-b.css',
    '/assets/shared-c.js',
  ]);
});

test('reports a byte mismatch in a served file', async (t) => {
  const { options, served } = await fixture(t);
  served.set('/assets/index-a.js', 'export const fixture = false;');
  await assert.rejects(
    verifyRelease(options),
    /Served build asset bytes do not match/,
  );
});

test('the direct client gets only the linked static files from a synthetic loopback release', async (t) => {
  const { options, served, calls } = await fixture(t);
  const server = createServer((req, res) => {
    calls.push(req.method + ' ' + req.url);
    res.statusCode = served.has(req.url) ? 200 : 404;
    res.end(served.get(req.url));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = 'http://127.0.0.1:' + server.address().port;
  const result = await verifyRelease({ ...options, url, fetchImpl: undefined });
  assert.equal(result.assetFiles, 5);
  assert.deepEqual(calls, [
    'GET /',
    'GET /cesium/Widgets/widgets.css',
    'GET /cesium/Cesium.js',
    'GET /assets/index-a.js',
    'GET /assets/index-b.css',
    'GET /assets/shared-c.js',
  ]);
});

test('rejects an empty saved state before making any HTTP request', async (t) => {
  const { options, calls, root, savedState } = await fixture(t);
  await createWorldStore({ cacheDir: root }).write({
    board: { asOf: '2026-01-02T00:00:00.000Z', countries: {} },
    observations: [],
    turns: [],
    lastCheckedAt: {},
  });
  await assert.rejects(verifyRelease(options), /nonempty saved World Board/);
  await writeFile(savedState, '{"version":2}');
  await assert.rejects(
    verifyRelease(options),
    /Could not read recognised World Board/,
  );
  assert.deepEqual(calls, []);
});

test('rejects external origins and entry paths outside the static asset directory', async (t) => {
  const { options, calls, dist } = await fixture(t);
  await assert.rejects(
    verifyRelease({ ...options, url: 'http://example.invalid/' }),
    /loopback root URL/,
  );
  await assert.rejects(
    verifyRelease({ ...options, url: origin + 'api/world' }),
    /loopback root URL/,
  );
  for (const invalid of [
    '/assets/../outside.js',
    '/assets/%2e%2e/outside.js',
    '/api/world',
    '/cesium/Workers/unlisted.js',
  ]) {
    await writeFile(
      path.join(dist, 'index.html'),
      entry.replace('/assets/index-a.js', invalid),
    );
    await assert.rejects(verifyRelease(options), /built asset path/);
  }
  await writeFile(
    path.join(dist, 'index.html'),
    '<base href="https://example.invalid/">' + entry,
  );
  await assert.rejects(verifyRelease(options), /no base override/);
  assert.deepEqual(calls, []);
});

test('rejects a linked asset directory that points outside the build', async (t) => {
  const { options, root, calls, dist } = await fixture(t);
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'index-a.js'), 'outside the build');
  await rm(path.join(dist, 'assets'), { recursive: true });
  await symlink(outside, path.join(dist, 'assets'), 'junction');
  await assert.rejects(
    verifyRelease(options),
    /built file is unavailable or escapes/,
  );
  assert.deepEqual(calls, []);
});

test('rejects a redirect without requesting its destination', async (t) => {
  const { options } = await fixture(t);
  let requests = 0;
  await assert.rejects(
    verifyRelease({
      ...options,
      fetchImpl: async (_, { redirect }) => {
        requests++;
        assert.equal(redirect, 'error');
        return new Response(null, {
          status: 302,
          headers: { location: 'https://example.invalid/' },
        });
      },
    }),
    /did not return HTTP 200/,
  );
  assert.equal(requests, 1);
});
