// Roadmap item 1.1: the HUD's costume is off. What remains is one quiet status
// line — place, coordinates, MGRS, altitude and UTC time — plus the selected
// vessel line. No classification banners, invented mission or sensor numbers,
// REC, orbit or band strips, brackets, and no model call for the place name.
//
// hud.js imports `mgrs`, a CommonJS package whose named exports Node's ESM
// loader cannot see, so this installs the same stub hook as
// hudAltitudeDatum.test.mjs before importing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const MGRS_STUB_URL = 'gev-test-stub:mgrs-status';
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

/** A fake page whose #intel-hud keeps the markup and hands out text sinks. */
function installPage({ latDeg = 37.616, lonDeg = -122.368, height = 900 } = {}) {
  const sinks = new Map();
  const classes = new Set();
  const hud = {
    innerHTML: '',
    dataset: {},
    style: { setProperty() {} },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
  };
  const sink = (id) => {
    if (!sinks.has(id)) {
      const own = new Set();
      sinks.set(id, {
        textContent: '',
        hidden: false,
        classList: { add: (n) => own.add(n), remove: (n) => own.delete(n), contains: (n) => own.has(n) },
      });
    }
    return sinks.get(id);
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === 'intel-hud') return hud;
      return hud.innerHTML.includes(`id="${id}"`) ? sink(id) : null;
    },
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  const moveEnd = [];
  const viewer = {
    camera: {
      pitch: -Math.PI / 2,
      positionCartographic: {
        latitude: (latDeg * Math.PI) / 180,
        longitude: (lonDeg * Math.PI) / 180,
        height,
      },
      computeViewRectangle: () => undefined,
      moveEnd: {
        addEventListener: (fn) => moveEnd.push(fn),
        removeEventListener() {},
      },
    },
  };
  return {
    hud,
    viewer,
    moveEnd,
    text: (id) => sink(id).textContent,
    restore() {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    },
  };
}

const ORNAMENT = [
  /TOP SECRET/,
  /NOFORN/,
  /KH11/,
  /OPS-\d/,
  /\bREC\b/,
  /ORB:/,
  /PASS:/,
  /BAND:/,
  /BITS:/,
  /LVL:/,
  /COLL:/,
  /ONA:/,
  /GSD/,
  /NIIRS/,
  /PAGE 1\/1/,
  /[┌┐└┘]/,
  /hud-(top|bottom)-(left|right|bar)/,
  /hud-(left|right)-edge/,
  /hud-sonar/,
];

test('the HUD draws no banners, invented numbers, REC, orbit or band strips', () => {
  const page = installPage();
  let hud;
  try {
    hud = new IntelHUD(page.viewer);
    for (const pattern of ORNAMENT) {
      assert.doesNotMatch(page.hud.innerHTML, pattern, `markup still carries ${pattern}`);
    }
    assert.doesNotMatch(source, /Math\.random/, 'nothing on the HUD is random any more');
    assert.doesNotMatch(source, /_missionId|_sensorId|_orbitNum|_passNum|_recBlink/);
  } finally {
    hud?.destroy();
    page.restore();
  }
});

test('the status line holds the place, coordinates, MGRS, altitude and UTC time', () => {
  const page = installPage();
  let hud;
  try {
    hud = new IntelHUD(page.viewer);
    const line = page.hud.innerHTML.slice(page.hud.innerHTML.indexOf('hud-status-line'));
    for (const id of ['hud-place', 'hud-latlon', 'hud-mgrs', 'hud-alt', 'hud-time']) {
      assert.ok(line.includes(`id="${id}"`), `#${id} belongs to the one status line`);
    }
    assert.ok(page.hud.innerHTML.includes('id="hud-ais-vessel"'), 'the vessel line is kept');
    hud.show();
    assert.match(page.text('hud-latlon'), /^37°36'57\.60"N 122°22'04\.80"W$/);
    assert.equal(page.text('hud-mgrs'), 'MGRS: 10S EG 5577 6339');
    assert.match(page.text('hud-alt'), /^ALT: \d+m$/);
    assert.match(page.text('hud-time'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z$/);
    assert.match(page.text('hud-place'), /^NEAR .+\(SAN FRANCISCO\)$/, 'near a catalogued landmark');
  } finally {
    hud?.destroy();
    page.restore();
  }
});

test('away from any landmark the place is the plain region name', () => {
  const page = installPage({ latDeg: 55.7558, lonDeg: 37.6173 });
  let hud;
  try {
    hud = new IntelHUD(page.viewer);
    hud.show();
    assert.equal(page.text('hud-place'), 'EUROPE');
  } finally {
    hud?.destroy();
    page.restore();
  }
});

test('the place name never calls a model', () => {
  const page = installPage();
  let calls = 0;
  const summaryService = {
    summarize() {
      calls++;
      return Promise.resolve({ ok: true, status: 200, data: { summary: 'x' } });
    },
  };
  let hud;
  try {
    hud = new IntelHUD(page.viewer, { summaryService });
    hud.show();
    for (const settle of page.moveEnd) settle();
    hud._updateCameraData();
    assert.equal(calls, 0);
  } finally {
    hud?.destroy();
    page.restore();
  }
  assert.doesNotMatch(source, /summarize\(|summaryService|hudSummaryResponse|getBasemapLabelContext/);
  const shell = readFileSync(new URL('./ui/applicationShell.js', import.meta.url), 'utf8');
  assert.doesNotMatch(shell, /summaryService/, 'the shell no longer hands the HUD a summary service');
});

test('every HUD layout shows the same quiet line; Minimal drops altitude and the vessel', () => {
  const css = readFileSync(new URL('./ui/styles/overlays.css', import.meta.url), 'utf8');
  assert.match(css, /#intel-hud\[data-variant='minimal'\] :is\(#hud-alt, \.hud-ais-vessel\)/);
  assert.doesNotMatch(css, /text-shadow|hud-bracket|hud-corner/, 'no glow and no brackets');
});
