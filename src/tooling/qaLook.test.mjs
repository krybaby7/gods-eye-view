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

test('worker probe accepts rejected fetch only with exact denial and zero sentinel hits', async () => {
  const { validateWorkerProbe } = await import('./qaLook.mjs');
  const result = {
    sentinelUrl: 'http://127.0.0.1:9999/probe',
    apiUrl: 'http://127.0.0.1:5314/api/look-worker-probe',
    sentinelHits: 0,
    results: [
      {
        url: 'http://127.0.0.1:9999/probe',
        error: 'TypeError: Failed to fetch',
      },
      { url: 'http://127.0.0.1:5314/api/look-worker-probe', status: 404 },
    ],
    before: { denied: {}, suppressed: [] },
    after: {
      denied: { 'http://127.0.0.1:9999/probe': 1 },
      suppressed: ['http://127.0.0.1:5314/api/look-worker-probe'],
    },
  };
  assert.doesNotThrow(() => validateWorkerProbe(result));
  assert.throws(() => validateWorkerProbe({ ...result, sentinelHits: 1 }));
  assert.throws(() =>
    validateWorkerProbe({ ...result, after: { ...result.after, denied: {} } }),
  );
  assert.throws(() =>
    validateWorkerProbe({
      ...result,
      after: { ...result.after, suppressed: [] },
    }),
  );
});

test('after legend evidence rejects unreadable visible text and cut title or Unknown', async () => {
  const { afterLegendFailures } = await import('./qaLook.mjs');
  const sample = {
    view: 'band',
    bandVisible: true,
    keyOmitted: false,
    captionText: [{ name: 'title', fontSize: '12px', lineHeight: '16px' }],
  };
  assert.deepEqual(afterLegendFailures(sample), []);
  assert.match(
    afterLegendFailures({
      ...sample,
      captionText: [{ name: 'note', fontSize: '12px', lineHeight: '15px' }],
    })[0],
    /note/,
  );
  assert.match(
    afterLegendFailures({ ...sample, keyOmitted: true })[0],
    /title or Unknown/,
  );
  assert.deepEqual(
    afterLegendFailures({ ...sample, bandVisible: false, keyOmitted: true }),
    [],
  );
  assert.match(
    afterLegendFailures({
      ...sample,
      view: 'popover',
      captionText: [{ name: 'stop', fontSize: '11px', lineHeight: '16px' }],
    })[0],
    /stop/,
  );
});

test('look requires the six core lenses while allowing new ones', async () => {
  const { missingCoreLenses } = await import('./qaLook.mjs');
  const core = [
    'condition',
    'strength',
    'energy',
    'data-age',
    'diplomacy',
    'ownership',
  ];
  assert.deepEqual(missingCoreLenses([...core, 'new-lens']), []);
  assert.deepEqual(missingCoreLenses(core.filter((id) => id !== 'strength')), [
    'strength',
  ]);
});

test('measured layouts require visible Today and India sheet at each case', async () => {
  const { requiredContextFailures } = await import('./qaLook.mjs');
  const data = {
    frames: [
      { name: 'Today', left: 0, top: 0, right: 10, bottom: 10 },
      { name: 'sheet', left: 20, top: 0, right: 30, bottom: 10 },
    ],
    sheetCode: 'IND',
  };
  assert.deepEqual(requiredContextFailures(data), []);
  assert.ok(
    requiredContextFailures({ ...data, frames: data.frames.slice(0, 1) })
      .length,
  );
  assert.ok(requiredContextFailures({ ...data, sheetCode: 'GBR' }).length);
  assert.ok(
    requiredContextFailures({
      ...data,
      frames: [{ ...data.frames[0], right: 0 }, data.frames[1]],
    }).length,
  );
});

test('after popup rejects missing, clipped, hidden or scrollable content', async () => {
  const { popupContentFailures } = await import('./qaLook.mjs');
  const content = {
    parts: [
      { name: 'title', whole: true },
      { name: 'stop 1', whole: true },
      { name: 'Unknown', whole: true },
      { name: 'note', whole: true },
    ],
    expectedStops: 1,
    hasNote: true,
    scrollable: [],
  };
  assert.deepEqual(popupContentFailures(content), []);
  assert.ok(
    popupContentFailures({
      ...content,
      parts: content.parts.filter((part) => part.name !== 'stop 1'),
    }).length,
  );
  assert.ok(
    popupContentFailures({
      ...content,
      parts: content.parts.map((part) =>
        part.name === 'Unknown' ? { ...part, whole: false } : part,
      ),
    }).length,
  );
  assert.ok(popupContentFailures({ ...content, scrollable: ['popup'] }).length);
});

