import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIEF_LIMITS,
  BRIEF_MAX_OUTPUT_TOKENS,
  BRIEF_STORY_CAP,
  SCENARIO_HORIZONS,
  TRACK_STATES,
  briefSchema,
  buildBriefInput,
  buildBriefInstructions,
  prepareBrief,
  runBrief,
  selectBriefStories,
  validateBriefOutput,
} from '../../server/providers/news/digest/brief.js';
import {
  DIGEST_ENDPOINT,
  DIGEST_FALLBACK_PRICE_PER_MTOK,
} from '../../server/providers/news/digest/runner.js';

const NOW = Date.parse('2026-10-28T14:00:00Z');
const hoursAgo = (hours) => new Date(NOW - hours * 3600_000).toISOString();
const theater = {
  id: 'fixture',
  name: 'Fixture theater',
  brief: ['First paragraph.', 'Second paragraph.'],
  actors: [
    {
      id: 'iran',
      name: 'Iran',
      type: 'state',
      role: 'party',
      aliases: ['Tehran'],
    },
    { id: 'oman', name: 'Oman', type: 'state', role: 'mediator', aliases: [] },
  ],
  drivers: [
    {
      text: 'A long-running dispute over the nuclear programme.',
      source: { name: 'CFR', url: 'https://www.cfr.org/x' },
    },
  ],
  tracks: [
    { id: 'military', label: 'Military' },
    { id: 'diplomatic', label: 'Diplomatic' },
    { id: 'humanitarian', label: 'Humanitarian' },
  ],
};
const story = (id, overrides = {}) => ({
  id,
  theater: 'fixture',
  title: `Story ${id}`,
  summary: `Summary ${id}.`,
  category: 'war-military',
  place: { name: 'Muscat' },
  location: { lat: 23.6, lon: 58.4, precision: 'city', method: 'gazetteer' },
  eventAt: hoursAgo(5),
  itemIds: ['secret-item-id'],
  claims: [
    {
      text: 'Talks resumed',
      actor: 'Omani foreign ministry',
      type: 'statement',
      itemIds: ['secret-item-id'],
      status: 'participant-claim',
    },
  ],
  whatsNew: 'Envoys met.',
  contradictions: [],
  status: 'open',
  firstSeenAt: hoursAgo(10),
  updatedAt: hoursAgo(1),
  perspectives: ['international-wire'],
  verification: 'reported',
  sourceCount: 2,
  kind: 'development',
  actorIds: ['oman'],
  ...overrides,
});
const line = (text, storyIds = ['st_a']) => ({ text, storyIds });
const output = (overrides = {}) => ({
  headline: line('Talks resumed in Muscat while strikes continued.', [
    'st_a',
    'st_b',
  ]),
  changes: [line('Envoys met in Muscat.')],
  trigger: line('A strike on a port prompted new talks.', ['st_b']),
  tracks: [
    {
      id: 'military',
      state: 'escalating',
      reason: 'Strikes reported.',
      storyIds: ['st_b'],
    },
    {
      id: 'diplomatic',
      state: 'shifting',
      reason: 'Talks resumed.',
      storyIds: ['st_a'],
    },
    {
      id: 'humanitarian',
      state: 'unclear',
      reason: 'Few reports.',
      storyIds: ['st_a'],
    },
  ],
  affected: [line('Residents near the port were evacuated, officials said.')],
  scenarios: [
    {
      title: 'Talks continue',
      horizon: 'weeks',
      text: 'Delegations meet again.',
      storyIds: ['st_a'],
      signposts: [
        { text: 'A second round is announced', seenIn: [] },
        { text: 'Envoys meet', seenIn: ['st_a'] },
      ],
    },
    {
      title: 'Talks stall',
      horizon: 'days',
      text: 'Strikes resume.',
      storyIds: ['st_b'],
      signposts: [],
    },
  ],
  unknowns: [line('Damage at the port is unconfirmed.', ['st_b'])],
  actorNotes: [
    { actorId: 'oman', text: 'Oman hosted the talks.', storyIds: ['st_a'] },
  ],
  ...overrides,
});
const context = (overrides = {}) => ({
  storyIds: new Set(['st_a', 'st_b']),
  trackIds: ['military', 'diplomatic', 'humanitarian'],
  actorIds: ['iran', 'oman'],
  ...overrides,
});
const completed = (body, usage = {}) => ({
  id: 'resp_brief',
  object: 'response',
  model: 'anthropic/claude-sonnet-5-5',
  status: 'completed',
  output: [
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: JSON.stringify(body) }],
    },
  ],
  usage: {
    input_tokens: 24000,
    output_tokens: 5200,
    output_tokens_details: { reasoning_tokens: 3300 },
    cost: { currency: 'USD', total_cost: 0.12 },
    ...usage,
  },
});

