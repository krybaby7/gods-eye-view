import assert from 'node:assert/strict';
import test from 'node:test';
import { decorateSearchSnapshots } from './dedupe.js';

function layer(id, title, fields, url = 'https://example.org/' + id) {
  return {
    id,
    label: 'Layer ' + id,
    sources: [{ id: 's1', url }],
    findings: [
      { id: 'f_1234', kind: 'event', title, sourceIds: ['s1'], ...fields },
    ],
  };
}

test('merges nearby crypto events by canonical URL and links war monitor without merging it', () => {
  const a = layer(
    'a',
    'Exchange hack in London',
    { location: { lat: 51.5, lon: 0 } },
    'https://www.example.org/crypto?utm_campaign=abc',
  );
  const b = layer(
    'b',
    'Exchange drained',
    { location: { lat: 51.94, lon: 0 } },
    'http://example.org/crypto#report',
  );
  const c = layer(
    'c',
    'A different report',
    { location: { lat: 52, lon: 0 } },
    'https://example.org/crypto',
  );
  const warStories = [
    {
      id: 'war',
      title: 'Cross-link',
      theaterId: 'world',
      urls: ['https://example.org/crypto/'],
    },
  ];
  const [one, two] = decorateSearchSnapshots([a, b], { warStories });
  assert.deepEqual(one.findings[0].alsoIn, [
    { searchId: 'b', label: 'Layer b' },
  ]);
  assert.deepEqual(one.findings[0].warMonitor, [
    { id: 'war', title: 'Cross-link', theaterId: 'world' },
  ]);
  assert.equal(one.findings[0].mergeKey, two.findings[0].mergeKey);
  assert.equal(
    decorateSearchSnapshots([b, a])[0].findings[0].mergeKey,
    one.findings[0].mergeKey,
  );
  assert.deepEqual(decorateSearchSnapshots([a, c])[0].findings[0].alsoIn, []);
  assert.equal(a.findings[0].mergeKey, undefined);
});

test('matches Sudan events at Jaccard 0.6, within one day, in the same hotspot', () => {
  const hotspot = { key: 'country:Sudan' };
  const a = layer('a', 'Sudan ceasefire talks resume', {
    hotspot,
    eventAt: '2026-11-04T09:00:00Z',
  });
  const b = layer('b', 'Sudan ceasefire talks stall', {
    hotspot,
    eventAt: '2026-11-05T09:00:00Z',
  });
  assert.equal(decorateSearchSnapshots([a, b])[0].findings[0].alsoIn.length, 1);
  const c = layer('c', 'Sudan ceasefire talks resume', {
    hotspot,
    eventAt: '2026-11-05T09:00:01Z',
  });
  assert.equal(decorateSearchSnapshots([a, c])[0].findings[0].alsoIn.length, 0);
});

test('matches lithium mines by normalized names within 25 km', () => {
  const a = layer('a', 'Mine', {
    kind: 'place',
    place: { name: 'Salar de Atacáma' },
    location: { lat: -23.5, lon: -68 },
  });
  const near = layer('b', 'Lithium facility', {
    kind: 'place',
    place: { name: 'Salar de Atacama' },
    location: { lat: -23.28, lon: -68 },
  });
  const far = layer('c', 'Lithium facility', {
    kind: 'place',
    place: { name: 'Salar de Atacama' },
    location: { lat: -23.27, lon: -68 },
  });
  assert.equal(
    decorateSearchSnapshots([a, near])[0].findings[0].alsoIn.length,
    1,
  );
  assert.equal(
    decorateSearchSnapshots([a, far])[0].findings[0].alsoIn.length,
    0,
  );
});
