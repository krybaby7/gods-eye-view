import assert from 'node:assert/strict';
import test from 'node:test';
import { completeRun, getUnresolvedPlaces } from './findings.js';

const search = {
  id: 'sr_1234',
  label: 'Search question',
  runs: [],
  findings: [],
  sources: [],
};
const run = {
  id: 'run_one',
  kind: 'ask',
  model: 'test',
  status: 'ok',
  finishedAt: '2026-11-04T14:03:10Z',
};
const gazetteer = [
  { name: 'Sudan', lat: 16, lon: 30, precision: 'country', country: 'Sudan' },
  { name: 'Khartoum', lat: 15, lon: 33, precision: 'city', country: 'Sudan' },
];
const sources = [
  { id: 's1', url: 'http://www.wire.example/sudan/?utm_source=one' },
  { id: 's2', url: 'https://other.example/khartoum' },
  { id: 's3', url: 'https://another.example/sudan' },
];
const registry = [
  {
    id: 'wire',
    name: 'Wire',
    kind: 'independent',
    perspective: 'international-wire',
    transport: { domain: 'wire.example' },
  },
];
function finding(title, name, fields = {}) {
  return {
    title,
    kind: 'event',
    place: { name, basis: 'happened-here' },
    sourceIds: ['s1'],
    ...fields,
  };
}
function complete(findings, fields = {}) {
  return completeRun({
    search,
    run,
    gazetteer,
    sources,
    registry,
    mapped: { label: 'Sudan news', summary: [], groups: [], findings },
    ...fields,
  });
}

test('only looks up cited unresolved names, in finding order, at most 15', () => {
  const findings = [
    finding('No citation', 'Ignored', { sourceIds: ['invented'] }),
    finding('Known', 'Khartoum, Sudan'),
    finding('First', 'Unknown', { lat: 1, lon: 2 }),
    finding('Repeated', 'unknown'),
    ...Array.from({ length: 15 }, (_, i) =>
      finding('Another', 'Unlisted ' + i),
    ),
  ];
  assert.deepEqual(
    getUnresolvedPlaces({ mapped: { findings }, sources, gazetteer }),
    ['Unknown', ...Array.from({ length: 14 }, (_, i) => 'Unlisted ' + i)],
  );
});

test('derives citation counts, source facts, verification and truthful location', () => {
  const first = complete(
    [
      finding('Located', 'Khartoum', {
        sourceIds: ['s1', 's2', 's1', 'unknown'],
      }),
      finding('No citation', 'Ignored', { sourceIds: ['unknown'] }),
      finding('Two unknowns', 'Model place', {
        sourceIds: ['s2', 's3'],
        lat: 1,
        lon: 2,
      }),
      finding('City is no area', 'Khartoum, Sudan', {
        kind: 'area',
        lat: 15,
        lon: 33,
      }),
      finding('Whole country', 'Sudan', { kind: 'area' }),
      finding('Gazetteer misses', 'Lookup', { lat: 12, lon: 12 }),
    ],
    {
      geocodes: new Map([['Lookup', { lat: 10, lon: 10, precision: 'city' }]]),
    },
  );
  assert.equal(first.label, 'Sudan news');
  assert.equal(first.status, 'ready');
  assert.equal(first.sources[0].canonicalUrl, 'https://wire.example/sudan');
  assert.equal(first.sources[0].publisher, 'Wire');
  assert.equal(first.sources[1].perspective, 'unregistered');
  assert.equal(first.sources[1].kind, 'unknown');
  assert.deepEqual(
    first.findings.map((f) => [f.location?.method, f.verification]),
    [
      ['gazetteer', 'corroborated'],
      ['model', 'reported'],
      [undefined, undefined],
      ['gazetteer', undefined],
      ['nominatim', 'reported'],
    ],
  );
  assert.equal(first.findings[0].hotspot.key, 'country:Sudan');
  assert.deepEqual(first.findings[0].sourceIds, ['s1', 's2']);
  assert.equal(first.findings[0].sourceCount, 2);
  assert.equal(first.runs[0].droppedNoSource, 1);
  assert.equal(first.runs[0].listOnly, 1);
  assert.equal(first.runs[0].agentModel, 'test');
});

