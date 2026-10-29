import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createGdeltQueue } from '../../server/providers/news/fetchers/gdeltDomain.js';
import { createGdeltFileFeed } from '../../server/providers/news/fetchers/gdeltFiles.js';
import {
  createNewsService,
  newsProxy,
} from '../../server/providers/news/index.js';
import { localProviderPlugins } from '../../server/providers/local.js';
import { gdeltDataResponse, gkgZip } from '../testSupport/gdeltFiles.mjs';
import {
  TEST_GDELT_DOMAINS,
  newsRootWithGdelt,
} from '../testSupport/newsRoot.mjs';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const GDELT_STAMP = '20261026114500';
const GDELT_DOMAINS = Object.values(TEST_GDELT_DOMAINS);

/**
 * Upstream double: every feed answers with two unique headlines, and GDELT's
 * newest file carries one headline per GDELT outlet (older files are absent).
 */
function fakeUpstream(calls = []) {
  const gdelt = {
    latest: GDELT_STAMP,
    files: {
      [GDELT_STAMP]: gkgZip(
        GDELT_STAMP,
        GDELT_DOMAINS.map((domain) => [
          `https://${domain}/a`,
          `${domain} report on Iran`,
        ]),
      ),
    },
  };
  return async (raw) => {
    const url = new URL(raw);
    calls.push(url);
    if (url.hostname === 'data.gdeltproject.org')
      return gdeltDataResponse(url, gdelt);
    if (url.hostname === 't.me')
      return new Response(
        `<div class="tgme_widget_message js-widget_message" data-post="${url.pathname.split('/').pop()}/9"><div class="tgme_widget_message_text js-message_text">Channel post</div><time datetime="2026-10-26T11:00:00+00:00"></time></div>`,
      );
    if (url.hostname === 'api.gdeltproject.org') {
      const domains = [
        ...url.searchParams.get('query').matchAll(/domainis:([\w.-]+)/g),
      ].map((m) => m[1]);
      return Response.json({
        articles: domains.map((domain) => ({
          url: `https://${domain}/a`,
          title: `${domain} headline`,
          seendate: '20261026T100000Z',
          language: 'English',
        })),
      });
    }
    if (url.hostname === 'www.middleeasteye.net')
      return new Response('blocked', { status: 403 });
    return new Response(
      `<rss><channel><item><title>${url.hostname} one</title><link>https://${url.hostname}/1</link><pubDate>Mon, 26 Oct 2026 09:00:00 GMT</pubDate></item><item><title>${url.hostname} two</title><link>https://${url.hostname}/2</link></item></channel></rss>`,
    );
  };
}

async function service(t, overrides = {}) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'gev-news-proxy-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  t.mock.method(console, 'warn', () => {});
  const intervals = [];
  const calls = [];
  const root = await newsRootWithGdelt(t);
  const news = createNewsService({
    root,
    cacheDir,
    now: () => NOW,
    env: { NEWS_GDELT_FILES: 'on' },
    fetchImpl: fakeUpstream(calls),
    gdeltQueue: createGdeltQueue({ sleep: async () => {} }),
    gdeltFiles: createGdeltFileFeed({ log: () => {} }),
    timers: {
      setInterval(fn, ms) {
        const handle = { fn, ms, cleared: false };
        intervals.push(handle);
        return handle;
      },
      clearInterval(handle) {
        handle.cleared = true;
      },
    },
    ...overrides,
  });
  return { news, intervals, calls, cacheDir, root };
}

test('construction performs no acquisition', (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('construction must not fetch');
  });
  newsProxy();
  createNewsService();
  assert.equal(
    localProviderPlugins().filter((plugin) => plugin.name === 'news-proxy')
      .length,
    1,
  );
});

