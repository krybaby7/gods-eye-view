import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createNewsLayer } from '../layers/news/index.js';
import { normalizeNewsSnapshot } from '../layers/news/records.js';
import { createSituationPanel } from './situationPanel.js';
import { BRIEF_EXPANDED_KEY, lastSeenKey } from './situationBriefModel.js';
import {
  createFakeDocument,
  createFakeStorage,
} from '../testSupport/fakeDocument.mjs';

const NOW = Date.parse('2026-10-28T14:00:00Z');
const at = (time) => `2026-10-28T${time}:00.000Z`;
const place = (name, lat, lon) => ({
  lat,
  lon,
  precision: 'city',
  method: 'gazetteer',
  name,
});
const story = (id, overrides = {}) => ({
  id,
  title: `Story ${id}`,
  summary: 'Summary.',
  category: 'war-military',
  place: { name: 'Bandar Abbas' },
  location: place('Bandar Abbas', 27.18, 56.27),
  eventAt: at('10:00'),
  firstSeenAt: at('10:00'),
  updatedAt: at('13:00'),
  itemIds: [`i-${id}`],
  claims: [],
  whatsNew: '',
  contradictions: [],
  status: 'open',
  perspectives: ['international-wire'],
  verification: 'reported',
  sourceCount: 2,
  kind: 'event',
  actorIds: [],
  ...overrides,
});
const line = (text, storyIds) => ({ text, storyIds });
const BRIEF = {
  id: 'br_1',
  theater: 'iran-israel-us',
  digestRunId: 'run_2',
  createdAt: at('13:02'),
  headline: line('Strikes and talks continue in parallel.', ['st_a', 'st_c']),
  changes: [
    line('A strike was reported at the port.', ['st_a', 'st_b']),
    line('Talks resumed in Muscat.', ['st_c']),
  ],
  trigger: line('The port strike prompted new talks, officials said.', [
    'st_a',
  ]),
  tracks: [
    {
      id: 'military',
      state: 'escalating',
      reason: 'Strikes reported.',
      storyIds: ['st_a'],
    },
    {
      id: 'diplomatic',
      state: 'shifting',
      reason: 'Talks resumed.',
      storyIds: ['st_c'],
    },
  ],
  affected: [line('An aid convoy was halted, the UN said.', ['st_b'])],
  scenarios: [
    {
      title: 'Talks continue',
      horizon: 'weeks',
      text: 'Delegations meet again.',
      storyIds: ['st_c'],
      signposts: [
        { text: 'Envoys meet', seenIn: ['st_c'] },
        { text: 'A date is set', seenIn: [] },
      ],
    },
    {
      title: 'Strikes resume',
      horizon: 'days',
      text: 'Talks pause.',
      storyIds: ['st_a'],
      signposts: [],
    },
  ],
  unknowns: [line('Damage at the port is unconfirmed.', ['st_d'])],
  actorRoles: [
    {
      actorId: 'oman',
      role: 'mediator',
      ...line('Oman hosted the talks.', ['st_c']),
    },
  ],
};

