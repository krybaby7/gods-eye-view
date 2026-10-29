#!/usr/bin/env node
/**
 * Browser QA for the war monitor: the news layer and the Situation panel,
 * against a running app server. `npm run qa:news -- --fixtures` (or
 * `node scripts/qa-news.mjs --fixtures --url http://127.0.0.1:5173`).
 *
 * `--fixtures` answers /api/news, /api/news/digest and /api/news/brief in the
 * page from fixture snapshots, a stubbed digest and a fixture Situation
 * Brief, so nothing reaches a feed or Perplexity. Without it the run uses
 * the server's real provider and only reads (it never presses Refresh or
 * Retry brief, which would spend money).
 *
 * Screenshots land in qa-artifacts/news/.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LAYER_STATE_REGISTRY,
  encodeLayerStateParams,
  normalizeLayerState,
} from '../src/data/layerState.js';

export const ARTIFACT_DIR = 'qa-artifacts/news';
const VIEWPORT = { width: 1440, height: 900 };
const NEWS_TOKEN = LAYER_STATE_REGISTRY.find(
  (entry) => entry.id === 'news',
).token;

const CATEGORIES = [
  { id: 'war-military', label: 'War & military', color: '#ef4444' },
  {
    id: 'political-diplomatic',
    label: 'Political & diplomatic',
    color: '#60a5fa',
  },
  {
    id: 'humanitarian-casualties',
    label: 'Humanitarian & casualties',
    color: '#f59e0b',
  },
  { id: 'environmental', label: 'Environmental', color: '#22c55e' },
  {
    id: 'infrastructure-shipping',
    label: 'Infrastructure & shipping',
    color: '#a78bfa',
  },
  { id: 'cyber-information', label: 'Cyber & information', color: '#22d3ee' },
];

const iso = (minutesAgo) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

// The Brief fixtures use the real theater's actors, drivers and tracks.
const THEATER = JSON.parse(
  readFileSync(
    new URL('../public/news/theaters/iran-israel-us.json', import.meta.url),
    'utf8',
  ),
);
// The World run uses the real World theater's categories and perspectives.
const WORLD = JSON.parse(
  readFileSync(
    new URL('../public/news/theaters/world.json', import.meta.url),
    'utf8',
  ),
);
const THEATERS = [
  { id: 'iran-israel-us', name: 'Iran · Israel · US' },
  { id: 'world', name: 'World' },
];
const LAST_SEEN_KEY = 'godsEyeView.v1.situationLastSeen.iran-israel-us';
const BRIEF_EXPANDED_KEY = 'godsEyeView.v1.situationBriefExpanded';

function item(id, sourceId, folder, kind, perspective, title, extra = {}) {
  return {
    id,
    theater: extra.theater || 'iran-israel-us',
    sourceId,
    folder,
    kind,
    perspective,
    title,
    titleOriginal: extra.titleOriginal || title,
    snippet: '',
    language: extra.language || 'en',
    url: `https://example.org/${id}`,
    canonicalUrl: `https://example.org/${id}`,
    publishedAt: iso(extra.age ?? 90),
    collectedAt: iso((extra.age ?? 90) - 5),
    primarySource: null,
    transport: 'rss',
    digestedAt: extra.digested ? iso(30) : null,
    storyId: extra.storyId ?? null,
  };
}

function story(id, title, category, location, itemIds, extra = {}) {
  return {
    id,
    theater: extra.theater || 'iran-israel-us',
    title,
    summary: extra.summary || `${title}. Sources differ on details.`,
    category,
    place: location ? { name: location.name } : null,
    location,
    eventAt: iso(300),
    itemIds,
    claims: [
      {
        text: 'A strike was reported',
        actor: null,
        type: 'occurrence',
        itemIds,
        status: extra.verification || 'reported',
      },
    ],
    whatsNew: extra.whatsNew || '',
    contradictions: extra.contradictions || [],
    status: 'open',
    firstSeenAt: iso(200),
    updatedAt: iso(extra.updated ?? 30),
    digestRunId: 'run_fixture',
    perspectives: extra.perspectives || ['international-wire'],
    verification: extra.verification || 'reported',
    sourceCount: extra.sourceCount ?? itemIds.length,
    kind: extra.kind || 'event',
    actorIds: extra.actorIds || [],
  };
}

const line = (text, storyIds) => ({ text, storyIds });

/** A checked Situation Brief over the fixture stories. */
export function fixtureBrief({ digested = false } = {}) {
  const brief = {
    id: digested ? 'br_2' : 'br_1',
    theater: 'iran-israel-us',
    digestRunId: digested ? 'run_2' : 'run_1',
    createdAt: iso(digested ? 1 : 9),
    headline: line(
      'Strike claims at Bandar Abbas and interception reports over the Galilee lead the latest stories.',
      ['st_bandar', 'st_north'],
    ),
    changes: [
      line(
        'IRNA and CENTCOM give different accounts of what was hit at Bandar Abbas.',
        ['st_bandar'],
      ),
      line('An aid convoy was halted near Khan Younis, the UN reported.', [
        'st_convoy',
      ]),
    ],
    trigger: line(
      'The Bandar Abbas strike came after interceptions over the Galilee, the IDF and Al-Manar reported.',
      ['st_north', 'st_bandar'],
    ),
    tracks: [
      {
        id: 'military',
        state: 'escalating',
        reason: 'Strike and interception claims in two places.',
        storyIds: ['st_bandar', 'st_north'],
      },
      {
        id: 'diplomatic',
        state: 'unclear',
        reason: 'The stories report statements, not talks.',
        storyIds: ['st_bandar'],
      },
      {
        id: 'humanitarian',
        state: 'stalled',
        reason: 'The UN reports an aid convoy halted near Khan Younis.',
        storyIds: ['st_convoy'],
      },
    ],
    affected: [
      line('Aid access near Khan Younis is blocked, according to the UN.', [
        'st_convoy',
      ]),
    ],
    scenarios: [
      {
        title: 'Exchanges widen',
        horizon: 'days',
        text: 'Strike and interception claims spread to more places.',
        storyIds: ['st_bandar', 'st_north'],
        signposts: [
          { text: 'Interceptions over northern Israel', seenIn: ['st_north'] },
          { text: 'A second Gulf port reported struck', seenIn: [] },
        ],
      },
      {
        title: 'Mediators reopen talks',
        horizon: 'weeks',
        text: 'Envoys meet while strike claims pause.',
        storyIds: ['st_bandar'],
        signposts: [
          {
            text: 'Envoys meet in Doha',
            seenIn: digested ? ['st_talks'] : [],
          },
          { text: 'Both sides confirm a pause', seenIn: [] },
        ],
      },
    ],
    unknowns: [
      line('What was hit at Bandar Abbas is disputed.', ['st_bandar']),
      line('Who is behind the reported port outage is not known.', [
        'st_cyber',
      ]),
    ],
    actorRoles: [
      {
        actorId: 'iran',
        role: 'party',
        text: 'Iranian state media describe the site as a civilian warehouse.',
        storyIds: ['st_bandar'],
      },
    ],
    newActors: [],
  };
  if (digested) {
    brief.actorRoles.push({
      actorId: 'saudi-arabia',
      role: 'party',
      text: 'The Saudi-led coalition says it struck Houthi launchers near Sanaa.',
      storyIds: ['st_yemen'],
    });
    brief.headline = line(
      'Envoys meet in Doha while strike claims continue at Bandar Abbas and over the Galilee.',
      ['st_talks', 'st_bandar', 'st_north'],
    );
    brief.changes = [
      line('Envoys met in Doha as talks resumed, Reuters reported.', [
        'st_talks',
      ]),
      ...brief.changes.slice(0, 2),
    ];
    brief.tracks[1] = {
      id: 'diplomatic',
      state: 'shifting',
      reason: 'Envoys met in Doha.',
      storyIds: ['st_talks'],
    };
  }
  return brief;
}

/**
 * The theater's actors as the snapshot serves them. After the Refresh's
 * brief, the stories have moved Saudi Arabia to party and added Egypt.
 */
