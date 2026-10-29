import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ITEM_RETENTION_MS,
  canonicalizeUrl,
  createNewsItemStore,
  newsItemId,
} from '../../server/providers/news/store.js';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const sources = new Map(
  [
    {
      id: 'wire',
      folder: 'reporting',
      kind: 'independent',
      perspective: 'international-wire',
    },
    { id: 'idf', folder: 'official', kind: 'state', perspective: 'israel-mil' },
  ].map((s) => [s.id, { ...s, languages: ['en'], transport: { type: 'rss' } }]),
);
const candidate = (overrides = {}) => ({
  sourceId: 'wire',
  title: 'Strike reported near Bandar Abbas',
  titleOriginal: 'Strike reported near Bandar Abbas',
  snippet: 'Officials said a depot burned.',
  language: 'en',
  url: 'https://www.Example.org/story/1/?utm_source=x&b=2&a=1#top',
  publishedAt: '2026-10-26T10:00:00Z',
  primarySource: null,
  transport: 'rss',
  ...overrides,
});

async function withStore(t, options = {}) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'gev-news-store-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  let clock = NOW;
  const store = createNewsItemStore({
    theaterId: 'fixture',
    cacheDir,
    now: () => clock,
    ...options,
  });
  return { store, cacheDir, tick: (ms) => (clock += ms) };
}

test('canonical URLs drop tracking, fragments, www and trailing slashes', () => {
  assert.equal(
    canonicalizeUrl('http://www.Example.org/story/1/?utm_source=x&b=2&a=1#top'),
    'https://example.org/story/1?a=1&b=2',
  );
  assert.equal(canonicalizeUrl('javascript:alert(1)'), null);
  assert.equal(canonicalizeUrl('not a url'), null);
  assert.match(
    newsItemId('https://example.org/story/1?a=1&b=2'),
    /^[0-9a-f]{16}$/,
  );
});

test('items carry registry fields, both times and an undigested state', async (t) => {
  const { store } = await withStore(t);
  assert.deepEqual(store.ingest([candidate()], sources), {
    added: 1,
    duplicates: 0,
    rejected: 0,
    pruned: 0,
  });
  const [item] = store.list();
  assert.equal(item.id, newsItemId('https://example.org/story/1?a=1&b=2'));
  assert.equal(item.theater, 'fixture');
  assert.equal(item.folder, 'reporting');
  assert.equal(item.kind, 'independent');
  assert.equal(item.perspective, 'international-wire');
  assert.equal(item.url, candidate().url);
  assert.equal(item.publishedAt, '2026-10-26T10:00:00.000Z');
  assert.equal(item.collectedAt, '2026-10-26T12:00:00.000Z');
  assert.equal(item.digestedAt, null);
  assert.equal(item.storyId, null);
});

test('exact repeats dedupe on canonical URL and on title plus publisher', async (t) => {
  const { store } = await withStore(t);
  store.ingest([candidate()], sources);
  const outcome = store.ingest(
    [
      candidate({ url: 'https://example.org/story/1?b=2&a=1' }),
      candidate({
        url: 'https://example.org/other',
        title: 'STRIKE reported  near Bandar Abbas',
      }),
      candidate({ url: 'https://example.org/idf', sourceId: 'idf' }),
      candidate({ url: 'https://example.org/x', sourceId: 'unknown' }),
    ],
    sources,
  );
  assert.deepEqual(outcome, {
    added: 1,
    duplicates: 2,
    rejected: 1,
    pruned: 0,
  });
  assert.equal(store.size(), 2);
});

test('items expire after 72 hours and old publications are not collected', async (t) => {
  const { store, tick } = await withStore(t);
  store.ingest(
    [
      candidate(),
      candidate({
        url: 'https://example.org/old',
        title: 'Old news',
        publishedAt: new Date(NOW - ITEM_RETENTION_MS - 1).toISOString(),
      }),
    ],
    sources,
  );
  assert.equal(store.size(), 1);
  tick(ITEM_RETENTION_MS + 1);
  assert.equal(store.list().length, 0);
});