function payload(overrides = {}) {
  return {
    revision: 'r1',
    retrievedAt: at('14:00'),
    theater: {
      id: 'iran-israel-us',
      name: 'Iran · Israel · US',
      categories: [
        { id: 'war-military', label: 'War & military', color: '#ef4444' },
        {
          id: 'humanitarian-casualties',
          label: 'Humanitarian',
          color: '#f59e0b',
        },
        { id: 'political-diplomatic', label: 'Political', color: '#60a5fa' },
      ],
      perspectives: [
        { id: 'international-wire', label: 'International wire' },
        { id: 'iran-state', label: 'Iran state' },
      ],
      actors: [
        { id: 'iran', name: 'Iran', type: 'state', role: 'party' },
        {
          id: 'united-states',
          name: 'United States',
          type: 'state',
          role: 'party',
        },
        // Set from the stories: external at first, a mediator since 13:02.
        {
          id: 'oman',
          name: 'Oman',
          type: 'state',
          role: 'mediator',
          startingRole: 'external',
          changedFrom: 'external',
          roleSince: at('13:02'),
          roleStoryIds: ['st_c'],
        },
        {
          id: 'civilians-gaza',
          name: 'Civilians in Gaza',
          type: 'population',
          role: 'affected',
        },
      ],
      drivers: [
        {
          text: 'A long-running dispute.',
          source: { name: 'CFR', url: 'https://www.cfr.org/x' },
        },
      ],
      tracks: [
        { id: 'military', label: 'Military' },
        { id: 'diplomatic', label: 'Diplomatic' },
        { id: 'humanitarian', label: 'Humanitarian' },
      ],
    },
    theaters: [{ id: 'iran-israel-us', name: 'Iran · Israel · US' }],
    items: [
      {
        id: 'i-st_a',
        sourceId: 'reuters',
        title: 'Item',
        folder: 'reporting',
        kind: 'independent',
        perspective: 'international-wire',
        publishedAt: at('12:00'),
        collectedAt: at('12:05'),
      },
    ],
    citations: [],
    stories: [
      story('st_a', {
        updatedAt: at('13:30'),
        actorIds: ['iran', 'united-states'],
      }),
      story('st_b', {
        category: 'humanitarian-casualties',
        location: place('Khan Younis', 31.35, 34.3),
        actorIds: ['civilians-gaza', 'oman'],
      }),
      story('st_c', {
        category: 'political-diplomatic',
        kind: 'development',
        location: place('Muscat', 23.59, 58.38),
        actorIds: ['iran', 'oman'],
      }),
      story('st_d', { location: null, place: null, updatedAt: at('12:00') }),
    ],
    lastRun: { id: 'run_2', status: 'ok', finishedAt: at('13:30') },
    lastDigest: { id: 'run_2', status: 'ok', finishedAt: at('13:30') },
    brief: BRIEF,
    briefRun: { id: 'run_3', kind: 'brief', status: 'ok', costUsd: 0.12 },
    briefStatus: { digestsBehind: 0, retryable: false },
    sources: [
      {
        id: 'reuters',
        name: 'Reuters',
        folder: 'reporting',
        perspective: 'international-wire',
        health: { ok: true },
      },
      {
        id: 'tasnim',
        name: 'Tasnim',
        folder: 'official',
        perspective: 'iran-state',
        health: { ok: false, blocked: true, degraded: true },
      },
    ],
    budget: { dailyUsd: 2, remainingUsd: 1.5, lastRunCostUsd: 0.3 },
    digest: { keyConfigured: true, running: false, disabledReason: null },
    ...overrides,
  };
}

