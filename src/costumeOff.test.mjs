// Roadmap piece 2, "costume off, board on" (item 1.1 and the 2.1 overlaps).
// Pins what the ornament removal leaves behind: a plain title that other code
// still measures, no Cyber skin or sonar, the vignette and ring off by default,
// a clean fallback for links that name the retired skin, and the layout rules
// that keep the legend, status line, lens bar and title apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandApplicationHtml } from '../build/application-html.js';
import {
  DEFAULT_HUD_LAYOUT,
  HUD_LAYOUTS,
  normalizeHudLayout,
} from './hudLayoutPolicy.js';
import { isScopeMaskEnabled } from './scopeMask.js';
import { ShareLinkManager } from './sharelink.js';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const html = expandApplicationHtml(read('../index.html'));

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return /\.(js|mjs|html|css)$/.test(name) ? [absolute] : [];
  });
}

function managerForHash(hash) {
  globalThis.window = { location: { hash, href: `http://localhost/${hash}` } };
  globalThis.history = {
    replaceState(_s, _t, next) {
      window.location.hash = new URL(next, window.location.href).hash;
    },
  };
  return new ShareLinkManager({
    camera: {
      changed: { addEventListener() {} },
      positionCartographic: { latitude: 0, longitude: 0, height: 1000 },
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0,
    },
  });
}

