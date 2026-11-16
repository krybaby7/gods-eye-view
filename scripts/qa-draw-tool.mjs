#!/usr/bin/env node
/** Rendered acceptance for Menu ▸ Tools ▸ Draw: real clicks, real keys, real teardown. */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:4173';
const SHOT_DIR = process.env.QA_SHOT_DIR || 'qa-shots/draw';
const SHOT_PREFIX = process.env.QA_SHOT_PREFIX || '';
const HEADFUL = process.env.QA_HEADFUL === '1';
// A dense, recognisable grid: neighbourhood blocks to enclose and a straight
// road to trace along.
const VIEW = {
  lon: -122.4194,
  lat: 37.7749,
  height: 900,
  heading: 0,
  pitch: -85,
};

const browser = await puppeteer.launch({
  headless: !HEADFUL,
  ...(HEADFUL
    ? {
        executablePath:
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      }
    : {}),
  args: [
    '--no-sandbox',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    ...(HEADFUL ? ['--window-size=1280,860'] : []),
    ...(process.platform === 'darwin'
      ? ['--use-angle=metal', '--enable-gpu']
      : ['--use-gl=angle', '--use-angle=swiftshader']),
  ],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
let failures = 0;
function check(name, passed, detail = '') {
  console.log(
    `[${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`,
  );
  if (!passed) failures++;
}
fs.mkdirSync(SHOT_DIR, { recursive: true });
const shot = (name) =>
  page.screenshot({
    path: path.join(SHOT_DIR, `${SHOT_PREFIX}${name}.jpg`),
    type: 'jpeg',
    quality: 82,
  });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A clip of the globe, clear of the panels on every side: the design clip
 * (340, 200, 560 × 380 on the design window below) placed at the same
 * fractions of the open globe.
 */
async function canvasClip() {
  const open = await openGlobe();
  return {
    x: Math.round(open.left + (340 / DESIGN.width) * open.width),
    y: Math.round(open.top + (200 / DESIGN.height) * open.height),
    width: Math.round((560 / DESIGN.width) * open.width),
    height: Math.round((380 / DESIGN.height) * open.height),
  };
}

/**
 * How many amber pixels the clip contains. The drawn area's stroke and fill are
 * the only amber in this scene, so the count going UP after a shape is finished
 * is the shape actually painting — which is what CESIUM_3D_TILE-only
 * classification failed to do on a keyless boot while still reporting a mark on
 * the board. Decoding happens in the page because Node here has no image
 * decoder.
 */
async function amberPixels() {
  const shot64 = await page.screenshot({
    clip: await canvasClip(),
    type: 'png',
    encoding: 'base64',
  });
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${base64}`)).blob(),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let amber = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Warm and saturated: the amber mark (#ffb547) blended over imagery.
      if (r > 150 && g > 90 && g < 220 && b < 130 && r - b > 70 && r - g > 20)
        amber += 1;
    }
    return amber;
  }, shot64);
}

/**
 * Press Enter as the person drawing does — with the map focused, not a button.
 * Enter on a focused control means "press this control", so the tool ignores it
 * there; the harness has to move focus the way a user would before using the
 * finish key.
 */
async function pressFinish() {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Enter');
}

/**
 * The window the fixed points below were chosen for, when the globe's canvas
 * filled it and nothing lay over it. The globe now sits inside the frame,
 * with the layer list and the preset strip at its left and the menu's Tools
 * panel at its right, so each fixed point is kept as the same fraction of
 * the open globe between them (roadmap 1.5).
 */
const DESIGN = { width: 1280, height: 860 };

/**
 * The open globe in window pixels: right of Today (or its rail) and of the
 * left stack's panels, left of the sheet and of an open menu panel, below
 * the top bar and above the status line.
 */
const openGlobe = () =>
  page.evaluate(() => {
    const drawn = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility !== 'visible')
        return null;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    };
    const canvas =
      window.__godsEyeView.viewer.scene.canvas.getBoundingClientRect();
    let left = canvas.left;
    let right = canvas.right;
    let top = canvas.top;
    let bottom = canvas.bottom;
    const atLeft = [
      '#frame-today',
      '#frame-rail',
      '#data-panel',
      '#lens-bar',
      '#left-panel-stack > *',
    ];
    for (const selector of atLeft)
      for (const element of document.querySelectorAll(selector)) {
        const rect = drawn(element);
        if (rect) left = Math.max(left, rect.right + 8);
      }
    for (const selector of ['#frame-sheet', '#frame-tools > .tools-panel'])
      for (const element of document.querySelectorAll(selector)) {
        const rect = drawn(element);
        if (rect) right = Math.min(right, rect.left - 8);
      }
    const bar = drawn(document.getElementById('frame-top'));
    if (bar) top = Math.max(top, bar.bottom + 8);
    const status =
      drawn(document.querySelector('#intel-hud .hud-status')) ??
      drawn(document.getElementById('frame-bottom'));
    if (status) bottom = Math.min(bottom, status.top - 8);
    return { left, top, width: right - left, height: bottom - top };
  });

/** Opens the Tools section of the top bar's menu, unless it is open. */
async function openToolsSection() {
  const open = await page.evaluate(
    () => document.getElementById('frame-menu-tools')?.hidden === false,
  );
  if (open) return;
  await page.click('#frame-menu');
  await page.waitForSelector('#frame-menu-list:not([hidden])', {
    timeout: 10_000,
  });
  await page.click('#frame-menu-item-tools');
  await page.waitForSelector('#frame-menu-tools:not([hidden])', {
    timeout: 10_000,
  });
}

/** The globe canvas's rectangle in window pixels. */
const canvasRect = () =>
  page.evaluate(() => {
    const rect =
      window.__godsEyeView.viewer.scene.canvas.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });

/**
 * One click on the globe, the way a person makes one, at a point given on the
 * design window and placed at the same fraction of the open globe.
 */
async function clickWorld(x, y, options = {}) {
  const open = await openGlobe();
  await page.mouse.click(
    open.left + (x / DESIGN.width) * open.width,
    open.top + (y / DESIGN.height) * open.height,
    options,
  );
  await wait(options.settle ?? 140);
}

/** One click at a canvas pixel (as Cesium projects it), in window pixels. */
async function clickCanvas(point, options = {}) {
  const rect = await canvasRect();
  await page.mouse.click(rect.left + point.x, rect.top + point.y, options);
  await wait(options.settle ?? 140);
}

const drawState = () =>
  page.evaluate(() => {
    const tool = window.__gevDrawTool;
    return {
      ...tool.diagnostics(),
      shape: tool.shape,
      vertices: tool.session?.vertices?.length ?? null,
      hint: document.getElementById('draw-hint')?.textContent || '',
      marks: window.__gevAnnotations.count(),
    };
  });

const marks = () =>
  page.evaluate(() =>
    window.__gevAnnotations.list().map((mark) => ({
      type: mark.type,
      label: mark.label,
      color: mark.color,
      source: mark.source ?? null,
    })),
  );

/** Wait until the board has settled at `expected` marks (annotate is async). */
async function waitForMarks(expected, timeout = 15_000) {
  try {
    await page.waitForFunction(
      (want) => window.__gevAnnotations.count() === want,
      { timeout },
      expected,
    );
    return true;
  } catch {
    return false;
  }
}

try {
  await page.setViewport({ width: 1280, height: 860 });
  await page.goto(`${BASE_URL}/?welcome=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      window.__gevDrawTool &&
      window.__gevAnnotations &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 90_000 },
  );
  await page.evaluate((view) => {
    const viewer = window.__godsEyeView.viewer;
    viewer.camera.cancelFlight?.();
    viewer.scene.tweens?.removeAll?.();
    viewer.camera.setView({
      destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: (view.lon * Math.PI) / 180,
        latitude: (view.lat * Math.PI) / 180,
        height: view.height,
      }),
      orientation: {
        heading: (view.heading * Math.PI) / 180,
        pitch: (view.pitch * Math.PI) / 180,
        roll: 0,
      },
    });
    viewer.scene.requestRender();
  }, VIEW);
  const settled = await page
    .waitForFunction(
      () => {
        const primitives = window.__godsEyeView.viewer.scene.primitives;
        for (let index = 0; index < primitives.length; index++) {
          const primitive = primitives.get(index);
          if (
            typeof primitive.tilesLoaded === 'boolean' &&
            !primitive.tilesLoaded
          )
            return false;
        }
        return true;
      },
      { timeout: 90_000 },
    )
    .then(
      () => true,
      () => false,
    );
  check('visible tile content settles before drawing', settled);

  // The Draw control lives in the top bar's menu, under Tools: open it the
  // way a user does. The panel stays open while drawing.
  await openToolsSection();
  await page.waitForFunction(
    () =>
      document.getElementById('draw-toggle')?.getBoundingClientRect().width > 0,
    { timeout: 10_000 },
  );
  check(
    'the Draw control is in the Tools section of the menu and starts off',
    await page.evaluate(() => {
      const toggle = document.getElementById('draw-toggle');
      return (
        toggle?.getAttribute('aria-pressed') === 'false' &&
        !document.getElementById('draw-mode-row')?.classList.contains('visible')
      );
    }),
  );

  // The viewer's OWN click actions, captured before the tool ever runs. Both
  // must be absent while drawing and back — as the SAME functions — after.
  await page.evaluate(() => {
    const Cesium = window.__CESIUM__;
    const stock = window.__godsEyeView.viewer.screenSpaceEventHandler;
    window.__qaStock = {
      click:
        stock.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK) || null,
      double:
        stock.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK) ||
        null,
    };
  });
  const stockActions = () =>
    page.evaluate(() => {
      const Cesium = window.__CESIUM__;
      const stock = window.__godsEyeView.viewer.screenSpaceEventHandler;
      const live = {
        click:
          stock.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK) || null,
        double:
          stock.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK) ||
          null,
      };
      return {
        clickPresent: Boolean(live.click),
        doublePresent: Boolean(live.double),
        clickIsOriginal: live.click === window.__qaStock.click,
        doubleIsOriginal: live.double === window.__qaStock.double,
        hadClick: Boolean(window.__qaStock.click),
        hadDouble: Boolean(window.__qaStock.double),
      };
    });

  // ── enable / disable cycles leave nothing behind ────────────────────────
  const before = await drawState();
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.click('#draw-toggle');
    await wait(120);
    await page.click('#draw-toggle');
    await wait(120);
  }
  const after = await drawState();
  check(
    'three enable/disable cycles add no listener, handler or preview data source',
    after.domListeners === before.domListeners &&
      after.previewDataSources === 1 &&
      before.previewDataSources === 1 &&
      after.sceneHandler === false &&
      after.pointerOwner === null &&
      after.stockDoubleClick === before.stockDoubleClick,
    `listeners ${before.domListeners}→${after.domListeners}, previews ${after.previewDataSources}, ` +
      `handler ${after.sceneHandler}, owner ${after.pointerOwner}, stock dblclick ${after.stockDoubleClick}`,
  );

  // ── the viewer's own click actions are borrowed, then given back ────────
  await page.click('#draw-toggle');
  const duringDraw = await stockActions();
  check(
    "Cesium's own selecting click and tracking double-click are both borrowed while drawing",
    duringDraw.clickPresent === false && duringDraw.doublePresent === false,
    `click present ${duringDraw.clickPresent}, double present ${duringDraw.doublePresent} ` +
      `(viewer had click ${duringDraw.hadClick}, double ${duringDraw.hadDouble})`,
  );
  await page.click('#draw-toggle');
  const afterDraw = await stockActions();
  check(
    'and both are restored as the SAME functions, not replacements',
    afterDraw.clickPresent === duringDraw.hadClick &&
      afterDraw.doublePresent === duringDraw.hadDouble &&
      afterDraw.clickIsOriginal &&
      afterDraw.doubleIsOriginal,
    JSON.stringify(afterDraw),
  );

  // ── a pin, finished with Enter ──────────────────────────────────────────
  await page.click('#draw-toggle');
  await page.click('.pp-mode-btn[data-shape="pin"]');
  await page.click('#draw-label-input');
  await page.keyboard.type('Pin one');
  await clickWorld(520, 330);
  check(
    'the pointer is claimed while a session is open',
    (await drawState()).pointerOwner === 'draw',
  );
  await page.keyboard.press('Enter');
  check(
    'a pin placed by mouse and finished with Enter lands on the board',
    await waitForMarks(1),
  );

  // ── a line along a road, with Backspace ─────────────────────────────────
  await page.click('.pp-mode-btn[data-shape="line"]');
  await clickWorld(360, 300);
  await clickWorld(470, 380);
  await clickWorld(600, 470);
  const beforeBackspace = (await drawState()).vertices;
  await page.keyboard.press('Backspace');
  await wait(120);
  const afterBackspace = (await drawState()).vertices;
  check(
    'Backspace removes the last vertex only',
    beforeBackspace === 3 && afterBackspace === 2,
    `${beforeBackspace} → ${afterBackspace}`,
  );
  await clickWorld(640, 500);
  await page.click('#draw-label-input');
  await page.keyboard.type('Market St');
  await page.keyboard.press('Enter');
  check(
    'a line finished from the label field lands on the board',
    await waitForMarks(2),
  );
  const lineMark = (await marks()).find((mark) =>
    mark.label?.startsWith('Market St'),
  );
  check(
    'a drawn line reports its length and never a travel time',
    Boolean(lineMark) &&
      /\d/.test(lineMark.label) &&
      !/min|walk|drive/i.test(lineMark.label),
    lineMark?.label,
  );
  await shot('02-line-along-a-road');

  // ── an area, coloured and labelled, finished with a double-click ────────
  await page.click('.pp-mode-btn[data-shape="area"]');
  await page.select('#draw-color-select', 'amber');
  const amberBefore = await amberPixels();
  await page.click('#draw-label-input');
  await page.keyboard.type('Civic Center block');
  await clickWorld(400, 280);
  await clickWorld(700, 290);
  await clickWorld(720, 520);
  await clickWorld(410, 500);
  const areaVertices = (await drawState()).vertices;
  check(
    'four clicks on the globe are four vertices',
    areaVertices === 4,
    `${areaVertices} vertices`,
  );
  await clickWorld(410, 500, { count: 2, settle: 0 });
  const areaLanded = await waitForMarks(3);
  await wait(900);
  const afterDoubleClick = await page.evaluate(() =>
    window.__gevAnnotations.count(),
  );
  check('an area finished by double-click lands on the board', areaLanded);
  check(
    'a double-click finishes the shape exactly once',
    afterDoubleClick === 3,
    `${afterDoubleClick} marks`,
  );
  const areaMark = (await marks()).find(
    (mark) => mark.label === 'Civic Center block',
  );
  check(
    'the label and colour chosen in the panel are what is drawn',
    areaMark?.color === 'amber',
    JSON.stringify(areaMark),
  );
  await wait(1200);
  const amberAfter = await amberPixels();
  check(
    'the finished area actually PAINTS — amber pixels appear on this surface',
    amberAfter - amberBefore > 500,
    `${amberBefore} → ${amberAfter} amber pixels (+${amberAfter - amberBefore})`,
  );
  await shot('01-area-with-label');
  await shot('03-pins-and-shapes');

  // ── Escape cancels the shape, a second Escape leaves draw mode ──────────
  await page.evaluate(() => window.__gevDrawTool.cancel());
  await clickWorld(500, 300);
  await clickWorld(560, 340);
  check('a new shape is in progress', (await drawState()).vertices === 2);
  await page.keyboard.press('Escape');
  await wait(150);
  const afterFirstEscape = await drawState();
  check(
    'Escape cancels the shape in progress and stays in draw mode',
    afterFirstEscape.vertices === 0 && afterFirstEscape.active === true,
    `vertices ${afterFirstEscape.vertices}, active ${afterFirstEscape.active}`,
  );
  await page.keyboard.press('Escape');
  await wait(150);
  const afterSecondEscape = await drawState();
  check(
    'a second Escape leaves draw mode and gives the pointer back',
    afterSecondEscape.active === false &&
      afterSecondEscape.pointerOwner === null &&
      afterSecondEscape.sceneHandler === false,
    JSON.stringify(afterSecondEscape),
  );
  check(
    'cancelling never removes a mark already on the board',
    afterSecondEscape.marks === 3,
    `${afterSecondEscape.marks} marks`,
  );

  // ── a click that would select something selects nothing while drawing ───
  const target = await findClickableTarget();
  check(
    'a selectable layer entity is on screen to test click ownership against',
    Boolean(target),
    target
      ? `${target.layer} at ${target.x},${target.y}`
      : 'no CCTV camera or bundled site could be reached — the ownership case cannot be proved',
  );
  if (target) {
    await clickCanvas(target, { settle: 900 });
    const selectedNormally = await page.evaluate(() =>
      Boolean(window.__godsEyeView.viewer.selectedEntity),
    );
    check(
      `clicking a ${target.layer} selects it when nothing owns the pointer`,
      selectedNormally,
    );
    await page.evaluate(() => {
      window.__godsEyeView.viewer.selectedEntity = undefined;
    });
    await page.click('#draw-toggle');
    await page.click('.pp-mode-btn[data-shape="area"]');
    await clickCanvas(target, { settle: 900 });
    const whileDrawing = await drawState();
    const selectedWhileDrawing = await page.evaluate(() =>
      Boolean(window.__godsEyeView.viewer.selectedEntity),
    );
    check(
      `clicking the same ${target.layer} while drawing adds a vertex and selects nothing`,
      whileDrawing.vertices === 1 && selectedWhileDrawing === false,
      `vertices ${whileDrawing.vertices}, selected ${selectedWhileDrawing}`,
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await wait(150);
  }

  // ── what a reload actually does ─────────────────────────────────────────
  const beforeReload = await page.evaluate(() =>
    window.__gevAnnotations.count(),
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      window.__gevAnnotations &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 90_000 },
  );
  const afterReload = await page.evaluate(() =>
    window.__gevAnnotations.count(),
  );
  check(
    'a reload starts an empty board — marks live for the session, not across reloads',
    beforeReload > 0 && afterReload === 0,
    `${beforeReload} before, ${afterReload} after`,
  );

  // ── Clear wipes the board ───────────────────────────────────────────────
  await openToolsSection();
  await page.waitForFunction(
    () =>
      document.getElementById('draw-toggle')?.getBoundingClientRect().width > 0,
    { timeout: 10_000 },
  );
  // The reload built a new page context: re-capture the viewer's own click
  // actions so the identity comparisons below still mean something.
  await page.evaluate(() => {
    const Cesium = window.__CESIUM__;
    const stock = window.__godsEyeView.viewer.screenSpaceEventHandler;
    window.__qaStock = {
      click:
        stock.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK) || null,
      double:
        stock.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK) ||
        null,
    };
  });
  await page.evaluate((view) => {
    const viewer = window.__godsEyeView.viewer;
    viewer.camera.cancelFlight?.();
    viewer.camera.setView({
      destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: (view.lon * Math.PI) / 180,
        latitude: (view.lat * Math.PI) / 180,
        height: view.height,
      }),
      orientation: { heading: 0, pitch: (view.pitch * Math.PI) / 180, roll: 0 },
    });
  }, VIEW);
  await wait(2500);
  await page.click('#draw-toggle');
  await page.click('.pp-mode-btn[data-shape="area"]');
  await clickWorld(420, 280);
  await clickWorld(700, 300);
  await clickWorld(660, 520);
  await pressFinish();
  const drewAgain = await waitForMarks(1);
  check('a shape can be drawn again after a reload', drewAgain);

  // Enter belongs to whatever the keyboard is on. With Clear focused it must
  // PRESS CLEAR — the shape in progress goes, and so does the mark already on
  // the board — and it must NOT quietly finish a second shape.
  await clickWorld(430, 300);
  await clickWorld(690, 320);
  await clickWorld(670, 500);
  const beforeButtonEnter = await drawState();
  await page.focus('#draw-clear');
  await page.keyboard.press('Enter');
  await wait(600);
  const afterButtonEnter = await drawState();
  check(
    'Enter on a keyboard-focused button activates the button, it does not finish the shape',
    beforeButtonEnter.vertices === 3 &&
      beforeButtonEnter.marks === 1 &&
      afterButtonEnter.marks === 0 &&
      afterButtonEnter.vertices === 0,
    `before ${beforeButtonEnter.vertices} vertices / ${beforeButtonEnter.marks} marks, ` +
      `after ${afterButtonEnter.vertices} / ${afterButtonEnter.marks} ` +
      '(a finish would have made it 2 marks)',
  );

  // Put one back so the Clear BUTTON check below has something to remove.
  await clickWorld(420, 280);
  await clickWorld(700, 300);
  await clickWorld(660, 520);
  await pressFinish();
  check(
    'a shape can be drawn after the board was cleared from the keyboard',
    await waitForMarks(1),
  );
  await page.click('#draw-clear');
  await wait(400);
  const cleared = await drawState();
  check(
    'Clear removes every mark from the board',
    cleared.marks === 0,
    `${cleared.marks} marks left`,
  );
  await shot('04-after-clear');

  // ── a shape that describes nothing is refused, not placed ───────────────
  const degenerateVertices = await page.evaluate(() => {
    const tool = window.__gevDrawTool;
    tool.cancel();
    // Three points on one line, placed through the same addVertex the clicks use.
    tool.addVertex(-122.42, 37.77);
    tool.addVertex(-122.42, 37.771);
    tool.addVertex(-122.42, 37.772);
    return tool.session?.vertices?.length ?? null;
  });
  check(
    'three collinear vertices are accepted into the session',
    degenerateVertices === 3,
    `${degenerateVertices} vertices`,
  );
  await pressFinish();
  await wait(600);
  const degenerate = await drawState();
  check(
    'three points in a line are refused with a reason, not placed',
    degenerate.marks === 0 && /in a line/.test(degenerate.hint),
    `${degenerate.marks} marks, hint "${degenerate.hint}"`,
  );

  // ── a shape drawn across the antimeridian lands where it was drawn ──────
  await page.evaluate(() => {
    const viewer = window.__godsEyeView.viewer;
    viewer.camera.cancelFlight?.();
    viewer.camera.setView({
      destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: (179.9995 * Math.PI) / 180,
        latitude: 0,
        height: 3000,
      }),
      orientation: { heading: 0, pitch: (-88 * Math.PI) / 180, roll: 0 },
    });
    viewer.scene.requestRender();
  });
  await wait(2500);
  await page.evaluate(() => {
    const tool = window.__gevDrawTool;
    tool.cancel();
    tool.setShape('area');
    // A ~200 m square straddling 180.
    tool.addVertex(179.999, -0.001);
    tool.addVertex(-179.999, -0.001);
    tool.addVertex(-179.999, 0.001);
    tool.addVertex(179.999, 0.001);
  });
  await pressFinish();
  const datelineLanded = await waitForMarks(1);
  const datelineAnchor = await page.evaluate(() => {
    const mark = window.__gevAnnotations.list()[0];
    return mark ? { lon: mark.anchor?.lon, lat: mark.anchor?.lat } : null;
  });
  check(
    'a shape drawn across the antimeridian anchors there, not on the Greenwich meridian',
    datelineLanded &&
      datelineAnchor &&
      Math.abs(Math.abs(datelineAnchor.lon) - 180) < 0.1 &&
      Math.abs(datelineAnchor.lat) < 0.1,
    JSON.stringify(datelineAnchor),
  );
  await page.evaluate(() => window.__gevAnnotations.clear());

  await page.click('#draw-toggle');
  await wait(200);
  const finalState = await drawState();
  check(
    'leaving draw mode gives back the pointer, the handler and the double-click',
    finalState.active === false &&
      finalState.pointerOwner === null &&
      finalState.sceneHandler === false &&
      finalState.previewDataSources === 1,
    JSON.stringify(finalState),
  );
  // ── destroy(): the shell disposing the tool leaves nothing behind ───────
  const beforeDestroy = await page.evaluate(
    () => window.__godsEyeView.viewer.dataSources.length,
  );
  await page.click('#draw-toggle'); // destroy from an ACTIVE session: the harder case
  await wait(200);
  const destroyed = await page.evaluate(async () => {
    const tool = window.__gevDrawTool;
    const wasActive = tool.active;
    await tool.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const Cesium = window.__CESIUM__;
    const viewer = window.__godsEyeView.viewer;
    const stock = viewer.screenSpaceEventHandler;
    let previews = 0;
    for (let i = 0; i < viewer.dataSources.length; i += 1)
      if (viewer.dataSources.get(i)?.name === 'gev-draw-preview') previews += 1;
    return {
      wasActive,
      diagnostics: tool.diagnostics(),
      previews,
      dataSources: viewer.dataSources.length,
      handleGone: window.__gevDrawTool === undefined,
      clickRestored:
        stock.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK) ===
        window.__qaStock.click,
      doubleRestored:
        stock.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK) ===
        window.__qaStock.double,
      drawingClass: document.body.classList.contains('gev-drawing'),
    };
  });
  check(
    'destroy() from an active session releases the pointer, handler and listeners',
    destroyed.wasActive === true &&
      destroyed.diagnostics.destroyed === true &&
      destroyed.diagnostics.pointerOwner === null &&
      destroyed.diagnostics.sceneHandler === false &&
      destroyed.diagnostics.domListeners === 0 &&
      destroyed.drawingClass === false,
    JSON.stringify(destroyed.diagnostics),
  );
  check(
    'destroy() detaches the preview data source and gives the window handle back',
    destroyed.previews === 0 &&
      destroyed.dataSources === beforeDestroy - 1 &&
      destroyed.handleGone,
    `previews ${destroyed.previews}, dataSources ${beforeDestroy} → ${destroyed.dataSources}, handle gone ${destroyed.handleGone}`,
  );
  check(
    "destroy() returns Cesium's own click actions",
    destroyed.clickRestored && destroyed.doubleRestored,
    `click ${destroyed.clickRestored}, double ${destroyed.doubleRestored}`,
  );

  check(
    'no uncaught page errors across the run',
    errors.length === 0,
    errors.join(' | '),
  );
} finally {
  await browser.close();
}
console.log(`RESULT: ${failures} failures`);
process.exitCode = failures ? 1 : 0;

