import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshNews } from './gevActions.js';
import { GEV_REALTIME_TOOLS } from '../../server/providers/openai/tools.js';
import { hudSummaryLayerContext } from '../hudSummaryResponse.js';

function manager(layer, { enabled = true } = {}) {
  const calls = [];
  return {
    calls,
    layers: new Map(layer ? [['news', { module: layer }]] : []),
    isEnabled: () => enabled,
    async setEnabled(id, value, options) {
      calls.push([id, value, options]);
      enabled = value;
      return true;
    },
  };
}

const layer = (outcome) => ({
  digests: 0,
  async requestDigest() {
    this.digests++;
    return outcome;
  },
  getStats: () => ({ storyCount: 5, budget: { remainingUsd: 1.64 } }),
});

test('refresh_news is a closed, argument-free tool that warns about cost', () => {
  const tool = GEV_REALTIME_TOOLS.find(
    (entry) => entry.name === 'refresh_news',
  );
  assert.deepEqual(tool.parameters.properties, {});
  assert.equal(tool.parameters.additionalProperties, false);
  assert.match(tool.description, /Costs money/);
  assert.match(tool.description, /never on your own/);
  const panels = GEV_REALTIME_TOOLS.find(
    (entry) => entry.name === 'set_panel_open',
  ).parameters.properties.panelId.enum;
  assert.ok(panels.includes('situation-panel'));
});

test('refresh_news turns the layer on, runs one digest and reads back the outcome', async () => {
  const news = layer({
    ok: true,
    summary:
      'Digest done: 1 new and 0 updated story from 2 items, 1 left unassigned. Cost 18¢.',
    run: {
      storiesCreated: 1,
      storiesUpdated: 0,
      unassignedCount: 1,
      costUsd: 0.18,
    },
  });
  const dm = manager(news, { enabled: false });
  const result = await refreshNews(dm);
  assert.deepEqual(dm.calls, [['news', true, { origin: 'voice' }]]);
  assert.equal(news.digests, 1);
  assert.deepEqual(result, {
    ok: true,
    action: 'refresh_news',
    summary:
      'Digest done: 1 new and 0 updated story from 2 items, 1 left unassigned. Cost 18¢.',
    storiesCreated: 1,
    storiesUpdated: 0,
    unassigned: 1,
    costUsd: 0.18,
    openStories: 5,
    budgetLeftUsd: 1.64,
    caveat:
      'Stories are reporting, not verified incidents; read the verification label.',
  });
});

test('refusals come back as the summary and never claim success', async () => {
  const keyless = await refreshNews(
    manager(
      layer({
        ok: false,
        keyRequired: true,
        error: 'no_key',
        summary: 'needs key',
      }),
    ),
  );
  assert.equal(keyless.ok, false);
  assert.equal(keyless.keyRequired, true);
  assert.equal(keyless.error, 'no_key');
  assert.equal(keyless.summary, 'needs key');
  const skipped = await refreshNews(
    manager(
      layer({
        ok: true,
        skipped: true,
        summary: 'Nothing new since the last digest; no model call was made.',
      }),
    ),
  );
  assert.equal(skipped.skipped, true);
  const missing = await refreshNews(manager(null));
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not available/);
});

test('the HUD summary carries a layer-supplied state line only when present', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const context = hudSummaryLayerContext(
    [
      {
        id: 'news',
        name: 'War Monitor',
        enabled: true,
        stats: {
          count: 3,
          lastUpdate: now,
          summary: '5 stories · digest 2h ago · budget $1.64 left',
        },
      },
      {
        id: 'earthquakes',
        name: 'Earthquakes',
        enabled: true,
        stats: { count: 2, lastUpdate: now },
      },
    ],
    { now },
  );
  assert.equal(
    context.enabledLayers[0].summary,
    '5 stories · digest 2h ago · budget $1.64 left',
  );
  assert.equal('summary' in context.enabledLayers[1], false);
});
