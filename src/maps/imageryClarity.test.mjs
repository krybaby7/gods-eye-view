import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESENTED_MAP_STACK_IDS } from '../mapStackChips.js';
import { VIEW_MAPS } from '../view/index.js';
import { MapSourceController } from './controller.js';
import { createGoogleDirectTileset } from './google3d.js';
import { describeMapError } from './providerErrors.js';
import { realtimeInstructions } from '../../server/providers/openai/instructions.js';
import { GEV_REALTIME_TOOLS } from '../../server/providers/openai/tools.js';

test('voice guidance distinguishes Google Satellite from the satellites data layer', () => {
  assert.match(
    realtimeInstructions(),
    /"Google Satellite" means set_map_stack google-satellite/,
  );
  const tool = GEV_REALTIME_TOOLS.find(
    (value) => value.name === 'set_map_stack',
  );
  assert.match(
    tool.parameters.properties.stack.description,
    /Google Satellite.*google-satellite/,
  );
});

test('map diagnostics redact parameter and header credentials without serializing provider objects', () => {
  for (const text of [
    'API_KEY=fixture-key access_token="fixture-token" session=fixture-session',
    '{"key":"fixture-key","Authorization":"Bearer fixture-token"}',
    'HTTP 401 https://example.com/private-path/fixture-key?anything=fixture-token',
  ])
    assert.doesNotMatch(
      describeMapError(new Error(text)),
      /fixture-(key|token|session)/,
    );
  assert.equal(
    describeMapError({ key: 'fixture-key' }),
    'Map provider request failed',
  );
  assert.equal(
    describeMapError(new Error('recovery offline')),
    'recovery offline',
  );
});

test('Google satellite can be presented and saved as a view', () => {
  assert.ok(PRESENTED_MAP_STACK_IDS.includes('google-satellite'));
  assert.ok(VIEW_MAPS.includes('google-satellite'));
});

test('map failure state and notifications redact request credentials', async () => {
  const messages = [];
  const viewer = { scene: { requestRender() {} } };
  const controller = new MapSourceController(viewer, {
    registry: {
      defaultId: 'bad',
      sources: [
        {
          descriptor: { id: 'bad', label: 'bad' },
          imagery: async () => {
            throw new Error(
              'HTTP 403 https://tile.googleapis.com/root?key=fixture-key&session=fixture-session Authorization: Bearer fixture-token',
            );
          },
        },
      ],
    },
    onError: (message) => messages.push(message),
  });
  const state = await controller.setStack('bad');
  assert.doesNotMatch(
    JSON.stringify([state.lastError, messages]),
    /fixture-(key|session|token)/,
  );
  assert.match(state.lastError, /403/);
  controller.destroy();
});

test('Google 3D supplies a tile failure listener to suppress raw SDK URL logging', async () => {
  let listener;
  const tileset = {
    tileFailed: {
      addEventListener(value) {
        listener = value;
      },
    },
  };
  const sdk = { createGooglePhotorealistic3DTileset: async () => tileset };
  assert.equal(await createGoogleDirectTileset(sdk, 'fixture-key'), tileset);
  assert.equal(typeof listener, 'function');
  const oldWarn = console.warn;
  const messages = [];
  try {
    console.warn = (...args) => messages.push(args.join(' '));
    listener({
      url: 'https://tile.googleapis.com/?key=fixture-key',
      message: 'Bearer fixture-token',
    });
    assert.doesNotMatch(messages.join(' '), /fixture-(key|token)/);
  } finally {
    console.warn = oldWarn;
  }
});
