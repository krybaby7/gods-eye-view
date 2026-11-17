import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLookArgs, collisions } from './qaLook.mjs';

test('look options validate origin, panel and state before launching', () => {
  const result = parseLookArgs([
    '--url',
    'http://127.0.0.1:5314',
    '--label',
    'before',
    '--panel',
    'legend',
    '--query',
    'x=a=b',
  ]);
  assert.equal(result.url.searchParams.get('x'), 'a=b');
  assert.equal(result.url.searchParams.get('welcome'), '0');
  assert.equal(result.state, 'filled');
  for (const args of [
    ['--url', 'http://example.com', '--label', 'before', '--panel', 'legend'],
    ['--url', 'https://localhost', '--label', 'before', '--panel', 'legend'],
    ['--url', 'http://localhost', '--label', 'other', '--panel', 'legend'],
    [
      '--url',
      'http://localhost',
      '--label',
      'before',
      '--panel',
      'legend',
      '--state',
      'empty',
    ],
    ['--url', 'http://localhost', '--label', 'before', '--panel', 'unknown'],
    [
      '--url',
      'http://localhost',
      '--label',
      'before',
      '--panel',
      'legend',
      '--query',
      'world-fixtures=0',
    ],
    [
      '--url',
      'http://localhost',
      '--label',
      'before',
      '--panel',
      'legend',
      '--query',
      'bad',
    ],
  ])
    assert.throws(() => parseLookArgs(args));
});

test('collision checks independent panels against frames and each other with tolerance', () => {
  const box = (name, left, top, right, bottom) => ({
    name,
    left,
    top,
    right,
    bottom,
  });
  const frame = [box('bottom', 0, 90, 100, 100)];
  const panels = [
    box('a', 0, 0, 50, 92),
    box('b', 49, 0, 80, 50),
    box('c', 48, 0, 80, 50),
  ];
  const found = collisions(frame, panels);
  assert.ok(found.some(({ a, b }) => a.name === 'a' && b.name === 'bottom'));
  assert.ok(found.some(({ a, b }) => a.name === 'a' && b.name === 'c'));
  assert.ok(!found.some(({ a, b }) => a.name === 'a' && b.name === 'b'));
});

test('strict fixture transport serves only selected origin assets and blocks other origins', async () => {
  const { installFixtures } =
    await import('../../scripts/qa-world.fixtures.mjs');
  const calls = [];
  let handler;
  const client = {
    send: async (method, args) => {
      if (method === 'Fetch.enable')
        assert.equal(
          typeof handler,
          'function',
          'handler is registered before interception starts',
        );
      calls.push({ method, args });
    },
    on: (_event, fn) => {
      handler = fn;
    },
  };
  const page = { createCDPSession: async () => client };
  const report = {
    transport: {
      snapshots: 0,
      refreshes: 0,
      imageryTiles: 0,
      suppressedApis: [],
      suppressedHosts: [],
    },
    errors: [],
  };
  await installFixtures(
    page,
    'http://127.0.0.1:5314',
    { snapshot: async () => ({ fixture: true }) },
    report,
    { strict: true },
  );
  assert.deepEqual(
    calls.find((call) => call.method === 'Fetch.enable').args.patterns,
    [{ urlPattern: '*' }],
  );
  assert.deepEqual(
    calls.find((call) => call.method === 'Network.setBlockedURLs').args.urls,
    ['ws://*', 'wss://*'],
  );
  for (const [requestId, url] of [
    ['asset', 'http://127.0.0.1:5314/src/app.js'],
    ['world', 'http://127.0.0.1:5314/api/world'],
    ['other', 'http://127.0.0.1:5315/api/world'],
    ['external', 'http://outside.example/data'],
    ['missing', 'http://127.0.0.1:5314/api/unknown'],
  ])
    await handler({ requestId, request: { url, method: 'GET' } });
  const byId = (id) => calls.find((call) => call.args?.requestId === id);
  assert.equal(byId('asset').method, 'Fetch.continueRequest');
  assert.equal(byId('world').args.responseCode, 200);
  for (const id of ['other', 'external', 'missing'])
    assert.equal(byId(id).args.responseCode, 404);
  assert.equal(report.transport.snapshots, 1);
  assert.equal(report.transport.requests, 5);
  assert.equal(report.transport.continued, 1);
  assert.equal(report.transport.fulfilled, 4);
  assert.equal(report.transport.blocked, 3);
});

test('deny proxy only permits static GET/HEAD on the exact origin', async () => {
  const { proxyAllowed } = await import('./qaLookProxy.mjs');
  const origin = 'http://127.0.0.1:5314';
  assert.equal(proxyAllowed(origin, 'GET', `${origin}/src/app.js`), true);
  assert.equal(
    proxyAllowed(origin, 'HEAD', `${origin}/assets/worker.js`),
    true,
  );
  for (const [method, url] of [
    ['GET', `${origin}/api/world`],
    ['GET', `${origin}/%61pi%2fworld`],
    ['GET', `${origin}/src/%252e%252e%252fapi/world`],
    ['POST', `${origin}/src/app.js`],
    ['GET', 'http://127.0.0.1:5315/src/app.js'],
    ['GET', 'https://127.0.0.1:5314/src/app.js'],
    ['GET', 'http://external.example/'],
  ])
    assert.equal(proxyAllowed(origin, method, url), false);
});

test('proxy forwards only local static requests and rejects API, origins and tunnels', async () => {
  const http = await import('node:http');
  const net = await import('node:net');
  const { createDenyProxy } = await import('./qaLookProxy.mjs');
  let upstreamHits = 0;
  const upstream = http.createServer((_req, res) => {
    upstreamHits++;
    res.end('fixture asset');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  const proxy = await createDenyProxy(origin);
  const address = new URL(proxy.address);
  const get = (target) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: address.hostname, port: address.port, path: target },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end();
    });
  const raw = (method) =>
    new Promise((resolve, reject) => {
      const socket = net.connect(Number(address.port), address.hostname, () =>
        socket.write(
          `${method} ${method === 'CONNECT' ? 'example.invalid:443' : 'http://example.invalid/'} HTTP/1.1\r\nHost: example.invalid\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
        ),
      );
      let data = '';
      socket.on('data', (chunk) => (data += chunk));
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
  try {
    assert.equal(await get(`${origin}/asset.js`), 200);
    assert.equal(await get(`${origin}/api/world`), 403);
    assert.equal(await get('http://127.0.0.1:1/asset.js'), 403);
    assert.match(await raw('CONNECT'), /403 Forbidden/);
    assert.match(await raw('GET'), /403 Forbidden/);
    assert.equal(upstreamHits, 1);
    assert.equal(proxy.totals.deniedApi, 1);
    assert.equal(proxy.totals.tunnels, 1);
    assert.equal(proxy.totals.upgrades, 1);
  } finally {
    await proxy.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