/**
 * Find something on screen that a layer would select on click, so the ownership
 * guard can be proved against a real selection rather than a stub. Bundled
 * infrastructure first (no network, works keyless); CCTV cameras if they are up.
 */
async function findClickableTarget() {
  // CCTV first: it is the layer the brief names, and it goes through the shared
  // tracking click gesture that flights and military use too.
  const camera = await page
    .evaluate(async () => {
      const manager = window.__godsEyeView.dataManager;
      await manager.setEnabled('cctv', true, { origin: 'user' });
      const module = manager.layers.get('cctv')?.module;
      if (!module?.getUIState) return null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const cameras = module.getUIState()?.cameras || [];
        const found = cameras.find((entry) => {
          const lat = entry.lat ?? entry.latitude;
          const lon = entry.lon ?? entry.longitude;
          return Number.isFinite(lat) && Number.isFinite(lon);
        });
        if (found)
          return {
            id: found.id,
            lat: found.lat ?? found.latitude,
            lon: found.lon ?? found.longitude,
          };
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return null;
    })
    .catch(() => null);

  if (camera) {
    await page.evaluate((spot) => {
      const viewer = window.__godsEyeView.viewer;
      viewer.camera.cancelFlight?.();
      viewer.camera.setView({
        destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: (spot.lon * Math.PI) / 180,
          latitude: (spot.lat * Math.PI) / 180,
          height: 600,
        }),
        orientation: { heading: 0, pitch: (-80 * Math.PI) / 180, roll: 0 },
      });
      viewer.scene.requestRender();
    }, camera);
    await wait(4000);
    const spot = await onScreen(
      (entity) => typeof entity.id === 'string' && entity.id.startsWith('CAM-'),
    );
    if (spot) return { ...spot, layer: 'CCTV camera' };
  }

  // Bundled infrastructure as the keyless fallback: a different guarded handler,
  // the same shared claim, and always present without a key.
  const site = await page
    .evaluate(async () => {
      const viewer = window.__godsEyeView.viewer;
      await window.__godsEyeView.dataManager.setEnabled(
        'local-datacenters',
        true,
        {
          origin: 'user',
        },
      );
      const centreOf = (entity) => {
        const time = viewer.clock.currentTime;
        const point = entity.position?.getValue?.(time);
        if (point) return point;
        const hierarchy = entity.polygon?.hierarchy?.getValue?.(time);
        if (hierarchy?.positions?.length) return hierarchy.positions[0];
        const line = entity.polyline?.positions?.getValue?.(time);
        return line?.length ? line[0] : null;
      };
      for (let attempt = 0; attempt < 40; attempt += 1) {
        for (let i = 0; i < viewer.dataSources.length; i += 1) {
          for (const entity of viewer.dataSources.get(i).entities.values) {
            if (entity.__localLayerId !== 'local-datacenters') continue;
            const point = centreOf(entity);
            if (!point) continue;
            const carto = window.Cesium
              ? window.Cesium.Cartographic.fromCartesian(point)
              : viewer.scene.globe.ellipsoid.cartesianToCartographic(point);
            if (!carto) continue;
            return {
              lon: (carto.longitude * 180) / Math.PI,
              lat: (carto.latitude * 180) / Math.PI,
            };
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return null;
    })
    .catch(() => null);
  if (!site) return null;
  await page.evaluate((spot) => {
    const viewer = window.__godsEyeView.viewer;
    viewer.camera.cancelFlight?.();
    viewer.camera.setView({
      destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: (spot.lon * Math.PI) / 180,
        latitude: (spot.lat * Math.PI) / 180,
        height: 2500,
      }),
      orientation: { heading: 0, pitch: (-88 * Math.PI) / 180, roll: 0 },
    });
    viewer.scene.requestRender();
  }, site);
  await wait(4000);
  const spot = await onScreen(
    (entity) => entity.__localLayerId === 'local-datacenters',
  );
  return spot ? { ...spot, layer: 'data centre' } : null;
}