function fixtureActors(rolesSet) {
  const actors = THEATER.actors.map((actor) => ({
    ...actor,
    startingRole: actor.role,
    roleSince: null,
    roleStoryIds: [],
    changedFrom: null,
    learned: false,
  }));
  if (!rolesSet) return actors;
  const saudi = actors.find((actor) => actor.id === 'saudi-arabia');
  Object.assign(saudi, {
    role: 'party',
    changedFrom: 'external',
    roleSince: iso(1),
    roleStoryIds: ['st_yemen'],
  });
  actors.push({
    id: 'egypt',
    name: 'Egypt',
    type: 'state',
    role: 'external',
    aliases: ['Cairo'],
    startingRole: 'external',
    roleSince: iso(1),
    roleStoryIds: ['st_yemen'],
    changedFrom: null,
    learned: true,
  });
  return actors;
}

const at = (name, lat, lon, method = 'gazetteer') => ({
  lat,
  lon,
  precision: method === 'model' ? 'approximate' : 'city',
  method,
  name,
});

export function fixtureSnapshot({
  digested = false,
  briefFailed = false,
} = {}) {
  const items = [
    item(
      'i-centcom',
      'centcom',
      'official',
      'state',
      'us-mil',
      'CENTCOM strikes drone storage near Bandar Abbas',
      { digested: true, storyId: 'st_bandar' },
    ),
    item(
      'i-irna',
      'irna',
      'official',
      'state',
      'iran-state',
      'Explosion at Bandar Abbas port warehouse',
      { digested: true, storyId: 'st_bandar' },
    ),
    item(
      'i-aje',
      'aljazeera',
      'reporting',
      'independent',
      'international-regional',
      'Blast reported at Iranian port of Bandar Abbas',
      { digested: true, storyId: 'st_bandar' },
    ),
    item(
      'i-ocha',
      'reliefweb',
      'humanitarian',
      'humanitarian',
      'un',
      'Gaza: aid convoy halted near Khan Younis',
      { digested: true, storyId: 'st_convoy' },
    ),
    item(
      'i-idf',
      'idf',
      'official',
      'state',
      'israel-mil',
      'Interceptors launched over northern Israel',
      { digested: true, storyId: 'st_north' },
    ),
    item(
      'i-manar',
      'almanar',
      'armed-group',
      'participant',
      'hezbollah',
      'المقاومة تستهدف موقعاً في الجليل',
      { digested: true, storyId: 'st_north', language: 'ar' },
    ),
    item(
      'i-crisis',
      'crisisgroup',
      'analysis',
      'analysis',
      'analysis-crisis',
      'What the latest escalation means for Gulf shipping',
      { digested: true },
    ),
    item(
      'i-new1',
      'reuters',
      'reporting',
      'independent',
      'international-wire',
      'Talks resume in Doha as envoys meet',
      { age: 10 },
    ),
    item(
      'i-new2',
      'iranwire',
      'local',
      'independent',
      'iran-diaspora',
      'Residents describe blackout in Tehran district',
      { age: 12 },
    ),
  ];
  const stories = [
    story(
      'st_bandar',
      'Strike reported at Bandar Abbas port',
      'war-military',
      at('Bandar Abbas', 27.1832, 56.2666),
      ['i-centcom', 'i-irna', 'i-aje'],
      {
        verification: 'corroborated',
        perspectives: ['international-regional', 'iran-state', 'us-mil'],
        contradictions: [
          'IRNA says a civilian warehouse; CENTCOM says a drone storage site.',
        ],
        whatsNew: 'Al Jazeera reports the blast independently.',
        // Updated by the latest digest (10 min ago, so just before it):
        // new since the stored last visit (20 min ago).
        updated: 11,
        actorIds: ['united-states', 'iran'],
      },
    ),
    story(
      'st_convoy',
      'Aid convoy reported halted near Khan Younis',
      'humanitarian-casualties',
      at('Khan Younis', 31.3462, 34.306),
      ['i-ocha'],
      {
        perspectives: ['un'],
        actorIds: ['civilians-gaza-west-bank', 'united-nations'],
      },
    ),
    story(
      'st_north',
      'Interceptions reported over the Galilee',
      'war-military',
      at('Galilee ridge', 32.95, 35.4, 'model'),
      ['i-idf', 'i-manar'],
      {
        verification: 'participant-claim',
        perspectives: ['hezbollah', 'israel-mil'],
        actorIds: ['israel', 'hezbollah', 'civilians-israel'],
      },
    ),
    story(
      'st_cyber',
      'Outage claims circulate about a Gulf port authority',
      'cyber-information',
      null,
      ['i-crisis'],
      {
        perspectives: ['analysis-crisis'],
        actorIds: ['iran'],
      },
    ),
  ];
  if (digested) {
    items[7].digestedAt = iso(1);
    items[7].storyId = 'st_talks';
    items[8].digestedAt = iso(1);
    stories.unshift(
      story(
        'st_talks',
        'Envoys meet in Doha as talks resume',
        'political-diplomatic',
        at('Doha', 25.2854, 51.531),
        ['i-new1'],
        {
          updated: 1,
          // Talks are a development: no pin, even with a place.
          kind: 'development',
          actorIds: ['qatar', 'iran', 'united-states'],
        },
      ),
    );
    // A corroborated Saudi-Houthi exchange: the evidence for Saudi Arabia's
    // role, and the story that names Egypt.
    items.push(
      item(
        'i-new3',
        'almasirah',
        'armed-group',
        'participant',
        'houthi',
        'Houthis say coalition jets struck Sanaa',
        { digested: true, storyId: 'st_yemen', age: 20 },
      ),
      item(
        'i-new4',
        'airwars',
        'verification',
        'verification',
        'verification',
        'Airwars logs coalition strikes near Sanaa',
        { digested: true, storyId: 'st_yemen', age: 25 },
      ),
    );
    stories.splice(
      1,
      0,
      story(
        'st_yemen',
        'Saudi-led coalition and Houthis trade strikes',
        'war-military',
        at('Sanaa', 15.3694, 44.191),
        ['i-new3', 'i-new4'],
        {
          updated: 2,
          verification: 'corroborated',
          perspectives: ['houthi', 'verification'],
          summary:
            'The coalition says it struck Houthi launchers near Sanaa; the Houthis report the strikes. Egypt has pledged military support to Saudi Arabia.',
          actorIds: ['saudi-arabia', 'houthis', 'egypt'],
        },
      ),
    );
  }
  const brief = fixtureBrief({ digested: digested && !briefFailed });
  const briefRun = briefFailed
    ? {
        id: 'run_b2',
        kind: 'brief',
        status: 'failed',
        digestRunId: 'run_2',
        error: 'truncated',
        message: 'the brief hit the 16,000-token output limit',
        costUsd: 0.09,
      }
    : {
        id: digested ? 'run_b2' : 'run_b1',
        kind: 'brief',
        status: 'ok',
        digestRunId: brief.digestRunId,
        costUsd: 0.12,
      };
  return {
    revision: digested ? 'fixture-2' : 'fixture-1',
    retrievedAt: new Date().toISOString(),
    theater: {
      id: 'iran-israel-us',
      name: 'Iran · Israel · US',
      categories: CATEGORIES,
      perspectives: THEATER.perspectives,
      actors: fixtureActors(digested && !briefFailed),
      drivers: THEATER.drivers,
      tracks: THEATER.tracks,
    },
    theaters: THEATERS,
    items,
    citations: [],
    stories,
    lastRun: {
      id: digested ? 'run_2' : 'run_1',
      status: 'ok',
      startedAt: iso(digested ? 1 : 10),
      finishedAt: iso(digested ? 1 : 10),
      itemCount: 7,
      costUsd: 0.18,
    },
    lastDigest: {
      id: digested ? 'run_2' : 'run_1',
      status: 'ok',
      startedAt: iso(digested ? 1 : 10),
      finishedAt: iso(digested ? 1 : 10),
      itemCount: 7,
      costUsd: 0.18,
    },
    brief,
    briefRun,
    briefStatus: {
      digestsBehind: briefFailed ? 1 : 0,
      retryable: briefFailed,
      retryDisabledReason: null,
    },
    sources: [
      {
        id: 'centcom',
        name: 'US Central Command',
        folder: 'official',
        kind: 'state',
        perspective: 'us-mil',
        health: { ok: true },
      },
      {
        id: 'middleeasteye',
        name: 'Middle East Eye',
        folder: 'reporting',
        kind: 'independent',
        perspective: 'international-regional',
        health: { ok: false, blocked: true, degraded: true, error: 'HTTP 403' },
      },
      {
        id: 'almasirah',
        name: 'Al Masirah (Telegram)',
        folder: 'armed-group',
        kind: 'participant',
        perspective: 'houthi',
        health: {
          ok: false,
          fragile: true,
          degraded: true,
          error: 'preview markup not found',
        },
      },
    ],
    budget: {
      dailyUsd: 2,
      spentTodayUsd: digested ? 0.36 : 0.18,
      remainingUsd: digested ? 1.64 : 1.82,
      exhausted: false,
      lastRunCostUsd: 0.18,
      lastBriefCostUsd: briefFailed ? 0.09 : 0.12,
    },
    digest: {
      provider: 'Perplexity Agent API',
      model: 'anthropic/claude-sonnet-5-5',
      keyConfigured: true,
      running: false,
      startedAt: null,
      disabledReason: digested ? 'nothing_new' : null,
      undigestedCount: digested ? 0 : 2,
    },
  };
}

