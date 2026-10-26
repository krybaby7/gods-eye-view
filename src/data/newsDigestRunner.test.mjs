import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIGEST_ENDPOINT,
  DIGEST_FALLBACK_PRICE_PER_MTOK,
  DIGEST_MAX_OUTPUT_TOKENS,
  buildDigestInstructions,
  digestSchema,
  parseDigestText,
  responseCost,
  runDigest,
  selectDigestItems,
  selectOpenStories,
  validateDigestOutput,
} from '../../server/providers/news/digest/runner.js';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const theater = {
  id: 'fixture',
  name: 'Fixture theater',
  brief: ['First paragraph.', 'Second paragraph.'],
  categories: [
    { id: 'war-military', label: 'War & military', color: '#ef4444' },
    { id: 'humanitarian-casualties', label: 'Humanitarian', color: '#f59e0b' },
  ],
  gazetteer: [
    {
      name: 'Bandar Abbas',
      lat: 27.18,
      lon: 56.27,
      precision: 'city',
      aliases: ['بندرعباس'],
    },
    {
      name: 'Khan Younis',
      lat: 31.35,
      lon: 34.31,
      precision: 'city',
      aliases: ['Khan Yunis'],
    },
  ],
};
const sourcesById = new Map([
  ['centcom', { id: 'centcom', name: 'US Central Command', starred: true }],
  ['irna', { id: 'irna', name: 'IRNA', starred: false }],
]);
const item = (id, sourceId = 'irna', minutesAgo = 10) => ({
  id,
  sourceId,
  kind: 'state',
  perspective: sourceId === 'irna' ? 'iran-state' : 'us-mil',
  title: `Title ${id}`,
  titleOriginal: `عنوان ${id}`,
  snippet: `Snippet ${id}`,
  publishedAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
  collectedAt: new Date(NOW).toISOString(),
});
const storyOut = (overrides = {}) => ({
  id: null,
  title: 'Strike reported at Bandar Abbas port',
  summary: 'IRNA reported a strike. CENTCOM said it targeted drone storage.',
  category: 'war-military',
  placeName: 'Bandar Abbas',
  lat: null,
  lon: null,
  eventAt: '2026-10-26T03:00:00Z',
  itemIds: ['a', 'b'],
  claims: [
    {
      text: 'A strike hit the port area',
      actor: null,
      type: 'occurrence',
      itemIds: ['a', 'b'],
    },
    {
      text: 'CENTCOM conducted it',
      actor: 'US',
      type: 'attribution',
      itemIds: ['b', 'zzz'],
    },
  ],
  whatsNew: '',
  contradictions: [],
  status: 'open',
  ...overrides,
});
const completed = (stories, extra = {}) => ({
  id: 'resp_1',
  object: 'response',
  model: 'anthropic/claude-sonnet-5-5',
  status: 'completed',
  output: [
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: JSON.stringify({ stories }) }],
    },
  ],
  usage: {
    input_tokens: 31000,
    output_tokens: 6000,
    total_tokens: 37000,
    cost: {
      currency: 'USD',
      input_cost: 0.062,
      output_cost: 0.06,
      total_cost: 0.122,
    },
  },
  ...extra,
});
const runOptions = (fetchImpl, overrides = {}) => ({
  apiKey: 'pplx-test-secret',
  theater,
  sourcesById,
  openStories: [],
  newItems: [item('a'), item('b', 'centcom')],
  knownItemIds: new Set(['a', 'b']),
  nowMs: NOW,
  fetchImpl,
  ...overrides,
});

test('the request uses the agreed model, no tools, one step and strict schema output', async () => {
  let request;
  const result = await runDigest(
    runOptions(async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return Response.json(completed([storyOut()]));
    }),
  );
  assert.equal(request.url, DIGEST_ENDPOINT);
  assert.equal(request.url, 'https://api.perplexity.ai/v1/responses');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.Authorization, 'Bearer pplx-test-secret');
  const body = request.body;
  assert.equal(body.model, 'anthropic/claude-sonnet-5-5');
  assert.deepEqual(body.tools, []);
  assert.equal(body.max_steps, 1);
  assert.equal(body.max_output_tokens, 16000);
  assert.equal(body.stream, false);
  assert.equal('effort' in body, false);
  assert.equal('preset' in body, false);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.name, 'war_monitor_digest');
  assert.deepEqual(body.input[0].type, 'message');
  assert.deepEqual(body.input[0].role, 'user');
  // The model sees original titles, publisher names and ids — never URLs.
  assert.match(body.input[0].content, /عنوان a/);
  assert.match(body.input[0].content, /US Central Command/);
  assert.doesNotMatch(body.input[0].content, /https?:/);

  assert.equal(result.model, 'anthropic/claude-sonnet-5-5');
  assert.deepEqual(result.cost, {
    costUsd: 0.122,
    estimated: false,
    inputTokens: 31000,
    outputTokens: 6000,
  });
  assert.deepEqual([...result.processedItemIds].sort(), ['a', 'b']);
  assert.equal(result.leftOut, 0);
  assert.equal(result.stories.length, 1);
  assert.deepEqual(result.stories[0].claims[1].itemIds, ['b']);
});

