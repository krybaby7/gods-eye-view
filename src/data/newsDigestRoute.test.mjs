import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGdeltQueue } from '../../server/providers/news/fetchers/gdeltDomain.js';
import {
  createNewsService,
  newsProxy,
} from '../../server/providers/news/index.js';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const KEY = 'pplx-fixture-secret';

/** Feeds answer with one headline each; Perplexity groups what it is sent. */
function upstream({ perplexity, calls }) {
  return async (raw, init) => {
    const url = new URL(raw);
    calls.push(url.hostname);
    if (url.hostname === 'api.perplexity.ai')
      return perplexity(JSON.parse(init.body), init);
    // CENTCOM has no current feed and arrives through GDELT.
    if (url.hostname === 'api.gdeltproject.org')
      return Response.json({
        articles: url.searchParams.get('query').includes('domainis:centcom.mil')
          ? [
              {
                url: 'https://www.centcom.mil/story',
                title: 'CENTCOM strikes drone storage site near Bandar Abbas',
                seendate: '20261026T080000Z',
                language: 'English',
              },
            ]
          : [],
      });
    if (url.hostname === 't.me') return new Response('<html></html>');
    const title =
      url.hostname === 'en.irna.ir'
        ? 'Explosion at Bandar Abbas port warehouse, officials say'
        : url.hostname === 'www.aljazeera.com'
          ? 'Blast reported at Iranian port of Bandar Abbas'
          : `${url.hostname} unrelated headline`;
    return new Response(
      `<rss><channel><item><title>${title}</title><link>https://${url.hostname}/story</link><pubDate>Mon, 26 Oct 2026 08:00:00 GMT</pubDate></item></channel></rss>`,
    );
  };
}

/** A Perplexity double that cites the three Bandar Abbas items. */
function groupingModel(costs = []) {
  return (body) => {
    const input = body.input[0].content;
    const items = JSON.parse(
      input.slice(input.indexOf('New items')).replace(/^[^\n]*\n/, ''),
    );
    const pick = (publisher) =>
      items.find((item) => item.publisher === publisher)?.id;
    const ids = [
      pick('US Central Command'),
      pick('IRNA'),
      pick('Al Jazeera English'),
      'invented-id',
    ];
    const cost = costs.shift() ?? 0.15;
    return Response.json({
      id: 'resp_fixture',
      object: 'response',
      model: 'anthropic/claude-sonnet-5-5',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                stories: [
                  {
                    id: null,
                    title: 'Strike reported at Bandar Abbas port',
                    summary:
                      'CENTCOM said it struck a drone storage site. IRNA said a warehouse exploded.',
                    category: 'war-military',
                    placeName: 'Bandar Abbas',
                    lat: 1,
                    lon: 1,
                    eventAt: '2026-10-26T03:00:00Z',
                    itemIds: ids,
                    claims: [
                      {
                        text: 'A blast hit the port',
                        actor: null,
                        type: 'occurrence',
                        itemIds: [ids[1], ids[2]],
                      },
                      {
                        text: 'CENTCOM conducted the strike',
                        actor: 'US',
                        type: 'attribution',
                        itemIds: [ids[0]],
                      },
                    ],
                    whatsNew: '',
                    contradictions: [
                      'IRNA says a civilian warehouse; CENTCOM says a drone storage site.',
                    ],
                    status: 'open',
                  },
                ],
              }),
            },
          ],
        },
      ],
      usage: {
        input_tokens: 30000,
        output_tokens: 4000,
        total_tokens: 34000,
        cost: {
          currency: 'USD',
          input_cost: cost / 2,
          output_cost: cost / 2,
          total_cost: cost,
        },
      },
    });
  };
}

async function setup(
  t,
  { env = {}, perplexity = groupingModel(), digestRunner } = {},
) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'gev-news-digest-route-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  const calls = [];
  const options = {
    cacheDir,
    now: () => NOW,
    env: { PERPLEXITY_API_KEY: KEY, ...env },
    fetchImpl: upstream({ perplexity, calls }),
    gdeltQueue: createGdeltQueue({ sleep: async () => {} }),
    timers: { setInterval: () => ({}), clearInterval() {} },
    ...(digestRunner ? { digestRunner } : {}),
  };
  const news = createNewsService(options);
  await news.snapshot();
  await (await news.context()).collector.collectAll();
  return { news, calls, options };
}

