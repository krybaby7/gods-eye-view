import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NEWS_FOLDERS,
  NEWS_KINDS,
  NEWS_TRANSPORTS,
  loadNewsRegistry,
  validateNewsSources,
  validateNewsTheater,
} from '../../server/providers/news/registry.js';

const source = (overrides = {}) => ({
  id: 'fixture',
  name: 'Fixture',
  homepage: 'https://example.org/',
  folder: 'reporting',
  kind: 'independent',
  perspective: 'international-wire',
  languages: ['en'],
  starred: false,
  caution: '',
  transport: { type: 'rss', url: 'https://example.org/feed' },
  credit: 'Fixture',
  ...overrides,
});
const theater = (overrides = {}) => ({
  id: 'fixture-theater',
  name: 'Fixture theater',
  brief: ['One.', 'Two.'],
  sourceIds: ['fixture'],
  categories: [{ id: 'war-military', label: 'War', color: '#ef4444' }],
  perspectives: [
    { id: 'international-wire', label: 'Wire', group: 'international' },
  ],
  gdeltTerms: ['Iran'],
  gazetteer: [
    { name: 'Tehran', lat: 35.69, lon: 51.39, precision: 'city', aliases: [] },
  ],
  ...overrides,
});
const sourcesById = (list) => new Map(list.map((entry) => [entry.id, entry]));

test('the real registry and theater files load and cross-validate', async () => {
  const registry = await loadNewsRegistry({ theaterId: 'iran-israel-us' });
  assert.ok(registry.sources.length >= 30);
  assert.equal(registry.theater.id, 'iran-israel-us');
  assert.equal(registry.theater.categories.length, 6);
  for (const id of registry.theater.sourceIds)
    assert.ok(registry.sourcesById.has(id), id);
  const transports = new Set(registry.sources.map((s) => s.transport.type));
  for (const type of NEWS_TRANSPORTS) assert.ok(transports.has(type), type);
  const folders = new Set(registry.sources.map((s) => s.folder));
  for (const folder of NEWS_FOLDERS) assert.ok(folders.has(folder), folder);
  assert.ok(registry.theater.gazetteer.length > 200);
  // Bot-protected outlets never use a scraping transport.
  for (const id of ['timesofisrael', 'alarabiya', 'tasnim', 'isw'])
    assert.equal(registry.sourcesById.get(id).transport.type, 'gdelt-domain');
  assert.equal(
    registry.sourcesById.get('reliefweb').transport.type,
    'reliefweb',
  );
});

test('unknown theater ids and path-like ids are refused', async () => {
  await assert.rejects(
    loadNewsRegistry({ theaterId: '../sources' }),
    /theater/,
  );
  await assert.rejects(loadNewsRegistry({ theaterId: 'nowhere' }), /theater/);
});

test('source validation refuses unknown folder, kind and transport', () => {
  assert.equal(validateNewsSources({ sources: [source()] }).length, 1);
  assert.throws(
    () => validateNewsSources({ sources: [source({ folder: 'gossip' })] }),
    /folder/,
  );
  assert.throws(
    () => validateNewsSources({ sources: [source({ kind: 'blog' })] }),
    /kind/,
  );
  assert.throws(
    () =>
      validateNewsSources({
        sources: [source({ transport: { type: 'scrape', url: 'https://x' } })],
      }),
    /transport/,
  );
  assert.deepEqual(NEWS_KINDS.includes('participant'), true);
});

test('source validation refuses duplicates and malformed transports', () => {
  assert.throws(
    () => validateNewsSources({ sources: [source(), source()] }),
    /duplicate/,
  );
  assert.throws(
    () =>
      validateNewsSources({
        sources: [source({ transport: { type: 'rss', url: 'ftp://x/feed' } })],
      }),
    /url/,
  );
  assert.throws(
    () =>
      validateNewsSources({
        sources: [
          source({ transport: { type: 'telegram-public', channel: 'a b' } }),
        ],
      }),
    /channel/,
  );
  assert.throws(
    () =>
      validateNewsSources({
        sources: [
          source({
            transport: { type: 'gdelt-domain', domain: 'not a domain' },
          }),
        ],
      }),
    /domain/,
  );
  assert.throws(
    () => validateNewsSources({ sources: [source({ id: 'A/B' })] }),
    /id/,
  );
  assert.throws(() => validateNewsSources({}), /sources/);
});

test('theater validation refuses unknown sources, perspectives and categories', () => {
  const list = [source()];
  assert.equal(
    validateNewsTheater(theater(), sourcesById(list)).id,
    'fixture-theater',
  );
  assert.throws(
    () =>
      validateNewsTheater(
        theater({ sourceIds: ['missing'] }),
        sourcesById(list),
      ),
    /unknown source/,
  );
  assert.throws(
    () =>
      validateNewsTheater(
        theater(),
        sourcesById([source({ perspective: 'martian' })]),
      ),
    /perspective/,
  );
  assert.throws(
    () =>
      validateNewsTheater(
        theater({
          categories: [
            { id: 'war-military', label: 'War', color: '#ef4444' },
            { id: 'war-military', label: 'Again', color: '#ef4444' },
          ],
        }),
        sourcesById(list),
      ),
    /category/,
  );
  assert.throws(
    () =>
      validateNewsTheater(
        theater({
          categories: [{ id: 'War Military', label: 'War', color: 'red' }],
        }),
        sourcesById(list),
      ),
    /category/,
  );
  assert.throws(
    () => validateNewsTheater(theater({ categories: [] }), sourcesById(list)),
    /category/,
  );
});

test('theater validation refuses bad gazetteer rows and ambiguous spellings', () => {
  const list = [source()];
  assert.throws(
    () =>
      validateNewsTheater(
        theater({
          gazetteer: [
            { name: 'X', lat: 95, lon: 0, precision: 'city', aliases: [] },
          ],
        }),
        sourcesById(list),
      ),
    /gazetteer/,
  );
  assert.throws(
    () =>
      validateNewsTheater(
        theater({
          gazetteer: [
            { name: 'X', lat: 1, lon: 1, precision: 'planet', aliases: [] },
          ],
        }),
        sourcesById(list),
      ),
    /precision/,
  );
  assert.throws(
    () =>
      validateNewsTheater(
        theater({
          gazetteer: [
            {
              name: 'Gaza City',
              lat: 31.5,
              lon: 34.46,
              precision: 'city',
              aliases: ['Gaza'],
            },
            {
              name: 'Gaza Strip',
              lat: 31.42,
              lon: 34.37,
              precision: 'region',
              aliases: ['gaza'],
            },
          ],
        }),
        sourcesById(list),
      ),
    /ambiguous/,
  );
});
