import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { normalizeLayerLoading } from '../../loadingFeedback.js';
import { createNewsLayer } from './index.js';
import { normalizeNewsSnapshot } from './records.js';

const categories = [
  { id: 'war-military', label: 'War & military', color: '#ef4444' },
  { id: 'humanitarian-casualties', label: 'Humanitarian', color: '#f59e0b' },
];
const story = (id, overrides = {}) => ({
  id,
  title: `Story ${id}`,
  summary: 'Summary.',
  category: 'war-military',
  place: { name: 'Bandar Abbas' },
  location: {
    lat: 27.18,
    lon: 56.27,
    precision: 'city',
    method: 'gazetteer',
    name: 'Bandar Abbas',
  },
  eventAt: '2026-10-26T03:00:00Z',
  firstSeenAt: '2026-10-26T10:00:00Z',
  updatedAt: '2026-10-26T11:00:00Z',
  itemIds: ['i1'],
  claims: [],
  whatsNew: '',
  contradictions: [],
  status: 'open',
  perspectives: ['us-mil'],
  verification: 'reported',
  sourceCount: 3,
  ...overrides,
});
const payload = (overrides = {}) => ({
  revision: 'r1',
  retrievedAt: '2026-10-26T12:00:00Z',
  theater: {
    id: 'iran-israel-us',
    name: 'Iran · Israel · US',
    categories,
    perspectives: [],
  },
  theaters: [{ id: 'iran-israel-us', name: 'Iran · Israel · US' }],
  items: [
    {
      id: 'i1',
      sourceId: 'centcom',
      title: 'Item',
      folder: 'official',
      kind: 'state',
      perspective: 'us-mil',
      url: 'https://centcom.mil/x',
      collectedAt: '2026-10-26T10:00:00Z',
    },
  ],
  citations: [],
  stories: [
    story('a'),
    story('b', {
      category: 'humanitarian-casualties',
      verification: 'participant-claim',
      location: {
        lat: 31.35,
        lon: 34.3,
        precision: 'approximate',
        method: 'model',
        name: 'Somewhere',
      },
    }),
    story('c', { location: null, place: null }),
    story('d', { status: 'closed' }),
  ],
  lastRun: null,
  lastDigest: {
    id: 'run_1',
    status: 'ok',
    finishedAt: '2026-10-26T11:00:00Z',
    costUsd: 0.18,
  },
  sources: [
    {
      id: 'centcom',
      name: 'US Central Command',
      folder: 'official',
      health: { ok: true },
    },
    {
      id: 'mee',
      name: 'Middle East Eye',
      folder: 'reporting',
      health: { ok: false, blocked: true, degraded: true },
    },
  ],
  budget: {
    dailyUsd: 2,
    spentTodayUsd: 0.18,
    remainingUsd: 1.82,
    exhausted: false,
    lastRunCostUsd: 0.18,
  },
  digest: {
    provider: 'Perplexity Agent API',
    model: 'anthropic/claude-sonnet-5-5',
    keyConfigured: true,
    running: false,
    disabledReason: null,
    undigestedCount: 4,
  },
  ...overrides,
});