test('collection never calls the model; only an explicit digest does', async (t) => {
  const { calls } = await setup(t);
  assert.equal(calls.includes('api.perplexity.ai'), false);
});

test('a digest turns items into a story with code-owned fields', async (t) => {
  const { news, calls } = await setup(t);
  const before = await news.snapshot();
  assert.equal(before.digest.disabledReason, null);
  assert.equal(before.digest.keyConfigured, true);
  assert.equal(
    JSON.stringify(before).includes(KEY),
    false,
    'the key never leaves the server',
  );
  const { status, body } = await news.requestDigest();
  assert.equal(status, 200);
  assert.equal(calls.filter((host) => host === 'api.perplexity.ai').length, 1);
  assert.equal(body.run.status, 'ok');
  assert.equal(body.run.costUsd, 0.15);
  assert.equal(body.run.model, 'anthropic/claude-sonnet-5-5');
  assert.equal(body.run.storiesCreated, 1);
  assert.equal(body.run.droppedItemIds, 1, 'the invented id was dropped');
  assert.equal(body.run.itemCount, before.items.length);
  assert.equal(body.run.unassignedCount, before.items.length - 3);

  const after = await news.snapshot();
  const [story] = after.stories;
  assert.match(story.id, /^st_[0-9a-f]{8}$/);
  assert.equal(story.itemIds.length, 3);
  assert.deepEqual(story.location, {
    lat: 27.1832,
    lon: 56.2666,
    precision: 'city',
    method: 'gazetteer',
    name: 'Bandar Abbas',
  });
  assert.deepEqual(story.perspectives, [
    'international-regional',
    'iran-state',
    'us-mil',
  ]);
  assert.equal(story.sourceCount, 3);
  // Al Jazeera (independent, international) with IRNA (iran) corroborates,
  // which outranks the recorded contradiction.
  assert.equal(story.verification, 'corroborated');
  assert.deepEqual(
    story.claims.map((claim) => claim.status),
    ['corroborated', 'participant-claim'],
  );
  assert.equal(after.lastRun.id, body.run.id);
  assert.equal(after.budget.spentTodayUsd, 0.15);
  assert.equal(after.budget.remainingUsd, 1.85);
  assert.equal(after.budget.lastRunCostUsd, 0.15);
  const cited = new Set(story.itemIds);
  for (const item of after.items) {
    assert.ok(item.digestedAt, 'every processed item is marked');
    assert.equal(item.storyId, cited.has(item.id) ? story.id : null);
  }
  assert.equal(after.digest.disabledReason, 'nothing_new');
});

test('nothing new skips without calling the model and records the skip', async (t) => {
  const { news, calls } = await setup(t);
  await news.requestDigest();
  const { status, body } = await news.requestDigest();
  assert.equal(status, 200);
  assert.equal(body.skipped, true);
  assert.equal(body.message, 'Nothing new since the last digest');
  assert.equal(calls.filter((host) => host === 'api.perplexity.ai').length, 1);
  assert.equal((await news.snapshot()).lastRun.status, 'skipped');
});

test('no key answers 503 and never reaches Perplexity', async (t) => {
  const { news, calls } = await setup(t, { env: { PERPLEXITY_API_KEY: '' } });
  const snapshot = await news.snapshot();
  assert.equal(snapshot.digest.disabledReason, 'no_key');
  assert.deepEqual(await news.requestDigest(), {
    status: 503,
    body: { error: 'no_key', keyRequired: true },
  });
  assert.equal(calls.includes('api.perplexity.ai'), false);
});

test('one run in flight at a time', async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const model = groupingModel();
  const { news } = await setup(t, {
    perplexity: async (body, init) => {
      await gate;
      return model(body, init);
    },
  });
  const first = news.requestDigest();
  await new Promise((resolve) => setImmediate(resolve));
  const snapshot = await news.snapshot();
  assert.equal(snapshot.digest.running, true);
  assert.equal(snapshot.digest.disabledReason, 'in_flight');
  const second = await news.requestDigest();
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'in_flight');
  release();
  assert.equal((await first).status, 200);
});

