import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNewsSnapshot } from '../layers/news/records.js';
import { ALERT_FEEDS } from './frameGauges.js';
import { buildTodayItems } from './todayItems.js';

const end = '2026-11-09T10:00:00Z';
const countries = {
  IND: { name: 'India', kind: 'country' },
  GBR: { name: 'United Kingdom', kind: 'country' },
  XXX: { name: 'Disputed territory', kind: 'disputed' },
  GEO: { name: 'Georgia', kind: 'country' },
  GEX: { name: 'Georgia', kind: 'country' },
};

function board(features = {}) {
  return {
    enabled: true,
    countries,
    turn: {
      number: 2,
      endedAt: end,
      changes: [
        { iso3: 'GBR', text: 'United Kingdom: health data updated' },
        { iso3: 'GBR', text: 'United Kingdom: more indicator changes' },
        { iso3: 'XXX', text: 'A territory reading changed' },
        { iso3: null, text: 'One feed is unavailable' },
        { iso3: 'IND', kind: 'related-asset', text: 'An asset changed' },
      ],
    },
    features,
  };
}

function flag(sourceId, overrides = {}) {
  return {
    id: `${sourceId}:IND:C1`,
    sourceId,
    iso3: 'IND',
    date: '2026-11-09',
    status: 'active',
    ...overrides,
  };
}

function story(id, overrides = {}) {
  return {
    id,
    title: `Fixture story ${id}`,
    summary: `Summary of ${id}.`,
    whatsNew: '',
    category: 'elections-governance',
    kind: 'development',
    status: 'open',
    place: null,
    updatedAt: '2026-11-09T08:00:00.000Z',
    eventAt: null,
    location: null,
    hotspot: null,
    itemIds: ['i1'],
    ...overrides,
  };
}

function news(stories) {
  return {
    enabled: true,
    theater: { id: 'world', name: 'World affairs' },
    stories,
    visibleStories: stories,
    items: [
      { id: 'i1', sourceId: 'press-a', url: 'https://publisher.invalid/one' },
      { id: 'i2', sourceId: 'press-a', url: 'https://publisher.invalid/two' },
      { id: 'i3', sourceId: 'press-b', url: 'https://paper.invalid/three' },
      { id: 'i4', sourceId: 'press-c', url: 'https://daily.invalid/four' },
      { id: 'i5', sourceId: 'press-d', url: 'https://wire.invalid/five' },
    ],
    citations: [],
    sources: [
      { id: 'press-a', name: 'Local Press' },
      { id: 'press-b', name: 'Public News' },
      { id: 'press-c', name: 'Daily Fixture' },
      { id: 'press-d', name: 'Wire Fixture' },
    ],
  };
}

const stories = (rows) => rows.filter(({ target }) => target.kind === 'story');

test('a located conflict event in a city is listed under its own title', () => {
  const event = story('strike', {
    title: 'A strike hit a fixture depot near the river.',
    summary: 'Missile strike reported by the army on a military target.',
    whatsNew: 'A second outlet confirmed the time.',
    kind: 'event',
    category: 'armed-conflict',
    place: 'Fixture City',
    location: { lat: 31.5, lon: 34.4, precision: 'city', method: 'gazetteer' },
    hotspot: { key: 'place:fixture-city', label: 'Fixture City' },
    eventAt: '2026-11-09T06:00:00.000Z',
    itemIds: ['i1', 'i3'],
  });
  const [row] = buildTodayItems(board(), news([event]));
  assert.equal(row.title, 'A strike hit a fixture depot near the river.');
  assert.equal(row.place, 'Fixture City');
  assert.equal(row.date, '2026-11-09T08:00:00.000Z');
  assert.equal(
    row.summary,
    'Missile strike reported by the army on a military target.',
  );
  assert.equal(row.whatsNew, 'A second outlet confirmed the time.');
  assert.deepEqual(row.sources, ['Local Press', 'Public News']);
  assert.deepEqual(row.citations, [
    { outlet: 'Local Press', href: 'https://publisher.invalid/one' },
    { outlet: 'Public News', href: 'https://paper.invalid/three' },
  ]);
  assert.equal(row.reason, 'Reported by 2 outlets');
  assert.deepEqual(row.target, {
    kind: 'story',
    id: 'strike',
    theaterId: 'world',
    mapped: true,
  });
});

