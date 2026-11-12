import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FILING_AREAS,
  FILING_AREA_IDS,
  KEEP_RULE,
  areaCriteria,
} from '../../server/providers/news/filing/areas.js';
import {
  JEV_ENDPOINT,
  JEV_MODEL,
  KEEP_THRESHOLD,
  SECOND_AREA_MIN,
  createJevFiler,
  itemsWithinBudget,
  jevCostUsd,
  jevRequest,
  parseJevAnswer,
} from '../../server/providers/news/filing/jev.js';
import {
  FILING_MAX_ATTEMPTS,
  createFilingRunner,
  filingSettings,
} from '../../server/providers/news/filing/index.js';
import { createNewsService } from '../../server/providers/news/index.js';
import {
  loadNewsRegistry,
  validateNewsTheater,
} from '../../server/providers/news/registry.js';
import { createNewsItemStore } from '../../server/providers/news/store.js';
import {
  NEWS_FILING_AREA_LABELS,
  normalizeNewsSnapshot,
} from '../layers/news/records.js';

const KEY = 'ts-fixture-secret-key';
const NOW = Date.parse('2026-11-12T12:00:00Z');

// ---------------------------------------------------------------------------
// Rule 1: areas

test('the twelve areas match the board slots S1 to S12, in order', () => {
  const indicators = JSON.parse(
    readFileSync(
      new URL('../../public/world/indicators.json', import.meta.url),
      'utf8',
    ),
  );
  const bySlot = new Map(indicators.map((row) => [row.slot, row.shortLabel]));
  assert.deepEqual(
    FILING_AREAS.map((area) => area.label),
    Array.from({ length: 12 }, (_, i) => bySlot.get(`S${i + 1}`)),
  );
  assert.deepEqual(FILING_AREA_IDS, [
    'economy',
    'fiscal',
    'government',
    'people',
    'society',
    'military',
    'energy',
    'food',
    'logistics',
    'technology',
    'diplomacy',
    'culture',
  ]);
  assert.ok(Object.isFrozen(FILING_AREAS));
  assert.ok(FILING_AREAS.every((area) => Object.isFrozen(area)));
  assert.match(KEEP_RULE, /^Keep an item when it is news about how a country/);
  assert.match(FILING_AREAS[5].definition, /^Military and security: armed/);
  // The browser's label map is the same list.
  assert.deepEqual(
    NEWS_FILING_AREA_LABELS,
    Object.fromEntries(FILING_AREAS.map((area) => [area.id, area.label])),
  );
});

// ---------------------------------------------------------------------------
// Rules 2 and 3: the request and the answer

test('a request sends the outlet, headline and snippet only, with the two questions', () => {
  const body = jevRequest({
    id: 'x',
    sourceId: 'bbcworld',
    title: 'Talks resume in Doha',
    snippet: 'Envoys met on Monday.',
    url: 'https://example.org/secret-link',
    perspective: 'international-public',
  });
  assert.equal(body.model, JEV_MODEL);
  assert.equal(JEV_MODEL, 'jev-1.14.0');
  assert.equal(
    body.state,
    'Outlet: bbcworld\nHeadline: Talks resume in Doha\nSnippet: Envoys met on Monday.',
  );
  assert.deepEqual(Object.keys(body), ['model', 'state', 'questions']);
  assert.deepEqual(Object.keys(body.questions), ['keep', 'area']);
  assert.equal(body.questions.keep.type, 'noul');
  assert.ok(body.questions.keep.instructions.endsWith(KEEP_RULE));
  assert.deepEqual(Object.keys(body.questions.keep.criteria), [
    'true',
    'false',
  ]);
  assert.equal(body.questions.area.type, 'choice');
  assert.deepEqual(body.questions.area.criteria, areaCriteria());
  assert.ok(!JSON.stringify(body).includes('example.org'));
  assert.equal(
    jevRequest({ sourceId: 's', title: 't', snippet: '' }).state,
    'Outlet: s\nHeadline: t',
  );
  assert.equal(
    jevRequest({ sourceId: 's', title: 't' }, { model: 'jev-2' }).model,
    'jev-2',
  );
});

const answer = (noul, probabilities, extra = {}) => ({
  model: JEV_MODEL,
  answers: {
    keep: { noul },
    area: { choice: Object.keys(probabilities)[0], probabilities },
  },
  usage: { input_tokens: 800, output_tokens: 3 },
  ...extra,
});