test("the daily budget refuses runs once today's costs reach it", async (t) => {
  const { news, options } = await setup(t, {
    env: { NEWS_DIGEST_DAILY_BUDGET_USD: '0.10' },
  });
  assert.equal((await news.requestDigest()).status, 200);
  // New items arrive; the spent 0.15 already exceeds 0.10.
  const ctx = await news.context();
  ctx.store.ingest(
    [
      {
        sourceId: 'reuters',
        title: 'Fresh item',
        url: 'https://reuters.com/fresh',
        publishedAt: '2026-10-26T11:00:00Z',
        transport: 'gdelt-domain',
      },
    ],
    ctx.registry.sourcesById,
  );
  const refused = await news.requestDigest();
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error, 'over_budget');
  assert.match(refused.body.reason, /\$0\.15 of the \$0\.10 daily budget/);
  assert.equal((await news.snapshot()).digest.disabledReason, 'over_budget');
  assert.equal(options.env.NEWS_DIGEST_DAILY_BUDGET_USD, '0.10');
});

test('a failed run is recorded with what it cost and counts toward the budget', async (t) => {
  const { news } = await setup(t, {
    digestRunner: async () => {
      throw Object.assign(new Error('digest output was not valid JSON'), {
        code: 'malformed_output',
        cost: {
          costUsd: 0.2,
          estimated: false,
          inputTokens: 1,
          outputTokens: 1,
        },
        model: 'anthropic/claude-sonnet-5-5',
      });
    },
  });
  const { status, body } = await news.requestDigest();
  assert.equal(status, 502);
  assert.equal(body.error, 'malformed_output');
  assert.equal(body.run.status, 'failed');
  assert.equal(body.run.costUsd, 0.2);
  const snapshot = await news.snapshot();
  assert.equal(snapshot.budget.spentTodayUsd, 0.2);
  assert.deepEqual(snapshot.stories, []);
  assert.ok(
    snapshot.items.every((item) => item.digestedAt === null),
    'items stay undigested',
  );
});

test('stories survive a restart, with cited items kept after the item store drops them', async (t) => {
  const { news, options } = await setup(t);
  await news.requestDigest();
  const restarted = createNewsService({
    ...options,
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  const snapshot = await restarted.snapshot();
  assert.equal(snapshot.stories.length, 1);
  assert.equal(snapshot.lastDigest.status, 'ok');
  await restarted.stop();
});

function install(plugin) {
  let handler;
  plugin.configureServer({
    httpServer: new EventEmitter(),
    middlewares: { use: (route, callback) => (handler = callback) },
  });
  return async (url, { method = 'POST', headers = {} } = {}) => {
    const res = {
      headersSent: false,
      statusCode: 200,
      headers: {},
      writeHead(status, h) {
        Object.assign(this, {
          statusCode: status,
          headers: h,
          headersSent: true,
        });
      },
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(body) {
        this.body = JSON.parse(body);
      },
    };
    await handler(
      {
        url,
        method,
        headers: { host: 'localhost:5173', ...headers },
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );
    return res;
  };
}

test('the digest route is POST-only, same-site gated and rate limited', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'gev-news-digest-gate-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const request = install(
    newsProxy({
      cacheDir,
      env: {},
      fetchImpl: async () => new Response('', { status: 503 }),
      timers: { setInterval: () => ({}), clearInterval() {} },
    }),
  );
  assert.equal((await request('/digest', { method: 'GET' })).statusCode, 405);
  const crossSite = await request('/digest', {
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(crossSite.statusCode, 403);
  const statuses = [];
  for (let i = 0; i < 6; i++)
    statuses.push((await request('/digest')).statusCode);
  assert.deepEqual(statuses, [503, 503, 503, 503, 429, 429]);
});

test('two Refreshes in the same moment make one paid call', async (t) => {
  let modelCalls = 0;
  const model = groupingModel();
  const { news } = await setup(t, {
    perplexity: async (body, init) => {
      modelCalls++;
      return model(body, init);
    },
  });
  const results = await Promise.all([
    news.requestDigest(),
    news.requestDigest(),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(modelCalls, 1);
});
