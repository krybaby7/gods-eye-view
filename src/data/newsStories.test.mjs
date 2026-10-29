import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CORROBORATING_KINDS,
  FAR_MATCH_KM,
  assignIds,
  closeStaleStories,
  deriveClaimStatuses,
  derivePerspectives,
  deriveVerification,
  mergeDigest,
  resolveLocation,
  sourceCount,
  storyByItem,
  unassignedItems,
} from '../../server/providers/news/digest/stories.js';

const groups = new Map([
  ['international-wire', 'international'],
  ['international-regional', 'international'],
  ['israel-mil', 'israel'],
  ['israel-dissent', 'israel'],
  ['us-mil', 'us'],
  ['iran-state', 'iran'],
  ['un', 'un'],
  ['verification', 'verification'],
  ['analysis-western', 'analysis'],
]);
let serial = 0;
const item = (kind, perspective, overrides = {}) => ({
  id: overrides.id ?? `i${++serial}`,
  sourceId: overrides.sourceId ?? `${perspective}-${kind}`,
  kind,
  perspective,
  primarySource: null,
  ...overrides,
});
const verify = (items, contradictions = []) =>
  deriveVerification(items, { contradictions, perspectiveGroups: groups });

test('participant-claim: every cited item is a participant or a state outlet', () => {
  assert.equal(verify([item('state', 'us-mil')]), 'participant-claim');
  assert.equal(
    verify([
      item('state', 'us-mil'),
      item('state', 'iran-state'),
      item('participant', 'iran-state'),
    ]),
    'participant-claim',
  );
});

test('reported: a lone independent item, or several from one perspective group', () => {
  assert.equal(verify([item('independent', 'international-wire')]), 'reported');
  assert.equal(
    verify([
      item('independent', 'international-wire'),
      item('independent', 'international-regional'),
    ]),
    'reported',
  );
  assert.equal(
    verify([item('analysis', 'analysis-western'), item('state', 'us-mil')]),
    'reported',
  );
  assert.equal(verify([]), 'reported');
});

test('corroborated: two perspective groups, one corroborating kind, no shared primary source', () => {
  for (const kind of CORROBORATING_KINDS)
    assert.equal(
      verify([item(kind, 'un'), item('state', 'us-mil')]),
      'corroborated',
      kind,
    );
  assert.equal(
    verify([
      item('independent', 'international-wire'),
      item('independent', 'israel-dissent'),
    ]),
    'corroborated',
  );
});

test('a state outlet paired with a participant never corroborates, however many groups', () => {
  assert.equal(
    verify([
      item('state', 'us-mil'),
      item('participant', 'iran-state'),
      item('analysis', 'analysis-western'),
    ]),
    'reported',
  );
});

test('items repeating one primary source count once toward corroboration', () => {
  const statement = {
    kind: 'statement',
    issuer: 'US Central Command',
    url: 'https://www.centcom.mil/x',
  };
  assert.equal(
    verify([
      item('state', 'us-mil', { primarySource: statement }),
      item('independent', 'international-wire', {
        primarySource: { ...statement, url: 'https://centcom.mil/x/' },
      }),
    ]),
    'reported',
  );
  // Without a URL, the issuer identifies the shared statement.
  const unlinked = { kind: 'statement', issuer: 'IDF', url: null };
  assert.equal(
    verify([
      item('state', 'israel-mil', { primarySource: unlinked }),
      item('independent', 'international-wire', {
        primarySource: { ...unlinked, issuer: 'idf' },
      }),
    ]),
    'reported',
  );
  // A third, independent item without that shared source restores corroboration.
  assert.equal(
    verify([
      item('state', 'us-mil', { primarySource: statement }),
      item('independent', 'international-wire', { primarySource: statement }),
      item('humanitarian', 'un'),
    ]),
    'corroborated',
  );
  // Two different releases from the same issuer are still one source.
  assert.equal(
    verify([
      item('state', 'us-mil', { primarySource: statement }),
      item('independent', 'international-wire', {
        primarySource: {
          ...statement,
          url: 'https://www.centcom.mil/y',
        },
      }),
    ]),
    'reported',
  );
});

test('distinct primary sources from different groups corroborate', () => {
  assert.equal(
    verify([
      item('state', 'us-mil', {
        primarySource: {
          kind: 'statement',
          issuer: 'US Central Command',
          url: 'https://www.centcom.mil/x',
        },
      }),
      item('independent', 'international-wire', {
        primarySource: {
          kind: 'statement',
          issuer: 'IRNA',
          url: 'https://en.irna.ir/news/1',
        },
      }),
    ]),
    'corroborated',
  );
});