const region = (name, lat, lon) => ({
  ...at(name, lat, lon),
  precision: 'region',
});

/**
 * The World theater after one digest: pins on every continent (two either
 * side of the date line), a list-only development, a model-placed pin, and
 * no Situation Brief.
 */
export function worldSnapshot() {
  const w = { theater: 'world', digested: true };
  const items = [
    item(
      'w-bbc',
      'bbcworld',
      'reporting',
      'independent',
      'international-public',
      'Paramilitary assault reported on El Fasher',
      { ...w, storyId: 'st_w_darfur' },
    ),
    item(
      'w-dabanga',
      'dabanga',
      'local',
      'independent',
      'africa-press',
      'Residents flee shelling in El Fasher',
      { ...w, storyId: 'st_w_darfur' },
    ),
    item(
      'w-telesur',
      'telesur',
      'official',
      'state',
      'venezuela-state',
      'Caracas rally backs the government',
      { ...w, storyId: 'st_w_caracas' },
    ),
    item(
      'w-meduza',
      'meduza',
      'reporting',
      'independent',
      'eurasia-press',
      'Shelling reported across Donbas',
      { ...w, storyId: 'st_w_donbas' },
    ),
    item(
      'w-tass',
      'tass',
      'official',
      'state',
      'russia-state',
      'Defence ministry reports advances in Donbas',
      { ...w, storyId: 'st_w_donbas' },
    ),
    item(
      'w-rnz',
      'rnzpacific',
      'reporting',
      'independent',
      'asia-pacific-press',
      'Fiji parliament debates electoral reform',
      { ...w, storyId: 'st_w_suva' },
    ),
    item(
      'w-rnz2',
      'rnzpacific',
      'reporting',
      'independent',
      'asia-pacific-press',
      'Samoa sets a date for its election',
      { ...w, storyId: 'st_w_apia' },
    ),
    item(
      'w-hrw',
      'hrw',
      'humanitarian',
      'humanitarian',
      'ngo',
      'Bangladesh: activists detained before protest',
      { ...w, storyId: 'st_w_dhaka' },
    ),
    item(
      'w-irrawaddy',
      'irrawaddy',
      'local',
      'independent',
      'asia-pacific-press',
      'Aid cuts hit displaced families in Rakhine',
      { ...w, storyId: 'st_w_rakhine' },
    ),
    item(
      'w-unnews',
      'unnews',
      'humanitarian',
      'humanitarian',
      'un',
      'Security Council renews sanctions regime',
      { ...w, storyId: 'st_w_sanctions' },
    ),
    item(
      'w-politico',
      'politicous',
      'reporting',
      'independent',
      'north-america-press',
      'Georgia certifies its results',
      { ...w, storyId: 'st_w_georgia' },
    ),
    item(
      'w-crisis',
      'crisisgroup',
      'analysis',
      'analysis',
      'analysis-crisis',
      'CrisisWatch: conflict risk alerts',
      w,
    ),
    item(
      'w-scmp',
      'scmp',
      'reporting',
      'independent',
      'asia-pacific-press',
      'Hong Kong court hears appeal',
      { theater: 'world' },
    ),
  ];
  const s = (id, title, category, location, itemIds, extra = {}) =>
    story(id, title, category, location, itemIds, {
      theater: 'world',
      ...extra,
    });
  const stories = [
    s(
      'st_w_darfur',
      'Paramilitary assault reported on El Fasher',
      'armed-conflict',
      region('Darfur', 13.4, 24.4),
      ['w-bbc', 'w-dabanga'],
      {
        verification: 'corroborated',
        perspectives: ['international-public', 'africa-press'],
        updated: 12,
      },
    ),
    s(
      'st_w_donbas',
      'Shelling and advances reported in Donbas',
      'armed-conflict',
      region('Donbas', 48.53, 38.4),
      ['w-meduza', 'w-tass'],
      {
        contradictions: [
          'Meduza reports shelling of towns; TASS reports an advance.',
        ],
        verification: 'disputed',
        perspectives: ['eurasia-press', 'russia-state'],
        updated: 15,
      },
    ),
    s(
      'st_w_caracas',
      'Rally in Caracas backs the government',
      'protests-unrest',
      at('Caracas', 10.5, -66.92),
      ['w-telesur'],
      {
        verification: 'participant-claim',
        perspectives: ['venezuela-state'],
        updated: 20,
      },
    ),
    s(
      'st_w_suva',
      'Fiji parliament debates electoral reform',
      'elections-governance',
      at('Suva', -18.13, 178.44),
      ['w-rnz'],
      { perspectives: ['asia-pacific-press'], updated: 25 },
    ),
    s(
      'st_w_apia',
      'Samoa sets a date for its election',
      'elections-governance',
      at('Apia', -13.84, -171.76),
      ['w-rnz2'],
      { perspectives: ['asia-pacific-press'], updated: 26 },
    ),
    s(
      'st_w_dhaka',
      'Activists detained in Dhaka before a protest',
      'rights-justice',
      at('Dhaka', 23.72, 90.41),
      ['w-hrw'],
      { perspectives: ['ngo'], updated: 30 },
    ),
    s(
      'st_w_rakhine',
      'Aid cuts hit displaced families in Rakhine',
      'humanitarian',
      region('Rakhine State', 20.27, 93.64),
      ['w-irrawaddy'],
      { perspectives: ['asia-pacific-press'], updated: 35 },
    ),
    s(
      'st_w_sanctions',
      'Security Council renews a sanctions regime',
      'diplomacy-sanctions',
      null,
      ['w-unnews'],
      { kind: 'development', perspectives: ['un'], updated: 40 },
    ),
    s(
      'st_w_georgia',
      'Georgia certifies its election results',
      'elections-governance',
      at('Georgia', 32.7, -83.4, 'model'),
      ['w-politico'],
      { perspectives: ['north-america-press'], updated: 45 },
    ),
  ];
  const digest = {
    id: 'run_w1',
    status: 'ok',
    startedAt: iso(12),
    finishedAt: iso(12),
    itemCount: 12,
    costUsd: 0.47,
  };
  return {
    revision: 'world-1',
    retrievedAt: new Date().toISOString(),
    theater: {
      id: 'world',
      name: 'World',
      situationBrief: false,
      categories: WORLD.categories,
      perspectives: WORLD.perspectives,
      actors: [],
      drivers: [],
      tracks: [],
    },
    theaters: THEATERS,
    items,
    citations: [],
    stories,
    lastRun: digest,
    lastDigest: digest,
    brief: null,
    briefRun: null,
    briefStatus: {
      digestsBehind: null,
      retryable: false,
      retryDisabledReason: null,
    },
    sources: [
      {
        id: 'bbcworld',
        name: 'BBC News (World)',
        folder: 'reporting',
        kind: 'independent',
        perspective: 'international-public',
        health: { ok: true },
      },
      {
        id: 'tass',
        name: 'TASS',
        folder: 'official',
        kind: 'state',
        perspective: 'russia-state',
        health: { ok: true },
      },
      {
        id: 'reuters',
        name: 'Reuters',
        folder: 'reporting',
        kind: 'independent',
        perspective: 'international-wire',
        health: {
          ok: false,
          rateLimited: true,
          degraded: true,
          error: 'HTTP 429',
        },
      },
    ],
    // The last brief anywhere cost 12¢; World shows no brief cost.
    budget: {
      dailyUsd: 2,
      spentTodayUsd: 0.83,
      remainingUsd: 1.17,
      exhausted: false,
      lastRunCostUsd: 0.47,
      lastBriefCostUsd: 0.12,
    },
    digest: {
      provider: 'Perplexity Agent API',
      model: 'anthropic/claude-sonnet-5-5',
      keyConfigured: true,
      running: false,
      startedAt: null,
      disabledReason: null,
      undigestedCount: 1,
    },
  };
}