function harness({
  source,
  cameraPosition = Cesium.Cartesian3.fromDegrees(50, 28, 2e7),
} = {}) {
  const added = [];
  const overlay = [];
  const actions = new Map();
  const focus = [];
  const contexts = new Map();
  let selectedContext = null;
  let picked = null;
  let preRender = null;
  const viewer = {
    dataSources: {
      add: (value) => added.push(value),
      remove: (value) => added.splice(added.indexOf(value), 1),
    },
    camera: { positionWC: cameraPosition },
    scene: {
      pick: () => picked,
      requestRender() {},
      preRender: {
        addEventListener(fn) {
          preRender = fn;
          return () => (preRender = null);
        },
      },
    },
  };
  const layer = createNewsLayer({
    source: source ?? {
      getSnapshot: async () => normalizeNewsSnapshot(payload()),
      requestDigest: async () => ({ ok: true }),
    },
    overlayHost: {
      setEntries: (...args) => overlay.push(args),
      setVisible() {},
      clearSource: (id) => overlay.push([id, []]),
      hitTest: () => null,
    },
    services: {
      context: {
        // Like the real store: the entity carries its context id, and only
        // a registered id can be selected.
        registerEntityContext: (entity, meta) => {
          entity.__gevContextId = meta.id;
          contexts.set(meta.id, meta);
        },
        removeEntityContextsForLayer: (layerId, { retainIds }) => {
          for (const id of [...contexts.keys()])
            if (!retainIds.has(id)) contexts.delete(id);
          if (selectedContext && !contexts.has(selectedContext))
            selectedContext = null;
        },
        selectEntityContext: (entity) => {
          const id = entity?.__gevContextId;
          if (!id || !contexts.has(id)) return null;
          selectedContext = id;
          return contexts.get(id);
        },
        clearSelectedEntityContextForLayer: (layerId) => {
          if (selectedContext?.startsWith(`${layerId}:`))
            selectedContext = null;
        },
      },
      picking: {
        registerPickOwner() {},
        unregisterPickOwner() {},
        resolvePickId: () => null,
        isOwnedByOtherLayer: () => false,
      },
      focus: { requestWorldFocus: (detail) => focus.push(detail) },
    },
    screenSpaceEventHandlerFactory: () => ({
      setInputAction: (fn, type) => actions.set(type, fn),
      destroy: () => actions.clear(),
    }),
  });
  layer.init(viewer);
  layer.enable(viewer);
  return {
    layer,
    viewer,
    added,
    overlay,
    actions,
    focus,
    contexts,
    selectedContext: () => selectedContext,
    pick: (value) => (picked = value),
    runPreRender: () => preRender?.(),
    lastCards: () => overlay.at(-1)?.[1] ?? [],
  };
}

test('one pin per located open story; list-only stories are counted, never drawn', async () => {
  const h = harness();
  assert.equal(await h.layer.update(), true);
  assert.deepEqual(h.layer._testing.pinIds(), ['a', 'b']);
  const stats = h.layer.getStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.storyCount, 3);
  assert.equal(stats.listOnly, 1);
  assert.equal(stats.itemCount, 1);
  assert.equal(stats.degradedSources, 1);
  assert.equal(stats.digestKeyRequired, false);
  assert.match(stats.loadingLabel, /^3 stories · 1 items$/);
  assert.match(
    stats.summary,
    /^3 stories \(1 list-only\) · digest \d+[mhd] ago · 1 source degraded · budget \$1\.82 left$/,
  );
  assert.deepEqual([...h.contexts.keys()], ['news:a', 'news:b']);
  assert.equal(h.contexts.get('news:a').layerId, 'news');
});

test('a development gets no pin and no flight, even when it names a place', async () => {
  const withTalks = payload();
  withTalks.stories.push(
    story('talks', { kind: 'development', actorIds: ['oman', 7] }),
  );
  const h = harness({
    source: {
      getSnapshot: async () => normalizeNewsSnapshot(withTalks),
      requestDigest: async () => ({ ok: true }),
    },
  });
  await h.layer.update();
  assert.deepEqual(h.layer._testing.pinIds(), ['a', 'b']);
  const talks = h.layer.getSnapshot().stories.find((s) => s.id === 'talks');
  assert.deepEqual([talks.kind, talks.actorIds], ['development', ['oman']]);
  assert.equal(
    h.layer.getSnapshot().stories.find((s) => s.id === 'a').kind,
    'event',
    'a story from before kinds existed reads as an event',
  );
  const stats = h.layer.getStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.listOnly, 2);
  assert.equal(h.layer.selectStory('talks'), true);
  assert.equal(h.focus.length, 0);
  assert.ok(!h.contexts.has('news:talks'));
});

test('a missing digest key is not a load failure: the feed still loads', async () => {
  const keyless = payload();
  keyless.digest = { ...keyless.digest, keyConfigured: false };
  const h = harness({
    source: {
      getSnapshot: async () => normalizeNewsSnapshot(keyless),
      requestDigest: async () => ({ ok: true }),
    },
  });
  assert.equal(await h.layer.update(), true);
  const stats = h.layer.getStats();
  assert.equal(stats.digestKeyRequired, true);
  assert.notEqual(stats.keyRequired, true);
  assert.match(stats.loadingLabel, /digest needs key$/);
  assert.match(stats.summary, /digest needs key$/);
  // The global loading status reads stats.keyRequired as a failed layer.
  const record = normalizeLayerLoading({
    id: 'news',
    name: 'War Monitor',
    enabled: true,
    lifecycleState: 'enabled',
    stats: { ...stats, refreshing: true },
  });
  assert.equal(record.keyRequired, false);
  assert.equal(record.error, null);
});

