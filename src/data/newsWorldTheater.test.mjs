import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GDELT_MAX_QUERY_CHARS,
  buildGdeltDomainQuery,
  groupGdeltSources,
} from '../../server/providers/news/fetchers/gdeltDomain.js';
import { resolvePlace } from '../../server/providers/news/geocode.js';
import { loadNewsRegistry } from '../../server/providers/news/registry.js';
import {
  buildDigestInstructions,
  validateDigestOutput,
} from '../../server/providers/news/digest/runner.js';
import { mergeDigest } from '../../server/providers/news/digest/stories.js';

const { sourcesById, theater } = await loadNewsRegistry({ theaterId: 'world' });
const sources = theater.sourceIds.map((id) => sourcesById.get(id));
const groupOf = new Map(theater.perspectives.map((p) => [p.id, p.group]));
const rows = (precision) =>
  theater.gazetteer.filter((row) => row.precision === precision);
const REGION_GROUPS = [
  'africa',
  'asia-pacific',
  'europe',
  'latin-america',
  'middle-east',
  'north-america',
  'south-asia',
  'eurasia',
];

test('the World theater validates, with six political categories and the Brief off', () => {
  assert.equal(theater.id, 'world');
  assert.equal(theater.name, 'World');
  assert.equal(theater.situationBrief, false);
  assert.deepEqual(
    theater.categories.map((category) => category.id),
    [
      'armed-conflict',
      'elections-governance',
      'protests-unrest',
      'diplomacy-sanctions',
      'humanitarian',
      'rights-justice',
    ],
  );
  const colors = theater.categories.map((category) => category.color);
  assert.equal(new Set(colors).size, colors.length, 'one colour each');
  assert.deepEqual(
    [theater.actors, theater.drivers, theater.tracks],
    [[], [], []],
  );
  // The scope note names no sides.
  assert.doesNotMatch(
    theater.brief.join(' '),
    /\b(?:ally|allies|enemy|aggressor)\b/i,
  );
});

test('30 to 45 sources, at least three per region and two international', () => {
  assert.ok(sources.length >= 30 && sources.length <= 45, sources.length);
  const perGroup = new Map();
  for (const source of sources) {
    const group = groupOf.get(source.perspective);
    perGroup.set(group, (perGroup.get(group) || 0) + 1);
  }
  for (const group of REGION_GROUPS)
    assert.ok(
      (perGroup.get(group) || 0) >= 3,
      `${group}: ${perGroup.get(group)}`,
    );
  assert.ok(perGroup.get('international') >= 2);
  for (const id of ['unnews', 'crisisgroup'])
    assert.ok(theater.sourceIds.includes(id), id);
  assert.equal(groupOf.get(sourcesById.get('unnews').perspective), 'un');
  assert.equal(
    groupOf.get(sourcesById.get('crisisgroup').perspective),
    'analysis',
  );
});

test('state outlets are kind state, in the state group, with a caution line', () => {
  const state = sources.filter((source) => source.kind === 'state');
  assert.ok(state.length >= 3, state.length);
  for (const source of state) {
    assert.equal(groupOf.get(source.perspective), 'state', source.id);
    assert.ok(source.caution.length > 20, source.id);
  }
  // Only state outlets sit in the state group.
  for (const source of sources)
    if (groupOf.get(source.perspective) === 'state')
      assert.equal(source.kind, 'state', source.id);
});

test('World sources use allowed transports and never Google News', () => {
  for (const source of sources) {
    assert.ok(
      ['rss', 'gdelt-domain', 'reliefweb', 'link-only'].includes(
        source.transport.type,
      ),
      source.id,
    );
    if (source.transport.type === 'rss')
      assert.doesNotMatch(source.transport.url, /news\.google\./, source.id);
  }
});

test('every World GDELT query stays within the length limit', () => {
  const groups = groupGdeltSources(sources, theater.gdeltTerms);
  assert.ok(theater.gdeltTerms.length >= 6);
  for (const group of groups)
    assert.ok(
      buildGdeltDomainQuery(
        group.map((source) => source.transport.domain),
        theater.gdeltTerms,
      ).length <= GDELT_MAX_QUERY_CHARS,
    );
});

test('the gazetteer has every country, every capital, big cities and named hotspots', () => {
  const countries = rows('country');
  const capitals = rows('city').filter((row) => row.prompt);
  const cities = rows('city').filter((row) => !row.prompt);
  const hotspots = [...rows('region'), ...rows('water')];
  assert.ok(countries.length >= 195, `countries ${countries.length}`);
  assert.ok(capitals.length >= 190, `capitals ${capitals.length}`);
  assert.ok(cities.length >= 300, `cities ${cities.length}`);
  assert.ok(
    hotspots.length >= 35 && hotspots.length <= 50,
    `hotspots ${hotspots.length}`,
  );
  // The digest instructions list only countries and capitals.
  for (const row of theater.gazetteer.filter((entry) => entry.prompt))
    assert.ok(['country', 'city'].includes(row.precision), row.name);
  assert.ok(countries.every((row) => row.prompt));
  assert.ok(hotspots.every((row) => !row.prompt));
  for (const row of theater.gazetteer) assert.ok(row.country, row.name);
});

