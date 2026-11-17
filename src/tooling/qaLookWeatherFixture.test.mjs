import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherLookFixture } from '../../scripts/qa-look-weather.fixtures.mjs';
import { installFixtures } from '../../scripts/qa-world.fixtures.mjs';

test('Weather fixture transport serves real local data and refuses unknown requests', async () => {
  const weather = createWeatherLookFixture('filled');
  const calls = [];
  let paused;
  const client = {
    send: async (method, args) => calls.push({ method, args }),
    on: (_event, handler) => {
      paused = handler;
    },
  };
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
  const origin = 'http://127.0.0.1:5314';
  await installFixtures(
    { createCDPSession: async () => client },
    origin,
    {},
    report,
    { strict: true, weather },
  );
  const request = async (id, path, method = 'GET') => {
    await paused({
      requestId: id,
      request: { url: new URL(path, origin).href, method },
    });
    const response = calls.find((call) => call.args?.requestId === id);
    assert.equal(response.method, 'Fetch.fulfillRequest');
    return {
      status: response.args.responseCode,
      body: Buffer.from(response.args.body, 'base64'),
    };
  };
  const radar = await request('radar', '/api/weather/manifest?product=radar');
  const manifest = JSON.parse(radar.body);
  assert.equal(radar.status, 200);
  assert.ok(manifest.times.length > 1);
  assert.ok(manifest.times.includes(manifest.latest));
  const tile = await request(
    'tile',
    `/api/weather/tile?product=radar&time=${encodeURIComponent(manifest.latest)}&size=256`,
  );
  assert.equal(tile.status, 200);
  assert.ok(tile.body.length > 0);
  assert.deepEqual(
    [...tile.body.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  const wind = await request(
    'wind',
    '/api/wind/manifest?model=gfs&overlay=temperature',
  );
  const windManifest = JSON.parse(wind.body);
  assert.equal(wind.status, 200);
  const grid = await request('grid', windManifest.gridUrl);
  assert.equal(grid.status, 200);
  assert.ok(grid.body.length > 0);
  assert.ok(grid.body.some((byte) => byte !== 0));
  for (const [id, url, method] of [
    ['product', '/api/weather/manifest?product=unknown', 'GET'],
    [
      'frame',
      '/api/weather/tile?product=radar&time=2000-01-01T00%3A00%3A00Z&size=256',
      'GET',
    ],
    ['model', '/api/wind/manifest?model=unknown', 'GET'],
    ['method', '/api/weather/manifest?product=radar', 'POST'],
    [
      'origin',
      'http://outside.example/api/weather/manifest?product=radar',
      'GET',
    ],
  ])
    assert.equal((await request(id, url, method)).status, 404, id);
  assert.deepEqual(report.errors, []);
});
