// The status line's plain place name. The 2026-08-20 QA hunt caught the HUD
// calling out landmarks on other continents — NEAR SACRE-COEUR (PARIS) 2470KM
// while parked over Moscow — because the NEAR bound was 2,500 km. These pin the
// metro bound, both sides of it, and the region fallback that replaced SECTOR
// (the coordinates now sit beside the place on the same line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composePlaceName, NEAR_POI_MAX_KM } from './hudLocality.js';

const ALCATRAZ = { poi: 'Alcatraz Island', city: 'San Francisco' };
const LINCOLN = { poi: 'Lincoln Memorial', city: 'Washington DC' };
const SACRE_COEUR = { poi: 'Sacré-Cœur', city: 'Paris' };

test('the NEAR bound is metro scale, not continental', () => {
  assert.equal(NEAR_POI_MAX_KM, 150);
});

test('a landmark under the camera reads Near, in sentence case, without a distance', () => {
  assert.equal(
    composePlaceName({ ...ALCATRAZ, distKm: 2.4 }, 'NORTH AMERICA'),
    'Near Alcatraz Island (San Francisco)',
  );
  assert.equal(
    composePlaceName({ ...LINCOLN, distKm: 0.6 }, 'NORTH AMERICA'),
    'Near Lincoln Memorial (Washington DC)',
  );
});

test('the field failures fall through to the region', () => {
  // Over Moscow, 2,470 km from the nearest catalogued POI.
  assert.equal(composePlaceName({ ...SACRE_COEUR, distKm: 2470 }, 'EUROPE'), 'EUROPE');
  // Over Chicago, 962 km from the Lincoln Memorial.
  assert.equal(composePlaceName({ ...LINCOLN, distKm: 962 }, 'NORTH AMERICA'), 'NORTH AMERICA');
});

test('the boundary is pinned on both sides, inclusive at the bound', () => {
  const at = composePlaceName({ ...LINCOLN, distKm: NEAR_POI_MAX_KM }, 'NORTH AMERICA');
  assert.match(at, /^Near Lincoln Memorial/, 'exactly at the bound still reads NEAR');
  const justUnder = composePlaceName({ ...LINCOLN, distKm: NEAR_POI_MAX_KM - 0.1 }, 'NORTH AMERICA');
  assert.match(justUnder, /^Near Lincoln Memorial/);
  const justOver = composePlaceName({ ...LINCOLN, distKm: NEAR_POI_MAX_KM + 0.1 }, 'NORTH AMERICA');
  assert.equal(justOver, 'NORTH AMERICA', 'one step past the bound falls through');
});

test('a missing or malformed nearest POI never crashes the place name', () => {
  assert.equal(composePlaceName(null, 'AFRICA'), 'AFRICA');
  assert.equal(composePlaceName(undefined, 'AFRICA'), 'AFRICA');
  assert.equal(composePlaceName({ ...LINCOLN, distKm: NaN }, 'ASIA'), 'ASIA');
  assert.equal(composePlaceName({ ...LINCOLN }, 'ASIA'), 'ASIA');
  assert.equal(composePlaceName(null, undefined), '');
});

// hud.js itself cannot be imported here: it pulls in the `mgrs` CommonJS
// package, which Vite resolves but plain Node cannot import by named export.
test('hud.js composes its place name through this helper', () => {
  const source = readFileSync(new URL('./hud.js', import.meta.url), 'utf8');
  const has = (pattern) => pattern.test(source);
  assert.equal(has(/import \{ composePlaceName \} from '\.\/hudLocality\.js';/), true);
  assert.equal(has(/placeEl\.textContent = composePlaceName\(/), true);
  assert.equal(has(/distKm < 2500/), false, 'the continental bound must not come back');
  assert.equal(has(/Near \$\{/), false, 'Near is composed in hudLocality.js, not re-inlined');
});