test('instructions carry rules, brief, categories and place names but no coordinates', () => {
  const text = buildDigestInstructions(theater);
  assert.match(text, /cite item ids exactly as given/i);
  assert.match(text, /Never output URLs/);
  assert.match(text, /Prefer updating an open story/);
  assert.match(text, /at most one story/);
  assert.match(text, /Second paragraph\./);
  assert.match(text, /- humanitarian-casualties: Humanitarian/);
  assert.match(text, /^Khan Younis \(Khan Yunis\)$/m);
  assert.doesNotMatch(text, /27\.18|56\.27/);
  assert.equal(buildDigestInstructions(theater), text, 'stable across runs');
});

test('the schema is strict: every object closed, every key required, nullables via anyOf', () => {
  const schema = digestSchema(['war-military']);
  const story = schema.properties.stories.items;
  assert.equal(schema.additionalProperties, false);
  assert.equal(story.additionalProperties, false);
  assert.deepEqual(
    [...story.required].sort(),
    Object.keys(story.properties).sort(),
  );
  assert.deepEqual(story.properties.category.enum, ['war-military']);
  assert.deepEqual(story.properties.lat, {
    anyOf: [{ type: 'number' }, { type: 'null' }],
  });
  const claim = story.properties.claims.items;
  assert.equal(claim.additionalProperties, false);
  assert.deepEqual(
    [...claim.required].sort(),
    Object.keys(claim.properties).sort(),
  );
  assert.doesNotMatch(
    JSON.stringify(schema),
    /minimum|maximum|maxLength|minLength|"url"/,
  );
});

test('unknown ids are dropped and counted; stories without valid ids are rejected', () => {
  const { stories, counts } = validateDigestOutput(
    {
      stories: [
        storyOut({ itemIds: ['a', 'ghost', 'b', 'a'] }),
        storyOut({ title: 'Second', itemIds: ['b', 'ghost2'] }),
        storyOut({ title: 'Nothing real', itemIds: ['ghost3'] }),
        null,
      ],
    },
    {
      knownItemIds: new Set(['a', 'b']),
      openStories: new Map(),
      categoryIds: ['war-military'],
      nowMs: NOW,
    },
  );
  assert.equal(stories.length, 1);
  assert.deepEqual(stories[0].itemIds, ['a', 'b']);
  assert.deepEqual(counts, {
    droppedItemIds: 3,
    duplicateItemIds: 1,
    rejectedStories: 3,
    unknownStoryIds: 0,
    clampedCategories: 0,
  });
});

test('story ids continue only for open stories; categories clamp; URLs and bad values are removed', () => {
  const open = new Map([
    ['st_open', { id: 'st_open', category: 'humanitarian-casualties' }],
  ]);
  const { stories, counts } = validateDigestOutput(
    {
      stories: [
        storyOut({ id: 'st_open', category: 'sports', itemIds: ['a'] }),
        storyOut({ id: 'st_open', itemIds: ['b'] }),
        storyOut({
          id: 'st_invented',
          itemIds: ['c'],
          title: 'See https://evil.example/x for more',
          lat: 95,
          lon: 10,
          eventAt: '2027-01-01T00:00:00Z',
          status: 'archived',
          claims: [{ text: 'x', actor: '', type: 'rumour', itemIds: ['c'] }],
        }),
      ],
    },
    {
      knownItemIds: new Set(['a', 'b', 'c']),
      openStories: open,
      categoryIds: ['war-military', 'humanitarian-casualties'],
      nowMs: NOW,
    },
  );
  assert.equal(stories[0].id, 'st_open');
  assert.equal(stories[0].category, 'humanitarian-casualties');
  assert.equal(
    stories[1].id,
    null,
    'a second claim on one open id becomes a new story',
  );
  assert.equal(stories[2].id, null);
  assert.equal(stories[2].title, 'See for more');
  assert.equal(stories[2].lat, null);
  assert.equal(stories[2].lon, null);
  assert.equal(stories[2].eventAt, null);
  assert.equal(stories[2].status, 'open');
  assert.deepEqual(stories[2].claims, [
    { text: 'x', actor: null, type: 'other', itemIds: ['c'] },
  ]);
  assert.equal(counts.unknownStoryIds, 2);
  assert.equal(counts.clampedCategories, 1);
});