test('the brief call reuses the digest request shape with a 16k output limit', () => {
  const prepared = prepareBrief({
    theater,
    stories: [story('st_a'), story('st_b', { kind: 'event' })],
    previousBrief: null,
    coverage: { summary: 'Coverage: 1 source down', details: ['X down'] },
    nowMs: NOW,
  });
  const body = prepared.body;
  assert.equal(BRIEF_MAX_OUTPUT_TOKENS, 16000);
  assert.equal(body.model, 'anthropic/claude-sonnet-5-5');
  assert.deepEqual(body.tools, []);
  assert.equal(body.max_steps, 1);
  assert.equal(body.max_output_tokens, 16000);
  assert.equal(body.stream, false);
  assert.equal('effort' in body, false);
  assert.equal('preset' in body, false);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.name, 'situation_brief');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(prepared.storyIds, ['st_a', 'st_b']);
  // Worst case: the input plus a full 16k answer, at list price.
  const fullAnswer = (16000 * DIGEST_FALLBACK_PRICE_PER_MTOK.output) / 1e6;
  assert.equal(prepared.worstCase.estimated, true);
  assert.equal(prepared.worstCase.outputTokens, 16000);
  assert.ok(prepared.worstCase.costUsd > fullAnswer);
  assert.ok(prepared.worstCase.costUsd < fullAnswer + 0.1);
});

test('the schema is strict and offers only fixed states, horizons, tracks and actors', () => {
  const schema = briefSchema({
    trackIds: ['military', 'diplomatic'],
    actorIds: ['iran'],
  });
  const closed = (node, path = 'root') => {
    if (node?.type === 'object') {
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual(
        [...node.required].sort(),
        Object.keys(node.properties).sort(),
        path,
      );
      for (const [key, child] of Object.entries(node.properties))
        closed(child, `${path}.${key}`);
    }
    if (node?.type === 'array') closed(node.items, `${path}[]`);
    for (const option of node?.anyOf || []) closed(option, path);
  };
  closed(schema);
  const track = schema.properties.tracks.items.properties;
  assert.deepEqual(track.id.enum, ['military', 'diplomatic']);
  assert.deepEqual(track.state.enum, TRACK_STATES);
  assert.deepEqual(TRACK_STATES, [
    'escalating',
    'easing',
    'stalled',
    'shifting',
    'unclear',
  ]);
  assert.deepEqual(
    schema.properties.scenarios.items.properties.horizon.enum,
    SCENARIO_HORIZONS,
  );
  assert.deepEqual(SCENARIO_HORIZONS, ['days', 'weeks', 'months']);
  assert.deepEqual(schema.properties.actorNotes.items.properties.actorId.enum, [
    'iran',
  ]);
  assert.deepEqual(schema.properties.trigger.anyOf[1], { type: 'null' });
  assert.doesNotMatch(
    JSON.stringify(schema),
    /minimum|maximum|maxLength|minLength|minItems|maxItems|probab|score|percent/,
  );
  // A theater without actors or tracks still gets enum-free string ids.
  const bare = briefSchema({ trackIds: [], actorIds: [] });
  assert.deepEqual(bare.properties.tracks.items.properties.id, {
    type: 'string',
  });
});

