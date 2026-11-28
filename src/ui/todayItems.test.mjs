import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNewsSnapshot } from '../layers/news/records.js';
import { buildTodayItems } from './todayItems.js';

const end = '2026-11-09T10:00:00Z';
const countries = {
  IND: { name: 'India', kind: 'country' },
  GBR: { name: 'United Kingdom', kind: 'country' },
  XXX: { name: 'Disputed territory', kind: 'disputed' },
};

function board() {
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
    features: {
      'live-gdacs': {
        flags: [
          {
            id: 'hazard-1',
            sourceId: 'live-gdacs',
            iso3: 'IND',
            date: '2026-11-09',
            status: 'active',
            label: 'Fixture hazard',
          },
          {
            id: 'hazard-2',
            sourceId: 'live-gdacs',
            iso3: 'GBR',
            date: '2026-11-08',
            status: 'cleared',
            label: 'Fixture older hazard',
          },
        ],
      },
      'live-fx': {
        staleSince: end,
        flags: [
          {
            id: 'old-fx',
            sourceId: 'live-fx',
            iso3: 'IND',
            date: '2026-11-01',
            status: 'active',
            label: 'Fixture currency flag',
          },
        ],
      },
      'live-ucdp-token': {
        flags: [
          {
            id: 'unsupported',
            sourceId: 'live-ucdp-token',
            iso3: 'IND',
            date: '2026-11-09',
            status: 'active',
            label: 'Excluded flag',
          },
        ],
      },
    },
  };
}

function story(id, overrides = {}) {
  return {
    id,
    title: 'Lawmakers approved a new public library budget.',
    summary: 'The budget covers public libraries.',
    category: 'elections-governance',
    kind: 'development',
    status: 'open',
    updatedAt: '2026-11-09T08:00:00Z',
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
    visibleStories: stories,
    items: [
      {
        id: 'i1',
        sourceId: 'press-a',
        url: 'https://publisher.invalid/library',
      },
      { id: 'i2', sourceId: 'press-a', url: 'https://publisher.invalid/notes' },
      { id: 'i3', sourceId: 'press-b', url: 'https://paper.invalid/library' },
    ],
    citations: [],
    sources: [
      { id: 'press-a', name: 'Local Press' },
      { id: 'press-b', name: 'Public News' },
    ],
  };
}

test('active country alerts rank first and retain a country-level open target', () => {
  const rows = buildTodayItems(board(), news([story('civic')]));
  assert.equal(rows.length, 3);
  const alert = rows[0];
  assert.equal(alert.place, 'India');
  assert.equal(alert.date, '2026-11-09');
  assert.ok(alert.sources.includes('GDACS'));
  assert.deepEqual(alert.target, { kind: 'country', iso3: 'IND' });
  assert.match(alert.reason, /active/i);
});

test('country changes collapse to one row with honest turn attribution', () => {
  const rows = buildTodayItems(board(), null);
  assert.equal(rows.length, 2);
  const changed = rows.find(({ target }) => target.iso3 === 'GBR');
  assert.deepEqual(changed.sources, ['World Board']);
  assert.equal(changed.turn, 2);
  assert.match(changed.title, /United Kingdom/);
  assert.match(changed.reason, /latest turn/i);
});

test('cached developments rank by distinct cited outlets rather than claimed counts', () => {
  const snapshot = news([
    story('repeat', { itemIds: ['i1', 'i2'], sourceCount: 99 }),
    story('outlets', { itemIds: ['i3', 'i2'], sourceCount: 1 }),
  ]);
  const rows = buildTodayItems(null, snapshot);
  assert.deepEqual(
    rows.map(({ target }) => target.id),
    ['outlets', 'repeat'],
  );
  assert.deepEqual(rows[0].sources, ['Local Press', 'Public News']);
  assert.deepEqual(rows[0].target, {
    kind: 'development',
    id: 'outlets',
    theaterId: 'world',
  });
  assert.equal(rows[0].place, 'World affairs');
});

test('the list leaves out targeted, closed, unattributed and geo-linked news', () => {
  const snapshot = news([
    story('allowed'),
    story('position', { location: { lat: 0, lon: 0 } }),
    story('hotspot', { hotspot: { key: 'fixture' } }),
    story('uncited', { itemIds: ['missing'] }),
    story('closed', { status: 'closed' }),
    story('event', { kind: 'event' }),
    story('category', { category: 'armed-conflict' }),
    story('target', { title: 'Missile strike coordinates released' }),
  ]);
  assert.deepEqual(
    buildTodayItems(null, snapshot).map(({ target }) => target.id),
    ['allowed'],
  );
});

test('disabling War Monitor discards its retained snapshot without losing board changes', () => {
  const snapshot = news([story('cached')]);
  assert.ok(
    buildTodayItems(board(), snapshot).some(
      ({ target }) => target.id === 'cached',
    ),
  );
  const rows = buildTodayItems(board(), { ...snapshot, enabled: false });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(({ target }) => target.kind === 'country'));
});

test('missing or disabled data yields an empty list', () => {
  assert.deepEqual(buildTodayItems(null, null), []);
  assert.deepEqual(buildTodayItems({ ...board(), enabled: false }, null), []);
  assert.deepEqual(
    buildTodayItems(null, news([story('undated', { updatedAt: null })])),
    [],
  );
});

test('a turn without a dated completion does not supply country rows', () => {
  const world = board();
  delete world.turn.endedAt;
  world.features = {};
  assert.deepEqual(buildTodayItems(world, null), []);
});

test('normalized developments display their recorded civic topic and a real citation, without raw narrative', () => {
  const rawStory = story('civic', {
    title: 'The source has a more specific headline.',
    summary: 'The original source narrative is outside the Today projection.',
    place: { name: 'India' },
  });
  const normalized = normalizeNewsSnapshot({
    theater: { id: 'world', name: 'World affairs' },
    stories: [rawStory],
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
  const [item] = buildTodayItems(board(), {
    ...normalized,
    enabled: true,
    visibleStories: normalized.stories,
  }).filter(({ target }) => target.kind === 'development');
  assert.equal(item.title, 'A governance report is available for India.');
  assert.equal(item.detail, undefined);
  assert.deepEqual(item.citation, {
    outlet: 'Local Press',
    href: 'https://example.invalid/public-record',
  });
});

test('visually indistinguishable civic reports are deduplicated', () => {
  assert.equal(
    buildTodayItems(null, news([story('one'), story('two')])).length,
    1,
  );
});

test('a citation with a non-web URL cannot support a Today item', () => {
  const snapshot = news([story('civic')]);
  snapshot.items[0].url = 'javascript:void(0)';
  assert.deepEqual(buildTodayItems(null, snapshot), []);
});
