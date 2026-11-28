import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const urlIndex = process.argv.indexOf('--url');
assert.ok(urlIndex >= 0, 'Pass the keyless fixture server with --url');
const url = new URL(process.argv[urlIndex + 1]);
assert.equal(url.hostname, '127.0.0.1', 'Use the keyless fixture server');
const iconFile = '/fonts/material-symbols-outlined.woff2';
const asset = await fetch(new URL(iconFile, url), { redirect: 'error' });
assert.equal(asset.status, 200, 'The server supplies the bundled font');
assert.match(asset.headers.get('content-type') ?? '', /^font\/woff2\b/);
const iconBytes = Buffer.from(await asset.arrayBuffer());
assert.equal(iconBytes.subarray(0, 4).toString(), 'wOF2');
const glyphs = (
  await readFile(
    new URL('../public/fonts/material-symbols-glyphs.txt', import.meta.url),
    'utf8',
  )
)
  .trim()
  .split(/\s+/);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  for (const outcome of ['load', 'fail']) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      const externalFontRequests = [];
      const fontResponses = [];
      page.on('response', (response) => {
        if (response.url() === new URL(iconFile, url).href) {
          fontResponses.push(response.status());
        }
      });
      page.on('request', (request) => {
        if (
          /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(
            new URL(request.url()).hostname,
          )
        ) {
          externalFontRequests.push(request.url());
        }
      });

      const session = await page.createCDPSession();
      const fontRequest = Promise.withResolvers();
      const releaseResponse = Promise.withResolvers();
      session.on('Fetch.requestPaused', async (event) => {
        fontRequest.resolve();
        await releaseResponse.promise;
        if (outcome === 'fail') {
          await session.send('Fetch.failRequest', {
            requestId: event.requestId,
            errorReason: 'Failed',
          });
        } else {
          // Answer Chrome with the exact bytes served by the fixture origin.
          await session.send('Fetch.fulfillRequest', {
            requestId: event.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'font/woff2' }],
            body: iconBytes.toString('base64'),
          });
        }
      });
      await session.send('Fetch.enable', {
        patterns: [{ urlPattern: new URL(iconFile, url).href }],
      });
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      const timeout = AbortSignal.timeout(15_000);
      await Promise.race([
        fontRequest.promise,
        new Promise((_, reject) => {
          timeout.addEventListener('abort', () =>
            reject(
              new Error(
                'The local Material Symbols response was not requested',
              ),
            ),
          );
        }),
      ]);
      await page.evaluate(() => {
        const icon = document.createElement('span');
        icon.id = 'qa-local-font-icon';
        icon.className = 'material-symbols-outlined';
        icon.textContent = 'radar';
        document.body.append(icon);
      });
      const visible = () =>
        page.$eval(
          '#qa-local-font-icon',
          (icon) => getComputedStyle(icon).visibility,
        );
      assert.equal(
        await visible(),
        'hidden',
        'The icon stays blank while its font is pending',
      );
      releaseResponse.resolve();

      if (outcome === 'fail') {
        await page.waitForFunction(() =>
          [...document.fonts].some(
            (font) =>
              font.family.includes('Material Symbols Outlined') &&
              font.status === 'error',
          ),
        );
        assert.equal(
          await visible(),
          'hidden',
          'The icon stays blank after a font failure',
        );
      } else {
        try {
          await page.waitForFunction(() =>
            document.documentElement.classList.contains(
              'material-symbols-ready',
            ),
          );
        } catch (error) {
          const fontStatus = await page.evaluate(() =>
            [...document.fonts]
              .filter((font) =>
                font.family.includes('Material Symbols Outlined'),
              )
              .map((font) => font.status),
          );
          throw new Error(
            `Icon font never showed (HTTP ${fontResponses.join(', ')}; face ${fontStatus.join(', ')})`,
            { cause: error },
          );
        }
        assert.equal(
          await visible(),
          'visible',
          'The icon appears after its font loads',
        );

        const measurements = await page.evaluate(async (names) => {
          const canvas = document.createElement('canvas').getContext('2d');
          canvas.font = '400 24px "Material Symbols Outlined"';
          return {
            widths: names.map((name) => canvas.measureText(name).width),
            inter: (
              await document.fonts.load('400 16px Inter', 'Global Eye View')
            ).length,
            mono: (
              await document.fonts.load('400 16px "JetBrains Mono"', '2026')
            ).length,
          };
        }, glyphs);
        for (const [i, width] of measurements.widths.entries()) {
          assert.ok(
            Math.abs(width - 24) < 0.25,
            glyphs[i] + ' must render as one 24px glyph, got ' + width,
          );
        }
        assert.ok(measurements.inter, 'The local Inter face loads');
        assert.ok(measurements.mono, 'The local JetBrains Mono face loads');
      }

      assert.deepEqual(
        externalFontRequests,
        [],
        'The page makes no Google Fonts requests',
      );
      console.log('[PASS] Fonts stay local and handle ' + outcome);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
