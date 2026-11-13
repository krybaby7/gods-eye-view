// The HUD's ALT readout datum. Field report (2026-08-22, cockpit parked at
// SFO): the bottom-right OSD read "ALT: -15M" — and JFK, earlier, "ALT: -18M".
// Cesium reports the camera's height against the WGS84 ELLIPSOID, and San
// Francisco's geoid sits ~32 m BELOW it, so a camera 17 m over the SFO deck
// reads 32 m too low. The number a viewer reads as "ALT" is MSL.
//
// The arithmetic itself is pinned in src/data/geoid.test.mjs
// (ellipsoidalToMslDisplayM, including the no-geoid fallback). This file pins
// the PRODUCTION wiring two ways: source probes that hud.js routes both of its
// on-screen altitude strings through that correction, and a live IntelHUD
// driven across the real cold → resolved geoid transition.
//
// hud.js imports `mgrs`, a CommonJS package whose named exports Node's ESM
// loader cannot see, so the live half installs a module hook that swaps that
// one specifier for a stub. The import also has to happen BEFORE any DOM
// globals exist: Cesium's widget bundle probes for a real `document` at module
// scope and a partial stub sends it down the browser path. Hence hook →
// import → install DOM, in that order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { ensureGeoidReady } from './data/geoid.js';

const MGRS_STUB_URL = 'gev-test-stub:mgrs';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'mgrs') return { url: MGRS_STUB_URL, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === MGRS_STUB_URL) {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export function forward() { return "10SEG55776339"; }\nexport default { forward };\n',
      };
    }
    return next(url, context);
  },
});

const { IntelHUD } = await import('./hud.js');

const source = readFileSync(new URL('./hud.js', import.meta.url), 'utf8');
// Boolean probes, not assert.match on the whole file — a failure here should
// name the missing wiring, not print all of hud.js.
const has = (pattern) => pattern.test(source);

/** SFO runway 28R touchdown area — the field report's coordinates. */
const SFO = { latDeg: 37.616, lonDeg: -122.368 };
/** The ellipsoidal camera height the owner's screenshot reported. */
const SFO_ELLIPSOIDAL_M = -15;

/**
 * Minimal DOM + viewer the HUD's telemetry tick actually touches. `intel-hud`
 * is deliberately absent so `_buildDOM` bails and the readouts stay the plain
 * text sinks this test reads.
 */
function installHudEnvironment() {
  const elements = new Map(
    ['hud-alt', 'hud-mgrs', 'hud-latlon', 'hud-place']
      .map((id) => [id, { textContent: '' }]),
  );
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  const viewer = {
    camera: {
      pitch: -Math.PI / 2,
      positionCartographic: {
        latitude: (SFO.latDeg * Math.PI) / 180,
        longitude: (SFO.lonDeg * Math.PI) / 180,
        height: SFO_ELLIPSOIDAL_M,
      },
      computeViewRectangle: () => undefined,
      moveEnd: { addEventListener() {}, removeEventListener() {} },
    },
  };
  return {
    elements,
    viewer,
    restore() {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    },
  };
}

test('hud.js corrects the camera height to MSL through the geoid module', () => {
  assert.equal(
    has(/import \{[^}]*\bellipsoidalToMslDisplayM\b[^}]*\} from '\.\/data\/geoid\.js';/s),
    true,
    'hud.js must take the datum correction from ./data/geoid.js, not re-derive one',
  );
  assert.equal(
    has(/ensureGeoidReady\(\)\s*\n\s*\.then\(/),
    true,
    'the geoid grid must be loaded opportunistically, never awaited on a readout tick',
  );
  assert.equal(
    has(/this\._geoidRequested = true;/),
    true,
    'the ~2.7 MB grid must be requested once, on demand — not at HUD construction',
  );
  assert.equal(
    has(/\.catch\(\(\) => \{\s*\/\* readout falls back to the uncorrected height \*\/\s*\}\)/),
    true,
    'a failed geoid load must leave the readout uncorrected, not unhandled',
  );
});

test('the corner ALT readout prints the MSL height, never the ellipsoidal one', () => {
  assert.equal(
    has(/const geoidN = this\._geoidUndulationM\(latDeg, lonDeg\);/),
    true,
    'the telemetry tick must look N up once and reuse it',
  );
  assert.equal(
    has(/const altMslM = ellipsoidalToMslDisplayM\(altM, geoidN\);/),
    true,
    'the ALT readout must convert the camera height before printing it',
  );
  assert.equal(
    has(/formatEyeAltitude\(altMslM\)/),
    true,
    'the #hud-alt line must print altMslM',
  );
  assert.equal(
    has(/formatEyeAltitude\(altM\)/),
    false,
    'the #hud-alt line must not regress to the raw ellipsoidal camera height',
  );
});

// ── The cold → resolved transition, driven live ─────────────────────────────
//
// The grid is a lazy ~2.7 MB chunk, so the first telemetry ticks of a session
// paint UNCORRECTED. The readout picks the correction up on the very next tick
// once it lands, with no timer of its own.

test('a cold tick paints the readout uncorrected, and the next tick corrects it', async () => {
  const env = installHudEnvironment();
  let hud;
  try {
    hud = new IntelHUD(env.viewer);
    const alt = () => env.elements.get('hud-alt').textContent;

    // Tick 1 — cold. This is also the tick that requests the grid.
    hud._updateCameraData();
    assert.match(alt(), /^Eye altitude -15 m$/, `cold readout, got ${alt()}`);

    // The HUD registered its own continuation on this same shared promise
    // during tick 1, and it registered first, so awaiting here means its
    // readiness flag is already set.
    await ensureGeoidReady();
    await Promise.resolve();

    hud._updateCameraData();
    assert.match(alt(), /^Eye altitude 17 m$/, `corrected readout, got ${alt()}`);
    hud._updateCameraData();
    assert.match(alt(), /^Eye altitude 17 m$/);
  } finally {
    hud?.destroy();
    env.restore();
  }
});

test('the corrected readouts are the MSL datum, not a coincidence of the SFO sign', async () => {
  await ensureGeoidReady();
  const env = installHudEnvironment();
  // London: N is +46 m, so the correction moves the readout DOWN. A sign flip
  // that happens to look right at SFO fails here.
  env.viewer.camera.positionCartographic.latitude = (51.5072 * Math.PI) / 180;
  env.viewer.camera.positionCartographic.longitude = (-0.1275 * Math.PI) / 180;
  env.viewer.camera.positionCartographic.height = 100;
  let hud;
  try {
    hud = new IntelHUD(env.viewer);
    hud._updateCameraData(); // cold: requests the grid, paints uncorrected
    assert.match(env.elements.get('hud-alt').textContent, /^Eye altitude 100 m$/);
    await ensureGeoidReady();
    await Promise.resolve();
    hud._updateCameraData();
    assert.match(
      env.elements.get('hud-alt').textContent,
      /^Eye altitude 54 m$/,
      `100 m ellipsoidal over London is 54 m MSL, got ${env.elements.get('hud-alt').textContent}`,
    );
  } finally {
    hud?.destroy();
    env.restore();
  }
});
