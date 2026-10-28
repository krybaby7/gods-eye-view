import assert from 'node:assert/strict';
import test from 'node:test';
import { newsCoverage, sourceHealthReason } from './coverage.js';

const NOW = Date.parse('2026-10-28T14:00:00Z');
const hoursAgo = (hours) => new Date(NOW - hours * 3600_000).toISOString();
const perspectives = [
  { id: 'iran-state', label: 'Iran state' },
  { id: 'houthi', label: 'Houthi' },
  { id: 'international-wire', label: 'International wire' },
  { id: 'un', label: 'UN' },
];
const source = (id, perspective, health = {}) => ({
  id,
  name: id.toUpperCase(),
  perspective,
  health: { ok: true, degraded: false, ...health },
});
const sources = [
  source('irna', 'iran-state'),
  source('tasnim', 'iran-state', { ok: false, blocked: true, degraded: true }),
  source('almasirah', 'houthi', {
    ok: false,
    degraded: true,
    error: 'preview markup not found',
  }),
  source('reuters', 'international-wire'),
  source('ochaopt', 'un', { disabled: true, linkOnly: true }),
];
const item = (sourceId, perspective, hours) => ({
  id: `${sourceId}-${hours}`,
  sourceId,
  perspective,
  publishedAt: hoursAgo(hours),
  collectedAt: hoursAgo(hours),
});

test('health reasons read like the degraded-source list', () => {
  assert.equal(sourceHealthReason({ blocked: true }), 'blocked');
  assert.equal(sourceHealthReason({ rateLimited: true }), 'rate limited');
  assert.equal(
    sourceHealthReason({
      stale: true,
      quiet: true,
      newestItemAt: '2026-10-20T08:00:00Z',
    }),
    'nothing new since 2026-10-20',
  );
  assert.equal(sourceHealthReason({ stale: true }), 'stale');
  assert.equal(sourceHealthReason({ error: 'HTTP 500' }), 'HTTP 500');
  assert.equal(sourceHealthReason({}), 'failing');
});

test('coverage groups down sources by perspective and names silent perspectives', () => {
  const coverage = newsCoverage({
    sources,
    perspectives,
    items: [
      item('irna', 'iran-state', 30),
      item('reuters', 'international-wire', 2),
    ],
    stories: [
      { id: 'a', status: 'open', location: { lat: 1, lon: 1 } },
      { id: 'b', status: 'open', location: null },
      { id: 'c', status: 'closed', location: null },
    ],
    nowMs: NOW,
  });
  assert.deepEqual(coverage.down, [
    {
      perspective: 'iran-state',
      label: 'Iran state',
      sources: [{ id: 'tasnim', name: 'TASNIM', reason: 'blocked' }],
    },
    {
      perspective: 'houthi',
      label: 'Houthi',
      sources: [
        {
          id: 'almasirah',
          name: 'ALMASIRAH',
          reason: 'preview markup not found',
        },
      ],
    },
  ]);
  // Iran state's only item is 30 h old; Houthi has none. UN has only a
  // link-only source, so its silence says nothing and is not listed.
  assert.deepEqual(
    coverage.silent.map((entry) => entry.label),
    ['Iran state', 'Houthi'],
  );
  assert.equal(coverage.unlocated, 1);
  assert.equal(
    coverage.summary,
    'Coverage: 2 sources down · 2 perspectives with no items in 24 h · 1 open story without a location',
  );
  assert.deepEqual(coverage.details, [
    'Iran state down: TASNIM (blocked)',
    'Houthi down: ALMASIRAH (preview markup not found)',
    'No Iran state items in 24 h',
    'No Houthi items in 24 h',
    '1 open story without a location',
  ]);
});

test('quiet is not calm: a full house still says what it checked', () => {
  const coverage = newsCoverage({
    sources: [source('reuters', 'international-wire')],
    perspectives,
    items: [item('reuters', 'international-wire', 1)],
    stories: [],
    nowMs: NOW,
  });
  assert.deepEqual(coverage.down, []);
  assert.deepEqual(coverage.silent, []);
  assert.equal(
    coverage.summary,
    'Coverage: every watched source answering; every watched perspective has items from the last 24 h',
  );
  assert.deepEqual(coverage.details, []);
});

test('one silent perspective is named in the summary; missing data is tolerated', () => {
  const coverage = newsCoverage({
    sources: [source('irna', 'iran-state'), source('reuters', 'unlisted')],
    perspectives,
    items: [item('reuters', 'unlisted', 1), { id: 'x', publishedAt: 'bad' }],
    stories: null,
    nowMs: NOW,
  });
  assert.equal(coverage.summary, 'Coverage: no Iran state items in 24 h');
  assert.deepEqual(newsCoverage({ nowMs: NOW }).details, []);
});
