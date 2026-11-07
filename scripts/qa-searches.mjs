#!/usr/bin/env node
/** Fixture-only browser QA. Run with --fixtures [--url http://127.0.0.1:5182]. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { LAYER_STATE_REGISTRY } from '../src/data/layerState.js';
import { decorateSearchSnapshots } from '../server/providers/search/dedupe.js';
import {
  buildRunSnapshot,
  compareRuns,
  listSearchDays,
} from '../server/providers/search/history.js';

const ARTIFACT_DIR = 'qa-artifacts/searches';
const VIEWPORT = { width: 1440, height: 900 };
const PANEL = '#searches-panel';
const FIRST = 'sr_00000001';
const SECOND = 'sr_00000002';
const OLD_DAY = '2026-11-04';
const NEW_DAY = '2026-11-06';
const QUESTION = 'What changed at the port?';
const FOLLOW_UP = 'What are others reporting about the port?';
const FIRST_LABEL = 'Port research';
const SECOND_LABEL = 'Port follow-up';
const UPDATE_TITLE = 'Port publishes new schedule';
const MAX_VISIBLE = 8;
const HOTSPOT = {
  key: 'country:Netherlands',
  label: 'Netherlands',
  kind: 'country',
  lat: 52.15,
  lon: 5.3,
};
const BELGIUM = {
  key: 'country:Belgium',
  label: 'Belgium',
  kind: 'country',
  lat: 50.85,
  lon: 4.35,
};
const ids = {
  event: 'f_00000001',
  statement: 'f_00000002',
  place: 'f_00000003',
  area: 'f_00000004',
  listOnly: 'f_00000005',
  update: 'f_00000006',
  duplicate: 'f_00000007',
};
const bases = {
  event: 'happened-here',
  statement: 'speaker-based',
  place: 'located-here',
  area: 'applies-here',
};
const searchToken = LAYER_STATE_REGISTRY.find(
  ({ id }) => id === 'searches',
)?.token;

function finding(
  id,
  kind,
  title,
  { lon, lat, hotspot = HOTSPOT, method = 'gazetteer' } = {},
) {
  const name = hotspot.label;
  return {
    id,
    kind,
    title,
    summary: title + ' according to Fixture News.',
    groupId: kind === 'area' || kind === 'place' ? 'places' : 'reports',
    actor: 'Port authority',
    place: { name, basis: bases[kind] },
    location:
      lon == null
        ? null
        : {
            lat,
            lon,
            name,
            precision: kind === 'area' ? 'country' : 'city',
            method,
          },
    hotspot: lon == null ? null : hotspot,
    eventAt:
      kind === 'event' || kind === 'statement' ? OLD_DAY + 'T09:00:00Z' : null,
    sourceIds: ['source', 'unsafe', 'credentials'],
    verification: 'reported',
    sourceCount: 1,
  };
}

function results(search, kind) {
  if (kind === 'update')
    return {
      findings: [
        finding(ids.update, 'statement', UPDATE_TITLE, {
          lon: 5.08,
          lat: 51.98,
        }),
      ],
      repeatedIds: [ids.event],
      summary: 'Updated port reporting.',
      day: NEW_DAY,
    };
  if (search.id === FIRST)
    return {
      findings: [
        finding(ids.event, 'event', 'Cargo ship reaches Rotterdam', {
          lon: 4.35,
          lat: 51.9,
        }),
        finding(ids.statement, 'statement', 'Port authority confirms arrival', {
          lon: 5.1,
          lat: 52.09,
          method: 'model',
        }),
        finding(ids.place, 'place', 'Port training center opens', {
          lon: 4.1,
          lat: 51.25,
          hotspot: BELGIUM,
        }),
        finding(ids.area, 'area', 'National shipping requirements', {
          lon: 5.55,
          lat: 52.25,
        }),
        finding(ids.listOnly, 'event', 'Arrival time remains unconfirmed'),
      ],
      repeatedIds: [],
      summary: 'Initial port reporting.',
      day: OLD_DAY,
    };
  return {
    findings: [
      finding(ids.duplicate, 'event', 'Cargo ship reaches Rotterdam', {
        lon: 4.35,
        lat: 51.9,
      }),
    ],
    repeatedIds: [],
    summary: 'Independent coverage of the arrival.',
    day: NEW_DAY,
  };
}

function fixtureServer() {
  const records = new Map();
  const requests = [];
  const unexpected = [];
  let serial = 0;
  let active;
  const freeColor = () => {
    const used = new Set(
      [...records.values()]
        .filter((record) => record.visible)
        .map((record) => record.colorIndex),
    );
    return (
      Array.from({ length: MAX_VISIBLE }, (_, i) => i).find(
        (i) => !used.has(i),
      ) ?? null
    );
  };
  for (let i = 1; i <= 7; i++) {
    const id = 'sr_f000000' + i;
    const startedAt = NEW_DAY + 'T07:00:00Z';
    records.set(id, {
      id,
      question: 'Fixture search ' + i,
      label: 'Fixture search ' + i,
      agent: 'claude',
      createdAt: startedAt,
      status: 'ready',
      visible: false,
      colorIndex: null,
      sources: [],
      findings: [],
      runs: [
        {
          id: 'run_f000000' + i,
          kind: 'ask',
          agent: 'claude',
          status: 'ok',
          startedAt,
          finishedAt: NEW_DAY + 'T07:01:00Z',
          answer: { summary: [], groups: [] },
          findingIds: [],
        },
      ],
    });
  }

  function start(search, kind) {
    const id = 'run_' + String(++serial).padStart(8, '0');
    const startedAt = new Date(Date.now() - 3000).toISOString();
    active = { search, id, kind, startedAt };
    search.status = 'running';
    delete search.error;
    search.running = {
      id,
      kind,
      agent: 'claude',
      stage: 'research',
      startedAt,
    };
    return { id: search.id, runId: id };
  }

  function complete() {
    const { search, id, kind } = active;
    const { findings, repeatedIds, summary, day } = results(search, kind);
    const startedAt = day + 'T11:00:00Z';
    const finishedAt = day + 'T11:00:03Z';
    if (!search.sources.length) {
      search.sources = [
        {
          id: 'source',
          url: 'https://example.com/port',
          domain: 'Fixture News',
          title: 'Port report',
          date: day,
          checkedBy: 'fetch',
          firstRunId: id,
        },
        {
          id: 'unsafe',
          url: 'javascript:alert(1)',
          domain: 'Unsafe script',
          firstRunId: id,
        },
        {
          id: 'credentials',
          url: 'https://user:secret@example.com/private',
          domain: 'Unsafe credentials',
          firstRunId: id,
        },
      ];
    }
    search.findings.push(
      ...findings.map((item) => ({
        ...item,
        firstRunId: id,
        firstSeenAt: finishedAt,
        lastSeenAt: finishedAt,
      })),
    );
    search.runs.push({
      id,
      kind,
      agent: 'claude',
      status: 'ok',
      startedAt,
      finishedAt,
      usage: { durationMs: 3000, inputTokens: 1200, outputTokens: 20 },
      answer: {
        summary: [
          { text: summary, sourceIds: ['source', 'unsafe', 'credentials'] },
        ],
        groups: [
          { id: 'reports', label: 'Reporting' },
          { id: 'places', label: 'Places' },
        ],
      },
      findingIds: [...repeatedIds, ...findings.map((item) => item.id)],
    });
    search.status = 'ready';
    delete search.running;
    active = null;
  }

  function respond(method, route, params, body) {
    if (!route && method === 'GET') {
      const asOf = params.get('asOf');
      const all = [...records.values()];
      const projected = all
        .map((record) => buildRunSnapshot(record, { asOf }))
        .filter(Boolean);
      const data = {
        asOf,
        days: listSearchDays(all),
        agents: {
          claude: {
            installed: true,
            signedIn: true,
            disabledReason: '',
            busy: Boolean(active),
          },
        },
        defaultAgent: 'claude',
        searches: decorateSearchSnapshots(projected),
      };
      const revision = createHash('sha256')
        .update(JSON.stringify(data))
        .digest('hex');
      if (params.get('rev') === revision) return [200, { unchanged: true }];
      return [200, { revision, ...data }];
    }
    if (!route && method === 'POST') {
      const first = body.question === QUESTION;
      assert.ok(
        first || body.question === FOLLOW_UP,
        'Unexpected fixture question',
      );
      assert.equal(body.agent, 'claude');
      assert.ok(!active, 'Only one fixture run can be active');
      const day = first ? OLD_DAY : NEW_DAY;
      const colorIndex = freeColor();
      const record = {
        id: first ? FIRST : SECOND,
        label: first ? FIRST_LABEL : SECOND_LABEL,
        agent: 'claude',
        question: body.question,
        createdAt: day + 'T11:00:00Z',
        visible: colorIndex != null,
        colorIndex,
        pinned: false,
        runs: [],
        findings: [],
        sources: [],
      };
      records.set(record.id, record);
      return [202, start(record, 'ask')];
    }
    const [id, action, child] = route.split('/');
    const search = records.get(id);
    if (!search)
      return [404, { error: 'not_found', reason: 'Unknown fixture search' }];
    if (method === 'GET' && action === 'runs') {
      const run = buildRunSnapshot(search, { runId: child });
      return run
        ? [200, { search: decorateSearchSnapshots([run])[0] }]
        : [404, { error: 'not_found' }];
    }
    if (method === 'GET' && action === 'changes') {
      const changes = compareRuns(search, params.get('from'), params.get('to'));
      return changes ? [200, changes] : [404, { error: 'not_found' }];
    }
    if (method === 'POST' && (action === 'update' || action === 'retry')) {
      assert.ok(!active, 'Only one fixture run can be active');
      return [202, start(search, action)];
    }
    if (method === 'POST' && action === 'cancel' && active?.search === search) {
      const { id: runId, kind, startedAt } = active;
      search.runs.push({
        id: runId,
        kind,
        startedAt,
        finishedAt: NEW_DAY + 'T10:00:03Z',
        status: 'failed',
        agent: 'claude',
      });
      delete search.running;
      search.status = 'failed';
      search.error = { message: 'Search cancelled' };
      active = null;
      return [202, { id, runId }];
    }
    if (method === 'PATCH' && !action) {
      if (body.visible && !search.visible) {
        const colorIndex = freeColor();
        if (colorIndex == null)
          return [
            409,
            {
              error: 'conflict',
              reason: 'Hide a search first: all 8 colours are in use',
            },
          ];
        search.colorIndex = colorIndex;
      }
      Object.assign(search, body);
      return [200, { id }];
    }
    if (method === 'DELETE' && !action) {
      records.delete(id);
      return [200, { id }];
    }
    if (method === 'DELETE' && action === 'findings' && child) {
      search.findings = search.findings.filter(({ id }) => id !== child);
      for (const run of search.runs)
        run.findingIds = (run.findingIds || []).filter(
          (findingId) => findingId !== child,
        );
      return [200, { id, findingId: child }];
    }
    unexpected.push(method + ' /api/searches/' + route);
    return [404, { error: 'unexpected_fixture_route' }];
  }

  async function install(page) {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      const method = request.method();
      const isSearch = /^\/api\/searches(?:\/|$)/.test(url.pathname);
      const isNews = /^\/api\/news(?:\/|$)/.test(url.pathname);
      if (!isSearch && !isNews) {
        void request.continue();
        return;
      }
      const reply = (status, body) =>
        request.respond({
          status,
          contentType: 'application/json',
          headers: { 'cache-control': 'no-store' },
          body: JSON.stringify(body),
        });
      if (isNews) {
        if (method !== 'GET') unexpected.push(method + ' ' + url.pathname);
        void reply(503, { error: 'news_disabled_in_searches_qa' });
        return;
      }
      try {
        const route = url.pathname
          .slice('/api/searches'.length)
          .replace(/^\//, '');
        const body = JSON.parse(request.postData() || '{}');
        const [status, data] = respond(method, route, url.searchParams, body);
        requests.push({
          method,
          route,
          params: Object.fromEntries(url.searchParams),
          body,
          status,
          unchanged: data.unchanged,
        });
        void reply(status, data);
      } catch (error) {
        unexpected.push(error.message);
        void reply(500, { error: 'fixture_failure', reason: error.message });
      }
    });
  }

  return {
    install,
    complete,
    requests,
    unexpected,
    stageMap: () => {
      active.search.running.stage = 'map';
    },
    runIds: (id) => records.get(id).runs.map((run) => run.id),
  };
}

function control(id, action) {
  const key = JSON.stringify([id, action]).replaceAll('\\', '\\\\');
  return `${PANEL} [data-search-focus='${key}']`;
}

async function until(page, fn, arg, label, timeout = 25_000) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 200 }, arg);
  } catch (error) {
    throw new Error('Timed out waiting for ' + label, { cause: error });
  }
}

function panelText(page, text) {
  return until(
    page,
    (wanted) =>
      document.getElementById('searches-panel')?.innerText.includes(wanted),
    text,
    text,
  );
}

async function click(page, selector) {
  // Panel renders replace controls. The locator reacquires them if they detach.
  try {
    await page.locator(selector).setTimeout(25_000).click();
  } catch (error) {
    throw new Error('Could not click ' + selector, { cause: error });
  }
}

async function clickText(page, label, scope = PANEL) {
  const handle = await page.waitForFunction(
    ([selector, text]) =>
      [...document.querySelectorAll(selector + ' button')].find(
        (button) =>
          button.textContent.trim() === text &&
          !button.disabled &&
          button.getClientRects().length,
      ),
    { timeout: 25_000, polling: 200 },
    [scope, label],
  );
  try {
    await handle.asElement().click();
  } finally {
    await handle.dispose();
  }
}

async function pinIds(page, expected) {
  await until(
    page,
    (ids) => {
      const { viewer } = window.__godsEyeView;
      const sources = viewer.dataSources.getByName('searches');
      const actual = sources[0]?.entities.values
        .map((entity) => entity.gevSearchFindingId)
        .sort();
      return (
        actual?.length === ids.length && ids.every((id, i) => actual[i] === id)
      );
    },
    [...expected].sort(),
    'search marker IDs ' + expected.join(', '),
  );
}

async function cameraAt(page, height) {
  await page.evaluate((meters) => {
    const { viewer } = window.__godsEyeView;
    viewer.camera.cancelFlight();
    viewer.camera.setView({
      destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: (5.3 * Math.PI) / 180,
        latitude: (52.15 * Math.PI) / 180,
        height: meters,
      }),
    });
    viewer.scene.requestRender();
  }, height);
}

function entities(page) {
  return page.evaluate(() => {
    const { viewer } = window.__godsEyeView;
    return (
      viewer.dataSources
        .getByName('searches')[0]
        ?.entities.values.map((entity) => {
          const point = viewer.scene.cartesianToCanvasCoordinates(
            entity.position.getValue(viewer.clock.currentTime),
          );
          const rect = viewer.scene.canvas.getBoundingClientRect();
          return {
            key: entity.gevSearchKey,
            findingId: entity.gevSearchFindingId,
            hotspot: entity.gevSearchHotspotKey,
            image: decodeURIComponent(entity.billboard.image.getValue()),
            x: point && rect.left + point.x,
            y: point && rect.top + point.y,
          };
        }) || []
    );
  });
}

async function pickEntity(page, key) {
  await until(
    page,
    (want) => {
      const { viewer } = window.__godsEyeView;
      const entity = viewer.dataSources
        .getByName('searches')[0]
        ?.entities.values.find((item) => item.gevSearchKey === want);
      if (!entity) return false;
      const point = viewer.scene.cartesianToCanvasCoordinates(
        entity.position.getValue(viewer.clock.currentTime),
      );
      const pick = point && viewer.scene.pick(point);
      return (pick?.id ?? pick?.primitive?.id)?.gevSearchKey === want;
    },
    key,
    'Cesium pick for ' + key,
  );
  const { x, y } = (await entities(page)).find((entity) => entity.key === key);
  await page.mouse.click(x, y);
}

async function main() {
  const args = process.argv.slice(2);
  const urlIndex = args.indexOf('--url');
  const base = urlIndex >= 0 ? args[urlIndex + 1] : 'http://127.0.0.1:5182';
  assert.ok(
    args.includes('--fixtures') && base,
    'Usage: node scripts/qa-searches.mjs --fixtures [--url URL]',
  );
  assert.ok(searchToken, 'Searches share token missing');
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      (await puppeteer.executablePath()),
    defaultViewport: VIEWPORT,
    protocolTimeout: 300_000,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const fixture = fixtureServer();
  const writes = () =>
    fixture.requests.filter(({ method }) => method !== 'GET');
  const errors = [];
  let count = 0;
  const step = async (label, fn) => {
    try {
      await fn();
    } catch (error) {
      throw new Error(label + ': ' + error.message, { cause: error });
    }
    console.log(`ok ${++count} ${label}`);
  };
  const page = await browser.newPage();
  const shot = (name) =>
    page.screenshot({ path: path.join(ARTIFACT_DIR, name + '.png') });
  const marker = async (id) =>
    (await entities(page)).find(({ findingId }) => findingId === id);
  const question = PANEL + ' textarea[aria-label="Search question"]';
  const ask = PANEL + ' button[type="submit"]';
  const day = PANEL + ' select[aria-label="Search history day"]';
  const filter = PANEL + ' [aria-label="Filter searches"]';
  const searchRows = PANEL + ' .searches-search';
  const swatches = PANEL + ' .searches-swatch[aria-pressed="true"]';
  const openMenu = async (id) => {
    const selector = control(id, 'actions');
    if (
      (await page.$eval(selector, (el) => el.getAttribute('aria-expanded'))) ===
      'false'
    )
      await click(page, selector);
  };
  const openFinding = async (id, findingId) => {
    const selector = control(JSON.stringify([id, findingId]), 'title');
    if (
      (await page.$eval(selector, (el) => el.getAttribute('aria-expanded'))) ===
      'false'
    )
      await click(page, selector);
  };

  try {
    page.on('pageerror', (error) => errors.push(error.message));
    await fixture.install(page);
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await until(
      page,
      () => Boolean(window.__godsEyeView?.dataManager),
      null,
      'app readiness',
      150_000,
    );
    await page.evaluate(() =>
      document.querySelector('.first-run-explore')?.click(),
    );
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      for (const el of document.querySelectorAll(
        '#first-run-launcher, [class*=first-run]',
      ))
        el.remove();
    });

    await step(
      'Enabling Searches opens the panel and encodes the layer token',
      async () => {
        await page.evaluate(() =>
          window.__godsEyeView.dataManager.setEnabled('searches', true, {
            origin: 'user',
          }),
        );
        await panelText(page, 'Fixture search 7');
        await until(
          page,
          (token) =>
            new URLSearchParams(location.hash.slice(1))
              .get('l')
              ?.split('.')
              .includes(token),
          searchToken,
          'Searches token',
        );
        assert.equal(
          await page.$eval(PANEL, (el) => el.classList.contains('collapsed')),
          false,
        );
        assert.equal(await page.$eval(ask, (el) => el.disabled), true);
        assert.deepEqual(
          await page.$$eval(
            PANEL + ' [aria-label="Search agent"] option',
            (opts) => opts.map((o) => o.value),
          ),
          ['claude'],
        );
      },
    );

    await step(
      'Ask shows both running stages and polls with the current revision',
      async () => {
        await page.type(question, QUESTION);
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
        assert.equal(
          await page.$eval(question, (el) => el.value),
          QUESTION + '\n',
        );
        assert.equal(writes().length, 0);
        await page.keyboard.press('Enter');
        await panelText(page, 'Searching the web…');
        await panelText(page, 'Claude is busy with another search.');
        await until(
          page,
          (sel) => document.querySelector(sel)?.innerText.includes('Cancel'),
          PANEL,
          'Cancel control',
        );
        await shot('01-running');
        fixture.stageMap();
        await panelText(page, 'Placing findings…');
        assert.ok(
          fixture.requests.some(({ params }) => params.rev),
          'Running state must poll by revision',
        );
        fixture.complete();
        await panelText(page, 'Initial port reporting.');
        await panelText(page, '1,200 input tokens');
      },
    );

    await step(
      'The globe draws four different marker shapes and keeps the fifth finding list-only',
      async () => {
        await cameraAt(page, 600_000);
        await pinIds(page, [ids.event, ids.statement, ids.place, ids.area]);
        assert.match(
          (await marker(ids.event)).image,
          /data-kind="event".*<circle[^>]+clip-path=/,
        );
        assert.match(
          (await marker(ids.statement)).image,
          /data-kind="statement".*<rect[^>]+rx="[^"]+"[^>]+clip-path=/,
        );
        assert.match((await marker(ids.statement)).image, /stroke-dasharray=/);
        assert.match(
          (await marker(ids.place)).image,
          /data-kind="place".*<path[^>]+clip-path=/,
        );
        assert.match(
          (await marker(ids.area)).image,
          /data-kind="area".*<circle[^>]+clip-path="[^"]+" fill="none" stroke="#/,
        );
        await panelText(page, 'Not on the globe');
        await pickEntity(page, (await marker(ids.statement)).key);
        await panelText(page, 'Placed where the speaker is based');
        assert.ok(
          await page.$(PANEL + ' .searches-selected'),
          'Clicking the pin selects its panel row',
        );
        const links = await page.$$eval(
          PANEL + ' a.searches-evidence',
          (nodes) => nodes.map((node) => [node.href, node.rel]),
        );
        assert.ok(links.length > 0);
        assert.ok(
          links.every(
            ([href, rel]) =>
              href === 'https://example.com/port' &&
              rel === 'noopener noreferrer',
          ),
        );
        await shot('02-markers');
      },
    );

    await step(
      'A second Ask merges duplicate pins, and its swatch removes and restores its color',
      async () => {
        await page.type(question, FOLLOW_UP);
        await click(page, ask);
        await panelText(page, 'Searching the web…');
        await clickText(page, 'Cancel');
        await panelText(page, 'Search cancelled');
        await click(page, control(SECOND, 'retry'));
        await panelText(page, 'Searching the web…');
        fixture.complete();
        await panelText(page, 'Independent coverage of the arrival.');
        await panelText(page, 'Also in ' + FIRST_LABEL);
        await cameraAt(page, 600_000);
        await pinIds(page, [ids.event, ids.statement, ids.place, ids.area]);
        assert.match(
          (await marker(ids.event)).image,
          /clip-path="url\(#part1\)"/,
        );
        await click(page, control(SECOND, 'visible'));
        await until(
          page,
          (sel) =>
            document.querySelector(sel)?.getAttribute('aria-pressed') ===
            'false',
          control(SECOND, 'visible'),
          'hidden follow-up',
        );
        assert.doesNotMatch(
          (await marker(ids.event)).image,
          /clip-path="url\(#part1\)"/,
        );
        await click(page, control(SECOND, 'visible'));
        await until(
          page,
          (sel) =>
            document.querySelector(sel)?.getAttribute('aria-pressed') ===
            'true',
          control(SECOND, 'visible'),
          'visible follow-up',
        );
        assert.match(
          (await marker(ids.event)).image,
          /clip-path="url\(#part1\)"/,
        );
        await shot('03-merged');
      },
    );

    await step(
      'Eight searches receive distinct colors and the ninth stays hidden',
      async () => {
        for (let i = 1; i <= 6; i++) {
          const selector = control('sr_f000000' + i, 'visible');
          await click(page, selector);
          await until(
            page,
            (sel) =>
              document.querySelector(sel)?.getAttribute('aria-pressed') ===
              'true',
            selector,
            'visible fixture ' + i,
          );
        }
        const colors = await page.$$eval(swatches, (els) =>
          els.map((el) => el.style.getPropertyValue('--search-color')),
        );
        assert.equal(colors.length, MAX_VISIBLE);
        assert.equal(new Set(colors).size, MAX_VISIBLE);
        await click(page, control('sr_f0000007', 'visible'));
        await panelText(page, 'all 8 colours are in use');
        assert.equal(
          await page.$$eval(swatches, (els) => els.length),
          MAX_VISIBLE,
        );
      },
    );

    await step(
      'Update replaces the snapshot, adds a fresh dot and retains earlier findings',
      async () => {
        await openMenu(FIRST);
        await click(page, control(FIRST, 'update'));
        await panelText(page, 'Searching the web…');
        fixture.stageMap();
        await panelText(page, 'Placing findings…');
        fixture.complete();
        await panelText(page, 'Updated port reporting.');
        await panelText(page, 'Earlier findings');
        await cameraAt(page, 600_000);
        await pinIds(page, [ids.event, ids.update]);
        assert.match((await marker(ids.update)).image, /data-fresh="1"/);
        assert.equal(
          await page.$eval(
            control(JSON.stringify([FIRST, ids.update]), 'title'),
            (el) => el.querySelector('.searches-new')?.textContent,
          ),
          'New',
        );
        await shot('04-updated');
      },
    );

    await step(
      'The historical day and exact run restore earlier markers; Back to now restores latest',
      async () => {
        const before = writes().length;
        await page.select(day, OLD_DAY);
        await panelText(page, 'Back to now');
        await panelText(page, 'Initial port reporting.');
        await pinIds(page, [ids.event, ids.statement, ids.place, ids.area]);
        assert.equal(await page.$$eval(searchRows, (els) => els.length), 1);
        assert.equal(await page.$eval(ask, (el) => el.disabled), true);
        assert.ok(
          fixture.requests.some(({ params }) => params.asOf === OLD_DAY),
        );
        await shot('05-history');
        await clickText(page, 'Back to now');
        await panelText(page, 'Updated port reporting.');
        const [firstRun] = fixture.runIds(FIRST);
        await page.select(control(FIRST, 'run'), firstRun);
        await panelText(page, 'Initial port reporting.');
        await pinIds(page, [ids.event, ids.statement, ids.place, ids.area]);
        assert.equal(await page.$$eval(searchRows, (els) => els.length), 1);
        assert.ok(
          fixture.requests.some(
            ({ route }) => route === FIRST + '/runs/' + firstRun,
          ),
        );
        await clickText(page, 'Back to now');
        await panelText(page, 'Updated port reporting.');
        await pinIds(page, [ids.event, ids.update]);
        assert.equal(writes().length, before, 'History is read-only');
      },
    );

    await step(
      'Changes shows added, seen again and missing findings',
      async () => {
        await openMenu(FIRST);
        await click(page, control(FIRST, 'changes'));
        await clickText(page, 'Compare runs');
        for (const text of [
          'Added · 1',
          'Seen again · 1',
          'Not seen since · 4',
        ])
          await panelText(page, text);
        const [from, to] = fixture.runIds(FIRST);
        assert.ok(
          fixture.requests.some(
            ({ route, params }) =>
              route === FIRST + '/changes' &&
              params.from === from &&
              params.to === to,
          ),
        );
        await shot('06-changes');
      },
    );

    await step(
      'Bubbles split their ring by search and a real globe pick applies a place chip',
      async () => {
        // The earlier Belgium finding remains in the panel, outside this place.
        const before = writes().length;
        await cameraAt(page, 4_500_000);
        await until(
          page,
          () =>
            window.__godsEyeView.viewer.dataSources
              .getByName('searches')[0]
              ?.entities.values.some(
                (entity) =>
                  entity.gevSearchHotspotKey === 'country:Netherlands',
              ),
          null,
          'Netherlands bubble',
        );
        const bubble = (await entities(page)).find(
          ({ hotspot }) => hotspot === HOTSPOT.key,
        );
        assert.match(bubble.image, />2<\/text>/);
        assert.match(bubble.image, /#a78bfa/);
        assert.match(bubble.image, /#2dd4bf/);
        await shot('07-bubbles');
        await pickEntity(page, bubble.key);
        await panelText(page, 'Place · Netherlands');
        await until(
          page,
          () =>
            window.__godsEyeView.viewer.camera.positionCartographic.height <
            3_000_000,
          null,
          'bubble focus flight',
        );
        assert.equal(
          await page.$(control(JSON.stringify([FIRST, ids.place]), 'title')),
          null,
          'Place filter excludes Belgium',
        );
        await click(
          page,
          PANEL + ' [aria-label="Clear place filter for Netherlands"]',
        );
        await click(page, control(FIRST, 'group:places'));
        await pinIds(page, [ids.duplicate]);
        await click(page, control(FIRST, 'group:null'));
        await pinIds(page, [ids.event, ids.update]);
        await page.type(filter, SECOND_LABEL);
        assert.equal(await page.$$eval(searchRows, (els) => els.length), 1);
        await page.$eval(filter, (el) => {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.equal(
          writes().length,
          before,
          'Camera and filters must not mutate Searches',
        );
      },
    );

    await step(
      'The panel fits Cyber and narrow widths and collapses in Cockpit',
      async () => {
        const setTheme = (theme) =>
          page.evaluate((value) => {
            const select = document.getElementById('hud-layout-select');
            select.value = value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }, theme);
        await setTheme('cyber');
        await until(
          page,
          () => document.documentElement.dataset.uiTheme === 'cyber',
          null,
          'Cyber theme',
        );
        await panelText(page, 'Updated port reporting.');
        for (const width of [720, 390]) {
          await page.setViewport({ width, height: 844 });
          await until(
            page,
            (wanted) => window.innerWidth === wanted,
            width,
            'narrow viewport',
          );
          const box = await page.$eval(PANEL, (el) => {
            const rect = el.getBoundingClientRect();
            const body = el.querySelector('#searches-panel-body');
            return {
              left: rect.left,
              right: rect.right,
              width: rect.width,
              overflow: body.scrollWidth - body.clientWidth,
            };
          });
          assert.ok(
            box.width > 0 &&
              box.left >= -1 &&
              box.right <= width + 1 &&
              box.overflow <= 1,
            JSON.stringify(box),
          );
          await shot('08-cyber-' + width);
        }
        await page.setViewport(VIEWPORT);
        await setTheme('tactical');
        // Exercise the same panel-chrome entry point that Cockpit uses. A tracked aircraft is unnecessary.
        await page.evaluate(() =>
          window.__godsEyeView.styleManager._panelChrome.enterCockpit(),
        );
        await until(
          page,
          (sel) => document.querySelector(sel)?.classList.contains('collapsed'),
          PANEL,
          'Cockpit collapse',
        );
        await shot('09-cockpit');
        await page.evaluate(() =>
          window.__godsEyeView.styleManager._panelChrome.exitCockpit(),
        );
        await until(
          page,
          (sel) =>
            !document.querySelector(sel)?.classList.contains('collapsed'),
          PANEL,
          'Cockpit restores the panel',
        );
      },
    );

    await step(
      'Confirmed finding and search deletes update the globe and history',
      async () => {
        await openFinding(FIRST, ids.update);
        await click(
          page,
          control(JSON.stringify([FIRST, ids.update]), 'delete'),
        );
        await panelText(page, 'Delete this finding from every run?');
        await clickText(
          page,
          'Delete',
          PANEL + ' .searches-finding .searches-confirm',
        );
        await cameraAt(page, 600_000);
        await pinIds(page, [ids.event]);
        const [, updatedRun] = fixture.runIds(FIRST);
        await page.select(control(FIRST, 'run'), updatedRun);
        await panelText(page, 'Back to now');
        await pinIds(page, [ids.event]);
        assert.equal(
          await page.$(control(JSON.stringify([FIRST, ids.update]), 'title')),
          null,
        );
        await clickText(page, 'Back to now');
        await openMenu(SECOND);
        await click(page, control(SECOND, 'delete'));
        await panelText(
          page,
          'Delete “' + SECOND_LABEL + '” and all its runs?',
        );
        await clickText(
          page,
          'Delete',
          PANEL + ' .searches-actions .searches-confirm',
        );
        await until(
          page,
          (sel) => !document.querySelector(sel),
          control(SECOND, 'title'),
          'deleted search',
        );
        assert.doesNotMatch(
          (await marker(ids.event)).image,
          /clip-path="url\(#part1\)"/,
        );
        assert.ok(
          writes().some(
            ({ method, route }) =>
              method === 'DELETE' &&
              route === FIRST + '/findings/' + ids.update,
          ),
        );
        assert.ok(
          writes().some(
            ({ method, route }) => method === 'DELETE' && route === SECOND,
          ),
        );
      },
    );

    assert.deepEqual(fixture.unexpected, []);
    assert.deepEqual(errors, []);
    console.log(
      `${count} Searches browser QA checks passed. Screenshots in ${ARTIFACT_DIR}.`,
    );
  } catch (error) {
    await shot('failure').catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

await main();
