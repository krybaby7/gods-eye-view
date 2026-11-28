import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import {
  boot,
  newFixture,
  serveFixtures,
} from '../scripts/qa-street-level.mjs';
import { waitForStill } from '../scripts/qa-panelDrag.mjs';
import { createFixtureWorld } from '../scripts/qa-world.fixtures.mjs';
import { createDenyProxy } from '../src/tooling/qaLookProxy.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  assert.ok(index >= 0 && args[index + 1], 'Missing ' + name);
  return args[index + 1];
};
const url = new URL(option('--url'));
assert.equal(url.hostname, '127.0.0.1');
const label = option('--label');
assert.ok(['before', 'after'].includes(label));
const out = process.env.GEV_STREET_LOOK_OUT || option('--out');
await mkdir(out, { recursive: true });
const world = createFixtureWorld(
  await mkdtemp(path.join(out, 'world-fixture-')),
);
await world.snapshot({ compact: true });
await world.whenIdle();
const snapshot = await world.snapshot({ compact: true });
const progress = await world.progress();

async function installBoardFixture(page) {
  const status = { served: 0, refused: 0 };
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  await cdp.send('Network.setBlockedURLs', { urls: ['ws://*', 'wss://*'] });
  cdp.on('Fetch.requestPaused', ({ requestId, request }) => {
    const pathname = new URL(request.url).pathname;
    const body =
      request.method === 'GET' &&
      (pathname === '/api/world'
        ? snapshot
        : pathname === '/api/world/progress' && progress);
    if (body) status.served++;
    else status.refused++;
    void cdp
      .send('Fetch.fulfillRequest', {
        requestId,
        responseCode: body ? 200 : 403,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(body || {})).toString('base64'),
      })
      .catch(() => {});
  });
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: url.origin + '/api/world*' }],
  });
  return status;
}

