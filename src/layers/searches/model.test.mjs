import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSearchMarkers, searchMarkerImage } from './model.js';
import { normalizeSearchSnapshot, SEARCH_COLORS } from './records.js';

const point = { lat: 12, lon: 34, name: 'A place' };
const finding = {
  id: 'f_0123',
  title: 'Lithium mine',
  kind: 'place',
  location: point,
  groupId: 'g1',
  mergeKey: 'shared',
  sourceCount: 2,
  sourceIds: ['s1'],
};
const search = {
  id: 'sr_0123',
  visible: true,
  colorIndex: 0,
  findings: [finding],
};
const svg = (options) =>
  decodeURIComponent(searchMarkerImage(options).split(',')[1]);

test('marker shape, equal colour splits, dashed outline and new dot are encoded in the image', () => {
  for (const [kind, path] of [
    ['event', '<circle'],
    ['statement', '<rect'],
    ['place', '<path'],
    ['area', '<circle'],
  ]) {
    const result = svg({
      kind,
      colors: SEARCH_COLORS.slice(0, 2),
      size: 22,
      dashed: true,
      fresh: true,
    });
    assert.match(result, new RegExp(`data-kind="${kind}"`));
    assert.ok(result.includes(path));
    assert.match(result, /stroke-dasharray="3 2.5"/);
    assert.match(result, /data-fresh="1"/);
    for (const color of SEARCH_COLORS.slice(0, 2))
      assert.ok(result.includes(color));
  }
  assert.match(
    svg({ kind: 'area', colors: [SEARCH_COLORS[0]], size: 22 }),
    /fill="none"/,
  );
});

test('visible merged members render one marker and hiding or filtering one keeps the other', () => {
  const second = {
    ...search,
    id: 'sr_5678',
    colorIndex: 1,
    findings: [{ ...finding, fresh: true }],
  };
  let markers = buildSearchMarkers(
    normalizeSearchSnapshot({ searches: [search, second] }).searches,
  );
  assert.equal(markers.length, 1);
  assert.deepEqual(markers[0].colors, SEARCH_COLORS.slice(0, 2));
  assert.equal(markers[0].fresh, true);
  markers = buildSearchMarkers(
    normalizeSearchSnapshot({ searches: [search, second] }).searches,
    { sr_5678: 'g2' },
  );
  assert.deepEqual(markers[0].colors, [SEARCH_COLORS[0]]);
  markers = buildSearchMarkers(
    normalizeSearchSnapshot({
      searches: [{ ...search, visible: false }, second],
    }).searches,
  );
  assert.deepEqual(markers[0].colors, [SEARCH_COLORS[1]]);
});

test('normalization keeps list-only results and rejects malformed coordinates and unsafe links', () => {
  const result = normalizeSearchSnapshot({
    searches: [
      {
        ...search,
        colorIndex: 999,
        findings: [{ ...finding, location: { lat: 99, lon: 34 } }],
        sources: [
          { id: 's1', url: 'javascript:alert(1)' },
          { id: 's2', url: 'https://example.org/a' },
        ],
      },
    ],
  });
  assert.equal(result.searches[0].findings[0].location, null);
  assert.equal(result.searches[0].sources.length, 1);
  assert.equal(result.searches[0].sources[0].id, 's2');
  assert.ok(SEARCH_COLORS.includes(result.searches[0].color));
  assert.equal(normalizeSearchSnapshot({ revision: '1' }), null);
});

test('all eight colour segments intersect the filled marker', () => {
  const result = svg({ kind: 'event', colors: SEARCH_COLORS, size: 22 });
  assert.match(result, /id="part0"><rect x="4"/);
  assert.match(result, /id="part7"><rect x="21.5"/);
});