/** Answer the news routes in the page; count digest posts. */
async function serveFixtures(page, state) {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/news')) {
      void request.continue();
      return;
    }
    const json = (status, body) =>
      request.respond({
        status,
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        body: JSON.stringify(body),
      });
    if (url.pathname === '/api/news/digest' && request.method() === 'POST') {
      state.digestPosts++;
      // A digest takes a moment; the panel shows the running state meanwhile.
      setTimeout(() => {
        state.digested = true;
        void json(200, {
          ok: true,
          run: {
            id: 'run_2',
            status: 'ok',
            storiesCreated: 1,
            storiesUpdated: 0,
            itemCount: 2,
            unassignedCount: 1,
            costUsd: 0.18,
          },
          briefRun: fixtureSnapshot({ digested: true }).briefRun,
          budget: fixtureSnapshot({ digested: true }).budget,
        });
      }, 1500);
      return;
    }
    if (url.pathname === '/api/news/brief' && request.method() === 'POST') {
      state.briefPosts++;
      if (!state.briefFailed) {
        void json(409, {
          error: 'nothing_to_retry',
          message: 'Retry brief works only after a failed brief',
        });
        return;
      }
      setTimeout(() => {
        state.briefFailed = false;
        const after = fixtureSnapshot({ digested: true });
        void json(200, {
          ok: true,
          briefRun: { ...after.briefRun, costUsd: 0.11 },
          budget: after.budget,
        });
      }, 800);
      return;
    }
    if (url.pathname === '/api/news' || url.pathname === '/api/news/') {
      if (url.searchParams.get('theater') === 'world') {
        state.worldGets++;
        void json(200, worldSnapshot());
        return;
      }
      void json(
        200,
        fixtureSnapshot({
          digested: state.digested,
          briefFailed: state.briefFailed,
        }),
      );
      return;
    }
    void json(404, { error: 'not_found' });
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for the app, then dismiss the first-run launcher. */
async function clearFirstRun(page) {
  await page.waitForFunction(() => Boolean(window.__godsEyeView?.dataManager), {
    timeout: 150_000,
  });
  await page.evaluate(() =>
    document.querySelector('.first-run-explore')?.click(),
  );
  await wait(500);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(
      '#first-run-launcher, [class*=first-run]',
    ))
      el.remove();
  });
}

async function waitFor(page, fn, arg, label, timeout = 30_000) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 200 }, arg);
  } catch (error) {
    throw new Error(`timed out waiting for ${label}: ${error.message}`);
  }
}

function newsState(page) {
  return page.evaluate(() => {
    const layer =
      window.__godsEyeView?.dataManager?.layers?.get('news')?.module;
    const panel = document.getElementById('situation-panel');
    return {
      pins: layer?._testing?.pinIds() ?? [],
      stats: layer?.getStats() ?? null,
      params: layer?.getParams() ?? null,
      panelHidden: panel?.hidden ?? true,
      panelCollapsed: panel?.classList.contains('collapsed') ?? null,
      rows: [
        ...document.querySelectorAll('#situation-panel .situation-story'),
      ].map((row) => row.dataset.storyId),
      refresh:
        document.querySelector('#situation-panel .situation-refresh')
          ?.textContent ?? null,
      refreshDisabled:
        document.querySelector('#situation-panel .situation-refresh')
          ?.disabled ?? null,
      digestLine:
        document.querySelector('#situation-panel .situation-digest-line')
          ?.textContent ?? null,
      notice:
        document.querySelector('#situation-panel .situation-notice')
          ?.textContent ?? '',
      count:
        document.getElementById('situation-panel-count')?.textContent ?? '',
      degraded:
        document.querySelector('#situation-panel .situation-degraded summary')
          ?.textContent ?? '',
      theme: document.documentElement.dataset.uiTheme || 'default',
    };
  });
}

/** What the Situation Brief section shows. */
function briefState(page) {
  return page.evaluate(() => {
    const panel = document.getElementById('situation-panel');
    const brief = panel.querySelector('.situation-brief');
    const text = (selector) =>
      brief.querySelector(selector)?.textContent ?? null;
    const all = (selector) => [...brief.querySelectorAll(selector)];
    return {
      order: [...panel.querySelector('.situation-panel-root').children].map(
        (node) => node.classList[0],
      ),
      headline: text('.situation-brief-headline'),
      changes: [
        ...(brief
          .querySelector('.situation-brief-lines')
          ?.querySelectorAll('.situation-brief-line') || []),
      ].map((node) => node.textContent),
      tracks: all('.situation-track').map((node) =>
        node.getAttribute('aria-label'),
      ),
      coverage: text('.situation-brief-coverage'),
      meta: text('.situation-brief-meta'),
      age: text('.situation-brief-age'),
      failure: text('.situation-brief-failure'),
      retry: Boolean(brief.querySelector('.situation-brief-retry')),
      expanded:
        brief
          .querySelector('.situation-brief-toggle')
          ?.getAttribute('aria-expanded') ?? null,
      moreHidden: document.getElementById('situation-brief-more')?.hidden,
      headings: all('.situation-brief-more > .situation-subhead').map(
        (node) => node.textContent,
      ),
      roles: all('.situation-actor-role').map((node) => node.textContent),
      actors: all('.situation-actor').length,
      parties: [
        ...(all('.situation-actor-group')
          .find(
            (group) =>
              group.querySelector('.situation-actor-role')?.textContent ===
              'Parties',
          )
          ?.querySelectorAll('.situation-actor') || []),
      ].map((chip) => chip.dataset.actorId),
      hiddenActors:
        brief.querySelector('.situation-actors')?.nextElementSibling
          ?.textContent ?? null,
      roleChanges: all('.situation-role-change').map(
        (node) => node.textContent,
      ),
      drivers: all('.situation-drivers li').length,
      scenarios: all('.situation-scenario').length,
      signposts: all('.situation-signposts li').map((node) => node.textContent),
    };
  });
}

/**
 * Click every Brief line and track badge in the page: each must select its
 * first cited story and highlight all of them in the Stories tab.
 */
async function clickEveryBriefLine(page, expected) {
  const results = await page.evaluate(() => {
    const news = window.__godsEyeView.dataManager.layers.get('news').module;
    const controls = [
      ...document.querySelectorAll(
        '#situation-panel .situation-brief-line, #situation-panel .situation-track:not([disabled])',
      ),
    ];
    return controls.map((control) => {
      control.click();
      const ids = control.dataset.storyIds.split(' ');
      const cited = [
        ...document.querySelectorAll('#situation-panel .situation-story-cited'),
      ].map((row) => row.dataset.storyId);
      return {
        text: control.textContent,
        selected: news.getSnapshot().selectedStoryId,
        first: ids[0],
        highlighted: ids.every((id) => cited.includes(id)),
      };
    });
  });
  assert.equal(results.length, expected);
  for (const result of results) {
    assert.equal(result.selected, result.first, result.text);
    assert.ok(result.highlighted, result.text);
  }
}

/** Scroll the panel back to the Brief (or a part of it) for a screenshot. */
async function showBrief(page, selector = '.situation-brief') {
  await page.evaluate(
    (target) =>
      document
        .querySelector(`#situation-panel ${target}`)
        .scrollIntoView({ block: 'start' }),
    selector,
  );
  await wait(300);
}

