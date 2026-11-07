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
      geocodes: new Map([
        ['Lookup', { lat: 10, lon: 10, precision: 'city', name: 'Lookup' }],
      ]),
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

const mineGazetteer = [
  ...gazetteer,
  { name: 'Australia', lat: -24, lon: 134, precision: 'country' },
  { name: 'Western Australia', lat: -27, lon: 121, precision: 'region' },
  { name: 'Antofagasta', lat: -23.6, lon: -70.4, precision: 'city' },
  {
    name: 'Washington, D.C.',
    aliases: ['Washington DC', 'District of Columbia'],
    lat: 38.9,
    lon: -77,
    precision: 'city',
  },
  { name: 'Netherlands', lat: 52, lon: 5, precision: 'country' },
];

test('queues full site names when the gazetteer only knows their qualifiers', () => {
  const findings = [
    finding('Lithium mine', 'Greenbushes, Western Australia', {
      kind: 'place',
    }),
    finding('Salt flat', 'Salar de Atacama, Antofagasta Region, Chile', {
      kind: 'place',
    }),
    finding('Capital', 'Washington, D.C., United States'),
    finding('Capital alias', 'District of Columbia (United States)'),
    finding('Capital with alias punctuation', 'Washington DC, United States'),
    finding('Capital in Sudan', 'Khartoum, Sudan'),
    finding('Country', 'the Netherlands'),
    finding('Country alone', 'Australia'),
  ];
  assert.deepEqual(
    getUnresolvedPlaces({
      mapped: { findings },
      sources,
      gazetteer: mineGazetteer,
    }),
    [
      'Greenbushes, Western Australia',
      'Salar de Atacama, Antofagasta Region, Chile',
    ],
  );
  assert.deepEqual(
    complete(findings, { gazetteer: mineGazetteer }).findings.map(
      (item) => item.location?.name,
    ),
    [
      undefined,
      undefined,
      'Washington, D.C.',
      'Washington, D.C.',
      'Washington, D.C.',
      'Khartoum',
      'Netherlands',
      'Australia',
    ],
  );
});

test('uses the geocoded subject or falls back without using an unrelated qualifier', () => {
  const findings = [
    finding('Greenbushes Lithium Mine', 'Greenbushes, Western Australia', {
      kind: 'place',
    }),
    finding(
      'Salar de Atacama lithium extraction',
      'Salar de Atacama, Antofagasta Region, Chile',
      { kind: 'place', lat: -23.5, lon: -68 },
    ),
    finding('Unknown deposit', 'Unknown Deposit, Western Australia', {
      kind: 'place',
    }),
    finding('Town', 'Ravensthorpe, Western Australia', { kind: 'place' }),
    finding('Grota do Cirilo lithium mine', 'Grota do Cirilo, Minas Gerais', {
      kind: 'place',
    }),
    finding('Australian mine', 'Bald Hill, Western Australia', {
      kind: 'place',
    }),
  ];
  const geocodes = new Map([
    [
      'Greenbushes, Western Australia',
      { name: 'Greenbushes Lithium Mine', lat: -33.86, lon: 116.06 },
    ],
    [
      'Salar de Atacama, Antofagasta Region, Chile',
      { name: 'Antofagasta', lat: -23.6, lon: -70.4, precision: 'city' },
    ],
    [
      'Unknown Deposit, Western Australia',
      { name: 'Western Australia', lat: -27, lon: 121, precision: 'region' },
    ],
    [
      'Ravensthorpe, Western Australia',
      { name: 'Ravensthorpe', lat: -33.58, lon: 120.05, precision: 'city' },
    ],
    [
      'Grota do Cirilo, Minas Gerais',
      { name: 'Grota do Cirilo (lithium mine)', lat: -16.53, lon: -41.98 },
    ],
    [
      'Bald Hill, Western Australia',
      { name: 'Bald Hill Road', lat: -32, lon: 116 },
    ],
  ]);
  assert.deepEqual(
    complete(findings, { gazetteer: mineGazetteer, geocodes }).findings.map(
      (item) => [item.location?.method, item.location?.lat],
    ),
    [
      ['nominatim', -33.86],
      ['model', -23.5],
      [undefined, undefined],
      ['nominatim', -33.58],
      ['nominatim', -16.53],
      [undefined, undefined],
    ],
  );
});
