import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOTSPOT_CARD_NOTE,
  NEWS_BUBBLE_HEIGHT_M,
  NEWS_PIN_HEIGHT_M,
  aggregateHotspots,
  buildHotspotCard,
  hotspotBubbleImage,
  hotspotSizePx,
  hotspotStyle,
  newsMapMode,
} from './hotspots.js';
import { filterNewsStories, filterStoriesByActor } from './records.js';

const categories = [
  { id: 'armed-conflict', label: 'Armed conflict', color: '#ef4444' },
  { id: 'humanitarian', label: 'Humanitarian', color: '#f59e0b' },
  { id: 'rights-justice', label: 'Rights', color: '#a78bfa' },
];
const SUDAN = {
  key: 'country:Sudan',
  label: 'Sudan',
  kind: 'country',
  lat: 15.6,
  lon: 30.0,
};
const DONBAS = {
  key: 'region:Donbas',
  label: 'Donbas',
  kind: 'region',
  lat: 48.5,
  lon: 38.4,
};
const story = (id, hotspot, extra = {}) => ({
  id,
  title: `Story ${id}`,
  category: 'armed-conflict',
  status: 'open',
  kind: 'event',
  location: {
    lat: hotspot.lat,
    lon: hotspot.lon,
    precision: 'city',
    method: 'gazetteer',
  },
  hotspot,
  updatedAt: '2026-10-29T10:00:00Z',
  actorIds: [],
  ...extra,
});
const svg = (url) => decodeURIComponent(url.split(',').slice(1).join(','));

test('mode: bubbles above 3,500 km, pins below 3,000 km, unchanged between', () => {
  assert.equal(NEWS_BUBBLE_HEIGHT_M, 3_500_000);
  assert.equal(NEWS_PIN_HEIGHT_M, 3_000_000);
  assert.equal(newsMapMode(4_000_000, 'pins'), 'bubbles');
  assert.equal(newsMapMode(4_000_000, 'bubbles'), 'bubbles');
  assert.equal(newsMapMode(3_200_000, 'pins'), 'pins');
  assert.equal(newsMapMode(3_200_000, 'bubbles'), 'bubbles');
  assert.equal(newsMapMode(2_800_000, 'bubbles'), 'pins');
  assert.equal(newsMapMode(2_800_000, 'pins'), 'pins');
  // No camera height (a test viewer, a scene not ready): keep the mode.
  assert.equal(newsMapMode(undefined, 'bubbles'), 'bubbles');
  assert.equal(newsMapMode(Number.NaN, 'pins'), 'pins');
});

test('diameter grows with the square root of the story count, 22 to 54 px', () => {
  assert.equal(hotspotSizePx(1), 22);
  assert.equal(hotspotSizePx(4), 30);
  assert.equal(hotspotSizePx(25), 54);
  assert.equal(hotspotSizePx(40), 54);
  assert.equal(hotspotSizePx(0), 22);
});

test('one bubble per hotspot key: count, newest stories first, radius', () => {
  const bubbles = aggregateHotspots(
    [
      story('a', SUDAN, { updatedAt: '2026-10-29T08:00:00Z' }),
      story('b', SUDAN, {
        updatedAt: '2026-10-29T11:00:00Z',
        location: { lat: 13.63, lon: 25.35 },
      }),
      story('c', DONBAS),
      story('d', SUDAN, { updatedAt: '2026-10-29T09:00:00Z' }),
      // No hotspot (a story from an older server): not in any bubble.
      { ...story('e', SUDAN), hotspot: null },
    ],
    { categories },
  );
  assert.deepEqual(
    bubbles.map((bubble) => [bubble.key, bubble.count]),
    [
      ['country:Sudan', 3],
      ['region:Donbas', 1],
    ],
  );
  const [sudan, donbas] = bubbles;
  assert.equal(sudan.label, 'Sudan');
  assert.deepEqual([sudan.lat, sudan.lon], [15.6, 30.0]);
  assert.deepEqual(
    sudan.stories.map((entry) => entry.id),
    ['b', 'd', 'a'],
  );
  // El Fasher is about 520 km from the Sudan bubble.
  assert.ok(
    sudan.radiusM > 500_000 && sudan.radiusM < 560_000,
    String(sudan.radiusM),
  );
  assert.equal(donbas.radiusM, 0);
});

test('the ring splits by category share in the theater’s category order', () => {
  const [bubble] = aggregateHotspots(
    [
      story('a', SUDAN, { category: 'rights-justice' }),
      story('b', SUDAN, { category: 'humanitarian' }),
      story('c', SUDAN, { category: 'humanitarian' }),
      story('d', SUDAN, { category: 'armed-conflict' }),
    ],
    { categories },
  );
  assert.deepEqual(bubble.segments, [
    { category: 'armed-conflict', color: '#ef4444', count: 1 },
    { category: 'humanitarian', color: '#f59e0b', count: 2 },
    { category: 'rights-justice', color: '#a78bfa', count: 1 },
  ]);
  // The largest category colours the card; a tie goes to the earlier one.
  assert.equal(bubble.accent, '#f59e0b');
  const image = svg(hotspotBubbleImage(hotspotStyle(bubble)));
  const strokes = [
    ...image.matchAll(/data-share="([\d.]+)" [^>]*stroke="(#[0-9a-f]+)"/g),
  ].map((match) => [match[2], Number(match[1])]);
  assert.deepEqual(strokes, [
    ['#ef4444', 0.25],
    ['#f59e0b', 0.5],
    ['#a78bfa', 0.25],
  ]);
  const [tied] = aggregateHotspots(
    [
      story('a', SUDAN, { category: 'humanitarian' }),
      story('b', SUDAN, { category: 'armed-conflict' }),
    ],
    { categories },
  );
  assert.equal(tied.accent, '#ef4444');
});