test('no open story is dropped for its kind, category, words, location or place', () => {
  const snapshot = news([
    story('development'),
    story('event', { kind: 'event' }),
    story('conflict', { category: 'armed-conflict' }),
    story('protest', { category: 'protests-unrest' }),
    story('rights', { category: 'rights-justice' }),
    story('words', { title: 'Troops and weapons moved toward the target.' }),
    story('coordinates', { summary: 'Reported at 31.5, 34.4.' }),
    story('located', { location: { lat: 1, lon: 2 } }),
    story('hotspot', { hotspot: { key: 'country:India', label: 'India' } }),
    story('city', { place: 'Fixture Town' }),
    story('country', { place: 'India' }),
    story('disputed', { place: 'Disputed territory' }),
    story('ambiguous', { place: 'Georgia' }),
    story('old', { updatedAt: null, eventAt: '2026-11-01T00:00:00.000Z' }),
  ]);
  const listed = stories(buildTodayItems(board(), snapshot));
  assert.deepEqual(listed.map(({ target }) => target.id).sort(), [
    'ambiguous',
    'city',
    'conflict',
    'coordinates',
    'country',
    'development',
    'disputed',
    'event',
    'hotspot',
    'located',
    'old',
    'protest',
    'rights',
    'words',
  ]);
  const byId = Object.fromEntries(listed.map((row) => [row.target.id, row]));
  assert.equal(byId.country.target.iso3, 'IND');
  assert.equal(byId.country.place, 'India');
  assert.equal(byId.disputed.target.iso3, undefined);
  assert.equal(byId.disputed.place, 'Disputed territory');
  assert.equal(byId.ambiguous.target.iso3, undefined);
  assert.equal(byId.development.place, 'World affairs');
  assert.equal(byId.old.date, '2026-11-01T00:00:00.000Z');
  // A development is never pinned, even with a location.
  assert.equal(byId.located.target.mapped, false);
});

test('stories outside the Situation panel filters still appear', () => {
  const snapshot = news([story('shown'), story('filtered')]);
  snapshot.visibleStories = [snapshot.stories[0]];
  assert.equal(stories(buildTodayItems(null, snapshot)).length, 2);
});

test('a story that cannot be named, dated or sourced is not listed', () => {
  const snapshot = news([
    story('listed'),
    story('closed', { status: 'closed' }),
    story('untitled', { title: '  ' }),
    story('', {}),
    story('undated', { updatedAt: null, eventAt: null }),
    story('uncited', { itemIds: ['missing'] }),
    story('unknown-outlet', { itemIds: ['stray'] }),
    story('script', { itemIds: ['bad'] }),
    story('credentials', { itemIds: ['secret'] }),
  ]);
  snapshot.items.push(
    { id: 'stray', sourceId: 'not-listed', url: 'https://x.invalid/a' },
    { id: 'bad', sourceId: 'press-a', url: 'javascript:void(0)' },
    { id: 'secret', sourceId: 'press-a', url: 'https://u:p@x.invalid/a' },
  );
  assert.deepEqual(
    stories(buildTodayItems(null, snapshot)).map(({ target }) => target.id),
    ['listed'],
  );
});

test('stories rank by outlets named, then latest update, then id, before alerts and turns', () => {
  const snapshot = news([
    story('one-new', { updatedAt: '2026-11-09T09:00:00.000Z' }),
    story('one-old', { updatedAt: '2026-11-08T09:00:00.000Z' }),
    story('b-tie', { updatedAt: '2026-11-08T09:00:00.000Z' }),
    // Two items from one outlet are one outlet, whatever sourceCount says.
    story('repeat', { itemIds: ['i1', 'i2'], sourceCount: 99 }),
    story('three', {
      itemIds: ['i1', 'i3', 'i4'],
      updatedAt: '2026-11-01T00:00:00.000Z',
    }),
  ]);
  const world = board({
    'live-gdacs': {
      flags: [
        flag('live-gdacs', { id: 'older', date: '2026-11-07' }),
        flag('live-gdacs', { id: 'newer', date: '2026-11-08' }),
      ],
    },
  });
  const rows = buildTodayItems(world, snapshot);
  assert.deepEqual(
    rows.map(({ id }) => id),
    [
      'story:world:three',
      'story:world:one-new',
      'story:world:repeat',
      'story:world:b-tie',
      'story:world:one-old',
      'alert:newer',
      'alert:older',
      'turn:2:GBR',
    ],
  );
});

