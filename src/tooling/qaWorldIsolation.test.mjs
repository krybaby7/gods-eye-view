import test from 'node:test';
import assert from 'node:assert/strict';
import { worldFixtureUnavailable } from './qaWorldIsolation.mjs';

test('fixture runs deny the world API root and descendants for every HTTP method', () => {
  for (const method of ['GET', 'POST'])
    for (const path of [
      '/api/world',
      '/api/world/',
      '/api/world/refresh',
      '/api/world/countries/EG',
    ]) {
      const response = worldFixtureUnavailable(path, 'searches', method);
      assert.equal(response.status, 503, `${method} ${path}`);
      assert.equal(response.contentType, 'application/json');
      assert.equal(response.headers['cache-control'], 'no-store');
      const body = JSON.parse(response.body);
      assert.equal(body.error, 'world_disabled_in_fixture');
      assert.match(body.message, /searches/);
    }
});

test('unrelated paths retain their normal fixture routing', () => {
  for (const path of [
    '/api/worldwide',
    '/api/worldly/refresh',
    '/api/news',
    '/',
    '/world',
  ])
    assert.equal(worldFixtureUnavailable(path, 'news'), undefined, path);
});