test('the keep threshold is 0.5: 0.49 is set aside, 0.5 is kept', () => {
  assert.equal(KEEP_THRESHOLD, 0.5);
  const kept = parseJevAnswer(answer(0.5, { military: 0.7, diplomacy: 0.3 }));
  assert.deepEqual(kept, {
    keep: true,
    keepProbability: 0.5,
    area: 'military',
    area2: 'diplomacy',
    areaProbability: 0.7,
  });
  const aside = parseJevAnswer(answer(0.49, { military: 0.7 }));
  assert.equal(aside.keep, false);
  assert.equal(aside.keepProbability, 0.49);
  assert.equal(aside.area, null);
  assert.equal(aside.area2, null);
});

test('the second area needs at least 0.25; unknown area names are ignored', () => {
  assert.equal(SECOND_AREA_MIN, 0.25);
  assert.equal(
    parseJevAnswer(answer(0.9, { energy: 0.6, diplomacy: 0.25 })).area2,
    'diplomacy',
  );
  assert.equal(
    parseJevAnswer(answer(0.9, { energy: 0.6, diplomacy: 0.24 })).area2,
    null,
  );
  const unknown = parseJevAnswer(
    answer(0.9, { sport: 0.8, energy: 0.15, fiscal: 0.05 }),
  );
  assert.equal(unknown.area, 'energy');
  assert.equal(unknown.area2, null);
  assert.equal(unknown.areaProbability, 0.15);
});

test('malformed answers give null', () => {
  for (const body of [
    null,
    {},
    { answers: {} },
    answer(undefined, { energy: 1 }),
    answer(null, { energy: 1 }),
    answer('0.9', { energy: 1 }),
    answer(1.2, { energy: 1 }),
    answer(0.9, {}),
    answer(0.9, { sport: 1 }),
    answer(0.9, { energy: 'high' }),
    { answers: { keep: { noul: 0.9 }, area: {} } },
  ])
    assert.equal(parseJevAnswer(body), null, JSON.stringify(body));
});

// ---------------------------------------------------------------------------
// Rule 2: the client

const items = (n, prefix = 'i') =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    sourceId: 'bbcworld',
    title: `Headline ${i}`,
    snippet: '',
  }));

function jevFetch({ statusFor = () => 200, bodyFor, calls = [] } = {}) {
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight--;
    const request = JSON.parse(init.body);
    const status = statusFor(request, calls.length);
    if (status !== 200)
      return new Response(JSON.stringify({ error: 'echo ' + init.body }), {
        status,
      });
    return Response.json(
      bodyFor ? bodyFor(request) : answer(0.9, { diplomacy: 0.8 }),
    );
  };
  return { fetchImpl, calls, peak: () => peak };
}

test('the filer sends one request per item, at most four at a time, and adds up usage', async () => {
  const lines = [];
  const fake = jevFetch();
  const filer = createJevFiler({
    apiKey: KEY,
    fetchImpl: fake.fetchImpl,
    log: (line) => lines.push(line),
  });
  const result = await filer.file(items(10), { nowIso: '2026-11-12T12:00:00.000Z' });
  assert.equal(fake.calls.length, 10);
  assert.ok(fake.peak() <= 4 && fake.peak() > 1, `peak ${fake.peak()}`);
  assert.deepEqual(
    fake.calls.map((c) => c.body.state.split('\n')[1]).sort(),
    items(10)
      .map((i) => 'Headline: ' + i.title)
      .sort(),
  );
  for (const call of fake.calls) {
    assert.equal(call.url, JEV_ENDPOINT);
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(call.init.headers['Content-Type'], 'application/json');
  }
  assert.equal(result.filed, 10);
  assert.deepEqual(result.usage, {
    requests: 10,
    inputTokens: 8000,
    costUsd: jevCostUsd(8000),
  });
  assert.equal(result.results[0].filing.area, 'diplomacy');
  assert.equal(result.results[0].filing.model, JEV_MODEL);
  assert.equal(result.results[0].filing.filedAt, '2026-11-12T12:00:00.000Z');
  assert.equal(lines.length, 1, 'one log line per batch');
  assert.match(lines[0], /10 filed \(10 kept, 0 set aside\)/);
  assert.ok(!lines[0].includes(KEY));
  assert.ok(!lines[0].includes('Headline'));
});

test('a concurrency of two keeps two requests in flight at most', async () => {
  const fake = jevFetch();
  await createJevFiler({
    apiKey: KEY,
    fetchImpl: fake.fetchImpl,
    concurrency: 2,
    log: () => {},
  }).file(items(6));
  assert.equal(fake.peak(), 2);
});