test('first snapshot starts collection; items, sources and health follow', async (t) => {
  const { news, intervals, calls } = await service(t);
  const first = await news.snapshot('iran-israel-us');
  assert.equal(intervals.length, 1, 'collector timer installed');
  assert.equal(intervals[0].ms, 60_000);
  assert.equal(first.theater.id, 'iran-israel-us');
  assert.equal(first.theater.categories.length, 6);
  assert.deepEqual(first.theaters, [
    { id: 'iran-israel-us', name: 'Iran · Israel · US' },
    { id: 'world', name: 'World' },
  ]);
  const ctx = await news.context('iran-israel-us');
  await ctx.collector.collectAll();
  // ReliefWeb stays off without an appname; link-only sources are never fetched.
  assert.ok(!calls.some((url) => url.hostname === 'api.reliefweb.int'));
  assert.ok(!calls.some((url) => url.hostname === 'www.afp.com'));
  // GDELT outlets come from the 15-minute files, not the search API.
  assert.ok(!calls.some((url) => url.hostname === 'api.gdeltproject.org'));
  assert.deepEqual(
    calls
      .filter((url) => url.hostname === 'data.gdeltproject.org')
      .map((url) => url.pathname),
    [
      '/gdeltv2/lastupdate.txt',
      '/gdeltv2/20261026110000.gkg.csv.zip',
      '/gdeltv2/20261026111500.gkg.csv.zip',
      '/gdeltv2/20261026113000.gkg.csv.zip',
      '/gdeltv2/20261026114500.gkg.csv.zip',
    ],
  );

  const snapshot = await news.snapshot('iran-israel-us');
  assert.ok(snapshot.items.length > 30);
  assert.notEqual(snapshot.revision, first.revision);
  const item = snapshot.items.find((entry) => entry.sourceId === 'centcom');
  assert.equal(item.folder, 'official');
  assert.equal(item.primarySource.kind, 'statement');
  const rows = new Map(snapshot.sources.map((row) => [row.id, row]));
  assert.equal(rows.get('aljazeera').health.ok, true);
  assert.equal(rows.get('middleeasteye').health.blocked, true);
  assert.equal(rows.get('middleeasteye').health.degraded, true);
  assert.equal(rows.get('reliefweb').health.disabled, true);
  assert.equal(rows.get('reliefweb').health.degraded, false);
  assert.equal(rows.get('afp').health.linkOnly, true);
  assert.equal(rows.get('idf').health.fragile, true);
  assert.equal(rows.get('timesofisrael').health.count, 1);
  assert.equal(JSON.stringify(snapshot).includes('apiKey'), false);

  const unchanged = await news.snapshot('iran-israel-us', {
    rev: snapshot.revision,
  });
  assert.deepEqual(Object.keys(unchanged).sort(), [
    'retrievedAt',
    'revision',
    'unchanged',
  ]);
  assert.equal(await news.snapshot('nowhere'), null);

  const status = await news.status();
  assert.equal(status.theaters[0].collecting, true);
  assert.equal(status.theaters[0].sources.blocked, 1);
  await news.stop();
  assert.equal(intervals[0].cleared, true);
});

test('by default GDELT outlets use the search API, ten domains at most', async (t) => {
  const { news, calls } = await service(t, {
    env: {},
  });
  await news.snapshot('iran-israel-us');
  await (await news.context('iran-israel-us')).collector.collectAll();
  assert.ok(!calls.some((url) => url.hostname === 'data.gdeltproject.org'));
  const queries = calls.filter((u) => u.hostname === 'api.gdeltproject.org');
  assert.ok(queries.length >= 1);
  for (const url of queries)
    assert.ok(url.searchParams.get('query').match(/domainis:/g).length <= 10);
  const rows = new Map(
    (await news.snapshot('iran-israel-us')).sources.map((row) => [row.id, row]),
  );
  assert.equal(rows.get('timesofisrael').health.ok, true);
  assert.equal(rows.get('timesofisrael').health.count, 1);
  await news.stop();
});

test('GDELT outlets report one clear error when the files fail', async (t) => {
  const upstream = fakeUpstream();
  const { news } = await service(t, {
    fetchImpl: async (raw) =>
      new URL(raw).hostname === 'data.gdeltproject.org'
        ? new Response('', { status: 503 })
        : upstream(raw),
  });
  await news.snapshot('iran-israel-us');
  await (await news.context('iran-israel-us')).collector.collectAll();
  const reuters = (await news.snapshot('iran-israel-us')).sources.find(
    (row) => row.id === 'reuters',
  ).health;
  assert.equal(reuters.ok, false);
  assert.equal(reuters.error, 'GDELT files: lastupdate.txt HTTP 503');
  assert.equal(reuters.degraded, true);
  await news.stop();
});