test('proxy survives a reset while rejecting CONNECT and upgrade sockets', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = `
    import net from 'node:net';
    import { createDenyProxy } from ${JSON.stringify(new URL('./qaLookProxy.mjs', import.meta.url).href)};
    const originalEnd = net.Socket.prototype.end;
    let resets = 0;
    net.Socket.prototype.end = function(chunk, ...args) {
      if (typeof chunk === 'string' && chunk.startsWith('HTTP/1.1 403')) {
        resets++;
        const code = resets === 1 ? 'ECONNRESET' : 'EPIPE';
        queueMicrotask(() => this.emit('error', Object.assign(new Error(code), {code})));
      }
      return originalEnd.call(this, chunk, ...args);
    };
    const proxy = await createDenyProxy('http://127.0.0.1:5314');
    const url = new URL(proxy.address);
    async function attempt(request) {
      await new Promise((resolve, reject) => {
        const socket = net.connect(Number(url.port), url.hostname, () => socket.write(request));
        socket.on('error', reject); socket.on('data', () => {}); socket.on('end', resolve);
      });
    }
    await attempt('CONNECT example.invalid:443 HTTP/1.1\\r\\nHost: example.invalid\\r\\n\\r\\n');
    await attempt('GET http://example.invalid/ HTTP/1.1\\r\\nHost: example.invalid\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\n\\r\\n');
    await proxy.close();
    if (resets !== 2 || proxy.totals.tunnels !== 1 || proxy.totals.upgrades !== 1) throw new Error('denial paths did not run');
    process.stdout.write('closed after two rejected resets');
  `;
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(child.status, 0, `child failed: ${child.stderr}`);
  assert.match(child.stdout, /closed after two rejected resets/);
});

test('proxy reports unexpected raw socket errors on close', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = `
    import net from 'node:net';
    import { createDenyProxy } from ${JSON.stringify(new URL('./qaLookProxy.mjs', import.meta.url).href)};
    const originalEnd = net.Socket.prototype.end;
    net.Socket.prototype.end = function(chunk, ...args) {
      if (typeof chunk === 'string' && chunk.startsWith('HTTP/1.1 403')) queueMicrotask(() => this.emit('error', Object.assign(new Error('unexpected I/O'), {code:'EIO'})));
      return originalEnd.call(this, chunk, ...args);
    };
    const proxy = await createDenyProxy('http://127.0.0.1:5314');
    const url = new URL(proxy.address);
    await new Promise((resolve, reject) => { const socket = net.connect(Number(url.port), url.hostname, () => socket.write('CONNECT example.invalid:443 HTTP/1.1\\r\\nHost: example.invalid\\r\\n\\r\\n')); socket.on('data', () => {}); socket.on('error', reject); socket.on('end', resolve); });
    try { await proxy.close(); throw new Error('close unexpectedly succeeded'); }
    catch (error) { if (error.code !== 'EIO') throw error; }
    process.stdout.write('reported EIO');
  `;
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(child.status, 0, `child failed: ${child.stderr}`);
  assert.match(child.stdout, /reported EIO/);
});