test('429 and 529 are retried three times with exponential backoff, then the item fails', async () => {
  const waits = [];
  const sleep = async (ms) => void waits.push(ms);
  // First item: 429, 529, then fine. Second: always 429.
  const tries = new Map();
  const fake = jevFetch({
    statusFor: (request) => {
      const n = (tries.get(request.state) ?? 0) + 1;
      tries.set(request.state, n);
      if (request.state.includes('Headline 0')) return n === 1 ? 429 : n === 2 ? 529 : 200;
      return 429;
    },
  });
  const result = await createJevFiler({
    apiKey: KEY,
    fetchImpl: fake.fetchImpl,
    concurrency: 1,
    sleep,
    log: () => {},
  }).file(items(2));
  assert.equal(result.results[0].filing.keep, true);
  assert.equal(result.results[1].filing, null);
  assert.equal(result.results[1].error, 'rate_limited');
  assert.equal(tries.get('Outlet: bbcworld\nHeadline: Headline 1'), 4);
  assert.deepEqual(waits, [1500, 3000, 1500, 3000, 6000]);
  assert.equal(result.usage.requests, 7);
  assert.equal(result.failed, 1);
});

test('a 401 or 403 stops the batch and reports an auth error', async () => {
  for (const status of [401, 403]) {
    const fake = jevFetch({ statusFor: () => status });
    const lines = [];
    const result = await createJevFiler({
      apiKey: KEY,
      fetchImpl: fake.fetchImpl,
      concurrency: 1,
      log: (line) => lines.push(line),
    }).file(items(5));
    assert.equal(result.authError, true);
    assert.equal(fake.calls.length, 1, 'no further item is sent');
    assert.equal(result.results[0].error, 'auth');
    assert.equal(result.unsent, 4);
    assert.ok(result.results.slice(1).every((r) => !r.sent));
    assert.ok(!lines.join('\n').includes(KEY));
    assert.ok(!lines.join('\n').includes('echo'), 'no response body logged');
  }
});

test('other failures leave that item unfiled and are counted', async () => {
  const fake = jevFetch({
    statusFor: (request) => (request.state.includes('Headline 1') ? 500 : 200),
    bodyFor: (request) =>
      request.state.includes('Headline 2')
        ? { answers: {} }
        : answer(0.2, { culture: 0.9 }),
  });
  const fetchImpl = async (url, init) => {
    if (JSON.parse(init.body).state.includes('Headline 3'))
      throw new TypeError('fetch failed');
    return fake.fetchImpl(url, init);
  };
  const result = await createJevFiler({
    apiKey: KEY,
    fetchImpl,
    log: () => {},
  }).file(items(4));
  assert.deepEqual(
    result.results.map((r) => r.error),
    [null, 'http_500', 'malformed', 'network'],
  );
  assert.equal(result.results[0].filing.keep, false);
  assert.equal(result.failed, 3);
  assert.equal(result.filed, 1);
});

// ---------------------------------------------------------------------------
// Rule 5: settings

test('settings: filer on with a key, collect by default, model and budget defaults', () => {
  assert.deepEqual(filingSettings({}), {
    filer: 'off',
    enabled: false,
    keyConfigured: false,
    when: 'collect',
    model: 'jev-1.14.0',
    budgetUsd: 0.25,
  });
  const on = filingSettings({ TYPESAFE_API_KEY: KEY });
  assert.equal(on.filer, 'jev');
  assert.equal(on.enabled, true);
  assert.equal(on.when, 'collect');
  assert.equal(
    filingSettings({ TYPESAFE_API_KEY: KEY, NEWS_FILER: 'off' }).enabled,
    false,
  );
  assert.equal(filingSettings({ NEWS_FILER: 'jev' }).enabled, false);
  assert.equal(
    filingSettings({ TYPESAFE_API_KEY: KEY, NEWS_FILER_WHEN: 'refresh' }).when,
    'refresh',
  );
  assert.equal(filingSettings({ NEWS_FILER_WHEN: 'sometimes' }).when, 'collect');
  assert.equal(filingSettings({ NEWS_FILER_MODEL: 'jev-2.0' }).model, 'jev-2.0');
  assert.equal(
    filingSettings({ NEWS_FILER_DAILY_BUDGET_USD: '0.05' }).budgetUsd,
    0.05,
  );
  assert.equal(
    filingSettings({ NEWS_FILER_DAILY_BUDGET_USD: 'lots' }).budgetUsd,
    0.25,
  );
});

// ---------------------------------------------------------------------------
// Rule 4: the theater flag