test('keeps stored sources and findings stable when an update reuses local citation IDs', () => {
  const first = complete([finding('Original title', 'Khartoum')]);
  const original = structuredClone(first);
  const later = {
    ...run,
    kind: 'update',
    id: 'run_two',
    finishedAt: '2026-11-06T14:03:10Z',
  };
  const second = completeRun({
    search: { ...first, label: 'My title', labelEdited: true },
    run: later,
    gazetteer,
    registry,
    sources: [
      { ...sources[1], id: 's1' },
      { ...sources[0], id: 's2' },
    ],
    mapped: {
      label: 'Changed label',
      summary: [
        { text: 'Valid', sourceIds: ['s1', 's2'] },
        { text: 'Unsupported', sourceIds: ['s3'] },
      ],
      groups: [],
      findings: [
        finding('Edited title', 'Another place', {
          sameAs: first.findings[0].id,
        }),
        finding('New finding', 'Khartoum'),
      ],
    },
  });
  assert.deepEqual(first, original);
  assert.equal(second.label, 'My title');
  assert.deepEqual(second.findings[0], {
    ...first.findings[0],
    lastSeenAt: later.finishedAt,
  });
  assert.equal(second.runs[1].findingIds[0], first.findings[0].id);
  assert.equal(second.runs[1].droppedNoSource, 1);
  assert.deepEqual(second.runs[1].answer.summary, [
    { text: 'Valid', sourceIds: ['s2', 's1'] },
  ]);
  assert.deepEqual(second.findings[1].sourceIds, ['s2']);
  assert.equal(
    complete([], {
      search: { ...search, label: 'My title', labelEdited: true },
    }).label,
    'My title',
  );
});

test('allocates deterministic four-digit finding IDs when hashes collide', () => {
  const candidates = [
    finding('Identical title', 'Sudan'),
    finding('Identical title', 'Sudan'),
  ];
  const ids = complete(candidates).findings.map(({ id }) => id);
  assert.equal(new Set(ids).size, 2);
  assert.ok(ids.every((id) => /^f_[0-9a-f]{4}$/.test(id)));
  assert.deepEqual(
    complete(candidates).findings.map(({ id }) => id),
    ids,
  );
});

test('publisher groups prevent similar registered outlets from corroborating one another', () => {
  const secondPublisher = {
    id: 'other',
    name: 'Other',
    homepage: 'https://www.other.example/',
    kind: 'independent',
    perspective: 'international-public',
  };
  const result = complete(
    [finding('Multiple reports', 'Sudan', { sourceIds: ['s1', 's2'] })],
    {
      registry: {
        sources: [...registry, secondPublisher],
        perspectives: [
          { id: 'international-wire', group: 'international' },
          { id: 'international-public', group: 'international' },
        ],
      },
    },
  );
  assert.equal(result.sources[1].registeredSourceId, 'other');
  assert.equal(result.findings[0].verification, 'reported');
});

test('area geocodes need a named country or region', () => {
  const result = complete(
    [
      finding('Recognized region', 'New Region', { kind: 'area' }),
      finding('Unrelated country', 'Small City', { kind: 'area' }),
    ],
    {
      geocodes: new Map([
        [
          'New Region',
          { lat: 23, lon: 20, precision: 'region', name: 'New Region' },
        ],
        [
          'Small City',
          { lat: 42, lon: 40, precision: 'country', name: 'Nearby Country' },
        ],
      ]),
    },
  );
  assert.equal(result.findings[0].location?.precision, 'region');
  assert.equal(result.findings[1].location, null);
});