test('malformed JSON fails the run but still reports what the call cost', async () => {
  const body = completed([]);
  body.output[0].content[0].text = '{"stories": [ unterminated';
  await assert.rejects(
    runDigest(runOptions(async () => Response.json(body))),
    (error) =>
      error.code === 'malformed_output' && error.cost.costUsd === 0.122,
  );
  const wrongShape = completed([]);
  wrongShape.output[0].content[0].text = '{"items": []}';
  await assert.rejects(
    runDigest(runOptions(async () => Response.json(wrongShape))),
    (error) =>
      error.code === 'malformed_output' && error.cost.costUsd === 0.122,
  );
  assert.deepEqual(parseDigestText('```json\n{"stories":[]}\n```'), {
    stories: [],
  });
});

test('a missing key never reaches the network', async () => {
  let called = false;
  await assert.rejects(
    runDigest(
      runOptions(
        async () => {
          called = true;
        },
        { apiKey: '' },
      ),
    ),
    { code: 'no_key' },
  );
  assert.equal(called, false);
});

test('model and HTTP errors map to codes without echoing the key', async () => {
  for (const [response, code] of [
    [
      new Response(
        JSON.stringify({
          error: { message: 'bad key', type: 'auth', code: 401 },
        }),
        { status: 401 },
      ),
      'auth',
    ],
    [
      new Response(
        JSON.stringify({
          error: {
            message: 'slow down',
            type: 'request_rate_limit_exceeded',
            code: 429,
          },
        }),
        { status: 429 },
      ),
      'rate_limited',
    ],
    [new Response('<html>oops</html>', { status: 502 }), 'upstream'],
    [
      Response.json(
        completed([], {
          status: 'failed',
          error: { message: 'model overloaded' },
        }),
      ),
      'model_error',
    ],
  ]) {
    await assert.rejects(
      runDigest(runOptions(async () => response)),
      (error) => {
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, /pplx-test-secret/);
        return true;
      },
    );
  }
  await assert.rejects(
    runDigest(
      runOptions(async () => {
        throw new TypeError('fetch failed');
      }),
    ),
    { code: 'network' },
  );
});

test('a response without a reported cost is estimated from tokens and flagged', () => {
  assert.deepEqual(
    responseCost({
      usage: { input_tokens: 1_000_000, output_tokens: 100_000 },
    }),
    {
      costUsd: 3,
      estimated: true,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
    },
  );
  assert.equal(responseCost({}).costUsd, 0);
});

test('over the cap, non-starred sources lose their oldest items first', () => {
  const items = [
    item('n-new', 'irna', 1),
    item('n-old', 'irna', 300),
    item('s-new', 'centcom', 2),
    item('s-old', 'centcom', 400),
  ];
  const kept = selectDigestItems(items, sourcesById, 3);
  assert.deepEqual(kept.items.map((i) => i.id).sort(), [
    'n-new',
    's-new',
    's-old',
  ]);
  assert.equal(kept.leftOut, 1);
  const tight = selectDigestItems(items, sourcesById, 1);
  assert.deepEqual(
    tight.items.map((i) => i.id),
    ['s-new'],
  );
  assert.equal(tight.leftOut, 3);
});

test('open stories for the input are the most recently updated open ones', () => {
  const stories = [
    { id: 'old', status: 'open', updatedAt: '2026-10-25T00:00:00Z' },
    { id: 'closed', status: 'closed', updatedAt: '2026-10-26T11:00:00Z' },
    { id: 'new', status: 'open', updatedAt: '2026-10-26T10:00:00Z' },
  ];
  assert.deepEqual(
    selectOpenStories(stories, 1).map((s) => s.id),
    ['new'],
  );
  assert.deepEqual(
    selectOpenStories(stories).map((s) => s.id),
    ['new', 'old'],
  );
});

test('a timed-out or cut-off call is charged an estimate, so the budget still counts it', async () => {
  const timedOut = async () => {
    throw new DOMException('timed out', 'TimeoutError');
  };
  const cutOff = async () => ({
    ok: true,
    status: 200,
    text: async () => {
      throw new TypeError('terminated');
    },
  });
  const refused = async () => {
    throw new TypeError('fetch failed');
  };
  const worstOutput =
    (DIGEST_MAX_OUTPUT_TOKENS * DIGEST_FALLBACK_PRICE_PER_MTOK.output) / 1e6;
  for (const [fetchImpl, code] of [
    [timedOut, 'timeout'],
    [cutOff, 'network'],
  ]) {
    await assert.rejects(runDigest(runOptions(fetchImpl)), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.cost.estimated, true);
      assert.ok(error.cost.costUsd > worstOutput, String(error.cost.costUsd));
      assert.ok(error.cost.inputTokens > 0);
      return true;
    });
  }
  // A connection that never opened was never billed.
  await assert.rejects(
    runDigest(runOptions(refused)),
    (error) => error.code === 'network' && error.cost === undefined,
  );
});