test('disputed: contradictions without corroboration; corroboration wins over contradictions', () => {
  const contradictions = ['IRNA says a warehouse; CENTCOM says a drone site.'];
  assert.equal(
    verify(
      [item('state', 'us-mil'), item('state', 'iran-state')],
      contradictions,
    ),
    'disputed',
  );
  assert.equal(
    verify([item('independent', 'international-wire')], contradictions),
    'disputed',
  );
  assert.equal(
    verify(
      [item('independent', 'international-wire'), item('state', 'iran-state')],
      contradictions,
    ),
    'corroborated',
  );
  assert.equal(verify([item('state', 'us-mil')], ['   ']), 'participant-claim');
});

test('unknown perspectives form their own group', () => {
  assert.equal(
    deriveVerification(
      [item('independent', 'mystery'), item('state', 'us-mil')],
      {
        contradictions: [],
        perspectiveGroups: new Map(),
      },
    ),
    'corroborated',
  );
});

test('claim status uses only the claim items and defaults to the story label', () => {
  const byId = new Map(
    [
      item('independent', 'international-wire', { id: 'w' }),
      item('state', 'iran-state', { id: 'irna' }),
      item('state', 'us-mil', { id: 'cc' }),
    ].map((i) => [i.id, i]),
  );
  const claims = deriveClaimStatuses(
    [
      {
        text: 'A strike hit the port',
        actor: null,
        type: 'occurrence',
        itemIds: ['w', 'irna'],
      },
      {
        text: 'CENTCOM conducted it',
        actor: 'US',
        type: 'attribution',
        itemIds: ['cc'],
      },
      { text: 'Three killed', actor: null, type: 'casualty', itemIds: [] },
      { text: 'Unknown ids', actor: null, type: 'other', itemIds: ['gone'] },
    ],
    byId,
    { storyLabel: 'reported', perspectiveGroups: groups },
  );
  assert.deepEqual(
    claims.map((claim) => claim.status),
    ['corroborated', 'participant-claim', 'reported', 'reported'],
  );
});

test('perspectives and source count come from the cited items', () => {
  const items = [
    item('state', 'us-mil', { sourceId: 'centcom' }),
    item('state', 'us-mil', { sourceId: 'centcom' }),
    item('independent', 'international-wire', { sourceId: 'reuters' }),
    item('humanitarian', 'un', { sourceId: 'reliefweb' }),
  ];
  assert.deepEqual(derivePerspectives(items), [
    'international-wire',
    'un',
    'us-mil',
  ]);
  assert.equal(sourceCount(items), 3);
  assert.equal(sourceCount([]), 0);
});

const gazetteer = [
  {
    name: 'Bandar Abbas',
    lat: 27.1832,
    lon: 56.2666,
    precision: 'city',
    aliases: ['بندرعباس'],
  },
];

test('location: gazetteer first, model coordinates only without a gazetteer match', () => {
  assert.deepEqual(
    resolveLocation({ placeName: 'بندرعباس', lat: 27.2, lon: 56.3 }, gazetteer),
    {
      lat: 27.1832,
      lon: 56.2666,
      precision: 'city',
      method: 'gazetteer',
      name: 'Bandar Abbas',
    },
  );
  assert.deepEqual(
    resolveLocation(
      { placeName: 'Some village', lat: 30.5, lon: 50.25 },
      gazetteer,
    ),
    {
      lat: 30.5,
      lon: 50.25,
      precision: 'approximate',
      method: 'model',
      name: 'Some village',
    },
  );
  assert.equal(
    resolveLocation(
      { placeName: 'Some village', lat: null, lon: null },
      gazetteer,
    ),
    null,
  );
  assert.equal(
    resolveLocation({ placeName: null, lat: 91, lon: 0 }, gazetteer),
    null,
  );
  assert.equal(
    resolveLocation({ placeName: null, lat: 0, lon: null }, gazetteer),
    null,
  );
  assert.equal(
    resolveLocation({ placeName: null, lat: null, lon: null }, gazetteer),
    null,
  );
});