/** Story rows and pins carrying the new-since-your-last-visit marker. */
function freshMarks(page) {
  return page.evaluate(() => {
    const rows = [
      ...document.querySelectorAll('#situation-panel .situation-story'),
    ]
      .filter((row) => row.querySelector('.situation-marker-fresh'))
      .map((row) => row.dataset.storyId);
    const { dataSources } = window.__godsEyeView.viewer;
    let source = null;
    for (let i = 0; i < dataSources.length; i++)
      if (dataSources.get(i).name === 'news') source = dataSources.get(i);
    const pins = source.entities.values
      .filter((entity) =>
        decodeURIComponent(entity.billboard.image.getValue()).includes(
          'data-fresh',
        ),
      )
      .map((entity) => entity.id.replace('news:', ''));
    return { rows, pins };
  });
}

/** Horizontal overflow of the page, the panel body and the Brief, in px. */
function overflow(page) {
  return page.evaluate(() => {
    const panel = document.getElementById('situation-panel');
    const body = panel.querySelector('[data-panel-body]') || panel;
    const brief = panel.querySelector('.situation-brief');
    const rect = panel.getBoundingClientRect();
    return {
      page: document.documentElement.scrollWidth - window.innerWidth,
      body: body.scrollWidth - body.clientWidth,
      brief: brief.scrollWidth - brief.clientWidth,
      panelWidth: Math.round(rect.width),
      panelRight: Math.round(rect.right),
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const urlIndex = args.indexOf('--url');
  const base = urlIndex >= 0 ? args[urlIndex + 1] : 'http://127.0.0.1:5173';
  const fixtures = args.includes('--fixtures');
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      (await puppeteer.executablePath()),
    defaultViewport: VIEWPORT,
    protocolTimeout: 300_000,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const errors = [];
  let count = 0;
  const step = async (label, fn) => {
    await fn();
    count++;
    console.log(`ok ${count} ${label}`);
  };
  const shot = (page, name) =>
    page.screenshot({ path: path.join(ARTIFACT_DIR, `${name}.png`) });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && /news|situation/i.test(text))
        errors.push(`console: ${text}`);
    });
    const state = {
      digested: false,
      digestPosts: 0,
      briefFailed: false,
      briefPosts: 0,
      worldGets: 0,
    };
    if (fixtures) {
      await serveFixtures(page, state);
      // The viewer last saw a digest 20 minutes ago: only st_bandar (updated
      // 11 minutes ago) is new since then.
      await page.evaluateOnNewDocument(
        (key, at) =>
          localStorage.setItem(key, JSON.stringify({ runId: 'run_0', at })),
        LAST_SEEN_KEY,
        iso(20),
      );
    }
    const params = new URLSearchParams([['v', '2']]);
    encodeLayerStateParams(
      params,
      normalizeLayerState({ enabledLayerIds: ['news'] }),
    );
    assert.equal(params.get('l'), NEWS_TOKEN);
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await clearFirstRun(page);

    await step(
      'enabling the news layer shows the Situation panel, expanded',
      async () => {
        await page.evaluate(() =>
          window.__godsEyeView.dataManager.setEnabled('news', true, {
            origin: 'user',
          }),
        );
        // The share link records the layer under its ledger token.
        await waitFor(
          page,
          (token) =>
            (new URLSearchParams(location.hash.slice(1)).get('l') || '')
              .split('.')
              .includes(token),
          NEWS_TOKEN,
          'the news token in the share link',
        );
        await waitFor(
          page,
          () => {
            const panel = document.getElementById('situation-panel');
            return (
              panel &&
              !panel.hidden &&
              document.querySelectorAll('#situation-panel .situation-story')
                .length > 0
            );
          },
          null,
          'the Situation panel with stories',
          120_000,
        );
        const s = await newsState(page);
        assert.equal(s.panelHidden, false);
        assert.equal(
          s.panelCollapsed,
          false,
          'first appearance expands the panel',
        );
        if (fixtures) {
          assert.deepEqual(s.rows, [
            'st_bandar',
            'st_convoy',
            'st_north',
            'st_cyber',
          ]);
          assert.equal(s.count, '4');
        }
      },
    );

    await step(
      'one pin per located story; the list-only story is counted, not drawn',
      async () => {
        const s = await newsState(page);
        if (fixtures) {
          assert.deepEqual([...s.pins].sort(), [
            'st_bandar',
            'st_convoy',
            'st_north',
          ]);
          assert.equal(s.stats.listOnly, 1);
          const note = await page.$eval(
            '#situation-panel .situation-note',
            (n) => n.textContent,
          );
          assert.match(note, /^1 story has no pin and appears only here\.$/);
        }
        assert.ok(s.digestLine && s.digestLine.length > 10, s.digestLine);
      },
    );

    await step(
      'the digest line, Refresh control and degraded-source indicator render',
      async () => {
        const s = await newsState(page);
        if (fixtures) {
          assert.match(
            s.digestLine,
            /^Digest \d\d:\d\d · 4 stories from 7 items · 1 unassigned · last run 18¢ · brief 12¢ · budget \$1\.82 left$/,
          );
          assert.equal(s.refresh, 'Refresh');
          assert.equal(s.refreshDisabled, false);
          assert.equal(s.degraded, '2 sources degraded');
        }
        await shot(page, '01-default-stories');
      },
    );

    await step(
      'expanding a story shows its claims and cited items with original links',
      async () => {
        await page.click(
          '#situation-panel .situation-story[data-story-id="st_bandar"] .situation-story-head',
        );
        await waitFor(
          page,
          () => !document.getElementById('situation-story-st_bandar')?.hidden,
          null,
          'the expanded story body',
        );
        const cited = await page.$$eval(
          '#situation-story-st_bandar .situation-item',
          (rows) => rows.map((row) => row.dataset.itemId),
        );
        if (fixtures) assert.deepEqual(cited, ['i-centcom', 'i-irna', 'i-aje']);
        const links = await page.$$eval(
          '#situation-story-st_bandar a.situation-open-original',
          (anchors) => anchors.map((a) => [a.target, a.rel]),
        );
        assert.ok(
          links.every(
            ([target, rel]) =>
              target === '_blank' && rel === 'noopener noreferrer',
          ),
        );
        const s = await newsState(page);
        assert.equal(
          await page.evaluate(
            () =>
              window.__godsEyeView.dataManager.layers
                .get('news')
                .module.getSnapshot().selectedStoryId,
          ),
          'st_bandar',
        );
        assert.ok(s.pins.includes('st_bandar'));
        assert.equal(
          await page.$$eval(
            '#situation-panel .situation-story-selected',
            (rows) => rows.length,
          ),
          1,
        );
        await shot(page, '02-story-expanded');
        // Deselecting on the map drops the row highlight at once, and the
        // shared selection follows the story.
        const shared = await page.evaluate(() => {
          const news = window.__godsEyeView.dataManager.layers.get('news');
          news.module.clearSelection();
          const cleared = window.__gevContextStore?.selectedEntityId ?? null;
          news.module.selectStory('st_bandar', { focus: false });
          return {
            cleared,
            reselected: window.__gevContextStore?.selectedEntityId ?? null,
          };
        });
        assert.equal(shared.reselected, 'news:st_bandar');
        assert.equal(shared.cleared, null);
        await page.evaluate(() =>
          window.__godsEyeView.dataManager.layers
            .get('news')
            .module.clearSelection(),
        );
        assert.equal(
          await page.$$eval(
            '#situation-panel .situation-story-selected',
            (rows) => rows.length,
          ),
          0,
        );
      },
    );

    if (fixtures) {
      await step(
        'the Situation Brief sits above the chips, collapsed: headline, changes, tracks, coverage, AI label',
        async () => {
          const brief = await briefState(page);
          assert.deepEqual(brief.order.slice(0, 3), [
            'situation-controls',
            'situation-brief',
            'situation-chips',
          ]);
          assert.match(brief.headline, /^Strike claims at Bandar Abbas/);
          assert.equal(brief.changes.length, 2);
          assert.deepEqual(brief.tracks, [
            'Military: escalating',
            'Diplomatic: unclear',
            'Humanitarian: stalled',
          ]);
          assert.match(
            brief.coverage,
            /^Coverage: 2 sources down · no Houthi items in 24 h · 1 open story without a location$/,
          );
          assert.match(
            brief.meta,
            /^AI analysis · \d\d:\d\d · cites 4 stories$/,
          );
          assert.equal(brief.moreHidden, true);
          assert.equal(brief.expanded, 'false');
          await showBrief(page);
          await shot(page, '10-brief-collapsed');
        },
      );

      await step(
        'stories new since the last visit are marked on the row and the pin',
        async () => {
          const marks = await freshMarks(page);
          assert.deepEqual(marks.rows, ['st_bandar']);
          assert.deepEqual(marks.pins, ['st_bandar']);
          // Hiding the page moves "last seen" to the digest on screen.
          const stored = await page.evaluate((key) => {
            Object.defineProperty(document, 'visibilityState', {
              value: 'hidden',
              configurable: true,
            });
            document.dispatchEvent(new Event('visibilitychange'));
            delete document.visibilityState;
            return JSON.parse(localStorage.getItem(key));
          }, LAST_SEEN_KEY);
          assert.equal(stored.runId, 'run_1');
          const after = await freshMarks(page);
          assert.deepEqual(after, { rows: [], pins: [] });
        },
      );

      await step(
        'every Brief line opens its stories: the first selected, the rest highlighted',
        async () => {
          // Collapsed: the headline, two change lines and three track badges.
          await clickEveryBriefLine(page, 6);
          await shot(page, '11-brief-line-opened');
          await page.evaluate(() =>
            window.__godsEyeView.dataManager.layers
              .get('news')
              .module.clearSelection(),
          );
        },
      );

      await step(
        'Show more adds actors, why now, the affected, scenarios and unknowns',
        async () => {
          await page.click('#situation-panel .situation-brief-toggle');
          await waitFor(
            page,
            () => !document.getElementById('situation-brief-more')?.hidden,
            null,
            'the expanded brief',
          );
          const brief = await briefState(page);
          assert.equal(brief.expanded, 'true');
          assert.deepEqual(brief.headings, [
            'Who is involved',
            'Why now',
            'Who is affected',
            'What could happen next',
            'What we know poorly',
          ]);
          // Only actors in open stories show: 7 of the 16; the rest are
          // hidden, not deleted.
          assert.deepEqual(brief.roles, [
            'Parties',
            'Institutions',
            'Affected',
          ]);
          assert.equal(brief.actors, 7);
          assert.match(
            brief.hiddenActors,
            /^9 more actors have no open stories and are not shown\.$/,
          );
          assert.deepEqual(brief.roleChanges, []);
          assert.equal(brief.drivers, 3);
          assert.equal(brief.scenarios, 2);
          assert.deepEqual(brief.signposts, [
            '✓ seen Interceptions over northern Israel',
            'not yet seen A second Gulf port reported struck',
            'not yet seen Envoys meet in Doha',
            'not yet seen Both sides confirm a pause',
          ]);
          assert.equal(
            await page.evaluate(
              (key) => localStorage.getItem(key),
              BRIEF_EXPANDED_KEY,
            ),
            '1',
          );
          // A tall window lets the whole expanded Brief show in one shot.
          await page.setViewport({ width: VIEWPORT.width, height: 2000 });
          await wait(1200);
          await showBrief(page);
          await shot(page, '12-brief-expanded');
          await page.setViewport(VIEWPORT);
          await wait(800);
          // Expanded: 12 lines (headline, 2 changes, 3 track reasons,
          // trigger, 1 affected, 2 scenarios, 2 unknowns) and 3 badges.
          await clickEveryBriefLine(page, 15);
          // The seen tick opens the story that reported it.
          await page.click('#situation-panel .situation-signpost-seen');
          assert.equal(
            await page.evaluate(
              () =>
                window.__godsEyeView.dataManager.layers
                  .get('news')
                  .module.getSnapshot().selectedStoryId,
            ),
            'st_north',
          );
        },
      );

      await step(
        'Refresh runs one digest, shows the running state, then the outcome',
        async () => {
          await page.click('#situation-panel .situation-refresh');
          await waitFor(
            page,
            () =>
              /^Digesting… \d:\d\d$/.test(
                document.querySelector('#situation-panel .situation-refresh')
                  ?.textContent || '',
              ),
            null,
            'the running Refresh label',
          );
          await shot(page, '03-refresh-running');
          await waitFor(
            page,
            () =>
              /Digest done/.test(
                document.querySelector('#situation-panel .situation-notice')
                  ?.textContent || '',
              ),
            null,
            'the digest outcome',
          );
          const s = await newsState(page);
          assert.equal(state.digestPosts, 1);
          assert.equal(s.rows[0], 'st_talks');
          assert.equal(s.refreshDisabled, true, 'nothing new disables Refresh');
          const reason = await page.$eval(
            '#situation-refresh-reason',
            (n) => n.textContent,
          );
          assert.equal(reason, 'Nothing new since the last digest');
          assert.match(
            s.notice,
            /^Digest done: 1 new and 0 updated story from 2 items, 1 left unassigned\. Cost 18¢\. Brief written, 12¢\./,
          );
          // Talks are a development: listed, never pinned.
          assert.ok(!s.pins.includes('st_talks'));
          assert.match(
            await page.$eval(
              '#situation-panel .situation-story[data-story-id="st_talks"] .situation-story-times',
              (n) => n.textContent,
            ),
            /development · no pin/,
          );
          const refreshed = await briefState(page);
          assert.match(refreshed.headline, /^Envoys meet in Doha/);
          // The brief's corroborated Saudi-Houthi story moved Saudi Arabia to
          // party and added Egypt; both are listed, newest first.
          assert.ok(refreshed.parties.includes('saudi-arabia'));
          assert.deepEqual(
            refreshed.roleChanges.map((line) =>
              line.replace(/\d\d:\d\d$/, 'T'),
            ),
            [
              'Saudi Arabia: external → party · T',
              'Egypt: added as external · T',
            ],
          );
          await shot(page, '04-after-refresh');
          await showBrief(page, '.situation-actors');
          await shot(page, '04b-roles-after-refresh');
        },
      );

      await step(
        'a failed Brief keeps the previous one with its age, and Retry brief rewrites it',
        async () => {
          state.briefFailed = true;
          await page.evaluate(() =>
            window.__godsEyeView.dataManager.layers
              .get('news')
              .module.refresh(),
          );
          await waitFor(
            page,
            () =>
              Boolean(
                document.querySelector(
                  '#situation-panel .situation-brief-retry',
                ),
              ),
            null,
            'the Retry brief button',
          );
          const failed = await briefState(page);
          assert.match(
            failed.headline,
            /^Strike claims at Bandar Abbas/,
            'the previous brief stays',
          );
          assert.match(failed.age, /^Brief from \d\d:\d\d, one digest behind$/);
          assert.equal(
            failed.failure,
            'The latest brief failed: it hit its output limit (cost 9¢).',
          );
          await showBrief(page);
          await shot(page, '13-brief-failed');
          await page.click('#situation-panel .situation-brief-retry');
          await waitFor(
            page,
            () =>
              /^Brief written, 11¢\.$/.test(
                document.querySelector('#situation-panel .situation-notice')
                  ?.textContent || '',
              ),
            null,
            'the Retry brief outcome',
          );
          const after = await briefState(page);
          assert.equal(state.briefPosts, 1);
          assert.equal(after.failure, null);
          assert.equal(after.retry, false);
          assert.match(after.headline, /^Envoys meet in Doha/);
          await showBrief(page);
          await shot(page, '14-brief-retried');
        },
      );
    }

    await step(
      'category chips filter pins and stories together and persist as a layer param',
      async () => {
        const before = await newsState(page);
        await page.click('#situation-panel .situation-chip:first-child');
        await wait(400);
        const after = await newsState(page);
        if (fixtures) {
          assert.equal(after.params.hiddenCategories, 'war-military');
          assert.ok(
            !after.pins.includes('st_bandar') &&
              !after.pins.includes('st_north'),
          );
          assert.ok(!after.rows.includes('st_bandar'));
        }
        assert.ok(after.rows.length <= before.rows.length);
        await shot(page, '05-category-filtered');
        await page.click('#situation-panel .situation-chip:first-child');
        await wait(300);
        assert.equal((await newsState(page)).params.hiddenCategories, '');
      },
    );

    if (fixtures)
      await step(
        'the Brief actor filter narrows stories and pins on top of the category chips',
        async () => {
          await page.click('#situation-panel [data-actor-id="iran"]');
          await wait(300);
          let s = await newsState(page);
          assert.deepEqual(s.rows, ['st_talks', 'st_bandar', 'st_cyber']);
          assert.deepEqual(s.pins, ['st_bandar']);
          assert.match(
            await page.$eval(
              '#situation-panel .situation-brief-filter',
              (n) => n.textContent,
            ),
            /^Showing stories involving Iran · Show all$/,
          );
          assert.equal(
            await page.$eval(
              '#situation-panel .situation-actor-note',
              (n) => n.textContent,
            ),
            'Iranian state media describe the site as a civilian warehouse.',
          );
          await showBrief(page, '.situation-actors');
          await shot(page, '15-actor-filter');
          // Hide War & military too: both filters apply.
          await page.click('#situation-panel .situation-chip:first-child');
          await wait(300);
          s = await newsState(page);
          assert.deepEqual(s.rows, ['st_talks', 'st_cyber']);
          assert.deepEqual(s.pins, []);
          assert.equal(s.params.hiddenCategories, 'war-military');
          assert.equal(
            await page.$eval(
              '#situation-panel .situation-frame',
              (n) => n.disabled,
            ),
            true,
            'nothing located to frame',
          );
          await showBrief(page, '.situation-chips');
          await shot(page, '16-actor-and-category');
          // Clicking the chip again clears the actor; the category stays.
          await page.click('#situation-panel [data-actor-id="iran"]');
          await page.click('#situation-panel .situation-chip:first-child');
          await wait(300);
          s = await newsState(page);
          assert.equal(s.params.hiddenCategories, '');
          assert.equal(s.rows.length, 6);
          assert.equal(
            await page.$('#situation-panel .situation-brief-filter'),
            null,
          );
        },
      );

    if (fixtures)
      await step(
        'Frame theater flies once over every visible pin',
        async () => {
          const requests = await page.evaluate(
            () =>
              new Promise((resolve) => {
                const seen = [];
                const listener = (event) => seen.push(event.detail);
                window.addEventListener('gev:world-request-focus', listener);
                document
                  .querySelector('#situation-panel .situation-frame')
                  .click();
                setTimeout(() => {
                  window.removeEventListener(
                    'gev:world-request-focus',
                    listener,
                  );
                  resolve(
                    seen.map((detail) => ({
                      kind: detail.kind,
                      radiusM: Math.round(detail.radiusM),
                    })),
                  );
                }, 200);
              }),
          );
          assert.equal(requests.length, 1);
          assert.equal(requests[0].kind, 'theater');
          assert.ok(requests[0].radiusM > 500_000, String(requests[0].radiusM));
          await wait(2500);
          await shot(page, '17-frame-theater');
        },
      );

    await step(
      'the Raw feed tab groups items by folder with markers',
      async () => {
        await page.click('#situation-tab-raw');
        await waitFor(
          page,
          () => !document.getElementById('situation-tabpanel-raw')?.hidden,
          null,
          'the raw tab',
        );
        const folders = await page.$$eval(
          '#situation-panel .situation-folder',
          (buttons) =>
            buttons.map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
        );
        assert.equal(folders.length, 7);
        if (fixtures) {
          assert.deepEqual(folders[0], ['Reporting 2', 'true']);
          await page.click('#situation-panel .situation-folder:nth-child(2)');
          await wait(300);
          const official = await page.$$eval(
            '#situation-tabpanel-raw .situation-item',
            (rows) => rows.map((r) => r.dataset.itemId),
          );
          assert.deepEqual(official, ['i-centcom', 'i-irna', 'i-idf']);
          await page.click('#situation-panel .situation-folder:nth-child(3)');
          await wait(300);
          const marker = await page.$eval(
            '#situation-tabpanel-raw .situation-marker',
            (n) => n.textContent,
          );
          assert.equal(marker, 'unassigned after digest');
        }
        await shot(page, '06-raw-feed');
        await page.click('#situation-tab-stories');
      },
    );

    await step('the Cyber theme keeps the panel usable', async () => {
      await page.evaluate(() => {
        const select = document.getElementById('hud-layout-select');
        select.value = 'cyber';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await waitFor(
        page,
        () => document.documentElement.dataset.uiTheme === 'cyber',
        null,
        'the Cyber theme',
      );
      await wait(800);
      const s = await newsState(page);
      assert.equal(s.theme, 'cyber');
      assert.equal(s.panelHidden, false);
      const box = await page.$eval('#situation-panel', (n) => {
        const r = n.getBoundingClientRect();
        return { width: r.width, height: r.height };
      });
      assert.ok(box.width > 200 && box.height > 40, JSON.stringify(box));
      await shot(page, '07-cyber');
      if (fixtures) {
        assert.equal((await briefState(page)).expanded, 'true');
        const fit = await overflow(page);
        assert.ok(fit.brief <= 1 && fit.body <= 1, JSON.stringify(fit));
        await page.evaluate(() =>
          document
            .querySelector('#situation-panel .situation-brief')
            .scrollIntoView({ block: 'start' }),
        );
        await wait(300);
        await shot(page, '18-brief-cyber');
      }
      await page.evaluate(() => {
        const select = document.getElementById('hud-layout-select');
        select.value = 'tactical';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await wait(500);
    });

    if (fixtures)
      await step(
        'at 720 px and 390 px the panel and the Brief fit without horizontal scroll',
        async () => {
          for (const [width, height, name] of [
            [720, 900, '19-brief-720'],
            [390, 844, '20-brief-390'],
          ]) {
            await page.setViewport({ width, height });
            await wait(1200);
            await page.evaluate(() =>
              document
                .querySelector('#situation-panel .situation-brief')
                .scrollIntoView({ block: 'start' }),
            );
            await wait(400);
            const fit = await overflow(page);
            assert.ok(fit.page <= 0, `${width}px page: ${JSON.stringify(fit)}`);
            assert.ok(
              fit.body <= 1,
              `${width}px panel: ${JSON.stringify(fit)}`,
            );
            assert.ok(
              fit.brief <= 1,
              `${width}px brief: ${JSON.stringify(fit)}`,
            );
            assert.ok(
              fit.panelWidth > 200,
              `${width}px: ${JSON.stringify(fit)}`,
            );
            assert.ok(
              fit.panelRight <= width + 1,
              `${width}px: ${JSON.stringify(fit)}`,
            );
            await shot(page, name);
          }
          await page.setViewport(VIEWPORT);
          await wait(800);
        },
      );

    // World: the second theater, picked from the panel's theater menu.
    const pickTheater = async (id) => {
      await page.evaluate((value) => {
        const select = document.querySelector(
          '#situation-panel .situation-theater',
        );
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, id);
      await waitFor(
        page,
        (value) =>
          window.__godsEyeView.dataManager.layers
            .get('news')
            .module.getSnapshot().theater?.id === value,
        id,
        `the ${id} theater`,
      );
      await wait(400);
    };
    const WORLD_PINS = [
      'st_w_apia',
      'st_w_caracas',
      'st_w_darfur',
      'st_w_dhaka',
      'st_w_donbas',
      'st_w_georgia',
      'st_w_rakhine',
      'st_w_suva',
    ];

    if (fixtures)
      await step(
        'switching to World shows its pins, chips, stories and Raw feed, and no Brief',
        async () => {
          assert.equal(
            await page.$eval(
              '#situation-panel .situation-theater',
              (n) => n.disabled,
            ),
            false,
            'two theaters: the menu is live',
          );
          await pickTheater('world');
          let s = await newsState(page);
          assert.ok(state.worldGets > 0);
          // Nothing carries over from the Iran run: no Refresh outcome, no
          // brief-line highlight.
          assert.equal(s.notice, '');
          assert.equal(
            await page.$eval(
              '#situation-panel .situation-cited-note',
              (n) => n.hidden,
            ),
            true,
          );
          assert.deepEqual([...s.pins].sort(), WORLD_PINS);
          assert.equal(s.stats.listOnly, 1, 'the sanctions development');
          assert.equal(s.rows.length, 9);
          assert.deepEqual(
            await page.$$eval('#situation-panel .situation-chip', (chips) =>
              chips.map((chip) => chip.textContent),
            ),
            WORLD.categories.map((category) => category.label),
          );
          assert.equal(
            await page.$eval(
              '#situation-panel .situation-brief',
              (n) => n.hidden,
            ),
            true,
            'World has no Brief section',
          );
          assert.equal(
            await page.$('#situation-panel .situation-brief-retry'),
            null,
          );
          assert.match(
            s.digestLine,
            /^Digest \d\d:\d\d · 9 stories from 12 items · 1 unassigned · last run 47¢ · budget \$1\.17 left$/,
          );
          await shot(page, '21-world-stories');
          // The model-placed pin and the corroborated story read as such.
          await page.click(
            '#situation-panel .situation-story[data-story-id="st_w_georgia"] .situation-story-head',
          );
          await wait(400);
          await shot(page, '22-world-model-placed');
          await page.evaluate(() =>
            window.__godsEyeView.dataManager.layers
              .get('news')
              .module.clearSelection(),
          );
          // Category chips filter World pins and stories together.
          await page.click('#situation-panel .situation-chip:first-child');
          await wait(300);
          s = await newsState(page);
          assert.equal(s.params.hiddenCategories, 'armed-conflict');
          assert.ok(!s.pins.includes('st_w_darfur'));
          assert.ok(!s.rows.includes('st_w_donbas'));
          await page.click('#situation-panel .situation-chip:first-child');
          await wait(300);
          assert.equal((await newsState(page)).params.hiddenCategories, '');
          await page.click('#situation-tab-raw');
          await waitFor(
            page,
            () => !document.getElementById('situation-tabpanel-raw')?.hidden,
            null,
            'the World raw tab',
          );
          // The folder picked in the Iran run stays picked; open Reporting.
          await page.click('#situation-panel .situation-folder:nth-child(1)');
          await wait(300);
          const folders = await page.$$eval(
            '#situation-panel .situation-folder',
            (buttons) =>
              buttons.map((b) => [
                b.textContent,
                b.getAttribute('aria-pressed'),
              ]),
          );
          assert.equal(folders.length, 7);
          assert.deepEqual(folders[0], ['Reporting 6', 'true']);
          assert.equal(
            (
              await page.$$eval(
                '#situation-tabpanel-raw .situation-item',
                (rows) => rows.map((row) => row.dataset.itemId),
              )
            ).length,
            6,
          );
          await shot(page, '23-world-raw-feed');
          await page.click('#situation-tab-stories');
        },
      );

    if (fixtures)
      await step(
        'Frame theater over World faces the side of the globe with most pins',
        async () => {
          const requests = await page.evaluate(
            () =>
              new Promise((resolve) => {
                const seen = [];
                const listener = (event) => seen.push(event.detail);
                window.addEventListener('gev:world-request-focus', listener);
                document
                  .querySelector('#situation-panel .situation-frame')
                  .click();
                setTimeout(() => {
                  window.removeEventListener(
                    'gev:world-request-focus',
                    listener,
                  );
                  resolve(
                    seen.map(({ kind, radiusM, position: p }) => ({
                      kind,
                      radiusM: Math.round(radiusM),
                      lon: (Math.atan2(p.y, p.x) * 180) / Math.PI,
                    })),
                  );
                }, 200);
              }),
          );
          assert.equal(requests.length, 1);
          assert.equal(requests[0].kind, 'theater');
          assert.ok(
            requests[0].radiusM > 3_000_000,
            String(requests[0].radiusM),
          );
          // The pins' average longitude (82°E): Africa, Europe and Asia,
          // not the near-empty middle of the Pacific.
          assert.ok(
            Math.abs(requests[0].lon - 81.975) < 0.5,
            String(requests[0].lon),
          );
          await wait(2500);
          await shot(page, '24-world-frame-theater');
        },
      );

    if (fixtures)
      await step(
        'World in the Cyber theme and at 720 px and 390 px fits without horizontal scroll',
        async () => {
          await page.evaluate(() => {
            const select = document.getElementById('hud-layout-select');
            select.value = 'cyber';
            select.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await waitFor(
            page,
            () => document.documentElement.dataset.uiTheme === 'cyber',
            null,
            'the Cyber theme',
          );
          await wait(800);
          let fit = await overflow(page);
          assert.ok(fit.body <= 1, JSON.stringify(fit));
          await shot(page, '25-world-cyber');
          await page.evaluate(() => {
            const select = document.getElementById('hud-layout-select');
            select.value = 'tactical';
            select.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await wait(500);
          for (const [width, height, name] of [
            [720, 900, '26-world-720'],
            [390, 844, '27-world-390'],
          ]) {
            await page.setViewport({ width, height });
            await wait(1200);
            fit = await overflow(page);
            assert.ok(fit.page <= 0, `${width}px page: ${JSON.stringify(fit)}`);
            assert.ok(
              fit.body <= 1,
              `${width}px panel: ${JSON.stringify(fit)}`,
            );
            assert.ok(
              fit.panelWidth > 200,
              `${width}px: ${JSON.stringify(fit)}`,
            );
            assert.ok(
              fit.panelRight <= width + 1,
              `${width}px: ${JSON.stringify(fit)}`,
            );
            await shot(page, name);
          }
          await page.setViewport(VIEWPORT);
          await wait(800);
        },
      );

    if (fixtures)
      await step(
        'switching back to Iran · Israel · US restores its Brief, pins and chips',
        async () => {
          await pickTheater('iran-israel-us');
          const s = await newsState(page);
          assert.ok(s.pins.includes('st_bandar'), JSON.stringify(s.pins));
          assert.ok(!s.pins.some((id) => id.startsWith('st_w_')));
          assert.equal(
            await page.$eval(
              '#situation-panel .situation-brief',
              (n) => n.hidden,
            ),
            false,
          );
          assert.ok((await briefState(page)).headline);
          assert.deepEqual(
            await page.$$eval('#situation-panel .situation-chip', (chips) =>
              chips.map((chip) => chip.textContent),
            ),
            CATEGORIES.map((category) => category.label),
          );
          assert.match(s.digestLine, / · brief \d+¢ · /);
          await shot(page, '28-back-to-iran');
        },
      );

    await step(
      'clean view and recording hide the panel and keep the pins',
      async () => {
        for (const mode of ['ui-clean-view', 'recording-mode']) {
          await page.evaluate(
            (name) => document.body.classList.add(name),
            mode,
          );
          await wait(600);
          const view = await page.$eval('#situation-panel', (node) => {
            const style = getComputedStyle(node);
            return {
              visibility: style.visibility,
              opacity: style.opacity,
              pointerEvents: style.pointerEvents,
            };
          });
          assert.equal(view.visibility, 'hidden', `${mode}: panel visibility`);
          assert.equal(view.pointerEvents, 'none', `${mode}: panel input`);
          assert.ok((await newsState(page)).pins.length > 0, `${mode}: pins`);
          await shot(page, `08-${mode}`);
          await page.evaluate(
            (name) => document.body.classList.remove(name),
            mode,
          );
        }
        await wait(400);
        const restored = await page.$eval(
          '#situation-panel',
          (node) => getComputedStyle(node).visibility,
        );
        assert.equal(restored, 'visible');
      },
    );

    await step(
      'entering Cockpit collapses the panel with the other map panels',
      async () => {
        const entered = await page.evaluate(
          () => window.__godsEyeView.styleManager.cockpitView.enter() === true,
        );
        if (!entered) {
          // Cockpit needs a tracked aircraft; without a live flight feed, drive
          // the panel-chrome hook Cockpit calls on entry and exit.
          console.log(
            '  (no trackable aircraft: using the Cockpit panel hook)',
          );
          await page.evaluate(() =>
            window.__godsEyeView.styleManager._panelChrome.enterCockpit(),
          );
        }
        await wait(1200);
        assert.equal((await newsState(page)).panelCollapsed, true);
        await shot(page, '09-cockpit');
        if (entered)
          await page.evaluate(() =>
            window.__godsEyeView.styleManager.cockpitView.exit(),
          );
        else
          await page.evaluate(() =>
            window.__godsEyeView.styleManager._panelChrome.exitCockpit(),
          );
        await wait(800);
        assert.equal(
          (await newsState(page)).panelCollapsed,
          false,
          'exit restores the panel',
        );
      },
    );

    assert.deepEqual(errors, []);
    console.log(
      `news QA passed (${count} steps); screenshots in ${ARTIFACT_DIR}`,
    );
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