test('World places resolve: countries, capitals, hotspots and other scripts', () => {
  const at = (spelling) => resolvePlace(spelling, theater.gazetteer);
  for (const [spelling, name, precision] of [
    ['Sudan', 'Sudan', 'country'],
    ['South Sudan', 'South Sudan', 'country'],
    ['Caracas', 'Caracas', 'city'],
    ['Donbas', 'Donbas', 'region'],
    ['Москва', 'Moscow', 'city'],
    ['北京', 'Beijing', 'city'],
    ['الخرطوم', 'Khartoum', 'city'],
    ['Ciudad de México', 'Mexico City', 'city'],
    ['Lagos, Nigeria', 'Lagos', 'city'],
    // Goma is below a million in Natural Earth: its province is the place.
    ['Goma, North Kivu', 'North Kivu', 'region'],
    ['Copenhagen', 'Copenhagen', 'city'],
    ['DR Congo', 'Democratic Republic of the Congo', 'country'],
    ['Gaza', 'Gaza Strip', 'region'],
    ['Taiwan Strait', 'Taiwan Strait', 'water'],
    ['Washington', 'Washington, D.C.', 'city'],
  ]) {
    const hit = at(spelling);
    assert.equal(hit?.name, name, spelling);
    assert.equal(hit?.precision, precision, spelling);
  }
  // Ambiguous names resolve to nothing rather than the wrong place.
  for (const spelling of ['Georgia', 'Congo', 'New Jersey', 'New Mexico'])
    assert.notEqual(at(spelling)?.precision, 'country', spelling);
  assert.equal(at('Georgia'), null);
  assert.equal(at('Tbilisi, Georgia')?.name, 'Tbilisi');
});

test('a fixture World digest places its stories through the gazetteer', () => {
  const items = [
    ['i1', 'bbcworld', 'Paramilitary attack reported near El Fasher'],
    ['i2', 'telesur', 'Caracas rally marks anniversary'],
    ['i3', 'meduza', 'Shelling reported across Donbas'],
    ['i4', 'tass', 'Митинг в Москве'],
    ['i5', 'politicous', 'Georgia certifies its results'],
  ].map(([id, sourceId, title]) => {
    const source = sourcesById.get(sourceId);
    return {
      id,
      sourceId,
      title,
      kind: source.kind,
      folder: source.folder,
      perspective: source.perspective,
      publisher: source.name,
      url: `https://example.org/${id}`,
      collectedAt: '2026-10-28T10:00:00.000Z',
    };
  });
  const story = (id, placeName, category, extra = {}) => ({
    id: null,
    title: `Story ${id}`,
    summary: '',
    category,
    placeName,
    lat: null,
    lon: null,
    eventAt: null,
    itemIds: [id],
    claims: [],
    whatsNew: '',
    contradictions: [],
    status: 'open',
    kind: 'event',
    actorIds: [],
    ...extra,
  });
  const { stories: validated, counts } = validateDigestOutput(
    {
      stories: [
        story('i1', 'Sudan', 'armed-conflict'),
        story('i2', 'Caracas', 'protests-unrest'),
        story('i3', 'Donbas', 'armed-conflict'),
        story('i4', 'Москва', 'protests-unrest'),
        // The US state is not in the gazetteer: the model's coordinates are
        // used, drawn as model-placed.
        story('i5', 'Georgia', 'elections-governance', {
          lat: 32.7,
          lon: -83.4,
        }),
      ],
    },
    {
      knownItemIds: new Set(items.map((item) => item.id)),
      openStories: new Map(),
      categoryIds: theater.categories.map((category) => category.id),
      nowMs: Date.parse('2026-10-28T12:00:00Z'),
    },
  );
  assert.equal(counts.clampedCategories, 0);
  const { stories } = mergeDigest({
    previous: [],
    validated,
    itemsById: new Map(items.map((item) => [item.id, item])),
    theaterId: 'world',
    gazetteer: theater.gazetteer,
    perspectiveGroups: groupOf,
    runId: 'run_w1',
    nowIso: '2026-10-28T12:00:00.000Z',
  });
  const located = Object.fromEntries(
    stories.map((entry) => [
      entry.itemIds[0],
      [entry.location?.name, entry.location?.precision, entry.location?.method],
    ]),
  );
  assert.deepEqual(located, {
    i1: ['Sudan', 'country', 'gazetteer'],
    i2: ['Caracas', 'city', 'gazetteer'],
    i3: ['Donbas', 'region', 'gazetteer'],
    i4: ['Moscow', 'city', 'gazetteer'],
    i5: ['Georgia', 'approximate', 'model'],
  });
});

test('the World digest instructions list countries and capitals only, within a bounded size', () => {
  const text = buildDigestInstructions(theater);
  const places = text.slice(text.indexOf('Gazetteer place names'));
  // One name per line, no aliases: exactly the flagged rows.
  assert.deepEqual(
    places.split('\n').slice(1),
    theater.gazetteer.filter((row) => row.prompt).map((row) => row.name),
  );
  assert.match(places, /^Sudan$/m);
  assert.match(places, /^Caracas$/m);
  assert.doesNotMatch(places, /^Donbas$/m, 'hotspots are matched, not listed');
  assert.doesNotMatch(places, /^Lagos$/m, 'big cities are matched, not listed');
  assert.doesNotMatch(places, /Москва/);
  // About 3,000 tokens at four characters a token.
  assert.ok(text.length < 13_000, `${text.length} characters`);
});
