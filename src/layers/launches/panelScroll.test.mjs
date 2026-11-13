import assert from 'node:assert/strict';
import test from 'node:test';
import { createPanel } from './panel.js';

test('rendering a selected mission resets the Context scroller', () => {
  {
    const inner = { scrollTop: 90 };
    const output = { closest: () => null, removeAttribute() {} };
    const state = {
      _missionPanel: {
        querySelector: () => output,
        closest(selector) {
          assert.equal(selector, '.global-context-panel-inner');
          return inner;
        },
      },
      _selectedLaunchId: 'mission-1',
      _launches: [{ id: 'mission-1', name: 'Example', payloads: [], recoveryStages: [] }],
      _replayTracks: new Map(),
    };
    const panel = createPanel({
      state,
      parts: {
        overlays: { shortMissionLabel: (name) => name },
        policyHelpers: { missionPathPresentation: () => ({}) },
        replay: { syncReplayButton() {} },
      },
    });
    panel.renderMissionPanel();
    assert.equal(inner.scrollTop, 0);
  }
});
