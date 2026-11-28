import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { panelRuntime } from '../src/app/globePanelRuntime.js';
import { createGlobePanelResource } from '../src/tools/globePanel.js';
import { composeCatalog, coreTools } from '../src/tools/index.js';

const urlIndex = process.argv.indexOf('--url');
assert.ok(urlIndex >= 0, 'Pass the keyless fixture server with --url');
const url = new URL(process.argv[urlIndex + 1]);
assert.equal(url.hostname, '127.0.0.1', 'Use the keyless fixture server');

const panelKey = 'font-fixture';
const staticRequests = new Set();
const catalog = composeCatalog({
  tools: coreTools,
  services: {
    app: {
      baseUrl: url.href,
      panelKey,
      fetch: async (path, init) => {
        if (!path.startsWith('/panel/') || init.method !== 'GET') {
          return new Response(null, { status: 404 });
        }
        staticRequests.add(path);
        return fetch(new URL(path, url), { method: 'GET', redirect: 'error' });
      },
    },
  },
});
const resource = createGlobePanelResource({ runtime: panelRuntime, panelKey });
const html = resource.text.replace(
  '<head>',
  '<head><base href="' +
    url.href +
    '"><meta http-equiv="Content-Security-Policy" content="font-src data:">',
);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  const page = await browser.newPage();
  const networkFonts = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font' && /^https?:/.test(request.url())) {
      networkFonts.push(request.url());
    }
  });
  await page.exposeFunction('panelCall', async (name, args) => {
    assert.equal(name, 'panel_request');
    const { data } = await catalog.call(name, args);
    return { structuredContent: data };
  });
  await page.evaluate(
    ({ html, appUrl }) => {
      const frame = document.createElement('iframe');
      window.addEventListener('message', async (event) => {
        if (
          event.source !== frame.contentWindow ||
          event.data?.jsonrpc !== '2.0'
        )
          return;
        const { id, method, params } = event.data;
        const send = (payload) =>
          event.source.postMessage({ jsonrpc: '2.0', ...payload }, '*');

        if (method === 'ui/initialize') {
          send({ id, result: {} });
        } else if (method === 'ui/notifications/initialized') {
          send({
            method: 'ui/notifications/tool-result',
            params: {
              structuredContent: { view: { url: appUrl }, url: appUrl },
            },
          });
        } else if (method === 'tools/call') {
          const result = await window.panelCall(params.name, params.arguments);
          send({ id, result });
        }
      });
      frame.srcdoc = html;
      document.body.append(frame);
    },
    { html, appUrl: url.href },
  );
  const host = await page.waitForSelector('iframe');
  const frame = await host.contentFrame();
  assert.ok(frame, 'The fixture MCP host loaded the panel iframe');
  await frame.waitForFunction(
    () => document.documentElement.classList.contains('material-symbols-ready'),
    { timeout: 45_000 },
  );
  const decoded = await frame.evaluate(async () => {
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = '400 24px "Material Symbols Outlined"';
    return {
      icon: canvas.measureText('rocket_launch').width,
      inter: (await document.fonts.load('400 16px Inter', 'Global Eye View'))
        .length,
      mono: (await document.fonts.load('400 16px "JetBrains Mono"', '2026'))
        .length,
    };
  });
  assert.equal(decoded.icon, 24);
  assert.ok(decoded.inter);
  assert.ok(decoded.mono);
  for (const asset of [
    'material-symbols-outlined.woff2',
    'inter-latin.woff2',
    'jetbrains-mono-latin.woff2',
  ]) {
    assert.ok(
      staticRequests.has('/panel/fonts/' + asset),
      asset + ' crossed the MCP bridge',
    );
  }
  assert.deepEqual(
    networkFonts,
    [],
    'The host page made no HTTP font requests',
  );
  console.log(
    '[PASS] Built panel fonts resolve and decode through the MCP bridge',
  );
} finally {
  await browser.close();
}
