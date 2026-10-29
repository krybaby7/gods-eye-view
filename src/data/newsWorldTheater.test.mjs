import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  findDuplicateTowns,
  linkCityHotspots,
} from '../../scripts/build-world-gazetteer.mjs';
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

test('the gazetteer has every country, every capital, cities from 300,000 and named hotspots', () => {
  const countries = rows('country');
  const capitals = rows('city').filter((row) => row.prompt);
  const cities = rows('city').filter((row) => !row.prompt);
  const hotspots = [...rows('region'), ...rows('water')];
  assert.ok(countries.length >= 195, `countries ${countries.length}`);
  assert.ok(capitals.length >= 190, `capitals ${capitals.length}`);
  // About 1,350 Natural Earth cities at 300,000 plus the hand-written towns;
  // a million-city gazetteer had about 410.
  assert.ok(
    cities.length >= 1300 && cities.length <= 1500,
    `cities ${cities.length}`,
  );
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
    // Goma is a hand-written town: the city is finer than its province.
    ['Goma, North Kivu', 'Goma', 'city'],
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

// The registry may not keep every field of a row: link assertions read the
// committed files as they are.
const readGazetteer = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../public/news/theaters/${name}.json`, import.meta.url),
      'utf8',
    ),
  ).gazetteer;
const worldRows = readGazetteer('world');
const worldByName = new Map(worldRows.map((row) => [row.name, row]));

test('the 300,000 threshold: counts by precision', () => {
  const count = (test) => worldRows.filter(test).length;
  assert.equal(
    count((row) => row.precision === 'country'),
    209,
  );
  assert.equal(
    count((row) => row.precision === 'city' && row.prompt),
    205,
  );
  // Natural Earth's 1,354 cities at 300,000, less the rows its data gets
  // wrong (PLACE_ERRATA), plus the hand-written towns.
  const cities = count((row) => row.precision === 'city' && !row.prompt);
  assert.ok(cities >= 1380 && cities <= 1450, `cities ${cities}`);
  assert.equal(
    count((row) => ['region', 'water'].includes(row.precision)),
    49,
  );
  // Only countries and capitals are listed in the digest instructions.
  assert.ok(
    worldRows
      .filter((row) => row.prompt)
      .every((row) => ['country', 'city'].includes(row.precision)),
  );
});

test('the owner list of conflict towns resolves to a row of that name', () => {
  const at = (spelling) => resolvePlace(spelling, theater.gazetteer);
  for (const town of [
    'Hebron',
    'Jenin',
    'Nablus',
    'Tulkarm',
    'Khan Younis',
    'Rafah',
    'Deir al-Balah',
    'Bakhmut',
    'Pokrovsk',
    'El Fasher',
    'Kadugli',
    'Marib',
    'Sumy',
    'Kramatorsk',
    'Geneina',
    'Mekelle',
    'Goma',
    'Sittwe',
    'Stepanakert',
    'Tyre',
    'Timbuktu',
  ]) {
    const hit = at(town);
    assert.equal(hit?.name, town, town);
    assert.equal(hit?.precision, 'city', town);
    assert.equal(hit?.method, 'gazetteer', town);
  }
  assert.equal(at('Khankendi')?.name, 'Stepanakert');
  // Cities the threshold brings in.
  for (const city of ['Donetsk', 'Luhansk', 'Mariupol', 'Nyala', 'Ramallah'])
    assert.equal(at(city)?.name, city, city);
  // Natural Earth's spellings, reached by the English press spellings, and
  // two places the first live run had to guess.
  for (const [spelling, name] of [
    ['El Obeid', 'Al-Ubayyid'],
    ['Taizz', "Ta'izz"],
    ['Taiz', "Ta'izz"],
    ['Hodeidah', 'Al Hudaydah'],
    ['Hudaydah', 'Al Hudaydah'],
    ['Wonsan', 'Wonsan'],
    ['Cebu City', 'Cebu City'],
  ])
    assert.equal(at(spelling)?.name, name, spelling);
});

test('a namesake of a better-known place is qualified, not pinned in the wrong country', () => {
  const at = (spelling) => resolvePlace(spelling, theater.gazetteer);
  assert.equal(at('Toledo'), null);
  assert.equal(at('Toledo, Ohio')?.name, 'Toledo, Ohio');
  assert.equal(at('Newcastle')?.name, 'Newcastle upon Tyne');
  assert.equal(at('Santa Fe'), null);
  // The Florida city must not take the common spelling from the Russian one.
  assert.equal(at('St. Petersburg')?.name, 'Saint Petersburg');
  assert.equal(at('St. Petersburg, Florida')?.name, 'St. Petersburg, Florida');
  // Natural Earth English names that belong to another place are renamed.
  assert.equal(at('Hail')?.name, 'Hail');
  assert.equal(at('Celaya')?.name, 'Celaya');
  assert.equal(at('Oujda')?.name, 'Oujda');
  assert.ok(at('Mazatlán')?.lat > 22);
  assert.equal(at('Ciudad Juárez')?.name, 'Ciudad Juárez');
});

test('CITY_HOTSPOTS landed: cities carry the region they lie in', () => {
  const link = (name) => worldByName.get(name)?.hotspot;
  for (const [city, region] of [
    ['Hebron', 'West Bank'],
    ['Ramallah', 'West Bank'],
    ['Gaza City', 'Gaza Strip'],
    ['Khan Younis', 'Gaza Strip'],
    ['Donetsk', 'Donbas'],
    ['Bakhmut', 'Donbas'],
    ['El Fasher', 'Darfur'],
    ['Nyala', 'Darfur'],
    ['Kadugli', 'Kordofan'],
    ['Al-Ubayyid', 'Kordofan'],
    ['Sevastopol', 'Crimea'],
    ['Zaporizhzhia', 'Zaporizhzhia Oblast'],
    ['Kherson', 'Kherson Oblast'],
    ['Mekelle', 'Tigray'],
    ['Sittwe', 'Rakhine State'],
    ['Goma', 'North Kivu'],
    ['Srinagar', 'Kashmir'],
    ['Stepanakert', 'Nagorno-Karabakh'],
    ['Timbuktu', 'Sahel'],
  ])
    assert.equal(link(city), region, city);
  // A town outside every region row has no link.
  assert.equal(link('Sumy'), undefined);
  assert.equal(link('Caracas'), undefined);
});

test('every hotspot link names a region or water row that has no link itself', () => {
  const linked = worldRows.filter((row) => row.hotspot !== undefined);
  assert.ok(linked.length >= 60, `${linked.length} linked rows`);
  for (const row of linked) {
    const target = worldByName.get(row.hotspot);
    assert.ok(target, `${row.name} → ${row.hotspot}`);
    assert.ok(['region', 'water'].includes(target.precision), row.name);
    assert.equal(target.hotspot, undefined, `${row.name}: a chain`);
    assert.equal(row.precision, 'city', `${row.name} is not a city`);
  }
  // The field follows the country in key order.
  const hebron = Object.keys(worldByName.get('Hebron'));
  assert.equal(hebron[hebron.indexOf('country') + 1], 'hotspot');
});

test('a hand-written town that duplicates a Natural Earth row is found', () => {
  const rows = [
    { name: 'Kherson', aliases: ['Херсон'], lat: 46.63, lon: 32.6 },
    { name: 'Sumy', aliases: [], lat: 50.92, lon: 34.78 },
  ];
  const towns = [
    // The same city, 3 km off, under its Russian spelling.
    { name: 'Херсон', lat: 46.65, lon: 32.62 },
    // A namesake 2,000 km away is not the same place.
    { name: 'Sumy', lat: 40.0, lon: 60.0 },
    { name: 'Bakhmut', lat: 48.59, lon: 38.0 },
  ];
  assert.deepEqual(findDuplicateTowns(towns, rows), [
    'Херсон: same place as Kherson',
  ]);
  assert.deepEqual(findDuplicateTowns([towns[2]], rows), []);
});

test('a stale CITY_HOTSPOTS entry fails loudly', () => {
  const fixture = () => [
    { name: 'Gaza Strip', kind: 'hotspot', precision: 'region' },
    { name: 'Red Sea', kind: 'hotspot', precision: 'water' },
    { name: 'Hebron', kind: 'city', precision: 'city' },
    { name: 'Gaza City', kind: 'city', precision: 'city' },
    { name: 'Egypt', kind: 'country', precision: 'country' },
  ];
  const rows = fixture();
  linkCityHotspots(rows, { Hebron: 'Gaza Strip', 'Gaza City': 'Red Sea' });
  assert.deepEqual(
    rows.map((row) => row.hotspot),
    [undefined, undefined, 'Gaza Strip', 'Red Sea', undefined],
  );
  // No row carries the name.
  assert.throws(
    () => linkCityHotspots(fixture(), { Jenin: 'Gaza Strip' }),
    /Jenin/,
  );
  // The target is not a region or water row, or does not exist.
  assert.throws(
    () => linkCityHotspots(fixture(), { Hebron: 'Egypt' }),
    /Egypt/,
  );
  assert.throws(
    () => linkCityHotspots(fixture(), { Hebron: 'West Bank' }),
    /West Bank/,
  );
  // A link is for a city.
  assert.throws(
    () => linkCityHotspots(fixture(), { 'Gaza Strip': 'Red Sea' }),
    /Gaza Strip/,
  );
});

test('iran-israel-us links its existing rows to the regions that hold them', () => {
  const rows = readGazetteer('iran-israel-us');
  const byName = new Map(rows.map((row) => [row.name, row]));
  for (const [place, region] of [
    ['Gaza City', 'Gaza Strip'],
    ['Jabalia', 'Gaza Strip'],
    ['Khan Younis', 'Gaza Strip'],
    ['Netzarim corridor', 'Gaza Strip'],
    ['Philadelphi corridor', 'Gaza Strip'],
    ['Hebron', 'West Bank'],
    ['Jenin', 'West Bank'],
    ['Bint Jbeil', 'Southern Lebanon'],
    ['Baalbek', 'Bekaa Valley'],
    ['Erbil', 'Kurdistan Region'],
    ['Ahvaz', 'Khuzestan'],
  ])
    assert.equal(byName.get(place)?.hotspot, region, place);
  // Unlinked: a place no region row holds.
  assert.equal(byName.get('Tehran').hotspot, undefined);
  for (const row of rows.filter((entry) => entry.hotspot !== undefined)) {
    const target = byName.get(row.hotspot);
    assert.ok(['region', 'water'].includes(target?.precision), row.name);
    assert.equal(target.hotspot, undefined, `${row.name}: a chain`);
  }
});