test('the theater flag "filing" is false by default, must be boolean, and World sets it', async () => {
  const sources = new Map([
    ['s1', { id: 's1', perspective: 'p1', transport: { type: 'rss' } }],
  ]);
  const doc = (extra = {}) => ({
    id: 'mini',
    name: 'Mini',
    brief: ['Scope.'],
    sourceIds: ['s1'],
    categories: [{ id: 'c', label: 'C', color: '#112233' }],
    perspectives: [{ id: 'p1', label: 'P', group: 'g' }],
    gazetteer: [],
    ...extra,
  });
  assert.equal(validateNewsTheater(doc(), sources).filing, false);
  assert.equal(validateNewsTheater(doc({ filing: true }), sources).filing, true);
  assert.equal(
    validateNewsTheater(doc({ filing: false }), sources).filing,
    false,
  );
  assert.throws(
    () => validateNewsTheater(doc({ filing: 'yes' }), sources),
    /filing must be true or false/,
  );
  assert.equal(
    (await loadNewsRegistry({ theaterId: 'world' })).theater.filing,
    true,
  );
  assert.equal(
    (await loadNewsRegistry({ theaterId: 'iran-israel-us' })).theater.filing,
    false,
  );
});

// ---------------------------------------------------------------------------
// Rule 6: storage and budget

async function tempDir(t, prefix) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const SOURCES = new Map([
  [
    'outlet',
    {
      id: 'outlet',
      folder: 'reporting',
      kind: 'independent',
      perspective: 'p1',
      transport: { type: 'rss' },
    },
  ],
]);

function candidate(i, title = `Story ${i}`) {
  return {
    sourceId: 'outlet',
    title,
    url: `https://example.org/${encodeURIComponent(title)}`,
    publishedAt: new Date(NOW - (i + 1) * 60_000).toISOString(),
  };
}

test('a filing and the day ledger persist with the items and survive a restart and deduplication', async (t) => {
  const cacheDir = await tempDir(t, 'gev-filing-store-');
  const store = createNewsItemStore({ theaterId: 'w', cacheDir, now: () => NOW });
  await store.load();
  store.ingest([candidate(0), candidate(1)], SOURCES);
  const [first] = store.list();
  const filing = {
    keep: false,
    keepProbability: 0.1,
    area: null,
    area2: null,
    areaProbability: 0.6,
    model: JEV_MODEL,
    filedAt: new Date(NOW).toISOString(),
  };
  store.setFiling(first.id, filing);
  store.noteFilingAttempt(first.id);
  store.addFilingUsage(NOW, { requests: 2, inputTokens: 1500, costUsd: 0.000063 });
  await store.save();
  const reloaded = createNewsItemStore({ theaterId: 'w', cacheDir, now: () => NOW });
  await reloaded.load();
  assert.deepEqual(reloaded.get(first.id).filing, filing);
  assert.equal(reloaded.get(first.id).filingAttempts, 1);
  assert.deepEqual(reloaded.filingUsage(NOW), {
    day: '2026-11-12',
    requests: 2,
    inputTokens: 1500,
    costUsd: 0.000063,
  });
  // The next day starts at zero.
  assert.equal(reloaded.filingUsage(NOW + 24 * 3600_000).costUsd, 0);
  // The same headline collected again does not replace the filed item.
  assert.equal(reloaded.ingest([candidate(0)], SOURCES).duplicates, 1);
  assert.deepEqual(reloaded.get(first.id).filing, filing);
  assert.deepEqual(
    reloaded.setAside().map((item) => item.id),
    [first.id],
  );
  assert.equal(reloaded.waiting().length, 1);
  const raw = JSON.parse(await readFile(reloaded.cachePath, 'utf8'));
  assert.equal(raw.filingUsage.day, '2026-11-12');
});

