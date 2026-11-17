import test from 'node:test';
import assert from 'node:assert/strict';
import { DETECTION_THEME_MAP } from './worldOverlayTokens.js';
import { TRANSIT_TIER_KEYS } from '../data/transitPresetStyle.js';

test('every detection theme carries a distinct bracket colour for every transit mode', () => {
  // The detection canvas composites above the post-FX chain, so these are
  // literal screen colours in every preset — the mode signal the sprites
  // lose under NVG and FLIR. A missing key would silently fall back to the
  // theme's line colour and every mode would bracket alike.
  for (const [name, theme] of Object.entries(DETECTION_THEME_MAP)) {
    const seen = new Set();
    for (const key of TRANSIT_TIER_KEYS) {
      const colour = theme.tiers?.[key];
      assert.match(colour || '', /^#[0-9a-f]{6}$/i, `${name} ${key}`);
      if (key !== 'transit_unknown') seen.add(colour.toLowerCase());
    }
    assert.equal(
      seen.size,
      TRANSIT_TIER_KEYS.length - 1,
      `${name}: the five real modes differ`,
    );
  }
});

test('default overlay preserves the live object colours', () => {
  const { civil, military, sea, space } = DETECTION_THEME_MAP._default.tiers;
  assert.deepEqual(
    { civil, military, sea, space },
    { civil: '#22e0ff', military: '#ffb347', sea: '#3fe0c8', space: '#bda4ff' },
  );
});