test('far match: a gazetteer row over 500 km from the model coordinates is not trusted', () => {
  assert.equal(FAR_MATCH_KM, 500);
  // Only Toledo, Ohio is a row; the story is about Toledo, Spain.
  const ohio = [
    { name: 'Toledo', lat: 41.67, lon: -83.58, precision: 'city', aliases: [] },
  ];
  assert.deepEqual(
    resolveLocation({ placeName: 'Toledo', lat: 39.86, lon: -4.02 }, ohio),
    {
      lat: 39.86,
      lon: -4.02,
      precision: 'approximate',
      method: 'model',
      name: 'Toledo',
      farMatch: true,
    },
  );
  // Within 500 km the row wins; without model coordinates it always does.
  assert.equal(
    resolveLocation({ placeName: 'Toledo', lat: 41.0, lon: -84.5 }, ohio)
      .method,
    'gazetteer',
  );
  assert.equal(
    resolveLocation({ placeName: 'Toledo', lat: null, lon: null }, ohio).method,
    'gazetteer',
  );
});

test('ids: open ids continue, new stories get deterministic st_ ids that never collide', () => {
  const stories = [
    { id: 'st_keep', itemIds: ['a'] },
    { id: null, itemIds: ['b'] },
    { id: null, itemIds: ['c'] },
  ];
  const first = assignIds(stories, {
    runId: 'run_1',
    existingIds: new Set(['st_keep']),
  });
  assert.equal(first[0].id, 'st_keep');
  assert.match(first[1].id, /^st_[0-9a-f]{8}$/);
  assert.notEqual(first[1].id, first[2].id);
  assert.deepEqual(
    assignIds(stories, { runId: 'run_1', existingIds: new Set(['st_keep']) }),
    first,
  );
  // A minted id already in use is skipped.
  const taken = new Set(['st_keep', first[1].id]);
  const again = assignIds([{ id: null, itemIds: ['b'] }], {
    runId: 'run_1',
    existingIds: taken,
  });
  assert.notEqual(again[0].id, first[1].id);
  assert.equal(stories[1].id, null, 'input is not mutated');
});

test('item bookkeeping: story by item and unassigned items', () => {
  const stories = [
    { id: 'st_a', itemIds: ['1', '2'] },
    { id: 'st_b', itemIds: ['3'] },
  ];
  assert.deepEqual(
    [...storyByItem(stories)],
    [
      ['1', 'st_a'],
      ['2', 'st_a'],
      ['3', 'st_b'],
    ],
  );
  assert.deepEqual(unassignedItems(['1', '3', '4', '5'], stories), ['4', '5']);
});

test('stale open stories close after 48 h; the open count is capped, oldest first', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const story = (id, hoursAgo, status = 'open') => ({
    id,
    status,
    updatedAt: new Date(now - hoursAgo * 3600_000).toISOString(),
  });
  const result = closeStaleStories(
    [
      story('fresh', 1),
      story('mid', 20),
      story('stale', 49),
      story('done', 1, 'closed'),
    ],
    now,
    { cap: 1 },
  );
  assert.deepEqual(
    result.map((s) => [s.id, s.status, s.closedReason ?? null]),
    [
      ['fresh', 'open', null],
      ['mid', 'closed', 'cap'],
      ['stale', 'closed', 'age'],
      ['done', 'closed', null],
    ],
  );
});