/**
 * Canvas coordinates of the first entity matching `belongs` that is on screen
 * and clear of the side panels. Annotation marks and the draw tool's own
 * preview vertices are on screen too, so the predicate has to be specific.
 */
async function onScreen(belongs, timeout = 20_000) {
  return page
    .waitForFunction(
      (belongsSource) => {
        // eslint-disable-next-line no-new-func
        const belongsTo = new Function(`return (${belongsSource})`)();
        const viewer = window.__godsEyeView.viewer;
        const scene = viewer.scene;
        const collections = [viewer.entities];
        for (let i = 0; i < viewer.dataSources.length; i += 1) {
          const source = viewer.dataSources.get(i);
          if (source?.name === 'gev-draw-preview') continue;
          collections.push(source.entities);
        }
        for (const source of collections) {
          for (const entity of source.values) {
            if (!belongsTo(entity)) continue;
            const position = entity.position?.getValue?.(
              viewer.clock.currentTime,
            );
            if (!position) continue;
            const window2d = scene.cartesianToCanvasCoordinates(position);
            if (!window2d) continue;
            const { x, y } = window2d;
            // Clear of the side panels: the band the script used on the
            // design window, as fractions of today's canvas.
            const w = scene.canvas.clientWidth;
            const h = scene.canvas.clientHeight;
            if (!(
              x > w * (300 / 1280) &&
              x < w * (900 / 1280) &&
              y > h * (180 / 860) &&
              y < h * (600 / 860)
            ))
              continue;
            // Projecting into the window is not the same as being clickable:
            // the entity may be beyond the horizon or behind a building. Only a
            // spot where the scene actually picks it proves the control case.
            const hit = scene.pick({ x: Math.round(x), y: Math.round(y) });
            if (!hit?.id || !belongsTo(hit.id)) continue;
            return { x: Math.round(x), y: Math.round(y) };
          }
        }
        return false;
      },
      { timeout, polling: 500 },
      belongs.toString(),
    )
    .then(
      (handle) => handle.jsonValue(),
      () => null,
    );
}
