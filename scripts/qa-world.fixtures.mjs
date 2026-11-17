import fs from 'node:fs/promises';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorldService } from '../server/providers/world/index.js';

const annualPeriod = '2024';
const firstDate = '2026-11-08T12:00:00Z';
const secondDate = '2026-11-09T12:00:00Z';
const readings = {
  IND: {
    S1: 1e13,
    S2: 1e11,
    S3: 64,
    S4: 73,
    S5: 52,
    S6: 1e10,
    S7: 33,
    S8: 11,
    S9: 3.4,
    S10: 56,
    S11: 45,
    S12: 1e9,
    C1: 24,
    C2: 9,
    C3: 90,
    C4: 6,
    C5: 80,
  },
  CHN: { S1: 1e14, C1: 56, C3: 98, C4: 4 },
  GBR: { S1: 1e12, C1: 79, C3: 93, C4: 5 },
  XKX: { S1: 1e10, C1: 35, C3: 85 },
  UVK: { C4: 6 },
  PAK: { S1: 1e11 },
};

export function createFixtureWorld(cacheDir, extraAdapters) {
  let second = false;
  const adapters = Object.fromEntries(
    ['worldbank', 'imf', 'ucdp', 'vdem'].map((id) => [
      id,
      {
        shouldCheck: ({ lastCheckedAt }) =>
          !lastCheckedAt || id === 'worldbank',
        async fetchObservations({ registry, now }) {
          // Leave progress observable during the browser's first request.
          await delay(300);
          const rows = second ? { IND: { C1: 37 } } : readings;
          const observations = registry.indicators
            .filter(({ source }) => source === id)
            .flatMap(({ slot, id: indicator }) =>
              Object.entries(rows)
                .filter(([, values]) => Object.hasOwn(values, slot))
                .map(([iso3, values]) => ({
                  iso3,
                  indicator,
                  value: values[slot],
                  period:
                    id === 'imf'
                      ? '2026'
                      : id === 'ucdp'
                        ? '2026-10'
                        : annualPeriod,
                  retrievedAt: now.toISOString(),
                  method: id === 'imf' ? 'source-forecast' : 'observed',
                })),
            );
          return { observations };
        },
      },
    ]),
  );
  const service = createWorldService({
    cacheDir,
    adapters: { ...adapters, ...extraAdapters },
    now: () => new Date(second ? secondDate : firstDate),
    fetchImpl: () => {
      throw new Error('World Board fixture attempted a live source request.');
    },
  });
  return {
    snapshot: service.snapshot,
    progress: service.progress,
    detail: service.detail,
    store: service.store,
    whenIdle: service.whenIdle,
    refresh: () => {
      second = true;
      return service.refreshStatus();
    },
  };
}