/** Read one CSS rule body by its exact selector text. */
function ruleBody(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing rule ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

test('the title stays as a plain element other code can measure', () => {
  assert.match(html, /<div id="title-bar">/);
  assert.match(html, /GOD'S EYE <span class="title-accent">VIEW<\/span>/, 'same title text');
  for (const gone of [
    'title-glow',
    'class="subtitle"',
    'NO PLACE LEFT BEHIND',
    'data-logo-gaze',
    'id="style-indicator"',
    'ACTIVE STYLE',
  ]) {
    assert.equal(html.includes(gone), false, `${gone} is removed`);
  }
  const foundation = read('./ui/styles/foundation.css');
  assert.doesNotMatch(ruleBody(foundation, '#title-bar h1'), /text-shadow/, 'no title glow');
  assert.doesNotMatch(foundation, /#style-indicator|\.subtitle|title-glow/);
  const controls = read('./ui/styles/controls.css');
  assert.doesNotMatch(ruleBody(controls, '.loader-logo'), /animation/, 'the loader logo no longer pulses');
});

test('the ornament modules and the Cyber skin are gone, with nothing still importing them', () => {
  for (const file of [
    'logoGaze.js',
    'splitFlap.js',
    'cyberSonar.js',
    'cyberSonarGpu.js',
    'cyberSonarScene.js',
    'ui/cyberSonarControls.js',
    'ui/styles/cyber.css',
  ]) {
    assert.equal(existsSync(path.join(SRC, file)), false, `${file} is removed`);
  }
  assert.doesNotMatch(read('../style.css'), /cyber\.css/);
  const offenders = sourceFiles(SRC)
    .filter((file) => !file.endsWith('costumeOff.test.mjs'))
    .filter((file) =>
      /cyberSonar|splitFlap|logoGaze|data-ui-theme|uiTheme|set_cyber_sonar|tr3b-toggle/.test(
        readFileSync(file, 'utf8'),
      ),
    )
    .map((file) => path.relative(SRC, file).split(path.sep).join('/'));
  assert.deepEqual(offenders, []);
});

test('the Display panel offers no Cyber layout, sonar or TR-3B reclassify button', () => {
  assert.doesNotMatch(html, /value="cyber"|cyber-sonar|Reclassify|TR-3B/);
  assert.match(html, /<select[^>]*id="hud-layout-select"/, 'the layout selector itself stays');
  assert.deepEqual([...HUD_LAYOUTS], ['tactical', 'operator', 'minimal']);
  const schemas = read('./voice/actionSchemas.js');
  assert.doesNotMatch(schemas, /set_cyber_sonar/);
  const server = read('../server/providers/openai/toolDescriptions.js') +
    read('../server/providers/openai/instructions.js');
  assert.doesNotMatch(server, /cyber/i);
});

test('a link or scene that names the retired Cyber skin falls back to the default layout', () => {
  assert.equal(DEFAULT_HUD_LAYOUT, 'tactical');
  assert.equal(normalizeHudLayout('cyber'), 'tactical');
  assert.equal(normalizeHudLayout('CYBER'), 'tactical');
  assert.equal(normalizeHudLayout('minimal'), 'minimal');
  const restored = managerForHash('#lat=10&lon=20&style=normal&hud=cyber&hv=1').parseInitialHash();
  assert.equal(restored.hudVariant, 'tactical');
  assert.equal(restored.hudVisible, true, 'the rest of the link still restores');
  const kept = managerForHash('#lat=10&lon=20&hud=operator').parseInitialHash();
  assert.equal(kept.hudVariant, 'operator');
});

test('the scope vignette and the sun and moon ring start off', () => {
  assert.equal(isScopeMaskEnabled(), false, 'the mask module starts disabled');
  assert.match(html, /id="scope-toggle"[^>]*aria-pressed="false"/);
  assert.match(html, /id="celestial-toggle"[^>]*aria-pressed="false"/);
  const parsed = managerForHash('#lat=10&lon=20&style=normal').parseInitialHash();
  assert.equal(parsed.scopeEnabled, false, 'a link without sc keeps the vignette off');
  assert.equal(parsed.celestialRing, false, 'a link without cr keeps the ring off');
  assert.match(read('./ui/visualPresets.js'), /\n  celestialRing: false,\n\};/, 'first-load defaults keep the ring off');
  assert.match(read('./ui/applicationShell.js'), /new CelestialRing\(viewer, \{\n\s+enabled: false,/);
  // Both toggles stay in the Display group, so they still work.
  const display = read('./ui/templates/display-controls.html');
  assert.match(display, /id="scope-toggle"/);
  assert.match(display, /id="celestial-toggle"/);
});

test('overlap (a): the status line is anchored right and never reaches the legend', () => {
  const overlays = read('./ui/styles/overlays.css');
  const status = ruleBody(overlays, '#intel-hud .hud-status');
  assert.match(status, /right: 36px;/);
  assert.doesNotMatch(status, /\bleft:/, 'only the right edge anchors the line');
  const reserve = Number(status.match(/max-width: calc\(100vw - (\d+)px\)/)?.[1]);
  const world = read('./ui/styles/world-panel.css');
  const legend = ruleBody(world, '#world-legend');
  assert.match(legend, /left: var\(--left-stack-x\);/);
  const legendWidth = Number(legend.match(/width: min\((\d+)px/)?.[1]);
  const stackX = Number(read('./ui/styles/foundation.css').match(/--left-stack-x: (\d+)px;/)?.[1]);
  // The line's left edge is at least (reserve - 36) from the viewport's left;
  // the legend's right edge is stackX + legendWidth. Keep a 12px gap.
  assert.ok(reserve - 36 >= stackX + legendWidth + 12, `reserve ${reserve}px clears the legend`);
});

test('overlap (b): with the banner gone the lens bar clears the plain title', () => {
  const foundation = read('./ui/styles/foundation.css');
  const titleTop = Number(ruleBody(foundation, '#title-bar').match(/top: (\d+)px;/)?.[1]);
  const logoWidth = Number(ruleBody(foundation, '#title-bar .title-logo').match(/width: (\d+)px;/)?.[1]);
  // The logo is the tallest thing in the title row: its aspect is 775 / 520.
  const titleBottom = titleTop + (logoWidth * 520) / 775;
  const lensTop = Number(ruleBody(read('./ui/styles/world-panel.css'), '#world-lens-bar').match(/top: (\d+)px;/)?.[1]);
  assert.ok(lensTop >= titleBottom + 12, `lens bar top ${lensTop}px clears the title bottom ${titleBottom}px`);
  assert.doesNotMatch(html, /hud-top-left|hud-top-bar/, 'nothing else sits at the top');
});

test('the rails and the label solver avoid the status line instead of the removed blocks', () => {
  const layout = read('./ui/panelLayoutController.js');
  assert.match(layout, /'#intel-hud \.hud-status'/);
  assert.doesNotMatch(layout, /hud-(top|bottom)-(left|right|bar)|hud-(left|right)-edge|#style-indicator/);
  const overlay = read('./overlays/worldOverlay.js');
  assert.match(overlay, /'\.hud-status'/);
  assert.doesNotMatch(overlay, /'\.hud-(top|bottom)-(left|right|bar)'|'#style-indicator'/);
});
