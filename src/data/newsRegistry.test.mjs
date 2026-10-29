import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NEWS_ACTOR_ROLES,
  NEWS_ACTOR_TYPES,
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
  for (const type of transports)
    assert.ok(NEWS_TRANSPORTS.includes(type), type);
  for (const type of ['rss', 'telegram-public', 'reliefweb', 'link-only'])
    assert.ok(transports.has(type), type);
  const folders = new Set(registry.sources.map((s) => s.folder));
  for (const folder of NEWS_FOLDERS) assert.ok(folders.has(folder), folder);
  assert.ok(registry.theater.gazetteer.length > 200);
  // Bot-protected outlets are never scraped. GDELT indexes none of them
  // (2026-10-29), so they are listed as links only.
  for (const id of ['timesofisrael', 'alarabiya', 'tasnim', 'isw'])
    assert.equal(registry.sourcesById.get(id).transport.type, 'link-only');
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

test('the real theater carries 12 to 16 actors, three drivers and three tracks', async () => {
  const { theater: real } = await loadNewsRegistry({
    theaterId: 'iran-israel-us',
  });
  assert.ok(real.actors.length >= 12 && real.actors.length <= 16);
  assert.equal(real.drivers.length, 3);
  for (const driver of real.drivers) {
    assert.ok(driver.text.length > 20);
    assert.match(driver.source.url, /^https:\/\//);
  }
  assert.deepEqual(
    real.tracks.map((track) => track.id),
    ['military', 'diplomatic', 'humanitarian'],
  );
  for (const actor of real.actors) {
    assert.ok(NEWS_ACTOR_TYPES.includes(actor.type), actor.id);
    assert.ok(NEWS_ACTOR_ROLES.includes(actor.role), actor.id);
  }
});

test('actors, drivers and tracks are optional and default to empty', () => {
  const loaded = validateNewsTheater(theater(), sourcesById([source()]));
  assert.deepEqual(
    [loaded.actors, loaded.drivers, loaded.tracks],
    [[], [], []],
  );
});

test('the Situation Brief is on unless the theater sets situationBrief: false', async () => {
  const list = sourcesById([source()]);
  assert.equal(validateNewsTheater(theater(), list).situationBrief, true);
  assert.equal(
    validateNewsTheater(theater({ situationBrief: true }), list).situationBrief,
    true,
  );
  assert.equal(
    validateNewsTheater(theater({ situationBrief: false }), list)
      .situationBrief,
    false,
  );
  assert.throws(
    () => validateNewsTheater(theater({ situationBrief: 'off' }), list),
    /situationBrief must be true or false/,
  );
  const { theater: real } = await loadNewsRegistry({
    theaterId: 'iran-israel-us',
  });
  assert.equal(real.situationBrief, true);
});

test('gazetteer rows keep an optional prompt flag, true or false', () => {
  const loaded = validateNewsTheater(
    theater({
      gazetteer: [
        {
          name: 'Tehran',
          lat: 35.69,
          lon: 51.39,
          precision: 'city',
          prompt: true,
        },
        {
          name: 'Isfahan',
          lat: 32.65,
          lon: 51.67,
          precision: 'city',
          prompt: 'yes',
        },
        { name: 'Shiraz', lat: 29.59, lon: 52.58, precision: 'city' },
      ],
    }),
    sourcesById([source()]),
  );
  assert.deepEqual(
    loaded.gazetteer.map((row) => row.prompt),
    [true, false, false],
  );
});

test('a gazetteer row may link a region or water row as its hotspot, kept on the row', () => {
  const list = sourcesById([source()]);
  const rows = (hotspot) => [
    { name: 'West Bank', lat: 31.95, lon: 35.25, precision: 'region' },
    { name: 'Red Sea', lat: 20, lon: 38.5, precision: 'water' },
    { name: 'Ramallah', lat: 31.9, lon: 35.2, precision: 'city' },
    { name: 'Hebron', lat: 31.53, lon: 35.1, precision: 'city', hotspot },
  ];
  const loaded = validateNewsTheater(
    theater({ gazetteer: rows('West Bank') }),
    list,
  );
  assert.equal(loaded.gazetteer[3].hotspot, 'West Bank');
  assert.ok(Object.isFrozen(loaded.gazetteer[3]));
  // Rows without a link carry none.
  assert.equal(Object.hasOwn(loaded.gazetteer[2], 'hotspot'), false);
  assert.equal(
    validateNewsTheater(theater({ gazetteer: rows('Red Sea') }), list)
      .gazetteer[3].hotspot,
    'Red Sea',
  );
  for (const [hotspot, why] of [
    ['Nablus', /unknown hotspot/],
    ['Ramallah', /region or water/],
    ['', /hotspot/],
    [7, /hotspot/],
  ])
    assert.throws(
      () => validateNewsTheater(theater({ gazetteer: rows(hotspot) }), list),
      why,
      String(hotspot),
    );
});

test('actor validation: unique ids, types and roles from the lists', () => {
  const list = sourcesById([source()]);
  const actor = (overrides = {}) => ({
    id: 'oman',
    name: 'Oman',
    type: 'state',
    role: 'mediator',
    aliases: ['Muscat', '', 7],
    ...overrides,
  });
  const loaded = validateNewsTheater(theater({ actors: [actor()] }), list);
  assert.deepEqual(loaded.actors, [
    {
      id: 'oman',
      name: 'Oman',
      type: 'state',
      role: 'mediator',
      aliases: ['Muscat'],
    },
  ]);
  assert.ok(Object.isFrozen(loaded.actors[0]));
  assert.throws(
    () => validateNewsTheater(theater({ actors: [actor(), actor()] }), list),
    /duplicate actor oman/,
  );
  assert.throws(
    () =>
      validateNewsTheater(theater({ actors: [actor({ type: 'team' })] }), list),
    /actor oman has unknown type team/,
  );
  assert.throws(
    () =>
      validateNewsTheater(theater({ actors: [actor({ role: 'ally' })] }), list),
    /actor oman has unknown role ally/,
  );
  assert.throws(
    () =>
      validateNewsTheater(theater({ actors: [actor({ id: 'O M' })] }), list),
    /actor id/,
  );
  assert.throws(
    () =>
      validateNewsTheater(theater({ actors: [actor({ name: ' ' })] }), list),
    /actor oman needs a name/,
  );
  assert.throws(
    () => validateNewsTheater(theater({ actors: {} }), list),
    /actors must be an array/,
  );
});

test('driver validation: at most three, each with text and a source link', () => {
  const list = sourcesById([source()]);
  const driver = (overrides = {}) => ({
    text: 'A long-running cause.',
    source: { name: 'Crisis Group', url: 'https://www.crisisgroup.org/' },
    ...overrides,
  });
  const loaded = validateNewsTheater(
    theater({ drivers: [driver(), driver(), driver()] }),
    list,
  );
  assert.equal(loaded.drivers.length, 3);
  assert.deepEqual(loaded.drivers[0], driver());
  assert.throws(
    () =>
      validateNewsTheater(
        theater({ drivers: [driver(), driver(), driver(), driver()] }),
        list,
      ),
    /at most 3 drivers/,
  );
  assert.throws(
    () =>
      validateNewsTheater(theater({ drivers: [driver({ text: '' })] }), list),
    /driver 0 needs text/,
  );
  assert.throws(
    () =>
      validateNewsTheater(
        theater({
          drivers: [
            driver({ source: { name: 'X', url: 'javascript:alert(1)' } }),
          ],
        }),
        list,
      ),
    /driver 0 needs a source/,
  );
  assert.throws(
    () =>
      validateNewsTheater(
        theater({ drivers: [driver({ source: { url: 'https://x.org/' } })] }),
        list,
      ),
    /driver 0 needs a source/,
  );
});

test('track validation: unique ids with labels', () => {
  const list = sourcesById([source()]);
  const loaded = validateNewsTheater(
    theater({
      tracks: [
        { id: 'military', label: 'Military' },
        { id: 'diplomatic', label: 'Diplomatic' },
      ],
    }),
    list,
  );
  assert.deepEqual(
    loaded.tracks.map((track) => track.id),
    ['military', 'diplomatic'],
  );
  assert.throws(
    () =>
      validateNewsTheater(
        theater({
          tracks: [
            { id: 'military', label: 'Military' },
            { id: 'military', label: 'Again' },
          ],
        }),
        list,
      ),
    /duplicate track military/,
  );
  assert.throws(
    () => validateNewsTheater(theater({ tracks: [{ id: 'military' }] }), list),
    /track military needs a label/,
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