test('mergeDigest updates open stories in place and computes every code-owned field', () => {
  const nowIso = '2026-10-26T12:00:00.000Z';
  const itemsById = new Map(
    [
      item('state', 'iran-state', { id: 'irna1', sourceId: 'irna' }),
      item('state', 'us-mil', { id: 'cc1', sourceId: 'centcom' }),
      item('independent', 'international-wire', {
        id: 'wire1',
        sourceId: 'reuters',
      }),
      item('humanitarian', 'un', { id: 'ocha1', sourceId: 'reliefweb' }),
    ].map((i) => [i.id, i]),
  );
  const previous = [
    {
      id: 'st_old',
      theater: 'fixture',
      title: 'Old title',
      category: 'war-military',
      itemIds: ['irna1'],
      claims: [],
      status: 'open',
      firstSeenAt: '2026-10-25T00:00:00.000Z',
      updatedAt: '2026-10-25T00:00:00.000Z',
    },
    {
      id: 'st_untouched',
      theater: 'fixture',
      itemIds: ['x'],
      status: 'open',
      firstSeenAt: '2026-10-25T00:00:00.000Z',
      updatedAt: '2026-10-26T06:00:00.000Z',
    },
  ];
  const validated = [
    {
      id: 'st_old',
      title: 'Strike reported at Bandar Abbas port',
      summary: 'IRNA reported a strike; CENTCOM said it hit drone storage.',
      category: 'war-military',
      placeName: 'Bandar Abbas',
      lat: null,
      lon: null,
      eventAt: '2026-10-26T03:00:00.000Z',
      itemIds: ['cc1', 'wire1'],
      claims: [
        {
          text: 'CENTCOM conducted it',
          actor: 'US',
          type: 'attribution',
          itemIds: ['cc1'],
        },
      ],
      whatsNew: 'CENTCOM confirmed.',
      contradictions: [],
      status: 'open',
      kind: 'event',
      actorIds: ['united-states', 'iran'],
    },
    {
      id: null,
      title: 'Aid convoy reported stopped near Khan Younis',
      summary: 'OCHA reported a convoy was stopped.',
      category: 'humanitarian-casualties',
      placeName: 'Nowhere listed',
      lat: null,
      lon: null,
      eventAt: null,
      itemIds: ['ocha1'],
      claims: [],
      whatsNew: '',
      contradictions: [],
      status: 'open',
    },
  ];
  const { stories, touched } = mergeDigest({
    previous,
    validated,
    itemsById,
    theaterId: 'fixture',
    gazetteer,
    perspectiveGroups: groups,
    runId: 'run_9',
    nowIso,
  });
  assert.equal(touched.length, 2);
  const updated = stories.find((s) => s.id === 'st_old');
  // The old citation is kept because no other story claimed it.
  assert.deepEqual(updated.itemIds, ['cc1', 'wire1', 'irna1']);
  assert.equal(updated.firstSeenAt, '2026-10-25T00:00:00.000Z');
  assert.equal(updated.updatedAt, nowIso);
  assert.equal(updated.digestRunId, 'run_9');
  assert.equal(updated.place.name, 'Bandar Abbas');
  assert.equal(updated.location.method, 'gazetteer');
  assert.deepEqual(updated.perspectives, [
    'international-wire',
    'iran-state',
    'us-mil',
  ]);
  assert.equal(updated.sourceCount, 3);
  assert.equal(updated.verification, 'corroborated');
  assert.equal(updated.claims[0].status, 'participant-claim');
  const created = stories.find((s) => s.title.startsWith('Aid convoy'));
  assert.match(created.id, /^st_/);
  assert.equal(created.theater, 'fixture');
  assert.equal(created.firstSeenAt, nowIso);
  assert.equal(created.location, null, 'unknown place stays list-only');
  assert.deepEqual(created.place, { name: 'Nowhere listed' });
  assert.equal(created.verification, 'reported');
  // kind and actorIds pass through; a story without them reads as an event.
  assert.deepEqual(
    [updated.kind, updated.actorIds],
    ['event', ['united-states', 'iran']],
  );
  assert.deepEqual([created.kind, created.actorIds], ['event', []]);
  assert.equal(
    stories.find((s) => s.id === 'st_untouched').updatedAt,
    '2026-10-26T06:00:00.000Z',
  );
});

test('mergeDigest moves a citation when the model reassigns it to another story', () => {
  const itemsById = new Map([
    ['a', item('independent', 'international-wire', { id: 'a' })],
    ['b', item('independent', 'international-wire', { id: 'b' })],
  ]);
  const previous = [
    {
      id: 'st_1',
      itemIds: ['a', 'b'],
      status: 'open',
      updatedAt: '2026-10-26T00:00:00Z',
      firstSeenAt: '2026-10-26T00:00:00Z',
    },
  ];
  const { stories } = mergeDigest({
    previous,
    validated: [
      {
        id: null,
        title: 'Split',
        summary: '',
        category: 'war-military',
        placeName: null,
        lat: null,
        lon: null,
        eventAt: null,
        itemIds: ['b'],
        claims: [],
        whatsNew: '',
        contradictions: [],
        status: 'open',
      },
    ],
    itemsById,
    theaterId: 'fixture',
    gazetteer,
    perspectiveGroups: groups,
    runId: 'run_2',
    nowIso: '2026-10-26T12:00:00.000Z',
  });
  assert.deepEqual(stories.find((s) => s.id === 'st_1').itemIds, ['a']);
  assert.deepEqual(stories.find((s) => s.title === 'Split').itemIds, ['b']);
});