test('the budget files as many items as fit at 1,000 tokens each and leaves the rest unfiled', async (t) => {
  const perItem = jevCostUsd(1000);
  assert.equal(itemsWithinBudget(perItem * 2.5), 2);
  assert.equal(itemsWithinBudget(perItem * 3), 3);
  assert.equal(itemsWithinBudget(0), 0);
  assert.equal(itemsWithinBudget(-1), 0);
  const cacheDir = await tempDir(t, 'gev-filing-budget-');
  const store = createNewsItemStore({ theaterId: 'w', cacheDir, now: () => NOW });
  await store.load();
  store.ingest([0, 1, 2, 3, 4].map((i) => candidate(i)), SOURCES);
  // Already spent today: half an item's estimate of a 3-item budget.
  store.addFilingUsage(NOW, { requests: 1, inputTokens: 500, costUsd: perItem / 2 });
  const fake = jevFetch();
  const runner = createFilingRunner({
    store,
    env: {
      TYPESAFE_API_KEY: KEY,
      NEWS_FILER_DAILY_BUDGET_USD: String(perItem * 3),
    },
    fetchImpl: fake.fetchImpl,
    now: () => NOW,
    log: () => {},
  });
  const outcome = await runner.fileNow();
  assert.equal(outcome.filed, 2);
  assert.equal(outcome.overBudget, 3);
  assert.equal(fake.calls.length, 2);
  assert.equal(store.list().filter((item) => item.filing).length, 2);
  // Newest first, as the store lists them.
  assert.deepEqual(
    store
      .list()
      .filter((item) => item.filing)
      .map((item) => item.title),
    ['Story 0', 'Story 1'],
  );
  assert.deepEqual(store.filingUsage(NOW), {
    day: '2026-11-12',
    requests: 3,
    inputTokens: 2100,
    costUsd: Math.round((perItem / 2 + jevCostUsd(1600)) * 1e7) / 1e7,
  });
  // Nothing fits any more: no request is sent.
  store.addFilingUsage(NOW, { costUsd: perItem * 3 });
  assert.equal((await runner.fileNow()).filed, 0);
  assert.equal(fake.calls.length, 2);
});

test('an item is sent at most once; a failed one is retried, three attempts in all', async (t) => {
  const cacheDir = await tempDir(t, 'gev-filing-attempts-');
  const store = createNewsItemStore({ theaterId: 'w', cacheDir, now: () => NOW });
  await store.load();
  store.ingest([candidate(0, 'Good'), candidate(1, 'Broken')], SOURCES);
  const fake = jevFetch({
    statusFor: (request) => (request.state.includes('Broken') ? 500 : 200),
  });
  const runner = createFilingRunner({
    store,
    env: { TYPESAFE_API_KEY: KEY },
    fetchImpl: fake.fetchImpl,
    now: () => NOW,
    log: () => {},
  });
  for (let i = 0; i < 5; i++) await runner.fileNow();
  const sent = fake.calls.map((c) => c.body.state.split('\n')[1]);
  assert.equal(sent.filter((s) => s === 'Headline: Good').length, 1);
  assert.equal(
    sent.filter((s) => s === 'Headline: Broken').length,
    FILING_MAX_ATTEMPTS,
  );
  assert.equal(runner.lastError().code, 'http_500');
});

test('two filing requests at once share one batch (single flight)', async (t) => {
  const cacheDir = await tempDir(t, 'gev-filing-flight-');
  const store = createNewsItemStore({ theaterId: 'w', cacheDir, now: () => NOW });
  await store.load();
  store.ingest([0, 1, 2].map((i) => candidate(i)), SOURCES);
  const fake = jevFetch();
  const runner = createFilingRunner({
    store,
    env: { TYPESAFE_API_KEY: KEY },
    fetchImpl: fake.fetchImpl,
    now: () => NOW,
    log: () => {},
  });
  await Promise.all([runner.fileNow(), runner.fileNow(), runner.fileNow()]);
  assert.equal(fake.calls.length, 3);
});

// ---------------------------------------------------------------------------
// Rules 7, 8, 9: the service

async function miniRoot(t) {
  const root = await tempDir(t, 'gev-filing-root-');
  const dir = path.join(root, 'public', 'news', 'theaters');
  await mkdir(dir, { recursive: true });
  const source = (id, host, starred = false) => ({
    id,
    name: id.toUpperCase(),
    homepage: `https://${host}/`,
    folder: 'reporting',
    kind: 'independent',
    perspective: 'p1',
    languages: ['en'],
    starred,
    transport: { type: 'rss', url: `https://${host}/feed` },
    credit: id,
  });
  await writeFile(
    path.join(root, 'public', 'news', 'sources.json'),
    JSON.stringify({
      sources: [source('alpha', 'alpha.example'), source('beta', 'beta.example')],
    }),
  );
  const theater = (id, filing) => ({
    id,
    name: id,
    situationBrief: false,
    ...(filing !== undefined && { filing }),
    brief: ['Scope.'],
    sourceIds: ['alpha', 'beta'],
    categories: [{ id: 'c', label: 'C', color: '#112233' }],
    perspectives: [{ id: 'p1', label: 'P', group: 'g' }],
    gazetteer: [],
  });
  await writeFile(path.join(dir, 'filed.json'), JSON.stringify(theater('filed', true)));
  await writeFile(path.join(dir, 'plain.json'), JSON.stringify(theater('plain')));
  return root;
}