export async function installFixtures(
  page,
  origin,
  world,
  report,
  { strict = false, firePerimeter = null, weather = null } = {},
) {
  const imagery = await fs.readFile(
    new URL(
      '../node_modules/cesium/Build/Cesium/Assets/Textures/NaturalEarthII/0/0/0.jpg',
      import.meta.url,
    ),
  );
  const missingTile = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  const client = await page.createCDPSession();
  if (strict) {
    await client.send('Network.enable');
    await client.send('Network.setBypassServiceWorker', { bypass: true });
    await client.send('Network.setBlockedURLs', {
      urls: ['ws://*', 'wss://*'],
    });
  }
  // Local modules and Cesium workers load normally. Only provider transport
  // is paused, and every paused request is fulfilled without going upstream.
  client.on('Fetch.requestPaused', async ({ requestId, request }) => {
    let url;
    let weatherReply;
    if (strict)
      report.transport.requests = (report.transport.requests ?? 0) + 1;
    function reply(value, status = 200, contentType = 'application/json') {
      if (strict) {
        report.transport.fulfilled = (report.transport.fulfilled ?? 0) + 1;
        if (status === 404) {
          report.transport.blocked = (report.transport.blocked ?? 0) + 1;
          (report.transport.suppressedUrls ??= []).push(request.url);
        }
      }
      const body =
        contentType === 'application/json' ? JSON.stringify(value) : value;
      return client.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        responseHeaders: [
          { name: 'Content-Type', value: contentType },
          { name: 'Access-Control-Allow-Origin', value: '*' },
        ],
        body: Buffer.from(body).toString('base64'),
      });
    }
    try {
      url = new URL(request.url);
      if (
        strict &&
        url.origin === origin &&
        url.pathname !== '/api' &&
        !url.pathname.startsWith('/api/')
      ) {
        report.transport.continued = (report.transport.continued ?? 0) + 1;
        await client.send('Fetch.continueRequest', { requestId });
      } else if (url.origin === origin) {
        if (url.pathname === '/api/world' && request.method === 'GET') {
          report.transport.snapshots++;
          await reply(await world.snapshot({ compact: true }));
        } else if (
          url.pathname === '/api/world/refresh' &&
          request.method === 'POST'
        ) {
          report.transport.refreshes++;
          await reply(await world.refresh(), 202);
        } else if (
          url.pathname === '/api/world/progress' &&
          request.method === 'GET'
        ) {
          await reply(await world.progress());
        } else if (
          url.pathname === '/api/world/detail' &&
          request.method === 'GET'
        ) {
          const detail = await world.detail(
            url.searchParams.get('country'),
            url.searchParams.get('lens'),
          );
          if (detail) await reply(detail);
          else await reply({ error: 'Unknown World Board detail lens.' }, 404);
        } else if (
          weather &&
          request.method === 'GET' &&
          (weatherReply = await weather(url))
        ) {
          const key = url.pathname;
          const counts = (report.transport.weatherReplies ??= {});
          counts[key] = (counts[key] ?? 0) + 1;
          await reply(weatherReply.value, 200, weatherReply.contentType);
        } else if (
          firePerimeter &&
          url.pathname === '/api/fire-perimeters' &&
          request.method === 'GET'
        ) {
          report.transport.firePerimeterReplies =
            (report.transport.firePerimeterReplies ?? 0) + 1;
          await reply({ rows: [firePerimeter] });
        } else if (
          url.pathname === '/api/flights' &&
          request.method === 'GET' &&
          report.transport.flightFixture
        ) {
          // Only while a phase asks for it (the cockpit check): one
          // synthetic aircraft, so the cockpit is entered the real way.
          const { id, callsign, lon, lat } = report.transport.flightFixture;
          const now = Math.floor(Date.now() / 1000);
          report.transport.flightFixtureReplies =
            (report.transport.flightFixtureReplies ?? 0) + 1;
          await reply({
            time: now,
            states: [
              [
                id,
                callsign,
                'Synthetic',
                now,
                now,
                lon,
                lat,
                9000,
                false,
              ].concat([230, 90, 0, null, 9000, null, false, 0]),
            ],
          });
        } else {
          report.transport.suppressedApis.push(url.pathname);
          await reply({}, 404);
        }
      } else if (url.hostname === 'fonts.googleapis.com') {
        await reply('', 200, 'text/css');
      } else if (
        url.hostname === 'services.arcgisonline.com' &&
        url.searchParams.get('f') === 'json'
      ) {
        await reply({
          currentVersion: 10.9,
          capabilities: 'Map,Tilemap,Query,Data',
          tileInfo: {
            rows: 256,
            cols: 256,
            dpi: 96,
            format: 'JPEG',
            origin: { x: -20037508.342787, y: 20037508.342787 },
            spatialReference: { wkid: 102100 },
            lods: Array.from({ length: 24 }, (_, level) => ({
              level,
              resolution: 156543.033928 / 2 ** level,
              scale: 591657527.591555 / 2 ** level,
            })),
          },
          fullExtent: {
            xmin: -20037508.342787,
            ymin: -20037508.342787,
            xmax: 20037508.342787,
            ymax: 20037508.342787,
            spatialReference: { wkid: 102100 },
          },
        });
      } else if (
        ['services.arcgisonline.com', 'tile.openstreetmap.org'].includes(
          url.hostname,
        ) &&
        !/\/tile\/23\/0\/0$/.test(url.pathname)
      ) {
        report.transport.imageryTiles++;
        await reply(imagery, 200, 'image/jpeg');
      } else if (/\/tile\/23\/0\/0$/.test(url.pathname)) {
        await reply(missingTile, 200, 'image/png');
      } else {
        if (!report.transport.suppressedHosts.includes(url.hostname))
          report.transport.suppressedHosts.push(url.hostname);
        await reply({}, 404);
      }
    } catch (error) {
      // Navigation can cancel queued imagery, but a failed World Board
      // interception would invalidate the acceptance results. The client
      // aborts a progress poll when the board is switched off (the runner
      // clears the layers right after the first start turns the board on)
      // and when a manual Refresh replaces the poll, so only that abort is
      // let through; snapshot, refresh and detail stay guarded.
      const abandoned = /Invalid InterceptionId|Target closed/.test(
        error.message,
      );
      if (
        (url?.pathname.startsWith('/api/world') &&
          !(abandoned && url.pathname === '/api/world/progress')) ||
        !abandoned
      )
        report.errors.push(
          `Fixture ${url?.pathname ?? request.url}: ${error.message}`,
        );
      await client
        .send('Fetch.failRequest', { requestId, errorReason: 'Failed' })
        .catch(() => {});
    }
  });
  await client.send('Fetch.enable', {
    patterns: (strict ? ['*'] : [origin + '/api/*', 'https://*/*']).map(
      (urlPattern) => ({
        urlPattern,
      }),
    ),
  });
}