test('instructions carry the never-break rules, the theater, actors, drivers and tracks', () => {
  const text = buildBriefInstructions(theater);
  assert.match(text, /Cite story ids only/);
  assert.match(text, /A sentence you cannot cite, leave out/);
  assert.match(text, /"unclear"/);
  assert.match(text, /as that party's claim/);
  assert.match(text, /No probabilities/);
  assert.match(text, /Roles, not sides/);
  assert.match(text, /winning or losing/);
  assert.match(text, /Quiet is not calm/);
  assert.match(text, /Second paragraph\./);
  assert.match(text, /^- iran: Iran \(Tehran\) — state, party$/m);
  assert.match(text, /^- oman: Oman — state, mediator$/m);
  assert.match(text, /A long-running dispute over the nuclear programme\./);
  assert.match(text, /^- military: Military$/m);
  assert.doesNotMatch(text, /https?:/, 'driver links stay out of the prompt');
  assert.equal(buildBriefInstructions(theater), text, 'stable across runs');
});

test('the input holds open and recently closed stories, newest first, capped at 80', () => {
  const stories = [
    story('st_old_open', { updatedAt: hoursAgo(40) }),
    story('st_new', { updatedAt: hoursAgo(1) }),
    story('st_closed_recent', { status: 'closed', updatedAt: hoursAgo(70) }),
    story('st_closed_old', { status: 'closed', updatedAt: hoursAgo(80) }),
  ];
  assert.deepEqual(
    selectBriefStories(stories, NOW).map((s) => s.id),
    ['st_new', 'st_old_open', 'st_closed_recent'],
  );
  const many = Array.from({ length: 90 }, (_, i) =>
    story(`st_${i}`, { updatedAt: hoursAgo(i / 10) }),
  );
  const capped = selectBriefStories(many, NOW);
  assert.equal(BRIEF_STORY_CAP, 80);
  assert.equal(capped.length, 80);
  assert.equal(capped[0].id, 'st_0');
});

test('stories go in with claims, labels and actors, but no item ids or links', () => {
  const input = buildBriefInput({
    previousBrief: {
      createdAt: hoursAgo(3),
      headline: line('Earlier headline.'),
      changes: [line('Earlier change.')],
      trigger: null,
      tracks: [
        { id: 'military', state: 'stalled', reason: 'Quiet.', storyIds: [] },
      ],
      affected: [],
      scenarios: [],
      unknowns: [],
      actorNotes: [],
    },
    stories: [story('st_a')],
    coverage: {
      summary: 'Coverage: 1 source down',
      details: ['Iran state down: Tasnim (blocked)'],
    },
    nowIso: new Date(NOW).toISOString(),
  });
  assert.match(input, /^Brief time: 2026-10-28T14:00:00\.000Z$/m);
  assert.match(input, /Earlier headline\./);
  assert.match(input, /"state":"stalled"/);
  assert.match(input, /Iran state down: Tasnim \(blocked\)/);
  const stories = JSON.parse(
    input.slice(input.indexOf('Stories (1):')).split('\n')[1],
  );
  assert.deepEqual(Object.keys(stories[0]).sort(), [
    'actorIds',
    'category',
    'claims',
    'contradictions',
    'eventAt',
    'id',
    'kind',
    'perspectives',
    'place',
    'status',
    'summary',
    'title',
    'updatedAt',
    'verification',
    'whatsNew',
  ]);
  assert.deepEqual(stories[0].claims, [
    {
      text: 'Talks resumed',
      actor: 'Omani foreign ministry',
      type: 'statement',
      status: 'participant-claim',
    },
  ]);
  assert.doesNotMatch(input, /secret-item-id|https?:/);
  assert.match(
    buildBriefInput({ previousBrief: null, stories: [], nowIso: 'x' }),
    /Previous brief: none/,
  );
});

test('a valid answer keeps every cited line in theater track order', () => {
  const { brief, counts } = validateBriefOutput(
    output({ tracks: [...output().tracks].reverse() }),
    context(),
  );
  assert.equal(
    brief.headline.text,
    'Talks resumed in Muscat while strikes continued.',
  );
  assert.deepEqual(
    brief.tracks.map((track) => [track.id, track.state]),
    [
      ['military', 'escalating'],
      ['diplomatic', 'shifting'],
      ['humanitarian', 'unclear'],
    ],
  );
  assert.equal(brief.scenarios.length, 2);
  assert.deepEqual(brief.scenarios[0].signposts, [
    { text: 'A second round is announced', seenIn: [] },
    { text: 'Envoys meet', seenIn: ['st_a'] },
  ]);
  assert.deepEqual(brief.actorNotes, [
    { actorId: 'oman', text: 'Oman hosted the talks.', storyIds: ['st_a'] },
  ]);
  assert.deepEqual(counts, {
    droppedStoryIds: 0,
    droppedLines: 0,
    trimmedLines: 0,
    clampedStates: 0,
    clampedHorizons: 0,
    droppedTracks: 0,
    droppedActorNotes: 0,
    droppedScenarios: 0,
  });
});

test('unknown story ids are dropped and counted; a line left uncited is dropped', () => {
  const { brief, counts } = validateBriefOutput(
    output({
      changes: [
        line('Cited and padded.', ['st_a', 'ghost', 'st_a']),
        line('Nothing real.', ['ghost2']),
        line('No ids at all.', []),
        line('', ['st_a']),
        null,
      ],
      trigger: line('Invented cause.', ['ghost3']),
      affected: [line('Fine.', ['st_b'])],
    }),
    context(),
  );
  assert.deepEqual(brief.changes, [line('Cited and padded.', ['st_a'])]);
  assert.equal(brief.trigger, null);
  assert.equal(counts.droppedStoryIds, 3);
  assert.equal(counts.droppedLines, 5);
});

test('signposts may cite nothing (not seen yet); seen ticks need a real story', () => {
  const { brief, counts } = validateBriefOutput(
    output({
      scenarios: [
        {
          ...output().scenarios[0],
          signposts: [
            { text: 'Seen in a ghost', seenIn: ['ghost'] },
            { text: 'Seen', seenIn: ['st_b'] },
            { text: '', seenIn: ['st_b'] },
            { text: 'Three', seenIn: [] },
            { text: 'Four', seenIn: [] },
            { text: 'Five', seenIn: [] },
          ],
        },
        output().scenarios[1],
      ],
    }),
    context(),
  );
  assert.deepEqual(brief.scenarios[0].signposts, [
    { text: 'Seen in a ghost', seenIn: [] },
    { text: 'Seen', seenIn: ['st_b'] },
    { text: 'Three', seenIn: [] },
    { text: 'Four', seenIn: [] },
  ]);
  assert.equal(counts.droppedStoryIds, 1);
  assert.equal(counts.trimmedLines, 1, 'the fifth signpost');
});

test('limits are enforced after citation checks', () => {
  const four = (prefix) =>
    [1, 2, 3, 4].map((n) => line(`${prefix} ${n}.`, ['st_a']));
  const scenario = (title) => ({ ...output().scenarios[1], title });
  const { brief, counts } = validateBriefOutput(
    output({
      changes: [line('Uncited.', []), ...four('Change')],
      affected: four('Affected'),
      unknowns: four('Unknown'),
      scenarios: [scenario('A'), scenario('B'), scenario('C'), scenario('D')],
      actorNotes: [
        { actorId: 'oman', text: 'First.', storyIds: ['st_a'] },
        { actorId: 'oman', text: 'Second.', storyIds: ['st_a'] },
        { actorId: 'hamas', text: 'Unknown actor.', storyIds: ['st_a'] },
      ],
    }),
    context(),
  );
  assert.equal(BRIEF_LIMITS.changes, 3);
  assert.deepEqual(
    brief.changes.map((entry) => entry.text),
    ['Change 1.', 'Change 2.', 'Change 3.'],
  );
  assert.equal(brief.affected.length, 3);
  assert.equal(brief.unknowns.length, 3);
  assert.deepEqual(
    brief.scenarios.map((entry) => entry.title),
    ['A', 'B', 'C'],
  );
  assert.deepEqual(brief.actorNotes, [
    { actorId: 'oman', text: 'First.', storyIds: ['st_a'] },
  ]);
  assert.equal(counts.trimmedLines, 4);
  assert.equal(counts.droppedLines, 1);
  assert.equal(counts.droppedActorNotes, 2);
});

test('track states and horizons are clamped; unknown and repeated tracks are dropped', () => {
  const { brief, counts } = validateBriefOutput(
    output({
      tracks: [
        {
          id: 'military',
          state: 'winning',
          reason: 'Strikes.',
          storyIds: ['st_b'],
        },
        {
          id: 'military',
          state: 'easing',
          reason: 'Again.',
          storyIds: ['st_b'],
        },
        { id: 'economy', state: 'easing', reason: 'No.', storyIds: ['st_b'] },
        {
          id: 'diplomatic',
          state: 'stalled',
          reason: 'Uncited.',
          storyIds: ['ghost'],
        },
      ],
      scenarios: [
        { ...output().scenarios[0], horizon: 'years' },
        output().scenarios[1],
      ],
    }),
    context(),
  );
  assert.deepEqual(brief.tracks, [
    {
      id: 'military',
      state: 'unclear',
      reason: 'Strikes.',
      storyIds: ['st_b'],
    },
  ]);
  assert.equal(brief.scenarios[0].horizon, null);
  assert.equal(counts.clampedStates, 1);
  assert.equal(counts.clampedHorizons, 1);
  assert.equal(counts.droppedTracks, 2);
  assert.equal(counts.droppedLines, 1, 'the uncited diplomatic track');
});

test('no single forecast and no probabilities: such scenarios are removed', () => {
  const odds = {
    ...output().scenarios[0],
    title: 'Deal signed',
    text: 'A 70% chance of a deal.',
  };
  const { brief, counts } = validateBriefOutput(
    output({ scenarios: [odds, output().scenarios[1]] }),
    context(),
  );
  // One scenario would be left, which reads as a forecast: none are shown.
  assert.deepEqual(brief.scenarios, []);
  assert.equal(counts.droppedScenarios, 2);
  for (const text of ['Odds favour talks.', 'The probability is low.'])
    assert.equal(
      validateBriefOutput(
        output({
          scenarios: [
            { ...output().scenarios[0], text },
            ...output().scenarios,
          ],
        }),
        context(),
      ).brief.scenarios.length,
      2,
    );
});

test('URLs are stripped from the model text', () => {
  const { brief } = validateBriefOutput(
    output({
      headline: line('Talks resumed, see https://evil.example/x today.', [
        'st_a',
      ]),
    }),
    context(),
  );
  assert.equal(brief.headline.text, 'Talks resumed, see today.');
});

test('a brief with no valid headline is rejected', () => {
  for (const headline of [
    line('Uncited.', ['ghost']),
    line('', ['st_a']),
    null,
  ])
    assert.throws(
      () => validateBriefOutput(output({ headline }), context()),
      (error) => error.code === 'no_headline',
    );
  assert.throws(
    () => validateBriefOutput([], context()),
    (error) => error.code === 'malformed_output',
  );
});

test('runBrief returns the checked record with cost, tokens and reasoning tokens', async () => {
  let request;
  const prepared = prepareBrief({
    theater,
    stories: [story('st_a'), story('st_b', { kind: 'event' })],
    previousBrief: null,
    coverage: null,
    nowMs: NOW,
  });
  const result = await runBrief({
    apiKey: 'pplx-test-secret',
    prepared,
    theater,
    digestRunId: 'run_digest',
    runId: 'run_brief',
    nowMs: NOW,
    fetchImpl: async (url, init) => {
      request = { url, body: JSON.parse(init.body) };
      return Response.json(
        completed(
          output({ changes: [line('Kept.'), line('Dropped.', ['ghost'])] }),
        ),
      );
    },
  });
  assert.equal(request.url, DIGEST_ENDPOINT);
  assert.equal(request.body.max_output_tokens, 16000);
  assert.match(result.brief.id, /^br_[0-9a-f]{8}$/);
  assert.equal(result.brief.theater, 'fixture');
  assert.equal(result.brief.digestRunId, 'run_digest');
  assert.equal(result.brief.createdAt, new Date(NOW).toISOString());
  assert.deepEqual(result.brief.changes, [line('Kept.')]);
  assert.equal(result.counts.droppedLines, 1);
  assert.equal(result.storiesSent, 2);
  assert.deepEqual(result.cost, {
    costUsd: 0.12,
    estimated: false,
    inputTokens: 24000,
    outputTokens: 5200,
  });
  assert.equal(result.reasoningTokens, 3300);
  assert.equal(result.model, 'anthropic/claude-sonnet-5-5');
});

test('a cut-off or headless brief fails and keeps what it cost', async () => {
  const prepared = prepareBrief({
    theater,
    stories: [story('st_a')],
    previousBrief: null,
    coverage: null,
    nowMs: NOW,
  });
  const run = (body) =>
    runBrief({
      apiKey: 'pplx-test-secret',
      prepared,
      theater,
      digestRunId: 'run_digest',
      runId: 'run_brief',
      nowMs: NOW,
      fetchImpl: async () => Response.json(body),
    });
  await assert.rejects(
    run({ ...completed(output()), status: 'incomplete' }),
    (error) => {
      assert.equal(error.code, 'truncated');
      assert.match(error.message, /brief hit the 16,000-token output limit/);
      assert.equal(error.cost.costUsd, 0.12);
      return true;
    },
  );
  await assert.rejects(
    run(completed(output({ headline: line('Ghost.', ['ghost']) }))),
    (error) => error.code === 'no_headline' && error.cost.costUsd === 0.12,
  );
  const garbled = completed(output());
  garbled.output[0].content[0].text = '{"headline": ';
  await assert.rejects(
    run(garbled),
    (error) => error.code === 'malformed_output' && error.cost.costUsd === 0.12,
  );
  await assert.rejects(
    runBrief({ apiKey: '', prepared, theater, nowMs: NOW }),
    (error) => error.code === 'no_key',
  );
});