test('a feed that answers with only old entries is quiet, stale and degraded', async (t) => {
  const upstream = fakeUpstream();
  const { news } = await service(t, {
    fetchImpl: async (raw) =>
      new URL(raw).hostname === 'www.aljazeera.com'
        ? new Response(
            '<rss><channel><item><title>Old one</title><link>https://www.aljazeera.com/old</link><pubDate>Thu, 05 Feb 2026 17:47:00 GMT</pubDate></item></channel></rss>',
          )
        : upstream(raw),
  });
  await news.snapshot('iran-israel-us');
  await (await news.context('iran-israel-us')).collector.collectAll();
  const rows = new Map(
    (await news.snapshot('iran-israel-us')).sources.map((row) => [row.id, row]),
  );
  const quiet = rows.get('aljazeera').health;
  assert.equal(quiet.ok, true);
  assert.equal(quiet.quiet, true);
  assert.equal(quiet.stale, true);
  assert.equal(quiet.degraded, true);
  assert.equal(quiet.newestItemAt, '2026-02-05T17:47:00.000Z');
  const fresh = rows.get('haaretz').health;
  assert.equal(fresh.quiet, false);
  assert.equal(fresh.degraded, false);
  assert.equal(fresh.newestItemAt, '2026-10-26T09:00:00.000Z');
  await news.stop();
});

test('a restart serves cached items before any upstream answers', async (t) => {
  const { news, cacheDir, root } = await service(t);
  await news.snapshot('iran-israel-us');
  await (await news.context('iran-israel-us')).collector.collectAll();
  const count = (await news.snapshot('iran-israel-us')).items.length;
  const restarted = createNewsService({
    root,
    cacheDir,
    now: () => NOW,
    env: {},
    fetchImpl: async () => {
      throw new Error('offline');
    },
    timers: { setInterval: () => ({}), clearInterval() {} },
  });
  const snapshot = await restarted.snapshot('iran-israel-us');
  assert.equal(snapshot.items.length, count);
  await restarted.stop();
});

test('a restart does not read the same GDELT files again', async (t) => {
  const { news, cacheDir, root } = await service(t);
  await news.snapshot('iran-israel-us');
  await (await news.context('iran-israel-us')).collector.collectAll();
  await news.stop();
  const calls = [];
  const restarted = createNewsService({
    root,
    cacheDir,
    now: () => NOW,
    env: { NEWS_GDELT_FILES: 'on' },
    fetchImpl: fakeUpstream(calls),
    gdeltFiles: createGdeltFileFeed({ log: () => {} }),
    timers: { setInterval: () => ({}), clearInterval() {} },
  });
  await restarted.snapshot('iran-israel-us');
  await (await restarted.context('iran-israel-us')).collector.collectAll();
  const read = calls
    .filter((url) => url.hostname === 'data.gdeltproject.org')
    .map((url) => url.pathname);
  assert.ok(read.includes('/gdeltv2/lastupdate.txt'));
  assert.deepEqual(
    read.filter((pathname) => pathname.endsWith('.gkg.csv.zip')),
    [],
  );
  await restarted.stop();
});

function install(plugin) {
  let handler;
  const httpServer = new EventEmitter();
  plugin.configureServer({
    httpServer,
    middlewares: {
      use(route, callback) {
        assert.equal(route, '/api/news');
        handler = callback;
      },
    },
  });
  const request = async (url, method = 'GET') => {
    const res = {
      headersSent: false,
      writeHead(status, headers) {
        Object.assign(this, { status, headers, headersSent: true });
      },
      end(body) {
        this.body = JSON.parse(body);
      },
    };
    await handler(
      { url, method, headers: {}, socket: { remoteAddress: '127.0.0.1' } },
      res,
    );
    return res;
  };
  return { request, httpServer };
}

test('routes answer JSON with no-store and refuse unknown paths', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'gev-news-route-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const intervals = [];
  const { request, httpServer } = install(
    newsProxy({
      cacheDir,
      env: {},
      fetchImpl: async () => new Response('', { status: 503 }),
      timers: {
        setInterval: (fn, ms) => {
          const handle = { cleared: false };
          intervals.push(handle);
          return handle;
        },
        clearInterval: (handle) => (handle.cleared = true),
      },
    }),
  );
  const ok = await request('/?theater=iran-israel-us');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['Cache-Control'], 'no-store');
  assert.equal(ok.body.theater.id, 'iran-israel-us');
  assert.equal((await request('/')).body.theater.id, 'iran-israel-us');
  assert.equal((await request('/?theater=nowhere')).status, 404);
  assert.equal((await request('/?theater=../../etc')).status, 404);
  assert.equal((await request('/status')).status, 200);
  assert.equal((await request('/status', 'POST')).status, 405);
  assert.equal((await request('/', 'DELETE')).status, 405);
  assert.equal((await request('/elsewhere')).status, 404);
  httpServer.emit('close');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(intervals[0].cleared, true);
});
