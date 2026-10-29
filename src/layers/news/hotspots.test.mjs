import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOTSPOT_BUBBLE_HEIGHT_M,
  HOTSPOT_PIN_HEIGHT_M,
  buildHotspots,
  hotspotMarkerStyle,
  hotspotRadiusM,
  hotspotSizePx,
  nextMapMode,
} from './hotspots.js';
import { filterNewsStories, filterStoriesByActor } from './records.js';

const categories = [
  { id: 'war', label: 'War', color: '#ef4444' },
  { id: 'aid', label: 'Aid', color: '#22c55e' },
  { id: 'vote', label: 'Vote', color: '#3b82f6' },
];
const sudan = {
  key: 'country:Sudan',
  label: 'Sudan',
  kind: 'country',
  lat: 15.5,
  lon: 32.5,
};
const story = (id, overrides = {}) => ({
  id,
  title: `Story ${id}`,
  category: 'war',
  location: { lat: 15.6, lon: 32.5, method: 'gazetteer', name: 'Khartoum' },
  hotspot: sudan,
  status: 'open',
  kind: 'event',
  updatedAt: '2026-10-29T10:00:00Z',
  actorIds: [],
  ...overrides,
});

test('the map switches to bubbles above 3,500 km and back to pins below 3,000 km', () => {
  assert.equal(HOTSPOT_BUBBLE_HEIGHT_M, 3_500_000);
  assert.equal(HOTSPOT_PIN_HEIGHT_M, 3_000_000);
  assert.equal(nextMapMode('pins', 4_000_000), 'bubbles');
  assert.equal(nextMapMode('bubbles', 2_800_000), 'pins');
  // Between the two the current mode stays: no flicker while zooming.
  assert.equal(nextMapMode('pins', 3_200_000), 'pins');
  assert.equal(nextMapMode('bubbles', 3_200_000), 'bubbles');
  assert.equal(nextMapMode('bubbles', Number.NaN), 'bubbles');
  assert.equal(nextMapMode('pins', undefined), 'pins');
});

test('one bubble per hotspot key, counting only pinned stories with a hotspot', () => {
  const bubbles = buildHotspots(
    [
      story('a'),
      story('b', { updatedAt: '2026-10-29T12:00:00Z' }),
      story('c', {
        hotspot: { ...sudan, key: 'region:Darfur', label: 'Darfur' },
      }),
      story('talks', { kind: 'development', hotspot: null }),
      story('nowhere', { location: null, hotspot: null }),
      story('old', { hotspot: null }),
    ],
    categories,
  );
  assert.deepEqual(
    bubbles.map((bubble) => [bubble.key, bubble.count]),
    [
      ['country:Sudan', 2],
      ['region:Darfur', 1],
    ],
  );
  const [first] = bubbles;
  assert.equal(first.label, 'Sudan');
  assert.equal(first.lat, 15.5);
  assert.equal(first.lon, 32.5);
  // Newest first, for the card.
  assert.deepEqual(
    first.stories.map((s) => s.id),
    ['b', 'a'],
  );
});

test('bubble diameter grows with the square root of the story count', () => {
  assert.equal(hotspotSizePx(1), 22);
  assert.equal(hotspotSizePx(4), 30);
  assert.equal(hotspotSizePx(25), 54);
  assert.equal(hotspotSizePx(40), 54);
  assert.equal(hotspotSizePx(0), 22);
});

test('the ring is split by category share, in the theater’s category order', () => {
  const [bubble] = buildHotspots(
    [
      story('a', { category: 'vote' }),
      story('b', { category: 'war' }),
      story('c', { category: 'vote' }),
      story('d', { category: 'mystery' }),
    ],
    categories,
  );
  assert.deepEqual(bubble.shares, [
    { category: 'war', color: '#ef4444', count: 1 },
    { category: 'vote', color: '#3b82f6', count: 2 },
    { category: 'mystery', color: '#94a3b8', count: 1 },
  ]);
  // The largest category colours the card.
  assert.equal(bubble.topColor, '#3b82f6');
  const style = hotspotMarkerStyle(bubble);
  assert.equal(style.count, 4);
  assert.equal(style.size, hotspotSizePx(4));
  assert.equal(style.shares, bubble.shares);
});

test('a bubble shows the new-since dot and the selected outline from its stories', () => {
  const stories = [
    story('a'),
    story('b', { updatedAt: '2026-10-29T12:00:00Z' }),
  ];
  const [plain] = buildHotspots(stories, categories);
  assert.equal(hotspotMarkerStyle(plain).fresh, false, 'no visit recorded');
  assert.equal(hotspotMarkerStyle(plain).selected, false);
  const [seen] = buildHotspots(stories, categories, {
    newSinceMs: Date.parse('2026-10-29T11:00:00Z'),
    selectedId: 'a',
  });
  assert.equal(hotspotMarkerStyle(seen).fresh, true, 'b is newer');
  assert.equal(hotspotMarkerStyle(seen).selected, true);
  const [old] = buildHotspots(stories, categories, {
    newSinceMs: Date.parse('2026-10-29T13:00:00Z'),
    selectedId: 'elsewhere',
  });
  assert.equal(hotspotMarkerStyle(old).fresh, false);
  assert.equal(hotspotMarkerStyle(old).selected, false);
});

test('category and actor filters change counts, and an emptied bubble disappears', () => {
  const stories = [
    story('a', { actorIds: ['rsf'] }),
    story('b', { category: 'aid' }),
    story('c', {
      category: 'aid',
      hotspot: { ...sudan, key: 'region:Darfur', label: 'Darfur' },
    }),
  ];
  const visible = (hidden, actorId) =>
    buildHotspots(
      filterStoriesByActor(
        filterNewsStories(stories, new Set(hidden)),
        actorId,
      ),
      categories,
    ).map((bubble) => [bubble.key, bubble.count]);
  assert.deepEqual(visible([]), [
    ['country:Sudan', 2],
    ['region:Darfur', 1],
  ]);
  assert.deepEqual(visible(['aid']), [['country:Sudan', 1]]);
  assert.deepEqual(visible([], 'rsf'), [['country:Sudan', 1]]);
});

test('the flight radius encloses the bubble’s stories from its position', () => {
  const [bubble] = buildHotspots(
    [
      story('a', { location: { lat: 15.5, lon: 32.5 } }),
      story('b', { location: { lat: 13.63, lon: 25.35 } }),
    ],
    categories,
  );
  const radius = hotspotRadiusM(bubble);
  // Khartoum to El Fasher is about 800 km.
  assert.ok(radius > 750_000 && radius < 850_000, `got ${radius}`);
  const [single] = buildHotspots(
    [story('a', { location: { lat: 15.5, lon: 32.5 } })],
    categories,
  );
  assert.equal(hotspotRadiusM(single), 0);
});