const SPORT = /football|derby/i;

/** Feeds answer with two headlines each; Jev sets sport aside. */
function upstream({ calls, jevStatus = () => 200, feeds = {} }) {
  return async (raw, init) => {
    const url = new URL(raw);
    calls.push(url.hostname);
    if (url.hostname === 'api.typesafe.ai') {
      const request = JSON.parse(init.body);
      const status = jevStatus(request);
      if (status !== 200)
        return new Response(JSON.stringify({ detail: init.body }), { status });
      return Response.json(
        SPORT.test(request.state)
          ? answer(0.08, { culture: 0.7, society: 0.2 })
          : answer(0.93, { government: 0.6, diplomacy: 0.3 }),
      );
    }
    const titles = feeds[url.hostname] ?? [
      `${url.hostname} cabinet resigns`,
      `${url.hostname} football derby ends level`,
    ];
    return new Response(
      `<rss><channel>${titles
        .map(
          (title, i) =>
            `<item><title>${title}</title><link>https://${url.hostname}/s${i}-${encodeURIComponent(title)}</link><pubDate>Thu, 12 Nov 2026 1${i}:00:00 GMT</pubDate></item>`,
        )
        .join('')}</channel></rss>`,
    );
  };
}

async function service(
  t,
  { env = {}, jevStatus, digestRunner, theater = 'filed', wrapFetch } = {},
) {
  const cacheDir = await tempDir(t, 'gev-filing-cache-');
  const logs = [];
  t.mock.method(console, 'warn', (...args) => logs.push(args.join(' ')));
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  const calls = [];
  const sent = [];
  const options = {
    root: await miniRoot(t),
    cacheDir,
    now: () => NOW,
    env: {
      NEWS_DIGEST_AGENT: 'perplexity',
      PERPLEXITY_API_KEY: 'pplx-fixture',
      TYPESAFE_API_KEY: KEY,
      ...env,
    },
    fetchImpl: wrapFetch
      ? wrapFetch(upstream({ calls, jevStatus }))
      : upstream({ calls, jevStatus }),
    timers: { setInterval: () => ({}), clearInterval() {} },
    filingSleep: async () => {},
    digestRunner:
      digestRunner ??
      (async ({ newItems }) => {
        sent.push(newItems.map((item) => item.title));
        return {
          stories: [],
          counts: {
            droppedItemIds: 0,
            duplicateItemIds: 0,
            rejectedStories: 0,
            unknownStoryIds: 0,
            clampedCategories: 0,
          },
          processedItemIds: newItems.map((item) => item.id),
          openStoryIds: [],
          leftOut: 0,
          model: 'fixture',
          cost: { costUsd: 0.01, estimated: false, inputTokens: 1, outputTokens: 1 },
          responseId: 'r',
        };
      }),
  };
  const news = createNewsService(options);
  await news.snapshot(theater);
  return { news, calls, sent, logs, options };
}

const jevCalls = (calls) => calls.filter((h) => h === 'api.typesafe.ai').length;

test('collect mode files new headlines after a cycle, once, without holding the cycle', async (t) => {
  const { news, calls, logs } = await service(t);
  const ctx = await news.context('filed');
  await ctx.collector.collectAll();
  await news.filingIdle('filed');
  assert.equal(jevCalls(calls), 4, 'four headlines, one request each');
  const items = ctx.store.list();
  assert.ok(items.every((item) => item.filing));
  const sport = items.filter((item) => SPORT.test(item.title));
  assert.ok(sport.every((item) => item.filing.keep === false));
  assert.ok(
    items
      .filter((item) => !SPORT.test(item.title))
      .every((item) => item.filing.area === 'government' && item.filing.area2 === 'diplomacy'),
  );
  // A second cycle with nothing new sends nothing.
  await ctx.collector.collectAll();
  await news.filingIdle('filed');
  assert.equal(jevCalls(calls), 4);
  // Snapshot: items carry their filing; the filing block reports usage.
  const snapshot = await news.snapshot('filed');
  assert.ok(snapshot.items.every((item) => item.filing));
  assert.deepEqual(snapshot.filing, {
    enabled: true,
    provider: 'jev',
    model: 'jev-1.14.0',
    when: 'collect',
    keyConfigured: true,
    theaterOptedIn: true,
    today: { requests: 4, inputTokens: 3200, costUsd: Math.round(jevCostUsd(3200) * 1e7) / 1e7 },
    budgetUsd: 0.25,
    exhausted: false,
    lastError: null,
  });
  assert.equal(snapshot.digest.undigestedCount, 2, 'set-aside items do not wait');
  const status = await news.status();
  assert.equal(status.filing.enabled, true);
  assert.equal(status.filing.when, 'collect');
  assert.equal(
    status.theaters.find((theater) => theater.id === 'filed').filing.theaterOptedIn,
    true,
  );
  // The key is never exposed or logged.
  assert.ok(!JSON.stringify(snapshot).includes(KEY));
  assert.ok(!JSON.stringify(status).includes(KEY));
  assert.ok(!logs.join('\n').includes(KEY));
  assert.equal(logs.filter((line) => line.includes('[news] filing')).length, 1);
  await news.stop();
});

test('collect mode never fails or slows the cycle when Jev fails', async (t) => {
  const { news, calls } = await service(t, { jevStatus: () => 500 });
  const ctx = await news.context('filed');
  await assert.doesNotReject(ctx.collector.collectAll());
  await news.filingIdle('filed');
  assert.equal(ctx.store.size(), 4);
  assert.ok(ctx.store.list().every((item) => !item.filing));
  assert.equal(jevCalls(calls), 4);
  const snapshot = await news.snapshot('filed');
  assert.equal(snapshot.filing.lastError.code, 'http_500');
  assert.match(snapshot.filing.lastError.message, /4 of 4 headlines/);
  await news.stop();
});

test('collect mode does not hold the cycle while Jev is slow', async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let jevStarted = 0;
  const { news } = await service(t, {
    wrapFetch: (inner) => async (raw, init) => {
      if (String(raw).includes('typesafe')) {
        jevStarted++;
        await gate;
      }
      return inner(raw, init);
    },
  });
  const ctx = await news.context('filed');
  // Resolves while every Jev request is still waiting.
  await ctx.collector.collectAll();
  assert.equal(ctx.store.size(), 4);
  assert.ok(jevStarted > 0);
  assert.ok(ctx.store.list().every((item) => !item.filing));
  release();
  await news.filingIdle('filed');
  assert.ok(ctx.store.list().every((item) => item.filing));
  await news.stop();
});

test('collect mode stays off for a theater without the flag, and when the filer is off', async (t) => {
  const plain = await service(t, { theater: 'plain' });
  await (await plain.news.context('plain')).collector.collectAll();
  await plain.news.filingIdle('plain');
  assert.equal(jevCalls(plain.calls), 0);
  assert.equal((await plain.news.snapshot('plain')).filing.theaterOptedIn, false);
  await plain.news.stop();
  const off = await service(t, { env: { NEWS_FILER: 'off' } });
  await (await off.news.context('filed')).collector.collectAll();
  await off.news.filingIdle('filed');
  assert.equal(jevCalls(off.calls), 0);
  assert.equal((await off.news.snapshot('filed')).filing.enabled, false);
  await off.news.stop();
});

test('the digest never reads set-aside items; unfiled items count as kept', async (t) => {
  const { news, sent } = await service(t);
  const ctx = await news.context('filed');
  await ctx.collector.collectAll();
  await news.filingIdle('filed');
  // One more headline arrives while filing is off: unfiled, so kept.
  ctx.store.ingest(
    [
      {
        sourceId: 'alpha',
        title: 'Unfiled election headline',
        url: 'https://alpha.example/unfiled',
        publishedAt: new Date(NOW - 60_000).toISOString(),
      },
    ],
    ctx.registry.sourcesById,
  );
  const { status, body } = await news.requestDigest('filed');
  assert.equal(status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 3);
  assert.ok(sent[0].every((title) => !SPORT.test(title)));
  assert.ok(sent[0].includes('Unfiled election headline'));
  assert.equal(body.run.setAside, 2);
  assert.equal(body.run.filedThisRun, 0, 'collect mode files nothing at Refresh');
  // Set-aside items stay in the store and the Raw feed, undigested.
  const snapshot = await news.snapshot('filed');
  const aside = snapshot.items.filter((item) => item.filing?.keep === false);
  assert.equal(aside.length, 2);
  assert.ok(aside.every((item) => item.digestedAt === null));
  // Only set-aside items wait: nothing new, and no call is made.
  assert.equal(snapshot.digest.undigestedCount, 0);
  assert.equal(snapshot.digest.disabledReason, 'nothing_new');
  const again = await news.requestDigest('filed');
  assert.equal(again.body.skipped, true);
  assert.equal(again.body.run.setAside, 2);
  assert.equal(sent.length, 1);
  await news.stop();
});

test('refresh mode files at the start of a Refresh, before items are chosen', async (t) => {
  const { news, sent, calls } = await service(t, {
    env: { NEWS_FILER_WHEN: 'refresh' },
  });
  const ctx = await news.context('filed');
  await ctx.collector.collectAll();
  await news.filingIdle('filed');
  assert.equal(jevCalls(calls), 0, 'refresh mode files nothing on collect');
  const { body } = await news.requestDigest('filed');
  assert.equal(jevCalls(calls), 4);
  assert.equal(body.run.filedThisRun, 4);
  assert.equal(body.run.setAside, 2);
  assert.equal(sent[0].length, 2);
  assert.ok(sent[0].every((title) => !SPORT.test(title)));
  assert.equal((await news.snapshot('filed')).filing.when, 'refresh');
  await news.stop();
});

test('refresh mode fails open: a failing filer never fails the digest', async (t) => {
  const { news, sent, calls } = await service(t, {
    env: { NEWS_FILER_WHEN: 'refresh' },
    jevStatus: () => 401,
  });
  const ctx = await news.context('filed');
  await ctx.collector.collectAll();
  const { status, body } = await news.requestDigest('filed');
  assert.equal(status, 200);
  // Four lanes start together; the refusal stops any further request.
  assert.ok(jevCalls(calls) <= 4);
  assert.equal(body.run.filedThisRun, 0);
  assert.equal(body.run.setAside, 0);
  assert.equal(sent[0].length, 4, 'unfiled items are all kept');
  const snapshot = await news.snapshot('filed');
  assert.equal(snapshot.filing.lastError.code, 'auth');
  assert.ok(!JSON.stringify(snapshot).includes(KEY));
  await news.stop();
});

test('the snapshot normalizer keeps filing on items and the filing block, never a key', () => {
  const normalized = normalizeNewsSnapshot({
    theater: { id: 'world' },
    items: [
      {
        id: 'a',
        title: 'T',
        filing: {
          keep: true,
          keepProbability: 0.9,
          area: 'energy',
          area2: 'sport',
          areaProbability: 0.7,
          model: JEV_MODEL,
          filedAt: '2026-11-12T12:00:00Z',
        },
      },
      { id: 'b', title: 'U', filing: { keep: 'maybe' } },
      { id: 'c', title: 'V' },
    ],
    stories: [],
    filing: {
      enabled: true,
      provider: 'jev',
      model: JEV_MODEL,
      when: 'collect',
      keyConfigured: true,
      theaterOptedIn: true,
      today: { requests: 3, inputTokens: 2400, costUsd: 0.0001 },
      budgetUsd: 0.25,
      exhausted: false,
      lastError: { code: 'auth', message: 'TypeSafe refused the key', at: '2026-11-12T12:00:00Z' },
      apiKey: KEY,
    },
  });
  assert.deepEqual(normalized.items[0].filing, {
    keep: true,
    keepProbability: 0.9,
    area: 'energy',
    area2: null,
    areaProbability: 0.7,
    model: JEV_MODEL,
    filedAt: '2026-11-12T12:00:00.000Z',
  });
  assert.equal(normalized.items[1].filing, null);
  assert.equal(normalized.items[2].filing, null);
  assert.equal(normalized.filing.enabled, true);
  assert.equal(normalized.filing.today.requests, 3);
  assert.equal(normalized.filing.lastError.code, 'auth');
  assert.ok(!JSON.stringify(normalized).includes(KEY));
  assert.equal(normalizeNewsSnapshot({ theater: { id: 'w' }, items: [], stories: [] }).filing.enabled, false);
});

test('filing is credited: what is sent to TypeSafe and that its terms apply', async () => {
  const { DATA_CREDITS } = await import('./dataCredits.js');
  const credit = DATA_CREDITS.find((entry) => entry.key === 'war-monitor-filing');
  assert.ok(credit);
  assert.match(credit.html, /outlet id, headline and snippet are sent to TypeSafe/);
  assert.match(credit.html, /https:\/\/docs\.typesafe\.ai\/legal/);
  const sources = readFileSync(
    new URL('../../DATA_SOURCES.md', import.meta.url),
    'utf8',
  );
  const row = sources.split('\n').find((line) => line.includes('api.typesafe.ai'));
  assert.ok(row);
  assert.match(row, /outlet id, headline and snippet are sent to TypeSafe/);
  assert.match(row, /docs\.typesafe\.ai\/legal/);
});