test('a poll replaced by a forced reload is not a refresh failure', async () => {
  const pending = [];
  const h = harness({
    source: {
      getSnapshot: ({ signal }) =>
        new Promise((resolve, reject) => {
          pending.push(resolve);
          signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
      requestDigest: async () => ({ ok: true }),
    },
  });
  const poll = h.layer.update();
  const forced = h.layer.refresh();
  pending[1](normalizeNewsSnapshot(payload()));
  assert.equal(await poll, true, 'the layer reloaded; the poll is not failed');
  assert.equal(await forced, true);
  assert.deepEqual(h.layer._testing.pinIds(), ['a', 'b']);
});

test('markers: colour by category, ring for participant claims, dashes when model-placed', async () => {
  const h = harness();
  await h.layer.update();
  const [source] = h.added;
  const image = (id) =>
    decodeURIComponent(
      source.entities.getById(`news:${id}`).billboard.image.getValue(),
    );
  assert.match(image('a'), /fill="#ef4444" fill-opacity="0.9"/);
  assert.doesNotMatch(image('a'), /stroke-dasharray/);
  assert.match(
    image('b'),
    /fill="#f59e0b" fill-opacity="0.18" stroke="#f59e0b" stroke-width="3"/,
  );
  assert.match(image('b'), /stroke-dasharray/);
});

test('category filter hides pins and stories together and round-trips as a param', async () => {
  const h = harness();
  await h.layer.update();
  assert.equal(
    h.layer.setParams({ hiddenCategories: 'humanitarian-casualties' }),
    true,
  );
  assert.deepEqual(h.layer._testing.pinIds(), ['a']);
  assert.deepEqual(h.layer.getParams(), {
    hiddenCategories: 'humanitarian-casualties',
  });
  assert.deepEqual(
    h.layer.getSnapshot().visibleStories.map((s) => s.id),
    ['a', 'c', 'd'],
  );
  const chips = h.layer.getRowControls().chips;
  assert.deepEqual(
    chips.map((chip) => [chip.id, chip.active]),
    [
      ['category-war-military', true],
      ['category-humanitarian-casualties', false],
    ],
  );
  assert.deepEqual(chips[1].params, { hiddenCategories: '' });
  assert.deepEqual(chips[0].params, {
    hiddenCategories: 'humanitarian-casualties,war-military',
  });
  const adopted = [];
  h.layer.attachDataManager({
    adoptLayerParams: (...args) => adopted.push(args),
  });
  h.layer.setCategoryFilter(['humanitarian-casualties']);
  assert.deepEqual(h.layer._testing.pinIds(), ['b']);
  assert.deepEqual(adopted, [
    ['news', { hiddenCategories: 'war-military' }, { origin: 'user' }],
  ]);
  h.layer.toggleCategory('war-military');
  assert.deepEqual(h.layer._testing.pinIds(), ['a', 'b']);
});

test('clicking a pin selects it, shows its card and asks the UI for one flight', async () => {
  const h = harness();
  await h.layer.update();
  const [source] = h.added;
  const reasons = [];
  h.layer.subscribe((snapshot, reason) =>
    reasons.push([reason, snapshot.selectedStoryId]),
  );
  h.pick({ id: source.entities.getById('news:a') });
  h.actions.get(Cesium.ScreenSpaceEventType.LEFT_CLICK)({
    position: { x: 1, y: 1 },
  });
  assert.equal(h.layer.getSnapshot().selectedStoryId, 'a');
  assert.deepEqual(reasons.at(-1), ['select', 'a']);
  assert.equal(h.focus.length, 1);
  assert.equal(h.focus[0].kind, 'story');
  assert.equal(h.focus[0].id, 'news:a');
  const [card] = h.lastCards();
  assert.equal(card.variant, 'selected');
  assert.equal(card.title, 'Story a');
  assert.deepEqual(card.details, ['War & military · 3 sources', 'Reported']);
  // A list-only story selects without a flight.
  h.layer.selectStory('c');
  assert.equal(h.focus.length, 1);
  // Empty space clears the selection.
  h.pick(null);
  h.actions.get(Cesium.ScreenSpaceEventType.LEFT_CLICK)({
    position: { x: 1, y: 1 },
  });
  assert.equal(h.layer.getSnapshot().selectedStoryId, null);
});

test('the shared selection follows the story: pin to pin, list-only, cleared, re-enabled', async () => {
  const h = harness();
  await h.layer.update();
  const click = (id) => {
    const [source] = h.added;
    h.pick(id ? { id: source.entities.getById(`news:${id}`) } : null);
    h.actions.get(Cesium.ScreenSpaceEventType.LEFT_CLICK)({
      position: { x: 1, y: 1 },
    });
  };
  click('a');
  assert.equal(h.selectedContext(), 'news:a');
  click(null);
  assert.equal(h.selectedContext(), null);
  // Pins rebuilt on deselect stay registered, so the next pick publishes.
  click('b');
  assert.equal(h.selectedContext(), 'news:b');
  // A list-only story has no pin: the previous pin is no longer selected.
  h.layer.selectStory('c');
  assert.equal(h.layer.getSnapshot().selectedStoryId, 'c');
  assert.equal(h.selectedContext(), null);
  h.layer.selectStory('a');
  assert.equal(h.selectedContext(), 'news:a');
  // Disabling drops the selection; re-enabling does not restore a card
  // without its context.
  h.layer.disable();
  h.layer.enable(h.viewer);
  assert.equal(h.layer.getSnapshot().selectedStoryId, null);
  assert.equal(
    h.lastCards().some((card) => card.variant === 'selected'),
    false,
  );
});

test('hovering a pin shows its card with category, sources and verification', async () => {
  const h = harness();
  await h.layer.update();
  const [source] = h.added;
  h.pick({ id: source.entities.getById('news:b') });
  h.actions.get(Cesium.ScreenSpaceEventType.MOUSE_MOVE)({
    endPosition: { x: 2, y: 2 },
  });
  const [card] = h.lastCards();
  assert.equal(card.variant, 'card');
  assert.deepEqual(card.details, [
    'Humanitarian · 3 sources',
    'Participant claim · model-placed',
  ]);
});

test('pins on the far side of the globe are hidden', async () => {
  const h = harness({
    cameraPosition: Cesium.Cartesian3.fromDegrees(-130, -28, 2e7),
  });
  await h.layer.update();
  const [source] = h.added;
  const shown = source.entities.getById('news:a').billboard.show.getValue();
  assert.equal(shown, false);
});

test('an unchanged revision keeps the snapshot; late refreshes cannot publish after disable', async () => {
  const calls = [];
  let resolve;
  const h = harness({
    source: {
      async getSnapshot(options) {
        calls.push(options);
        if (calls.length === 1) return normalizeNewsSnapshot(payload());
        if (calls.length === 2) return { unchanged: true, revision: 'r1' };
        return new Promise((done) => (resolve = done));
      },
      requestDigest: async () => ({ ok: true }),
    },
  });
  await h.layer.update();
  await h.layer.update();
  assert.equal(calls[1].rev, 'r1');
  assert.deepEqual(h.layer._testing.pinIds(), ['a', 'b']);
  const pending = h.layer.update();
  h.layer.disable();
  assert.equal(calls[2].signal.aborted, true);
  resolve(normalizeNewsSnapshot(payload({ stories: [] })));
  assert.equal(await pending, false);
  assert.equal(h.layer.getStats().storyCount, 3);
  assert.equal(await h.layer.update(), false, 'disabled layers do not fetch');
});

test('Refresh runs one digest, reloads the snapshot and reports the outcome', async () => {
  const calls = [];
  let digest = 0;
  const h = harness({
    source: {
      async getSnapshot(options) {
        calls.push(options);
        return normalizeNewsSnapshot(payload({ revision: `r${calls.length}` }));
      },
      async requestDigest() {
        digest++;
        return {
          ok: true,
          run: {
            storiesCreated: 2,
            storiesUpdated: 1,
            itemCount: 40,
            unassignedCount: 9,
            costUsd: 0.18,
          },
        };
      },
    },
  });
  await h.layer.update();
  const reasons = [];
  h.layer.subscribe((snapshot, reason) =>
    reasons.push([reason, snapshot.digest.running]),
  );
  const outcome = await h.layer.requestDigest();
  assert.equal(digest, 1);
  assert.equal(calls.at(-1).rev, undefined, 'the reload is forced');
  assert.deepEqual(reasons[0], ['digest', true]);
  assert.deepEqual(reasons.at(-1), ['digest', false]);
  assert.equal(
    outcome.summary,
    "Digest done: 2 new and 1 updated stories from 40 items, 9 left unassigned. Cost 18¢. $1.82 of today's $2.00 budget left.",
  );
  assert.equal(h.layer.getSnapshot().digest.outcome.summary, outcome.summary);
});

test('a missing key, a refusal or a network failure become readable outcomes', async () => {
  const outcomes = [
    { ok: false, keyRequired: true, error: 'no_key' },
    {
      ok: false,
      status: 429,
      error: 'over_budget',
      message: "Today's digests cost $2.10 of the $2.00 daily budget",
    },
    { ok: true, skipped: true, message: 'Nothing new since the last digest' },
    {
      ok: false,
      error: 'truncated',
      message: 'the digest hit the 64,000-token output limit before finishing',
      run: { costUsd: 0.34 },
    },
  ];
  const h = harness({
    source: {
      getSnapshot: async () => normalizeNewsSnapshot(payload()),
      async requestDigest() {
        const next = outcomes.shift();
        if (!next) throw new Error('offline');
        return next;
      },
    },
  });
  await h.layer.update();
  assert.match((await h.layer.requestDigest()).summary, /PERPLEXITY_API_KEY/);
  assert.match(
    (await h.layer.requestDigest()).summary,
    /\$2\.10 of the \$2\.00 daily budget\. Refresh is off until tomorrow\./,
  );
  assert.match(
    (await h.layer.requestDigest()).summary,
    /no model call was made/,
  );
  assert.equal(
    (await h.layer.requestDigest()).summary,
    'The digest hit its output limit before finishing, so no stories changed. It cost 34¢.',
  );
  assert.match(
    (await h.layer.requestDigest()).summary,
    /^The digest failed \(network: offline\)/,
  );
});

test('analyst records cover visible open stories, located or not', async () => {
  const h = harness();
  await h.layer.update();
  const records = h.layer.getAnalystRecords();
  assert.deepEqual(
    records.map((r) => r.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(records[1], {
    id: 'b',
    title: 'Story b',
    category: 'humanitarian-casualties',
    perspectives: 'us-mil',
    verification: 'participant-claim',
    sourceCount: 3,
    place: 'Bandar Abbas',
    lat: 31.35,
    lon: 34.3,
    modelPlaced: true,
    kind: 'event',
    status: 'open',
    eventAt: Date.parse('2026-10-26T03:00:00Z'),
    updatedAt: Date.parse('2026-10-26T11:00:00Z'),
    summary: 'Summary.',
  });
  assert.equal(records[2].lat, null);
  h.layer.disable();
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('destroy releases the data source, cards and context records', async () => {
  const h = harness();
  await h.layer.update();
  h.layer.destroy();
  assert.equal(h.added.length, 0);
  assert.equal(h.contexts.size, 0);
  assert.deepEqual(h.overlay.at(-1), ['news', []]);
});

/** The standard payload with actors on its stories and one story newer. */
function briefPayload() {
  const withActors = payload();
  withActors.theater.actors = [
    { id: 'iran', name: 'Iran', type: 'state', role: 'party', aliases: [] },
    { id: 'oman', name: 'Oman', type: 'state', role: 'mediator', aliases: [] },
  ];
  const tags = { a: ['iran'], b: ['iran', 'oman'], c: ['oman'], d: [] };
  for (const entry of withActors.stories) entry.actorIds = tags[entry.id];
  withActors.stories[0].updatedAt = '2026-10-26T11:30:00Z';
  return withActors;
}

function briefHarness(extra = {}) {
  return harness({
    source: {
      getSnapshot: async () => normalizeNewsSnapshot(briefPayload()),
      requestDigest: async () => ({ ok: true }),
      ...extra,
    },
  });
}

test('the actor filter combines with category toggles and is never a share param', async () => {
  const h = briefHarness();
  await h.layer.update();
  const reasons = [];
  h.layer.subscribe((snapshot, reason) => reasons.push(reason));
  h.layer.setActorFilter('oman');
  assert.deepEqual(h.layer._testing.pinIds(), ['b']);
  assert.deepEqual(
    h.layer.getSnapshot().visibleStories.map((s) => s.id),
    ['b', 'c'],
  );
  assert.equal(h.layer.getSnapshot().actorFilter, 'oman');
  assert.deepEqual(reasons, ['filter']);
  h.layer.toggleCategory('humanitarian-casualties');
  assert.deepEqual(h.layer._testing.pinIds(), []);
  assert.deepEqual(
    h.layer.getSnapshot().visibleStories.map((s) => s.id),
    ['c'],
  );
  assert.deepEqual(h.layer.getParams(), {
    hiddenCategories: 'humanitarian-casualties',
  });
  assert.equal(h.layer.getStats().visibleStoryCount, 1);
  h.layer.setActorFilter(null);
  assert.deepEqual(h.layer._testing.pinIds(), ['a']);
  h.layer.toggleCategory('humanitarian-casualties');
  assert.deepEqual(h.layer._testing.pinIds(), ['a', 'b']);
  // An actor the theater does not list filters nothing.
  h.layer.setActorFilter('hamas');
  assert.equal(h.layer.getSnapshot().actorFilter, null);
});

test('stories updated after the last-seen digest get a quiet pin marker', async () => {
  const h = briefHarness();
  await h.layer.update();
  const [source] = h.added;
  const image = (id) =>
    decodeURIComponent(
      source.entities.getById(`news:${id}`).billboard.image.getValue(),
    );
  assert.doesNotMatch(image('a'), /data-fresh/);
  h.layer.setNewSince(Date.parse('2026-10-26T11:00:00Z'));
  assert.equal(
    h.layer.getSnapshot().newSinceMs,
    Date.parse('2026-10-26T11:00:00Z'),
  );
  assert.match(image('a'), /data-fresh/, 'updated 11:30, after 11:00');
  assert.doesNotMatch(image('b'), /data-fresh/, 'updated at 11:00 exactly');
  // The marker is its own mark, not the participant-claim ring.
  assert.match(image('b'), /stroke-width="3"/);
  h.layer.setNewSince(null);
  assert.doesNotMatch(image('a'), /data-fresh/);
});

test('Frame theater asks for one flight over every visible pin', async () => {
  const h = briefHarness();
  await h.layer.update();
  assert.equal(h.layer.frameTheater(), true);
  assert.equal(h.focus.length, 1);
  const [request] = h.focus;
  assert.equal(request.kind, 'theater');
  assert.equal(request.id, 'news-theater:iran-israel-us');
  // Pins a (27.18, 56.27) and b (31.35, 34.3): the sphere reaches both.
  const centre = Cesium.Cartographic.fromCartesian(request.position);
  assert.ok(Math.abs(Cesium.Math.toDegrees(centre.latitude) - 29.265) < 0.01);
  assert.ok(Math.abs(Cesium.Math.toDegrees(centre.longitude) - 45.285) < 0.01);
  assert.ok(request.radiusM > 1_000_000 && request.radiusM < 1_200_000);
  h.layer.setActorFilter('oman');
  h.layer.toggleCategory('humanitarian-casualties');
  assert.equal(h.layer.frameTheater(), false, 'no pin, no flight');
  assert.equal(h.focus.length, 1);
});

test('Retry brief runs one brief, reloads and reports; it never overlaps a digest', async () => {
  let briefs = 0;
  let release;
  const h = briefHarness({
    requestDigest: () => new Promise((resolve) => (release = resolve)),
    async requestBrief() {
      briefs++;
      return { ok: true, briefRun: { status: 'ok', costUsd: 0.11 } };
    },
  });
  await h.layer.update();
  const outcome = await h.layer.requestBrief();
  assert.equal(briefs, 1);
  assert.equal(outcome.summary, 'Brief written, 11¢.');
  assert.equal(h.layer.getSnapshot().digest.outcome.summary, outcome.summary);
  const digest = h.layer.requestDigest();
  assert.equal(h.layer.getSnapshot().digest.running, true);
  assert.equal((await h.layer.requestBrief()).error, 'in_flight');
  assert.equal(briefs, 1);
  release({ ok: true, run: {} });
  await digest;
});