test('each source keeps only its newest sixty items', async (t) => {
  const { store } = await withStore(t, { perSourceCap: 3 });
  const outcome = store.ingest(
    Array.from({ length: 5 }, (_, i) =>
      candidate({
        url: `https://example.org/${i}`,
        title: `Story ${i}`,
        publishedAt: new Date(NOW - (5 - i) * 60_000).toISOString(),
      }),
    ),
    sources,
  );
  assert.equal(outcome.pruned, 2);
  assert.deepEqual(
    store.list().map((item) => item.title),
    ['Story 4', 'Story 3', 'Story 2'],
  );
});

test('digest marks processed items and records cited stories', async (t) => {
  const { store } = await withStore(t);
  store.ingest(
    [candidate(), candidate({ url: 'https://example.org/2', title: 'Second' })],
    sources,
  );
  const [second, first] = store.list();
  const before = store.revision();
  store.markDigested(
    [first.id, second.id],
    new Map([[first.id, 'st_1']]),
    '2026-10-26T12:05:00.000Z',
  );
  assert.ok(store.revision() > before);
  assert.equal(store.get(first.id).storyId, 'st_1');
  assert.equal(store.get(second.id).storyId, null);
  assert.equal(store.get(second.id).digestedAt, '2026-10-26T12:05:00.000Z');
  assert.deepEqual(store.undigested(), []);
});

test('the disk cache round-trips and malformed caches are ignored', async (t) => {
  const { store, cacheDir } = await withStore(t);
  store.ingest([candidate()], sources);
  await store.save();
  const saved = JSON.parse(
    await readFile(path.join(cacheDir, 'fixture.json'), 'utf8'),
  );
  assert.equal(saved.version, 1);
  assert.equal(saved.items.length, 1);
  const again = createNewsItemStore({
    theaterId: 'fixture',
    cacheDir,
    now: () => NOW,
  });
  await again.load();
  assert.equal(again.size(), 1);
  assert.equal(again.list()[0].title, 'Strike reported near Bandar Abbas');
  // A repeat after restart still dedupes against the cached item.
  assert.equal(again.ingest([candidate()], sources).duplicates, 1);
  const empty = createNewsItemStore({
    theaterId: 'missing',
    cacheDir,
    now: () => NOW,
  });
  await empty.load();
  assert.equal(empty.size(), 0);
});

test('collection cursors, such as the last GDELT file read, survive a restart', async (t) => {
  const { store, cacheDir } = await withStore(t);
  assert.equal(store.cursor('gdeltFiles'), null);
  store.setCursor('gdeltFiles', '20261028210000');
  await store.save();
  const again = createNewsItemStore({
    theaterId: 'fixture',
    cacheDir,
    now: () => NOW,
  });
  await again.load();
  assert.equal(again.cursor('gdeltFiles'), '20261028210000');
  assert.equal(again.cursor('other'), null);
});

test('concurrent saves never leave a torn cache', async (t) => {
  const { store, cacheDir } = await withStore(t);
  const writes = [];
  for (let i = 0; i < 6; i++) {
    store.ingest(
      [
        candidate({
          url: `https://example.org/c${i}`,
          title: `Concurrent ${i}`,
        }),
      ],
      sources,
    );
    writes.push(store.save());
  }
  await Promise.all(writes);
  const again = createNewsItemStore({
    theaterId: 'fixture',
    cacheDir,
    now: () => NOW,
  });
  await again.load();
  assert.equal(again.size(), 6);
});

test('Telegram posts are told apart by their post URL, not their title', async (t) => {
  const { store } = await withStore(t);
  const post = (id) =>
    candidate({
      sourceId: 'idf',
      title: 'Sirens sounded in the north.',
      url: `https://t.me/idfofficial/${id}`,
      transport: 'telegram-public',
    });
  const outcome = store.ingest([post(101), post(102), post(101)], sources);
  assert.equal(outcome.added, 2);
  assert.equal(outcome.duplicates, 1);
});