test('the reason states the number of outlets the item names', () => {
  const snapshot = news([
    story('four', { itemIds: ['i1', 'i2', 'i3', 'i4', 'i5', 'missing'] }),
    story('single', { itemIds: ['i1', 'i2'] }),
  ]);
  for (const row of stories(buildTodayItems(null, snapshot))) {
    const count = row.sources.length;
    assert.equal(
      row.reason,
      `Reported by ${count} ${count === 1 ? 'outlet' : 'outlets'}`,
    );
    assert.equal(row.citations.length, count);
    assert.deepEqual(
      row.citations.map(({ outlet }) => outlet),
      row.sources,
    );
  }
  const [four, single] = stories(buildTodayItems(null, snapshot));
  assert.equal(four.reason, 'Reported by 4 outlets');
  assert.equal(single.reason, 'Reported by 1 outlet');
});

test('cited-item snapshots kept after retention still source a story', () => {
  const snapshot = news([story('kept', { itemIds: ['gone'] })]);
  snapshot.citations = [
    { id: 'gone', sourceId: 'press-b', url: 'https://paper.invalid/kept' },
  ];
  const [row] = stories(buildTodayItems(null, snapshot));
  assert.deepEqual(row.sources, ['Public News']);
});

test('every alert feed the gauge counts can produce a Today item', () => {
  const features = Object.fromEntries(
    Object.keys(ALERT_FEEDS).map((sourceId) => [
      sourceId,
      {
        flags: [
          flag(sourceId, {
            id: `${sourceId}:flag`,
            ...(sourceId.startsWith('live-ucdp') && { recordedDeaths: 40 }),
          }),
        ],
      },
    ]),
  );
  const rows = buildTodayItems(board(features), null).filter(({ id }) =>
    id.startsWith('alert:'),
  );
  assert.deepEqual(
    rows.map(({ id }) => id.slice('alert:'.length)).sort(),
    Object.keys(ALERT_FEEDS)
      .map((sourceId) => `${sourceId}:flag`)
      .sort(),
  );
  for (const row of rows) {
    assert.equal(row.place, 'India');
    assert.deepEqual(row.target, { kind: 'country', iso3: 'IND' });
    assert.match(row.title, /^India has an active .+ alert\.$/);
    assert.match(row.reason, /^Active .+ alert$/);
    assert.equal(row.sources.length, 1);
  }
  const byFeed = Object.fromEntries(
    rows.map((row) => [row.id.slice('alert:'.length, -':flag'.length), row]),
  );
  assert.equal(byFeed['live-ucdp-saved'].reason, 'Active armed conflict alert');
  assert.equal(byFeed['live-ucdp-token'].reason, 'Active armed conflict alert');
  assert.equal(byFeed['live-coups'].reason, 'Active coup alert');
  assert.deepEqual(byFeed['live-ucdp-token'].sources, ['UCDP']);
});

test('an alert shows the text its flag carries and the publisher it names', () => {
  const rows = buildTodayItems(
    board({
      'live-ucdp-token': {
        flags: [
          flag('live-ucdp-token', {
            id: 'ucdp',
            date: '2026-10',
            recordedDeaths: 40,
            label:
              'UCDP Candidate recorded fatalities: 40 (draft threshold: 25)',
            sourceName: 'UCDP Candidate',
          }),
        ],
      },
      'live-gdelt': {
        flags: [
          flag('live-gdelt', {
            id: 'gdelt',
            slot: 'C6',
            label: '4 protest events in sampled 15-minute files',
          }),
        ],
      },
      'live-unhcr': {
        flags: [flag('live-unhcr', { id: 'unhcr', date: '2025' })],
      },
    }),
    null,
  );
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(
    byId['alert:ucdp'].title,
    'UCDP Candidate recorded fatalities: 40 (draft threshold: 25)',
  );
  assert.deepEqual(byId['alert:ucdp'].sources, ['UCDP Candidate']);
  assert.equal(byId['alert:ucdp'].date, '2026-10');
  assert.equal(byId['alert:gdelt'].reason, 'Active protest alert');
  // A yearly figure keeps its year rather than being dropped.
  assert.equal(byId['alert:unhcr'].date, '2025');
});