const proxy = await createDenyProxy(url.origin);
let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-quic',
      '--proxy-server=' + proxy.address,
      '--proxy-bypass-list=<-loopback>',
    ],
  });
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ]) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      const fixture = newFixture({ configured: true });
      await serveFixtures(page, fixture);
      const board = await installBoardFixture(page);
      await boot(page, url.href);
      await page.waitForFunction(
        () => document.getElementById('world-turn')?.textContent === 'Turn 1',
      );
      assert.ok(board.served > 0, 'The synthetic board was used');
      await page.evaluate(async () => {
        const manager = window.__godsEyeView.dataManager;
        await manager.setEnabled('street-level', true, { origin: 'user' });
        const strip = document.getElementById('street-level-panel');
        if (strip.classList.contains('collapsed')) {
          strip.querySelector('.panel-collapse-btn').click();
        }
      });
      await page.waitForSelector(
        '#sl-provider-chips [data-chip-id="mapillary"]',
        { visible: true },
      );
      await waitForStill(page, 'street-level-panel');
      await page.screenshot({
        path: path.join(out, label + '-' + width + 'x' + height + '-empty.png'),
      });

      const image = fixture.images.find((entry) => !entry.isPano);
      await page.evaluate(async (imageId) => {
        const { dataManager } = window.__godsEyeView;
        const street = dataManager.layers.get('street-level').module;
        await street.openImage('mapillary', imageId, { frame: false });
      }, image.id);
      await page.waitForFunction(
        (imageId) => {
          const street = window.__godsEyeView.dataManager.layers
            .get('street-level')
            .module.getUIState().street;
          return (
            street.imageId === imageId &&
            !street.loading &&
            !document.getElementById('sl-viewer-wrap').hidden &&
            document.getElementById('sl-image-when').textContent.trim()
          );
        },
        { timeout: 45_000 },
        image.id,
      );
      await waitForStill(page, 'street-level-panel');
      await page.screenshot({
        path: path.join(
          out,
          label + '-' + width + 'x' + height + '-filled.png',
        ),
      });
      assert.equal(
        fixture.unknown.length,
        0,
        'Every Mapillary fixture request was answered',
      );
      assert.equal(
        board.refused,
        0,
        'No World refresh or unhandled route was attempted',
      );
      assert.ok(
        [...fixture.calls].some((call) => /^GET .*\/thumb\//.test(call)),
      );
      const photo = await page.evaluate(async (imageId) => {
        const image = new Image();
        image.src =
          'https://qa-fixture.mapillary.com/thumb/' + imageId + '.jpg';
        await image.decode();
        const canvas = document.querySelector('#sl-viewer canvas');
        return [
          image.naturalWidth,
          image.naturalHeight,
          canvas?.clientWidth > 0,
        ];
      }, image.id);
      assert.deepEqual(
        photo,
        [640, 320, true],
        'The fixture photo decodes and the viewer canvas is visible',
      );

      await page.click('#sl-viewer-expand');
      await page.waitForSelector('#sl-viewer-wrap[aria-modal="true"]', {
        visible: true,
      });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => {
        const viewer = document.getElementById('sl-viewer-wrap');
        return (
          !viewer.hasAttribute('aria-modal') &&
          document.activeElement.id === 'sl-viewer-expand'
        );
      });
      await waitForStill(page, 'street-level-panel');

      const geometry = await page.evaluate(() => {
        const panel = document
          .getElementById('street-level-panel')
          .getBoundingClientRect();
        const viewer = document
          .getElementById('sl-viewer-wrap')
          .getBoundingClientRect();
        return {
          panelOnScreen:
            panel.left >= 0 && panel.right <= innerWidth + 1 && panel.top >= 0,
          viewerFits:
            viewer.left >= panel.left &&
            viewer.right <= panel.right + 1 &&
            viewer.bottom <= panel.bottom + 1,
        };
      });
      const reading = await page.evaluate(() => {
        const rgb = (value) => value.match(/[\d.]+/g).map(Number);
        const luminance = (channels) =>
          channels
            .slice(0, 3)
            .map((value) => value / 255)
            .map((value) =>
              value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4,
            )
            .reduce(
              (sum, value, index) =>
                sum + value * [0.2126, 0.7152, 0.0722][index],
              0,
            );
        const opaqueBackground = (node) => {
          for (
            let ancestor = node;
            ancestor;
            ancestor = ancestor.parentElement
          ) {
            const rgbColor = rgb(getComputedStyle(ancestor).backgroundColor);
            if ((rgbColor[3] ?? 1) === 1) return luminance(rgbColor);
          }
          return null;
        };
        return [
          '.sl-status',
          '.sl-image-meta',
          '.sl-image-link',
          '#sl-viewer-expand',
          '.sl-providers .data-toggle-chip',
          '.sl-seg-btn',
          '.sl-since-label',
        ].flatMap((selector) => {
          const node = document.querySelector(selector);
          if (!node?.getClientRects().length) return [];
          const style = getComputedStyle(node);
          const background = opaqueBackground(node);
          const foreground = luminance(rgb(style.color));
          return [
            {
              selector,
              size: parseFloat(style.fontSize),
              fits:
                node.clientWidth === 0 ||
                node.scrollWidth <= node.clientWidth + 1,
              contrast:
                background === null
                  ? null
                  : (Math.max(foreground, background) + 0.05) /
                    (Math.min(foreground, background) + 0.05),
            },
          ];
        });
      });
      if (label === 'after') {
        assert.deepEqual(geometry, { panelOnScreen: true, viewerFits: true });
        for (const { selector, size, contrast, fits } of reading) {
          assert.ok(
            size >= 13,
            selector + ' reading text measured ' + size + 'px',
          );
          assert.ok(fits, selector + ' stays within its available width');
          assert.ok(
            contrast >= 4.5,
            selector + ' contrast measured ' + contrast,
          );
        }
        const lowerSettingsReachable = await page.evaluate(() => {
          const slider = document.getElementById('sl-since');
          slider.focus();
          if (document.activeElement !== slider) return false;
          const inner = document.querySelector('.street-level-panel-inner');
          document
            .getElementById('sl-coverage-meta')
            .scrollIntoView({ block: 'end' });
          const visible = inner.getBoundingClientRect();
          return ['#sl-since-label', '#sl-legend', '#sl-coverage-meta'].every(
            (selector) => {
              const box = document
                .querySelector(selector)
                .getBoundingClientRect();
              return (
                box.height > 0 &&
                box.top >= visible.top - 1 &&
                box.bottom <= visible.bottom + 1
              );
            },
          );
        });
        assert.ok(
          lowerSettingsReachable,
          'Scroll reaches the date, legend and coverage text',
        );
        if (height === 720) {
          await page.screenshot({
            path: path.join(
              out,
              label + '-' + width + 'x' + height + '-scrolled.png',
            ),
          });
        }
        let escapedPanel = false;
        for (let count = 0; count < 5 && !escapedPanel; count++) {
          await page.keyboard.press('Tab');
          escapedPanel = await page.evaluate(
            () =>
              !document
                .getElementById('street-level-panel')
                .contains(document.activeElement),
          );
        }
        assert.ok(
          escapedPanel,
          'The inline panel does not trap keyboard focus',
        );
      }
      await page.click('#sl-viewer-close');
      await page.waitForFunction(
        () => document.getElementById('sl-viewer-wrap').hidden,
      );
      console.log(
        '[PASS] Street-level fixture ' +
          width +
          'x' +
          height +
          ': ' +
          JSON.stringify({
            reading,
            geometry,
            board,
            mapillary: {
              distinctCalls: fixture.calls.size,
              tileRequests: fixture.tileRequests,
              unexpected: fixture.unknown.length,
            },
          }),
      );
    } finally {
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close();
  const { deniedApi, deniedOrigin, tunnels, upgrades } = proxy.totals;
  console.log(
    'Street fixture proxy counts: ' +
      JSON.stringify({ deniedApi, deniedOrigin, tunnels, upgrades }),
  );
  await proxy.close();
}
