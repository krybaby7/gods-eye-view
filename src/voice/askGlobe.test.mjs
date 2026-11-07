import assert from 'node:assert/strict';
import test from 'node:test';
import { GEV_REALTIME_TOOLS } from '../../server/providers/openai/tools.js';
import { createGevActionRunner } from './gevActions.js';
import { voiceLayer, voiceLayerAliasMap } from './layerManifest.js';
import { progressLine, progressStepLabel } from './speech.js';

function harness(layer, enabled = false) {
  const calls = [];
  const dataManager = {
    layers: new Map([['searches', { module: layer }]]),
    isEnabled: () => enabled,
    async setEnabled(id, value, options) {
      calls.push([id, value, options]);
      enabled = value;
      return true;
    },
  };
  const run = createGevActionRunner({
    viewer: {
      camera: { moveEnd: { addEventListener() {} } },
      clock: { onTick: { addEventListener() {} } },
      scene: { canvas: { addEventListener() {}, removeEventListener() {} } },
    },
    styleManager: {},
    dataManager,
  });
  return { run, calls };
}

test('ask_globe is an explicit web search with one bounded question', () => {
  const tool = GEV_REALTIME_TOOLS.find(({ name }) => name === 'ask_globe');
  assert.match(tool.description, /web search/i);
  assert.match(tool.description, /only when the user explicitly asks/i);
  assert.deepEqual(tool.parameters, {
    type: 'object',
    additionalProperties: false,
    required: ['question'],
    properties: { question: { type: 'string', minLength: 1, maxLength: 500 } },
  });
});

test('ask_globe enables Searches, announces progress, waits and reads back mapped findings', async () => {
  const signal = new AbortController().signal;
  const { run, calls } = harness({
    async ask(question) {
      calls.push(['ask', question]);
      return { id: 'search-1', runId: 'run-1' };
    },
    async waitForRun(id, options) {
      calls.push(['wait', id, options]);
      return {
        label: 'Crypto this week',
        findings: [{ location: { lat: 0, lon: 0 } }, { location: null }],
      };
    },
  });

  const result = await run(
    'ask_globe',
    { question: 'What is going on with crypto?' },
    { signal, progress: (update) => calls.push(['progress', update]) },
  );
  assert.deepEqual(calls, [
    ['searches', true, { origin: 'voice' }],
    ['progress', { step: 'search', label: 'Searching' }],
    ['ask', 'What is going on with crypto?'],
    ['wait', 'search-1', { signal }],
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.say, 'Crypto this week: 1 finding on the globe');
  assert.equal(progressLine('search', 'Searching'), 'Searching.');
  assert.equal(progressStepLabel('search', 'Searching'), 'Searching');
  assert.equal(progressLine('search', 'Austin'), 'Looking up Austin.');
});

test('ask_globe rejects invalid questions before enabling the layer', async () => {
  const { run, calls } = harness({});
  for (const question of [null, 4, '', '   ', 'x'.repeat(501)]) {
    const result = await run('ask_globe', { question });
    assert.equal(result.ok, false);
    assert.match(result.say, /1 to 500 characters/);
  }
  assert.deepEqual(calls, []);
});

test('ask_globe reads back run failures and cancels the voice wait', async () => {
  const failed = harness(
    {
      ask: async () => ({ id: 'search-1', runId: 'run-1' }),
      waitForRun: async () => {
        throw new Error('The agent is unavailable.');
      },
    },
    true,
  );
  const failure = await failed.run('ask_globe', {
    question: 'Ask about crypto',
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.say, 'The agent is unavailable.');

  const controller = new AbortController();
  const cancelled = harness(
    {
      ask: async () => ({ id: 'search-1', runId: 'run-1' }),
      waitForRun: async () => {
        controller.abort();
        return { label: 'Crypto', findings: [] };
      },
    },
    true,
  );
  const result = await cancelled.run(
    'ask_globe',
    { question: 'Ask about crypto' },
    {
      signal: controller.signal,
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
});

test('analyst_query can match stored Search Layers findings', async () => {
  assert.deepEqual(Object.keys(voiceLayer('searches').query.fields), [
    'title',
    'kind',
    'searchLabel',
    'place',
    'actor',
    'verification',
    'eventAt',
  ]);
  assert.equal(voiceLayer('searches').query.timeField, 'eventAt');
  for (const alias of ['searches', 'search layers', 'findings']) {
    assert.equal(voiceLayerAliasMap().get(alias), 'searches');
  }
  const { run, calls } = harness(
    {
      getAnalystRecords: () => [
        {
          id: 'f1',
          title: 'Binance files response',
          kind: 'event',
          lat: 10,
          lon: 20,
        },
        { id: 'f2', title: 'Bitcoin price rises', kind: 'statement' },
      ],
    },
    true,
  );
  const result = await run('analyst_query', {
    layers: ['searches'],
    scope: { kind: 'anywhere' },
    filters: [{ field: 'title', op: 'contains', value: 'Binance' }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.items[0].title, 'Binance files response');
  assert.deepEqual(calls, []);
});