test('rejected CONNECT and upgrade half-open clients cannot stall proxy close', async () => {
  const net = await import('node:net');
  const { createDenyProxy } = await import('./qaLookProxy.mjs');
  const proxy = await createDenyProxy('http://127.0.0.1:5314');
  const url = new URL(proxy.address);
  const sockets = [];
  async function reject(method) {
    return await new Promise((resolve, reject) => {
      const socket = net.connect({
        host: url.hostname,
        port: Number(url.port),
        allowHalfOpen: true,
      });
      sockets.push(socket);
      let text = '';
      socket.on('connect', () =>
        socket.write(
          `${method} ${method === 'CONNECT' ? 'example.invalid:443' : 'http://example.invalid/'} HTTP/1.1\r\nHost: example.invalid\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
        ),
      );
      socket.on('data', (chunk) => {
        text += chunk;
      });
      socket.on('end', () => resolve(text));
      socket.on('error', reject);
    });
  }
  try {
    assert.match(await reject('CONNECT'), /403 Forbidden/);
    assert.match(await reject('GET'), /403 Forbidden/);
    await Promise.race([
      proxy.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('proxy close stalled')), 1500),
      ),
    ]);
    assert.equal(proxy.totals.tunnels, 1);
    assert.equal(proxy.totals.upgrades, 1);
  } finally {
    for (const socket of sockets) socket.destroy();
  }
});

test('look evidence crops the exact full viewport image without a second browser capture', async () => {
  const { captureLookImage } = await import('./qaLookImage.mjs');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const sharp = (await import('sharp')).default;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'look-image-test-'));
  const pixels = Buffer.from([
    255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255,
  ]);
  const calls = [];
  const page = {
    screenshot: async (options) => {
      calls.push(options);
      await sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } })
        .png()
        .toFile(options.path);
    },
  };
  try {
    const full = path.join(dir, 'full.png'),
      crop = path.join(dir, 'crop.png');
    await captureLookImage(
      page,
      full,
      crop,
      { left: 1, top: 0, right: 4, bottom: 2 },
      { width: 3, height: 2 },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, full);
    assert.equal(calls[0].captureBeyondViewport, false);
    assert.equal(calls[0].clip, undefined);
    const output = await sharp(crop)
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(output.info.width, 2);
    assert.equal(output.info.height, 2);
    assert.deepEqual(
      [...output.data],
      [0, 255, 0, 0, 0, 255, 255, 0, 255, 0, 255, 255],
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('look evidence flags changed context during screenshot capture', async () => {
  const { captureStateFailures } = await import('./qaLook.mjs');
  const before = { today: 'open', sheet: 'open', lens: 'diplomacy' };
  assert.deepEqual(captureStateFailures(before, { ...before }), []);
  assert.match(
    captureStateFailures(before, { ...before, today: 'folded' })[0],
    /today/i,
  );
  assert.match(
    captureStateFailures(before, { ...before, sheet: 'closed' })[0],
    /sheet/i,
  );
  assert.match(
    captureStateFailures(before, { ...before, lens: 'strength' })[0],
    /lens/i,
  );
});

test('look evidence rejects screenshot whose pixels do not match scale-one viewport', async () => {
  const { captureLookImage } = await import('./qaLookImage.mjs');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const sharp = (await import('sharp')).default;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'look-scale-test-'));
  const page = {
    screenshot: async ({ path }) =>
      sharp({
        create: { width: 4, height: 4, channels: 3, background: '#fff' },
      })
        .png()
        .toFile(path),
  };
  try {
    await assert.rejects(
      captureLookImage(
        page,
        path.join(dir, 'full.png'),
        path.join(dir, 'crop.png'),
        { left: 0, top: 0, right: 2, bottom: 2 },
        { width: 2, height: 2 },
      ),
      /viewport|scale/i,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('layers capture accepts empty and filled states without relaxing legend validation', () => {
  for (const state of ['empty', 'filled']) {
    const options = parseLookArgs([
      '--url',
      'http://localhost:5314',
      '--label',
      'before',
      '--panel',
      'layers',
      '--state',
      state,
    ]);
    assert.equal(options.panel, 'layers');
    assert.equal(options.state, state);
    assert.match(options.out.replaceAll('\\', '/'), /restyle-1\.3\/layers$/);
  }
  const defaults = parseLookArgs([
    '--url',
    'http://localhost:5314',
    '--label',
    'after',
    '--panel',
    'layers',
  ]);
  assert.equal(defaults.state, 'filled');
  assert.throws(() =>
    parseLookArgs([
      '--url',
      'http://localhost:5314',
      '--label',
      'before',
      '--panel',
      'layers',
      '--state',
      'unknown',
    ]),
  );
});

test('rail restoration rejects missing or changed visibility and disclosure state', async () => {
  const { railRestorationFailures } = await import('./qaLookLayers.mjs');
  const before = [
    {
      id: 'context',
      visible: true,
      buttonVisible: true,
      collapsed: true,
      hidden: false,
      expanded: 'false',
    },
  ];
  assert.deepEqual(
    railRestorationFailures(before, structuredClone(before)),
    [],
  );
  assert.notEqual(railRestorationFailures([], []).length, 0);
  for (const change of [
    { visible: false },
    { buttonVisible: false },
    { collapsed: false },
    { hidden: true },
    { expanded: 'true' },
  ])
    assert.notEqual(
      railRestorationFailures(before, [{ ...before[0], ...change }]).length,
      0,
    );
});

test('Cameras and Radio captures accept both fixture states', () => {
  for (const panel of ['cctv', 'radio']) {
    for (const state of ['empty', 'filled']) {
      const options = parseLookArgs([
        '--url',
        'http://localhost:5317',
        '--label',
        'before',
        '--panel',
        panel,
        '--state',
        state,
      ]);
      assert.equal(options.panel, panel);
      assert.equal(options.state, state);
    }
  }
});

test('keys looks default to the keyless setup query', () => {
  const options = parseLookArgs([
    '--url',
    'http://localhost:5173',
    '--label',
    'after',
    '--panel',
    'keys',
    '--query',
    'setup=1',
  ]);
  assert.equal(options.state, 'empty');
  assert.equal(options.url.searchParams.get('setup'), '1');
});

test('controls looks register the shared surfaces capture', () => {
  const options = parseLookArgs([
    '--url',
    'http://localhost:5173',
    '--label',
    'after',
    '--panel',
    'controls',
  ]);
  assert.equal(options.panel, 'controls');
  assert.equal(options.state, 'filled');
});
