#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {
  parseLookArgs,
  collisions,
  validateWorkerProbe,
} from '../src/tooling/qaLook.mjs';
import { createDenyProxy } from '../src/tooling/qaLookProxy.mjs';
import { createFixtureWorld, installFixtures } from './qa-world.fixtures.mjs';

const options = parseLookArgs(process.argv.slice(2));
const out =
  process.env.GEV_LOOK_OUT && !process.argv.includes('--out')
    ? path.resolve(process.env.GEV_LOOK_OUT)
    : options.out;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-look-'));
const report = {
  transport: {
    snapshots: 0,
    refreshes: 0,
    imageryTiles: 0,
    suppressedApis: [],
    suppressedHosts: [],
  },
  errors: [],
  cases: [],
};
const wait = { timeout: 75000, polling: 125 };
let browser;
let page;
let proxy;
try {
  await fs.mkdir(out, { recursive: true });
  const world = createFixtureWorld(path.join(temporary, 'world'));
  proxy = await createDenyProxy(options.url.origin);
  browser = await puppeteer.launch({
    userDataDir: path.join(temporary, 'profile'),
    headless: true,
    protocolTimeout: 180000,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-quic',
      `--proxy-server=${proxy.address}`,
      '--proxy-bypass-list=<-loopback>',
    ],
  });
  await verifyWorkerIsolation();
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await installFixtures(page, options.url.origin, world, report, {
    strict: true,
  });
  page.on('pageerror', (error) =>
    report.errors.push(error.stack || error.message),
  );
  await page.goto(options.url.href, {
    waitUntil: 'domcontentloaded',
    timeout: wait.timeout,
  });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.viewer &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    wait,
  );
  await page.evaluate(
    () => window.__godsEyeView.styleManager.initialRestorePromise,
  );
  await page.evaluate(async () => {
    document.getElementById('clear-selected-layers').click();
    const manager = window.__godsEyeView.dataManager;
    await manager.setEnabled('world', false, { origin: 'user' });
    const source = await (await fetch('/src/layers/world/geometry.js')).text();
    const specifier = source.match(
      /from\s+["']([^"']*cesium\.js[^"']*)["']/,
    )?.[1];
    if (!specifier) throw new Error('Cesium module not resolved');
    const C = await import(specifier);
    const viewer = window.__godsEyeView.viewer;
    const imagery = await C.TileMapServiceImageryProvider.fromUrl(
      C.buildModuleUrl('Assets/Textures/NaturalEarthII'),
    );
    viewer.terrainProvider = new C.EllipsoidTerrainProvider();
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(imagery);
    viewer.camera.cancelFlight();
    viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(82, 22, 9000000),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    viewer.scene.requestRender();
    const { worldLegend } = await import('/src/layers/world/lensRegistry.js');
    window.lookQa = {
      C,
      expected: () => {
        const snapshot = manager.layers.get('world').module.getSnapshot();
        const definition = snapshot.lenses.find(
          (item) => item.id === snapshot.lens,
        );
        return {
          lens: snapshot.lens,
          legend: definition?.legend?.(snapshot) ?? worldLegend(snapshot),
        };
      },
    };
    await manager.setEnabled('world', true, { origin: 'user' });
  });
  await page.waitForFunction(
    () =>
      window.__godsEyeView.dataManager.isEffectivelyEnabled('world') &&
      document.querySelector('#world-turn')?.textContent === 'Turn 1',
    wait,
  );
  const pick = await page.waitForFunction(() => {
    const { C } = window.lookQa;
    const { scene } = window.__godsEyeView.viewer;
    const point = C.SceneTransforms.worldToWindowCoordinates(
      scene,
      C.Cartesian3.fromDegrees(81.7, 21.2),
    );
    if (!point) return false;
    const canvas = scene.canvas.getBoundingClientRect();
    for (const [dx, dy] of [
      [0, 0],
      [16, 0],
      [-16, 0],
      [0, 16],
      [0, -16],
      [24, 14],
      [-24, 14],
      [24, -14],
      [-24, -14],
    ]) {
      const probe = new C.Cartesian2(point.x + dx, point.y + dy);
      const x = Math.round(probe.x + canvas.left),
        y = Math.round(probe.y + canvas.top);
      if (
        scene.pick(probe, 1, 1)?.id?.startsWith?.('world:IND:') &&
        document.elementFromPoint(x, y) === scene.canvas
      )
        return { x, y };
    }
    scene.requestRender();
    return false;
  }, wait);
  const point = await pick.jsonValue();
  await pick.dispose();
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(
    () => document.querySelector('#world-sheet-code')?.textContent === 'IND',
    wait,
  );
  if (await page.evaluate(() => document.body.dataset.today !== 'open'))
    await page.click('#frame-today-open');
  await page.waitForFunction(
    () =>
      document.body.dataset.today === 'open' &&
      document.body.dataset.sheet === 'open',
    wait,
  );
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const lenses = await page.$$eval(
      '#world-lens-bar [data-world-lens]',
      (nodes) => nodes.map((node) => node.dataset.worldLens),
    );
    assert.ok(lenses.length, `no live lens controls at ${width}x${height}`);
    for (const lens of lenses) {
      try {
        const selector = `#world-lens-bar [data-world-lens="${lens}"]`;
        await page.click(selector);
        await page.waitForFunction(
          (selector, lens) => {
            const expected = window.lookQa.expected();
            const title = document
              .querySelector('#world-legend-title')
              ?.textContent.trim();
            const stops = [
              ...document.querySelectorAll('#world-legend-stops > *'),
            ].map((node) => node.textContent.trim());
            const note = document
              .querySelector('#world-legend-note')
              ?.textContent.trim();
            return (
              expected.lens === lens &&
              document.querySelector(selector)?.getAttribute('aria-pressed') ===
                'true' &&
              title === expected.legend.name &&
              JSON.stringify(stops) === JSON.stringify(expected.legend.stops) &&
              note === expected.legend.note
            );
          },
          wait,
          selector,
          lens,
        );
      } catch (error) {
        await failure(width, height, lens, 'select', error);
      }
      try {
        await capture(width, height, lens, 'band');
      } catch (error) {
        await failure(width, height, lens, 'band', error);
      }
      try {
        const button = await page.$('#frame-legend-whole');
        if (button && (await button.isVisible())) {
          await button.click();
          await page.waitForSelector('#frame-legend-popup:not([hidden])', {
            ...wait,
            visible: true,
          });
          try {
            await capture(width, height, lens, 'popover');
          } finally {
            await page.keyboard.press('Escape');
          }
        }
      } catch (error) {
        await failure(width, height, lens, 'popover', error);
      }
    }
  }
} catch (error) {
  report.errors.push(error.stack || error.message);
} finally {
  try {
    if (browser)
      await browser.close().catch((error) => report.errors.push(error.message));
    if (proxy) {
      report.proxy = { ...proxy.totals };
      await proxy.close().catch((error) => report.errors.push(error.message));
    }
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(
      path.join(out, `${options.label}-${options.state}-report.json`),
      JSON.stringify(report, null, 2),
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
if (
  report.errors.length ||
  report.cases.some((item) => item.error || item.collisions?.length)
)
  process.exitCode = 1;

// A local sentinel proves worker requests cannot bypass the proxy. The API probe
// must be stopped either by the CDP fixture owner or by the proxy, never Vite.
async function verifyWorkerIsolation() {
  let hits = 0;
  const sentinel = http.createServer((_req, res) => {
    hits++;
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
    res.end('unexpected');
  });
  await new Promise((resolve, reject) => {
    sentinel.once('error', reject);
    sentinel.listen(0, '127.0.0.1', resolve);
  });
  let probePage;
  try {
    probePage = await browser.newPage();
    const diagnostics = [];
    report.workerProbe = { diagnostics, pending: true };
    probePage.on('pageerror', (error) =>
      diagnostics.push(error.stack || error.message),
    );
    probePage.on('console', (message) => {
      if (message.type() === 'error') diagnostics.push(message.text());
    });
    probePage.on('requestfailed', (request) =>
      diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`),
    );
    const probePath = new URL('/__look-network-probe', options.url.origin).href;
    const client = await probePage.createCDPSession();
    client.on('Fetch.requestPaused', ({ requestId }) =>
      client.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
        body: Buffer.from(
          '<!doctype html><title>Network probe</title>',
        ).toString('base64'),
      }),
    );
    await client.send('Fetch.enable', {
      patterns: [{ urlPattern: probePath }],
    });
    await probePage.goto(probePath, {
      waitUntil: 'domcontentloaded',
      timeout: wait.timeout,
    });
    const external = `http://127.0.0.1:${sentinel.address().port}/worker-probe`;
    const api = new URL('/api/look-worker-probe', options.url.origin).href;
    const snapshot = () => ({
      denied: structuredClone(proxy.totals.deniedTargets),
      suppressed: [...(report.transport.suppressedUrls ?? [])],
    });
    const before = snapshot();
    const results = await probePage.evaluate(
      async ({ external, api }) => {
        const code = `self.onmessage = async ({data}) => { const results = []; for (const url of data) { try { const response = await fetch(url, {cache:'no-store'}); results.push({url,status:response.status}); } catch (error) { results.push({url,error:String(error)}); } } self.postMessage(results); };`;
        const blob = URL.createObjectURL(
          new Blob([code], { type: 'text/javascript' }),
        );
        try {
          return await new Promise((resolve, reject) => {
            const worker = new Worker(blob);
            const timer = setTimeout(() => {
              worker.terminate();
              reject(new Error('worker probe timed out'));
            }, 10000);
            worker.onmessage = (event) => {
              clearTimeout(timer);
              worker.terminate();
              resolve(event.data);
            };
            worker.onerror = (event) => {
              clearTimeout(timer);
              worker.terminate();
              reject(new Error(event.message));
            };
            worker.postMessage([external, api]);
          });
        } finally {
          URL.revokeObjectURL(blob);
        }
      },
      { external, api },
    );
    const after = snapshot();
    report.workerProbe = {
      diagnostics,
      sentinelUrl: external,
      apiUrl: api,
      results,
      sentinelHits: hits,
      before,
      after,
    };
    validateWorkerProbe(report.workerProbe);
  } finally {
    try {
      if (probePage) await probePage.close();
    } finally {
      await new Promise((resolve) => sentinel.close(resolve));
    }
  }
}

async function failure(width, height, lens, view, error) {
  const failed = {
    width,
    height,
    lens,
    view,
    error: error.stack || error.message,
    transport: structuredClone(report.transport),
    proxy: proxy ? { ...proxy.totals } : null,
  };
  report.cases.push(failed);
  const stem = `${options.label}-${options.state}-${width}x${height}-${lens}-${view}-failure`;
  await fs.writeFile(
    path.join(out, `${stem}.json`),
    JSON.stringify(failed, null, 2),
  );
  try {
    await page.screenshot({ path: path.join(out, `${stem}-full.png`) });
  } catch {}
}

async function capture(width, height, lens, view) {
  const data = await page.evaluate(
    async ({ width, height, view }) => {
      const visible = (element) => {
        if (!element) return false;
        for (let node = element; node; node = node.parentElement) {
          const css = getComputedStyle(node);
          if (
            node.hidden ||
            css.display === 'none' ||
            css.visibility !== 'visible' ||
            Number(css.opacity) === 0
          )
            return false;
        }
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      };
      const id = (element) =>
        element.id ||
        element.dataset.panelId ||
        element.className ||
        element.tagName;
      const box = (name, element) => {
        const r = element.getBoundingClientRect();
        return {
          name,
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          elementId: id(element),
          ancestors: [
            ...(function* (node) {
              while (node.parentElement) {
                node = node.parentElement;
                yield id(node);
              }
            })(element),
          ],
        };
      };
      const read = () => {
        const frames = [
          ['top bar', '#frame-top'],
          ['bottom bar', '#frame-bottom'],
          ['Today', '#frame-today'],
          ['rail', '#frame-rail'],
          ['sheet', '#frame-sheet'],
        ]
          .map(([name, sel]) => [name, document.querySelector(sel)])
          .filter(([, el]) => visible(el))
          .map(([name, el]) => box(name, el));
        const selectors = [
          '#data-panel',
          '#frame-presets-menu',
          '#lens-bar',
          '#right-context-rail > [data-panel-id]',
          '#command-dock',
          '#frame-tools > .tools-panel',
          '#world-hover',
        ];
        if (view === 'popover') selectors.push('#frame-legend-popup');
        const elements = [
          ...new Set(
            selectors.flatMap((sel) => [...document.querySelectorAll(sel)]),
          ),
        ].filter(visible);
        const panels = elements.map((el) => box(id(el), el));
        const band = document.querySelector('#world-legend'),
          button = document.querySelector('#frame-legend-whole');
        const target =
          view === 'popover'
            ? document.querySelector('#frame-legend-popup')
            : visible(band)
              ? band
              : button;
        if (!visible(target))
          throw new Error('Legend capture target is not visible');
        const type = (el) => {
          const css = getComputedStyle(el);
          return {
            fontSize: css.fontSize,
            lineHeight: css.lineHeight,
            fontFamily: css.fontFamily,
          };
        };
        const bounds = band.getBoundingClientRect();
        const whole = (element) => {
          const r = element.getBoundingClientRect();
          return (
            visible(element) &&
            r.left >= bounds.left - 0.5 &&
            r.right <= bounds.right + 0.5 &&
            r.top >= bounds.top - 0.5 &&
            r.bottom <= bounds.bottom + 0.5
          );
        };
        const marks = [
          ...document.querySelectorAll('#world-legend-stops > *'),
        ].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            text: el.textContent.trim(),
            visible:
              visible(el) &&
              r.left >= bounds.left - 0.5 &&
              r.right <= bounds.right + 0.5 &&
              r.top >= bounds.top - 0.5 &&
              r.bottom <= bounds.bottom + 0.5,
          };
        });
        return {
          width: innerWidth,
          height: innerHeight,
          frames,
          panels,
          target: box('target', target),
          text: target.textContent.trim(),
          caption: {
            legend: type(band),
            title: type(document.querySelector('#world-legend-title')),
            note: type(document.querySelector('#world-legend-note')),
            target: type(target),
          },
          omitted: marks.filter((mark) => !mark.visible),
          completeParts: [
            document.querySelector('#world-legend-title').textContent.trim(),
            ...marks.map((mark) => mark.text),
            document.querySelector('.world-legend-unknown').textContent.trim(),
            document.querySelector('#world-legend-note').textContent.trim(),
          ].filter(Boolean),
          selected: document.querySelector(
            '#world-lens-bar [aria-pressed="true"]',
          )?.dataset.worldLens,
          expected: window.lookQa.expected(),
          buttonVisible: visible(button),
          keyOmitted:
            !visible(band) ||
            !whole(document.querySelector('#world-legend-title')) ||
            !whole(document.querySelector('.world-legend-unknown')),
          legendMatches: (() => {
            const expected = window.lookQa.expected();
            return (
              expected.lens ===
                document.querySelector(
                  '#world-lens-bar [aria-pressed=\"true\"]',
                )?.dataset.worldLens &&
              expected.legend.name ===
                document
                  .querySelector('#world-legend-title')
                  .textContent.trim() &&
              JSON.stringify(expected.legend.stops) ===
                JSON.stringify(marks.map((mark) => mark.text)) &&
              expected.legend.note ===
                document.querySelector('#world-legend-note').textContent.trim()
            );
          })(),
          noteOmitted:
            band.hasAttribute('data-note-off') ||
            document.querySelector('#world-legend-note').scrollWidth >
              document.querySelector('#world-legend-note').clientWidth + 1,
          legendTitle: document
            .querySelector('#world-legend-title')
            ?.textContent.trim(),
        };
      };
      return await new Promise((resolve, reject) => {
        let prior,
          since = 0,
          samples = 0,
          frame;
        const timer = setTimeout(() => {
          cancelAnimationFrame(frame);
          reject(new Error('Layout stability timed out'));
        }, 10000);
        function sample(now) {
          try {
            const data = read();
            const key = JSON.stringify(data);
            if (
              data.width !== width ||
              data.height !== height ||
              !data.legendMatches ||
              key !== prior
            ) {
              prior = key;
              since = now;
              samples = 0;
            }
            if (data.legendMatches && ++samples >= 3 && now - since >= 250) {
              clearTimeout(timer);
              resolve(data);
              return;
            }
            frame = requestAnimationFrame(sample);
          } catch (e) {
            clearTimeout(timer);
            reject(e);
          }
        }
        frame = requestAnimationFrame(sample);
      });
    },
    { width, height, view },
  );
  // The popover is a separate surface despite its bottom-bar DOM parent.
  for (const panel of data.panels)
    if (panel.elementId === 'frame-legend-popup') panel.ancestors = [];
  data.collisions = collisions(data.frames, data.panels);
  data.transport = structuredClone(report.transport);
  data.proxy = proxy ? { ...proxy.totals } : null;
  const stem = `${options.label}-${options.state}-${width}x${height}-${lens}-${view}`;
  const target = data.target;
  const valid =
    target.left >= 0 &&
    target.top >= 0 &&
    target.right <= width &&
    target.bottom <= height;
  if (!valid) data.error = `Target outside viewport: ${JSON.stringify(target)}`;
  if (
    data.selected !== lens ||
    data.expected.lens !== lens ||
    data.legendTitle !== data.expected.legend.name ||
    JSON.stringify(
      data.completeParts.slice(1, 1 + data.expected.legend.stops.length),
    ) !== JSON.stringify(data.expected.legend.stops)
  )
    data.error = `Wrong lens or empty legend: ${data.selected}`;
  if (
    view === 'band' &&
    (data.omitted.length || data.noteOmitted || data.keyOmitted) &&
    !data.buttonVisible
  )
    data.error = 'Omitted or cut legend content lacks the whole-legend control';
  if (view === 'popover') {
    const missing = data.completeParts.filter(
      (part) => !data.text.includes(part),
    );
    if (missing.length)
      data.error = `Popover missing legend parts: ${JSON.stringify(missing)}`;
  }
  await page.screenshot({ path: path.join(out, `${stem}-full.png`) });
  const left = Math.max(0, target.left),
    top = Math.max(0, target.top),
    right = Math.min(width, target.right),
    bottom = Math.min(height, target.bottom);
  if (right > left && bottom > top)
    await page.screenshot({
      path: path.join(out, `${stem}-crop.png`),
      clip: { x: left, y: top, width: right - left, height: bottom - top },
    });
  await fs.writeFile(
    path.join(out, `${stem}.json`),
    JSON.stringify(data, null, 2),
  );
  report.cases.push({ width, height, lens, view, ...data });
}