test('alerts keep their rules: active, a known country, a date and an id', () => {
  const rows = buildTodayItems(
    board({
      'live-gdacs': {
        flags: [
          flag('live-gdacs', { id: 'ok' }),
          flag('live-gdacs', { id: 'cleared', status: 'cleared' }),
          flag('live-gdacs', { id: 'nowhere', iso3: 'ZZZ' }),
          flag('live-gdacs', { id: 'disputed', iso3: 'XXX' }),
          flag('live-gdacs', { id: 'undated', date: 'soon' }),
          flag('live-gdacs', { id: '' }),
        ],
      },
      'live-fx': { staleSince: end, flags: [flag('live-fx', { id: 'stale' })] },
      'live-ucdp-saved': {
        flags: [flag('live-ucdp-saved', { id: 'no-deaths' })],
      },
    }),
    null,
  );
  assert.deepEqual(
    rows.filter(({ id }) => id.startsWith('alert:')).map(({ id }) => id),
    ['alert:ok'],
  );
});

test('country changes collapse to one row with honest turn attribution', () => {
  const rows = buildTodayItems(board(), null);
  assert.equal(rows.length, 1);
  const [changed] = rows;
  assert.deepEqual(changed.sources, ['World Board']);
  assert.equal(changed.turn, 2);
  assert.match(changed.title, /United Kingdom/);
  assert.match(changed.reason, /latest turn/i);
  assert.deepEqual(changed.target, { kind: 'country', iso3: 'GBR' });
});

test('switching War Monitor off removes its stories and keeps the board rows', () => {
  const snapshot = news([story('cached')]);
  assert.equal(stories(buildTodayItems(board(), snapshot)).length, 1);
  const rows = buildTodayItems(board(), { ...snapshot, enabled: false });
  assert.deepEqual(
    rows.map(({ id }) => id),
    ['turn:2:GBR'],
  );
});

test('missing or disabled data yields an empty list', () => {
  assert.deepEqual(buildTodayItems(null, null), []);
  assert.deepEqual(buildTodayItems({ ...board(), enabled: false }, null), []);
  const world = board();
  delete world.turn.endedAt;
  assert.deepEqual(buildTodayItems(world, null), []);
});

test('a normalized snapshot keeps the story text and its place', () => {
  const normalized = normalizeNewsSnapshot({
    theater: { id: 'world', name: 'World affairs' },
    stories: [
      {
        id: 'st_1',
        title: 'Fixture council met in the capital.',
        summary: 'The fixture council met for a second day.',
        whatsNew: 'A vote was scheduled.',
        kind: 'event',
        category: 'armed-conflict',
        place: { name: 'India' },
        updatedAt: '2026-11-09T08:30:00Z',
        status: 'open',
        itemIds: ['i1'],
      },
    ],
    items: [
      {
        id: 'i1',
        title: 'Original article heading',
        sourceId: 'press-a',
        url: 'https://example.invalid/public-record',
      },
    ],
    sources: [{ id: 'press-a', name: 'Local Press' }],
  });
  const [row] = stories(
    buildTodayItems(board(), {
      ...normalized,
      enabled: true,
      visibleStories: normalized.stories,
    }),
  );
  assert.equal(row.title, 'Fixture council met in the capital.');
  assert.equal(row.summary, 'The fixture council met for a second day.');
  assert.equal(row.whatsNew, 'A vote was scheduled.');
  assert.equal(row.place, 'India');
  assert.equal(row.date, '2026-11-09T08:30:00.000Z');
  assert.deepEqual(row.target, {
    kind: 'story',
    id: 'st_1',
    theaterId: 'world',
    mapped: false,
    iso3: 'IND',
  });
});