function newsLayer(snapshot, source = {}) {
  const focus = [];
  const viewer = {
    dataSources: { add() {}, remove() {} },
    camera: { positionWC: Cesium.Cartesian3.fromDegrees(50, 28, 2e7) },
    scene: {
      pick: () => null,
      requestRender() {},
      preRender: { addEventListener: () => () => {} },
    },
  };
  const layer = createNewsLayer({
    source: {
      getSnapshot: async () => normalizeNewsSnapshot(snapshot),
      requestDigest: async () => ({ ok: true }),
      ...source,
    },
    overlayHost: {
      setEntries() {},
      setVisible() {},
      clearSource() {},
      hitTest: () => null,
    },
    services: { focus: { requestWorldFocus: (detail) => focus.push(detail) } },
    screenSpaceEventHandlerFactory: () => ({
      setInputAction() {},
      destroy() {},
    }),
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, focus, viewer };
}

async function mount({
  snapshot = payload(),
  storage = createFakeStorage(),
  source,
  MutationObserverImpl = null,
} = {}) {
  const document = createFakeDocument();
  const panel = document.createElement('section');
  panel.setAttribute('id', 'situation-panel');
  const count = document.createElement('span');
  count.setAttribute('id', 'situation-panel-count');
  const container = document.createElement('div');
  panel.append(count, container);
  document.body.append(panel);
  const { layer, focus } = newsLayer(snapshot, source);
  await layer.update();
  const view = createSituationPanel({
    container,
    layer,
    now: () => NOW,
    storage,
    setIntervalImpl: () => 1,
    clearIntervalImpl() {},
    MutationObserverImpl,
  });
  const $ = (selector) => view.root.querySelector(selector);
  const $$ = (selector) => view.root.querySelectorAll(selector);
  const rows = () =>
    $$('.situation-story').map((row) => ({
      id: row.dataset.storyId,
      cited: row.classList.contains('situation-story-cited'),
      fresh: Boolean(row.querySelector('.situation-marker-fresh')),
    }));
  return { document, panel, layer, focus, view, storage, $, $$, rows };
}

const text = (node) => node?.textContent ?? null;

test('collapsed by default: headline, changes, tracks, coverage and the AI label; the rest waits', async () => {
  const { $, $$ } = await mount();
  const section = $('.situation-brief');
  assert.ok(section, 'the brief sits in the panel');
  assert.equal(
    text($('.situation-brief-headline')),
    'Strikes and talks continue in parallel.',
  );
  assert.deepEqual(
    $$('.situation-brief-lines')[0]
      .querySelectorAll('.situation-brief-line')
      .map(text),
    ['A strike was reported at the port.', 'Talks resumed in Muscat.'],
  );
  assert.deepEqual(
    $$('.situation-track').map((badge) => [
      badge.getAttribute('aria-label'),
      badge.getAttribute('data-state'),
      badge.disabled,
    ]),
    [
      ['Military: escalating', 'escalating', false],
      ['Diplomatic: shifting', 'shifting', false],
      ['Humanitarian: no cited reading', 'none', true],
    ],
  );
  assert.equal(
    text($('.situation-brief-coverage')),
    'Coverage: 1 source down · no Iran state items in 24 h · 1 open story without a location',
  );
  assert.match(
    text($('.situation-brief-meta')),
    /^AI analysis · \d\d:\d\d · cites 4 stories$/,
  );
  const more = $('[id="situation-brief-more"]');
  assert.equal(more.hidden, true);
  assert.equal(more.childNodes.length, 0);
  const toggle = $('.situation-brief-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), 'situation-brief-more');
  // The brief comes before the category chips and the tabs.
  const order = section.parentNode.children.map((node) => node.className);
  assert.ok(
    order.indexOf('situation-brief') < order.indexOf('situation-chips'),
  );
  assert.ok(
    order.indexOf('situation-controls') < order.indexOf('situation-brief'),
  );
});

test('Show more adds actors, why now, the affected, scenarios and unknowns, and is remembered', async () => {
  const storage = createFakeStorage();
  const { $, $$, view } = await mount({ storage });
  $('.situation-brief-toggle').click();
  assert.equal(
    $('.situation-brief-toggle').getAttribute('aria-expanded'),
    'true',
  );
  assert.equal(storage.getItem(BRIEF_EXPANDED_KEY), '1');
  const more = $('[id="situation-brief-more"]');
  assert.equal(more.hidden, false);
  assert.deepEqual(more.querySelectorAll('.situation-subhead').map(text), [
    'Who is involved',
    'Why now',
    'Who is affected',
    'What could happen next',
    'What we know poorly',
  ]);
  assert.deepEqual(
    $$('.situation-actor-group').map((group) => [
      text(group.querySelector('.situation-actor-role')),
      group
        .querySelectorAll('.situation-actor')
        .map((chip) => chip.getAttribute('data-actor-id')),
    ]),
    [
      ['Parties', ['iran', 'united-states']],
      ['Mediators', ['oman']],
      ['Affected', ['civilians-gaza']],
    ],
  );
  // Chips carry a type and a count, never a colour of their own; the title
  // says where the role comes from.
  const iran = $('[data-actor-id="iran"]');
  assert.equal(text(iran), 'Iranstate2');
  assert.equal(iran.getAttribute('style'), null);
  assert.match(iran.title, /Party: starting role from the theater file\.$/);
  assert.match(
    $('[data-actor-id="oman"]').title,
    /Mediator since \d\d:\d\d, on 1 corroborated story\.$/,
  );
  // Role changes list who moved and when; each opens its evidence.
  const change = $('[data-focus-key="role-change-oman"]');
  assert.match(text(change), /^Oman: external → mediator · \d\d:\d\d$/);
  assert.equal(change.getAttribute('data-story-ids'), 'st_c');
  assert.equal(
    text($('[data-focus-key="trigger"]')),
    'The port strike prompted new talks, officials said.',
  );
  const driver = $('.situation-drivers').querySelector('a');
  assert.equal(driver.getAttribute('href'), 'https://www.cfr.org/x');
  assert.equal(driver.getAttribute('rel'), 'noopener noreferrer');
  assert.match(text($('.situation-drivers')), /curated \(not AI\)/);
  const cards = $$('.situation-scenario');
  assert.deepEqual(
    cards.map((card) => text(card.querySelector('.situation-scenario-head'))),
    ['Talks continuewithin weeks', 'Strikes resumewithin days'],
  );
  const signposts = cards[0].querySelectorAll('li').map(text);
  assert.deepEqual(signposts, [
    '✓ seen Envoys meet',
    'not yet seen A date is set',
  ]);
  assert.deepEqual(
    $('.situation-track-reasons')
      .querySelectorAll('.situation-brief-line')
      .map(text),
    ['Military: Strikes reported.', 'Diplomatic: Talks resumed.'],
  );
  assert.deepEqual(
    $('.situation-brief-coverage-details').querySelectorAll('li').map(text),
    [
      'Iran state down: Tasnim (blocked)',
      'No Iran state items in 24 h',
      '1 open story without a location',
    ],
  );
  view.destroy();
  // A new mount restores the viewer's choice.
  const again = await mount({ storage });
  assert.equal(
    again.$('.situation-brief-toggle').getAttribute('aria-expanded'),
    'true',
  );
});

test('every line opens its stories: the first is selected and flown to when pinned, the rest highlighted', async () => {
  const { $, $$, layer, focus, rows } = await mount({
    storage: createFakeStorage({ [BRIEF_EXPANDED_KEY]: '1' }),
  });
  $$('.situation-brief-lines')[0]
    .querySelector('.situation-brief-line')
    .click();
  assert.equal(layer.getSnapshot().selectedStoryId, 'st_a');
  assert.equal(focus.length, 1, 'st_a is a located event: one flight');
  assert.deepEqual(
    rows()
      .filter((row) => row.cited)
      .map((row) => row.id),
    ['st_a', 'st_b'],
  );
  assert.match(
    text($('.situation-cited-note')),
    /^Highlighted: the 2 stories this brief line cites · Clear$/,
  );
  // A development opens without a flight.
  $('[data-focus-key="change-1"]').click();
  assert.equal(layer.getSnapshot().selectedStoryId, 'st_c');
  assert.equal(focus.length, 1);
  // Every clickable line, badge and seen tick selects its first story.
  const clickable = [
    ...$$('.situation-brief-line'),
    ...$$('.situation-track').filter((badge) => !badge.disabled),
    ...$$('.situation-signpost-seen'),
  ];
  assert.equal(clickable.length, 14, 'with the role change line');
  for (const control of clickable) {
    const [first] = control.getAttribute('data-story-ids').split(' ');
    control.click();
    assert.equal(layer.getSnapshot().selectedStoryId, first, text(control));
  }
  $('.situation-cited-note').querySelector('.situation-link-button').click();
  assert.deepEqual(
    rows().filter((row) => row.cited),
    [],
  );
});

test('the actor filter combines with category toggles on the list and the pins', async () => {
  const { $, layer, rows } = await mount({
    storage: createFakeStorage({ [BRIEF_EXPANDED_KEY]: '1' }),
  });
  assert.deepEqual(layer._testing.pinIds(), ['st_a', 'st_b']);
  $('[data-actor-id="oman"]').click();
  assert.equal(
    $('[data-actor-id="oman"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.deepEqual(
    rows().map((row) => row.id),
    ['st_b', 'st_c'],
  );
  assert.deepEqual(layer._testing.pinIds(), ['st_b']);
  assert.match(
    text($('.situation-brief-filter')),
    /^Showing stories involving Oman · Show all$/,
  );
  // The active actor's note appears under the strip.
  assert.equal(text($('.situation-actor-note')), 'Oman hosted the talks.');
  // And where its role comes from, opening the evidence.
  const evidence = $('[data-focus-key="actor-role-evidence"]');
  assert.match(
    text(evidence),
    /^Mediator since \d\d:\d\d, on 1 corroborated story$/,
  );
  evidence.click();
  assert.equal(layer.getSnapshot().selectedStoryId, 'st_c');
  // Hide Humanitarian: both filters apply.
  $('[data-focus-key="chip-humanitarian-casualties"]').click();
  assert.deepEqual(
    rows().map((row) => row.id),
    ['st_c'],
  );
  assert.deepEqual(layer._testing.pinIds(), []);
  // Clicking the chip again clears the actor filter; the category stays.
  $('[data-actor-id="oman"]').click();
  assert.deepEqual(
    rows().map((row) => row.id),
    ['st_a', 'st_c', 'st_d'],
  );
  assert.equal(layer.getParams().hiddenCategories, 'humanitarian-casualties');
  assert.equal($('.situation-brief-filter'), null);
});

test('stories updated after the stored last-seen digest are marked until the viewer leaves', async () => {
  const storage = createFakeStorage({
    [lastSeenKey('iran-israel-us')]: JSON.stringify({
      runId: 'run_1',
      at: at('13:00'),
    }),
  });
  const observers = [];
  class Observer {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const { document, panel, layer, rows, view } = await mount({
    storage,
    MutationObserverImpl: Observer,
  });
  assert.deepEqual(
    rows().map((row) => [row.id, row.fresh]),
    [
      ['st_a', true],
      ['st_b', false],
      ['st_c', false],
      ['st_d', false],
    ],
  );
  assert.equal(layer.getSnapshot().newSinceMs, Date.parse(at('13:00')));
  // Hiding the page moves "last seen" to the digest on screen.
  document.visibilityState = 'hidden';
  document.dispatchEvent({ type: 'visibilitychange' });
  assert.deepEqual(JSON.parse(storage.getItem(lastSeenKey('iran-israel-us'))), {
    runId: 'run_2',
    at: '2026-10-28T13:30:00.000Z',
  });
  assert.deepEqual(
    rows().filter((row) => row.fresh),
    [],
  );
  // Closing the panel does the same.
  storage.removeItem(lastSeenKey('iran-israel-us'));
  assert.deepEqual(observers[0].options.attributeFilter, ['class', 'hidden']);
  panel.classList.add('collapsed');
  observers[0].callback();
  assert.ok(storage.getItem(lastSeenKey('iran-israel-us')));
  view.destroy();
  assert.equal(observers[0].disconnected, true);
  assert.equal(document.listenerCount('visibilitychange'), 0);
});

test('a first visit marks nothing new', async () => {
  const { rows, layer } = await mount();
  assert.equal(layer.getSnapshot().newSinceMs, null);
  assert.deepEqual(
    rows().filter((row) => row.fresh),
    [],
  );
});

test('a failed brief keeps the previous one, says so, and offers Retry brief', async () => {
  let retries = 0;
  const failed = payload({
    briefRun: {
      id: 'run_4',
      kind: 'brief',
      status: 'failed',
      error: 'truncated',
      costUsd: 0.09,
    },
    briefStatus: {
      digestsBehind: 1,
      retryable: true,
      retryDisabledReason: null,
    },
  });
  const { $ } = await mount({
    snapshot: failed,
    source: {
      async requestBrief() {
        retries++;
        return { ok: true, briefRun: { status: 'ok', costUsd: 0.11 } };
      },
    },
  });
  assert.equal(
    text($('.situation-brief-headline')),
    'Strikes and talks continue in parallel.',
    'the previous brief stays',
  );
  assert.match(
    text($('.situation-brief-age')),
    /^Brief from \d\d:\d\d, one digest behind$/,
  );
  assert.equal(
    text($('.situation-brief-failure')),
    'The latest brief failed: it hit its output limit (cost 9¢).',
  );
  const retry = $('.situation-brief-retry');
  assert.equal(text(retry), 'Retry brief');
  assert.equal(retry.disabled, false);
  retry.click();
  for (let tick = 0; tick < 10; tick++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retries, 1);
  assert.equal(text($('.situation-notice')), 'Brief written, 11¢.');
});

test('Retry brief is disabled with its reason, and absent when nothing failed', async () => {
  const overBudget = await mount({
    snapshot: payload({
      brief: null,
      briefRun: {
        id: 'r',
        kind: 'brief',
        status: 'skipped',
        reason: 'over_budget',
        message: 'Brief skipped: $0.05 of budget left',
      },
      briefStatus: {
        digestsBehind: null,
        retryable: true,
        retryDisabledReason: 'over_budget',
      },
    }),
  });
  const retry = overBudget.$('.situation-brief-retry');
  assert.equal(retry.disabled, true);
  assert.equal(retry.title, "Today's budget is used up");
  assert.equal(
    text(overBudget.$('.situation-brief-failure')),
    'Brief skipped: $0.05 of budget left.',
  );
  assert.equal(overBudget.$('.situation-brief-toggle'), null);
  const fine = await mount();
  assert.equal(fine.$('.situation-brief-retry'), null);
  assert.equal(fine.$('.situation-brief-failure'), null);
});

test('with no brief yet the section says how one is made and still shows coverage', async () => {
  const { $ } = await mount({
    snapshot: payload({ brief: null, briefRun: null, briefStatus: null }),
  });
  assert.match(
    text($('.situation-brief').querySelector('.situation-note')),
    /^No brief yet\./,
  );
  assert.match(text($('.situation-brief-coverage')), /^Coverage: /);
  assert.equal($('.situation-brief-meta'), null);
});

test('a theater with the Brief off shows no Brief section; switching back restores it', async () => {
  const theaters = [
    { id: 'iran-israel-us', name: 'Iran · Israel · US' },
    { id: 'world', name: 'World' },
  ];
  const iran = payload({ theaters });
  const world = payload({
    revision: 'w1',
    theater: {
      id: 'world',
      name: 'World',
      situationBrief: false,
      categories: [
        { id: 'armed-conflict', label: 'Armed conflict', color: '#ef4444' },
      ],
      perspectives: [{ id: 'international-wire', label: 'International wire' }],
    },
    theaters,
    stories: [story('st_w', { category: 'armed-conflict' })],
    brief: null,
    // A stale failure from another theater must not surface Retry brief.
    briefRun: null,
    briefStatus: { digestsBehind: null, retryable: true },
  });
  const { $, $$, layer } = await mount({
    snapshot: iran,
    source: {
      getSnapshot: async ({ theater } = {}) =>
        normalizeNewsSnapshot(theater === 'world' ? world : iran),
    },
  });
  assert.equal($('.situation-brief').hidden, false);
  // A brief line's highlight belongs to its theater's stories.
  $('.situation-brief-headline').click();
  assert.equal($('.situation-cited-note').hidden, false);
  await layer.setTheater('world');
  assert.equal($('.situation-brief').hidden, true);
  assert.equal($('.situation-cited-note').hidden, true);
  assert.deepEqual(
    $$('.situation-story').map((row) => row.dataset.storyId),
    ['st_w'],
  );
  await layer.setTheater('iran-israel-us');
  assert.equal($('.situation-brief').hidden, false);
  assert.equal(
    text($('.situation-brief-headline')),
    'Strikes and talks continue in parallel.',
  );
});

test('Frame theater flies once over the pins and is off without any', async () => {
  const { $, focus, layer } = await mount();
  const frame = $('.situation-frame');
  assert.equal(text(frame), 'Frame theater');
  assert.equal(frame.disabled, false);
  frame.click();
  assert.equal(focus.length, 1);
  assert.equal(focus[0].kind, 'theater');
  layer.setActorFilter('iran');
  layer.toggleCategory('war-military');
  assert.equal($('.situation-frame').disabled, true);
  assert.equal($('.situation-frame').title, 'No located open stories to frame');
});

test('an actor with no open stories leaves the strip but keeps its id', async () => {
  const withEgypt = payload();
  withEgypt.theater.actors.push({
    id: 'egypt',
    name: 'Egypt',
    type: 'state',
    role: 'external',
    learned: true,
    roleSince: at('12:00'),
    roleStoryIds: ['st_gone'],
  });
  const { $, layer } = await mount({
    snapshot: withEgypt,
    storage: createFakeStorage({ [BRIEF_EXPANDED_KEY]: '1' }),
  });
  assert.equal($('[data-actor-id="egypt"]'), null);
  assert.match(
    text($('.situation-actors').nextSibling),
    /^1 more actor has no open stories and is not shown\.$/,
  );
  // It is still an actor: it can be filtered on, and then it shows.
  layer.setActorFilter('egypt');
  assert.equal(
    $('[data-actor-id="egypt"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(layer.getSnapshot().actorFilter, 'egypt');
});

const IRAN = {
  key: 'country:Iran',
  label: 'Iran',
  kind: 'country',
  lat: 32.43,
  lon: 53.69,
};
const GAZA = {
  key: 'region:Gaza Strip',
  label: 'Gaza Strip',
  kind: 'region',
  lat: 31.42,
  lon: 34.37,
};

/** The fixture with the server's hotspots: st_a in Iran, st_b in Gaza. */
function withHotspots() {
  const snapshot = payload();
  snapshot.stories = snapshot.stories.map((entry) => ({
    ...entry,
    hotspot: entry.id === 'st_a' ? IRAN : entry.id === 'st_b' ? GAZA : null,
  }));
  return snapshot;
}

test('a place filter shows a chip above the list; its clear button restores the list', async () => {
  const { $, document, layer, rows, focus } = await mount({
    snapshot: withHotspots(),
  });
  assert.equal($('.situation-place-filter').hidden, true);
  assert.equal(layer.focusHotspot('region:Gaza Strip'), true);
  assert.equal(focus.at(-1).kind, 'hotspot');
  assert.deepEqual(
    rows().map((row) => row.id),
    ['st_b'],
  );
  assert.equal(
    text(document.getElementById('situation-tab-stories')),
    'Stories (1)',
  );
  assert.equal(text(document.getElementById('situation-panel-count')), '1');
  const chip = $('.situation-place-filter');
  assert.equal(chip.hidden, false);
  const clear = chip.querySelector('button');
  assert.equal(text(clear), 'Gaza Strip ✕');
  assert.equal(
    clear.getAttribute('aria-label'),
    'Clear place filter: Gaza Strip',
  );
  // The chip sits above the list and its note.
  const panel = document.getElementById('situation-tabpanel-stories');
  assert.equal(panel.childNodes[0], chip);
  // The pins stay unfiltered.
  assert.deepEqual(layer._testing.pinIds(), ['st_a', 'st_b']);
  clear.click();
  assert.equal(layer.getSnapshot().placeFilter, null);
  assert.equal($('.situation-place-filter').hidden, true);
  assert.deepEqual(
    rows().map((row) => row.id),
    ['st_a', 'st_b', 'st_c', 'st_d'],
  );
});

test('with a place filter the empty-list note and the cited hint name the place', async () => {
  const { $, layer } = await mount({
    snapshot: withHotspots(),
    storage: createFakeStorage({ [BRIEF_EXPANDED_KEY]: '1' }),
  });
  layer.setPlaceFilter('region:Gaza Strip');
  // The headline cites st_a (Iran) and st_c: both outside Gaza.
  $('.situation-brief-headline').click();
  assert.match(
    text($('.situation-cited-note')),
    /^Highlighted: the 2 stories this brief line cites; 2 hidden by the category, actor or place filter \(Gaza Strip\) · Clear$/,
  );
  $('[data-focus-key="chip-humanitarian-casualties"]').click();
  assert.equal(
    text($('.situation-note')),
    'No stories in Gaza Strip under these categories.',
  );
  layer.setPlaceFilter(null);
  $('[data-focus-key="chip-humanitarian-casualties"]').click();
  for (const id of [
    'war-military',
    'humanitarian-casualties',
    'political-diplomatic',
  ])
    if (
      $(`[data-focus-key="chip-${id}"]`).getAttribute('aria-pressed') === 'true'
    )
      $(`[data-focus-key="chip-${id}"]`).click();
  assert.equal(
    text($('.situation-note')),
    'No stories under these categories.',
  );
});