test('the count is drawn into the bubble image, not a Cesium label', () => {
  const [bubble] = aggregateHotspots(
    [story('a', SUDAN), story('b', SUDAN), story('c', SUDAN)],
    { categories },
  );
  const style = hotspotStyle(bubble);
  assert.equal(style.count, 3);
  assert.equal(style.size, hotspotSizePx(3));
  const image = hotspotBubbleImage(style);
  assert.match(image, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.match(svg(image), /<text [^>]*>3<\/text>/);
  // A single category is one full ring.
  assert.equal([...svg(image).matchAll(/data-share=/g)].length, 1);
});

test('new-since dot and selected outline follow the pin rules', () => {
  const stories = [
    story('a', SUDAN, { updatedAt: '2026-10-29T08:00:00Z' }),
    story('b', SUDAN, { updatedAt: '2026-10-29T12:00:00Z' }),
    story('c', DONBAS, { updatedAt: '2026-10-29T08:00:00Z' }),
  ];
  const since = Date.parse('2026-10-29T10:00:00Z');
  const [sudan, donbas] = aggregateHotspots(stories, {
    categories,
    newSinceMs: since,
    selectedId: 'c',
  });
  assert.equal(sudan.fresh, true);
  assert.equal(donbas.fresh, false);
  assert.equal(sudan.selected, false);
  assert.equal(donbas.selected, true);
  assert.match(svg(hotspotBubbleImage(hotspotStyle(sudan))), /data-fresh="1"/);
  assert.doesNotMatch(
    svg(hotspotBubbleImage(hotspotStyle(donbas))),
    /data-fresh/,
  );
  assert.match(
    svg(hotspotBubbleImage(hotspotStyle(donbas))),
    /stroke="#ffffff"/,
  );
  assert.doesNotMatch(
    svg(hotspotBubbleImage(hotspotStyle(sudan))),
    /stroke="#ffffff"/,
  );
  // Nothing is new before a first visit.
  assert.equal(
    aggregateHotspots(stories, { categories, newSinceMs: null })[0].fresh,
    false,
  );
});

test('category and actor filters change counts; an emptied bubble disappears', () => {
  const stories = [
    story('a', SUDAN, { actorIds: ['rsf'] }),
    story('b', SUDAN, { category: 'humanitarian' }),
    story('c', DONBAS),
  ];
  const visible = (hidden, actor) =>
    aggregateHotspots(
      filterStoriesByActor(filterNewsStories(stories, new Set(hidden)), actor),
      { categories },
    ).map((bubble) => [bubble.key, bubble.count]);
  assert.deepEqual(visible([], null), [
    ['country:Sudan', 2],
    ['region:Donbas', 1],
  ]);
  // Equal counts read A to Z.
  assert.deepEqual(visible(['humanitarian'], null), [
    ['region:Donbas', 1],
    ['country:Sudan', 1],
  ]);
  assert.deepEqual(visible(['armed-conflict'], null), [['country:Sudan', 1]]);
  assert.deepEqual(visible([], 'rsf'), [['country:Sudan', 1]]);
});

test('hover card: place and count, three newest titles, the coverage note', () => {
  const [bubble] = aggregateHotspots(
    [
      story('a', SUDAN, { updatedAt: '2026-10-29T08:00:00Z' }),
      story('b', SUDAN, { updatedAt: '2026-10-29T11:00:00Z' }),
      story('c', SUDAN, {
        updatedAt: '2026-10-29T09:00:00Z',
        category: 'humanitarian',
      }),
      story('d', SUDAN, { updatedAt: '2026-10-29T07:00:00Z' }),
    ],
    { categories },
  );
  const position = { x: 1, y: 2, z: 3 };
  const card = buildHotspotCard(bubble, { position });
  assert.equal(card.id, 'hotspot:country:Sudan');
  assert.equal(card.variant, 'card');
  assert.equal(card.position, position);
  assert.equal(card.title, 'Sudan · 4 stories');
  assert.deepEqual(card.details, [
    'Story b',
    'Story c',
    'Story a',
    HOTSPOT_CARD_NOTE,
  ]);
  assert.equal(
    HOTSPOT_CARD_NOTE,
    'Counts stories in the latest digest, not severity. Quiet places may be under-reported.',
  );
  assert.equal(card.accent, '#ef4444');
  assert.equal(card.interactive, true);
  const [one] = aggregateHotspots([story('x', DONBAS)], { categories });
  assert.equal(buildHotspotCard(one, { position }).title, 'Donbas · 1 story');
});
