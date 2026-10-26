#!/usr/bin/env node
/**
 * Browser QA for the war monitor: the news layer and the Situation panel,
 * against a running app server. `npm run qa:news -- --fixtures` (or
 * `node scripts/qa-news.mjs --fixtures --url http://127.0.0.1:5173`).
 *
 * `--fixtures` answers /api/news and /api/news/digest in the page from
 * fixture snapshots and a stubbed digest, so nothing reaches a feed or
 * Perplexity. Without it the run uses the server's real provider and only
 * reads (it never presses Refresh, which would spend money).
 *
 * Screenshots land in qa-artifacts/news/.
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  LAYER_STATE_REGISTRY,
  encodeLayerStateParams,
  normalizeLayerState,
} from '../src/data/layerState.js';

export const ARTIFACT_DIR = 'qa-artifacts/news';
const VIEWPORT = { width: 1440, height: 900 };
const NEWS_TOKEN = LAYER_STATE_REGISTRY.find(
  (entry) => entry.id === 'news',
).token;

const CATEGORIES = [
  { id: 'war-military', label: 'War & military', color: '#ef4444' },
  {
    id: 'political-diplomatic',
    label: 'Political & diplomatic',
    color: '#60a5fa',
  },
  {
    id: 'humanitarian-casualties',
    label: 'Humanitarian & casualties',
    color: '#f59e0b',
  },
  { id: 'environmental', label: 'Environmental', color: '#22c55e' },
  {
    id: 'infrastructure-shipping',
    label: 'Infrastructure & shipping',
    color: '#a78bfa',
  },
  { id: 'cyber-information', label: 'Cyber & information', color: '#22d3ee' },
];

const iso = (minutesAgo) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

function item(id, sourceId, folder, kind, perspective, title, extra = {}) {
  return {
    id,
    theater: 'iran-israel-us',
    sourceId,
    folder,
    kind,
    perspective,
    title,
    titleOriginal: extra.titleOriginal || title,
    snippet: '',
    language: extra.language || 'en',
    url: `https://example.org/${id}`,
    canonicalUrl: `https://example.org/${id}`,
    publishedAt: iso(extra.age ?? 90),
    collectedAt: iso((extra.age ?? 90) - 5),
    primarySource: null,
    transport: 'rss',
    digestedAt: extra.digested ? iso(30) : null,
    storyId: extra.storyId ?? null,
  };
}

function story(id, title, category, location, itemIds, extra = {}) {
  return {
    id,
    theater: 'iran-israel-us',
    title,
    summary: extra.summary || `${title}. Sources differ on details.`,
    category,
    place: location ? { name: location.name } : null,
    location,
    eventAt: iso(300),
    itemIds,
    claims: [
      {
        text: 'A strike was reported',
        actor: null,
        type: 'occurrence',
        itemIds,
        status: extra.verification || 'reported',
      },
    ],
    whatsNew: extra.whatsNew || '',
    contradictions: extra.contradictions || [],
    status: 'open',
    firstSeenAt: iso(200),
    updatedAt: iso(extra.updated ?? 30),
    digestRunId: 'run_fixture',
    perspectives: extra.perspectives || ['international-wire'],
    verification: extra.verification || 'reported',
    sourceCount: extra.sourceCount ?? itemIds.length,
  };
}

const at = (name, lat, lon, method = 'gazetteer') => ({
  lat,
  lon,
  precision: method === 'model' ? 'approximate' : 'city',
  method,
  name,
});

export function fixtureSnapshot({ digested = false } = {}) {
  const items = [
    item(
      'i-centcom',
      'centcom',
      'official',
      'state',
      'us-mil',
      'CENTCOM strikes drone storage near Bandar Abbas',
      { digested: true, storyId: 'st_bandar' },
    ),
    item(
      'i-irna',
      'irna',
      'official',
      'state',
      'iran-state',
      'Explosion at Bandar Abbas port warehouse',
      { digested: true, storyId: 'st_bandar' },
    ),
    item(
      'i-aje',
      'aljazeera',
      'reporting',
      'independent',
      'international-regional',
      'Blast reported at Iranian port of Bandar Abbas',
      { digested: true, storyId: 'st_bandar' },
    ),
    item(
      'i-ocha',
      'reliefweb',
      'humanitarian',
      'humanitarian',
      'un',
      'Gaza: aid convoy halted near Khan Younis',
      { digested: true, storyId: 'st_convoy' },
    ),
    item(
      'i-idf',
      'idf',
      'official',
      'state',
      'israel-mil',
      'Interceptors launched over northern Israel',
      { digested: true, storyId: 'st_north' },
    ),
    item(
      'i-manar',
      'almanar',
      'armed-group',
      'participant',
      'hezbollah',
      'المقاومة تستهدف موقعاً في الجليل',
      { digested: true, storyId: 'st_north', language: 'ar' },
    ),
    item(
      'i-crisis',
      'crisisgroup',
      'analysis',
      'analysis',
      'analysis-crisis',
      'What the latest escalation means for Gulf shipping',
      { digested: true },
    ),
    item(
      'i-new1',
      'reuters',
      'reporting',
      'independent',
      'international-wire',
      'Talks resume in Muscat as envoys meet',
      { age: 10 },
    ),
    item(
      'i-new2',
      'iranwire',
      'local',
      'independent',
      'iran-diaspora',
      'Residents describe blackout in Tehran district',
      { age: 12 },
    ),
  ];
  const stories = [
    story(
      'st_bandar',
      'Strike reported at Bandar Abbas port',
      'war-military',
      at('Bandar Abbas', 27.1832, 56.2666),
      ['i-centcom', 'i-irna', 'i-aje'],
      {
        verification: 'corroborated',
        perspectives: ['international-regional', 'iran-state', 'us-mil'],
        contradictions: [
          'IRNA says a civilian warehouse; CENTCOM says a drone storage site.',
        ],
        whatsNew: 'Al Jazeera reports the blast independently.',
      },
    ),
    story(
      'st_convoy',
      'Aid convoy reported halted near Khan Younis',
      'humanitarian-casualties',
      at('Khan Younis', 31.3462, 34.306),
      ['i-ocha'],
      {
        perspectives: ['un'],
      },
    ),
    story(
      'st_north',
      'Interceptions reported over the Galilee',
      'war-military',
      at('Galilee ridge', 32.95, 35.4, 'model'),
      ['i-idf', 'i-manar'],
      {
        verification: 'participant-claim',
        perspectives: ['hezbollah', 'israel-mil'],
      },
    ),
    story(
      'st_cyber',
      'Outage claims circulate about a Gulf port authority',
      'cyber-information',
      null,
      ['i-crisis'],
      {
        perspectives: ['analysis-crisis'],
      },
    ),
  ];
  if (digested) {
    items[7].digestedAt = iso(1);
    items[7].storyId = 'st_talks';
    items[8].digestedAt = iso(1);
    stories.unshift(
      story(
        'st_talks',
        'Envoys meet in Muscat as talks resume',
        'political-diplomatic',
        at('Muscat', 23.588, 58.3829),
        ['i-new1'],
        { updated: 1 },
      ),
    );
  }
  return {
    revision: digested ? 'fixture-2' : 'fixture-1',
    retrievedAt: new Date().toISOString(),
    theater: {
      id: 'iran-israel-us',
      name: 'Iran · Israel · US',
      categories: CATEGORIES,
      perspectives: [],
    },
    theaters: [{ id: 'iran-israel-us', name: 'Iran · Israel · US' }],
    items,
    citations: [],
    stories,
    lastRun: {
      id: digested ? 'run_2' : 'run_1',
      status: 'ok',
      startedAt: iso(digested ? 1 : 30),
      finishedAt: iso(digested ? 1 : 30),
      itemCount: 7,
      costUsd: 0.18,
    },
    lastDigest: {
      id: digested ? 'run_2' : 'run_1',
      status: 'ok',
      startedAt: iso(digested ? 1 : 30),
      finishedAt: iso(digested ? 1 : 30),
      itemCount: 7,
      costUsd: 0.18,
    },
    sources: [
      {
        id: 'centcom',
        name: 'US Central Command',
        folder: 'official',
        kind: 'state',
        perspective: 'us-mil',
        health: { ok: true },
      },
      {
        id: 'middleeasteye',
        name: 'Middle East Eye',
        folder: 'reporting',
        kind: 'independent',
        perspective: 'international-regional',
        health: { ok: false, blocked: true, degraded: true, error: 'HTTP 403' },
      },
      {
        id: 'almasirah',
        name: 'Al Masirah (Telegram)',
        folder: 'armed-group',
        kind: 'participant',
        perspective: 'houthi',
        health: {
          ok: false,
          fragile: true,
          degraded: true,
          error: 'preview markup not found',
        },
      },
    ],
    budget: {
      dailyUsd: 2,
      spentTodayUsd: digested ? 0.36 : 0.18,
      remainingUsd: digested ? 1.64 : 1.82,
      exhausted: false,
      lastRunCostUsd: 0.18,
    },
    digest: {
      provider: 'Perplexity Agent API',
      model: 'anthropic/claude-sonnet-5-5',
      keyConfigured: true,
      running: false,
      startedAt: null,
      disabledReason: digested ? 'nothing_new' : null,
      undigestedCount: digested ? 0 : 2,
    },
  };
}

/** Answer the news routes in the page; count digest posts. */
async function serveFixtures(page, state) {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/news')) {
      void request.continue();
      return;
    }
    const json = (status, body) =>
      request.respond({
        status,
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        body: JSON.stringify(body),
      });
    if (url.pathname === '/api/news/digest' && request.method() === 'POST') {
      state.digestPosts++;
      // A digest takes a moment; the panel shows the running state meanwhile.
      setTimeout(() => {
        state.digested = true;
        void json(200, {
          ok: true,
          run: {
            id: 'run_2',
            status: 'ok',
            storiesCreated: 1,
            storiesUpdated: 0,
            itemCount: 2,
            unassignedCount: 1,
            costUsd: 0.18,
          },
          budget: fixtureSnapshot({ digested: true }).budget,
        });
      }, 1500);
      return;
    }
    if (url.pathname === '/api/news' || url.pathname === '/api/news/') {
      void json(200, fixtureSnapshot({ digested: state.digested }));
      return;
    }
    void json(404, { error: 'not_found' });
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for the app, then dismiss the first-run launcher. */
async function clearFirstRun(page) {
  await page.waitForFunction(() => Boolean(window.__godsEyeView?.dataManager), {
    timeout: 150_000,
  });
  await page.evaluate(() =>
    document.querySelector('.first-run-explore')?.click(),
  );
  await wait(500);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(
      '#first-run-launcher, [class*=first-run]',
    ))
      el.remove();
  });
}

async function waitFor(page, fn, arg, label, timeout = 30_000) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 200 }, arg);
  } catch (error) {
    throw new Error(`timed out waiting for ${label}: ${error.message}`);
  }
}

function newsState(page) {
  return page.evaluate(() => {
    const layer =
      window.__godsEyeView?.dataManager?.layers?.get('news')?.module;
    const panel = document.getElementById('situation-panel');
    return {
      pins: layer?._testing?.pinIds() ?? [],
      stats: layer?.getStats() ?? null,
      params: layer?.getParams() ?? null,
      panelHidden: panel?.hidden ?? true,
      panelCollapsed: panel?.classList.contains('collapsed') ?? null,
      rows: [
        ...document.querySelectorAll('#situation-panel .situation-story'),
      ].map((row) => row.dataset.storyId),
      refresh:
        document.querySelector('#situation-panel .situation-refresh')
          ?.textContent ?? null,
      refreshDisabled:
        document.querySelector('#situation-panel .situation-refresh')
          ?.disabled ?? null,
      digestLine:
        document.querySelector('#situation-panel .situation-digest-line')
          ?.textContent ?? null,
      notice:
        document.querySelector('#situation-panel .situation-notice')
          ?.textContent ?? '',
      count:
        document.getElementById('situation-panel-count')?.textContent ?? '',
      degraded:
        document.querySelector('#situation-panel .situation-degraded summary')
          ?.textContent ?? '',
      theme: document.documentElement.dataset.uiTheme || 'default',
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const urlIndex = args.indexOf('--url');
  const base = urlIndex >= 0 ? args[urlIndex + 1] : 'http://127.0.0.1:5173';
  const fixtures = args.includes('--fixtures');
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      (await puppeteer.executablePath()),
    defaultViewport: VIEWPORT,
    protocolTimeout: 300_000,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const errors = [];
  let count = 0;
  const step = async (label, fn) => {
    await fn();
    count++;
    console.log(`ok ${count} ${label}`);
  };
  const shot = (page, name) =>
    page.screenshot({ path: path.join(ARTIFACT_DIR, `${name}.png`) });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && /news|situation/i.test(text))
        errors.push(`console: ${text}`);
    });
    const state = { digested: false, digestPosts: 0 };
    if (fixtures) await serveFixtures(page, state);
    const params = new URLSearchParams([['v', '2']]);
    encodeLayerStateParams(
      params,
      normalizeLayerState({ enabledLayerIds: ['news'] }),
    );
    assert.equal(params.get('l'), NEWS_TOKEN);
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await clearFirstRun(page);

    await step(
      'enabling the news layer shows the Situation panel, expanded',
      async () => {
        await page.evaluate(() =>
          window.__godsEyeView.dataManager.setEnabled('news', true, {
            origin: 'user',
          }),
        );
        // The share link records the layer under its ledger token.
        await waitFor(
          page,
          (token) =>
            (new URLSearchParams(location.hash.slice(1)).get('l') || '')
              .split('.')
              .includes(token),
          NEWS_TOKEN,
          'the news token in the share link',
        );
        await waitFor(
          page,
          () => {
            const panel = document.getElementById('situation-panel');
            return (
              panel &&
              !panel.hidden &&
              document.querySelectorAll('#situation-panel .situation-story')
                .length > 0
            );
          },
          null,
          'the Situation panel with stories',
          120_000,
        );
        const s = await newsState(page);
        assert.equal(s.panelHidden, false);
        assert.equal(
          s.panelCollapsed,
          false,
          'first appearance expands the panel',
        );
        if (fixtures) {
          assert.deepEqual(s.rows, [
            'st_bandar',
            'st_convoy',
            'st_north',
            'st_cyber',
          ]);
          assert.equal(s.count, '4');
        }
      },
    );

    await step(
      'one pin per located story; the list-only story is counted, not drawn',
      async () => {
        const s = await newsState(page);
        if (fixtures) {
          assert.deepEqual([...s.pins].sort(), [
            'st_bandar',
            'st_convoy',
            'st_north',
          ]);
          assert.equal(s.stats.listOnly, 1);
          const note = await page.$eval(
            '#situation-panel .situation-note',
            (n) => n.textContent,
          );
          assert.match(note, /1 story has no location/);
        }
        assert.ok(s.digestLine && s.digestLine.length > 10, s.digestLine);
      },
    );

    await step(
      'the digest line, Refresh control and degraded-source indicator render',
      async () => {
        const s = await newsState(page);
        if (fixtures) {
          assert.match(
            s.digestLine,
            /^Digest \d\d:\d\d · 4 stories from 7 items · 1 unassigned · last run 18¢ · budget \$1\.82 left$/,
          );
          assert.equal(s.refresh, 'Refresh');
          assert.equal(s.refreshDisabled, false);
          assert.equal(s.degraded, '2 sources degraded');
        }
        await shot(page, '01-default-stories');
      },
    );

    await step(
      'expanding a story shows its claims and cited items with original links',
      async () => {
        await page.click(
          '#situation-panel .situation-story[data-story-id="st_bandar"] .situation-story-head',
        );
        await waitFor(
          page,
          () => !document.getElementById('situation-story-st_bandar')?.hidden,
          null,
          'the expanded story body',
        );
        const cited = await page.$$eval(
          '#situation-story-st_bandar .situation-item',
          (rows) => rows.map((row) => row.dataset.itemId),
        );
        if (fixtures) assert.deepEqual(cited, ['i-centcom', 'i-irna', 'i-aje']);
        const links = await page.$$eval(
          '#situation-story-st_bandar a.situation-open-original',
          (anchors) => anchors.map((a) => [a.target, a.rel]),
        );
        assert.ok(
          links.every(
            ([target, rel]) =>
              target === '_blank' && rel === 'noopener noreferrer',
          ),
        );
        const s = await newsState(page);
        assert.equal(
          await page.evaluate(
            () =>
              window.__godsEyeView.dataManager.layers
                .get('news')
                .module.getSnapshot().selectedStoryId,
          ),
          'st_bandar',
        );
        assert.ok(s.pins.includes('st_bandar'));
        await shot(page, '02-story-expanded');
      },
    );

    if (fixtures) {
      await step(
        'Refresh runs one digest, shows the running state, then the outcome',
        async () => {
          await page.click('#situation-panel .situation-refresh');
          await waitFor(
            page,
            () =>
              /^Digesting… \d:\d\d$/.test(
                document.querySelector('#situation-panel .situation-refresh')
                  ?.textContent || '',
              ),
            null,
            'the running Refresh label',
          );
          await shot(page, '03-refresh-running');
          await waitFor(
            page,
            () =>
              /Digest done/.test(
                document.querySelector('#situation-panel .situation-notice')
                  ?.textContent || '',
              ),
            null,
            'the digest outcome',
          );
          const s = await newsState(page);
          assert.equal(state.digestPosts, 1);
          assert.equal(s.rows[0], 'st_talks');
          assert.equal(s.refreshDisabled, true, 'nothing new disables Refresh');
          const reason = await page.$eval(
            '#situation-refresh-reason',
            (n) => n.textContent,
          );
          assert.equal(reason, 'Nothing new since the last digest');
          assert.match(
            s.notice,
            /^Digest done: 1 new and 0 updated story from 2 items, 1 left unassigned\. Cost 18¢\./,
          );
          assert.ok(s.pins.includes('st_talks'));
          await shot(page, '04-after-refresh');
        },
      );
    }

    await step(
      'category chips filter pins and stories together and persist as a layer param',
      async () => {
        const before = await newsState(page);
        await page.click('#situation-panel .situation-chip:first-child');
        await wait(400);
        const after = await newsState(page);
        if (fixtures) {
          assert.equal(after.params.hiddenCategories, 'war-military');
          assert.ok(
            !after.pins.includes('st_bandar') &&
              !after.pins.includes('st_north'),
          );
          assert.ok(!after.rows.includes('st_bandar'));
        }
        assert.ok(after.rows.length <= before.rows.length);
        await shot(page, '05-category-filtered');
        await page.click('#situation-panel .situation-chip:first-child');
        await wait(300);
        assert.equal((await newsState(page)).params.hiddenCategories, '');
      },
    );

    await step(
      'the Raw feed tab groups items by folder with markers',
      async () => {
        await page.click('#situation-tab-raw');
        await waitFor(
          page,
          () => !document.getElementById('situation-tabpanel-raw')?.hidden,
          null,
          'the raw tab',
        );
        const folders = await page.$$eval(
          '#situation-panel .situation-folder',
          (buttons) =>
            buttons.map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
        );
        assert.equal(folders.length, 7);
        if (fixtures) {
          assert.deepEqual(folders[0], ['Reporting 2', 'true']);
          await page.click('#situation-panel .situation-folder:nth-child(2)');
          await wait(300);
          const official = await page.$$eval(
            '#situation-tabpanel-raw .situation-item',
            (rows) => rows.map((r) => r.dataset.itemId),
          );
          assert.deepEqual(official, ['i-centcom', 'i-irna', 'i-idf']);
          await page.click('#situation-panel .situation-folder:nth-child(3)');
          await wait(300);
          const marker = await page.$eval(
            '#situation-tabpanel-raw .situation-marker',
            (n) => n.textContent,
          );
          assert.equal(marker, 'unassigned after digest');
        }
        await shot(page, '06-raw-feed');
        await page.click('#situation-tab-stories');
      },
    );

    await step('the Cyber theme keeps the panel usable', async () => {
      await page.evaluate(() => {
        const select = document.getElementById('hud-layout-select');
        select.value = 'cyber';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await waitFor(
        page,
        () => document.documentElement.dataset.uiTheme === 'cyber',
        null,
        'the Cyber theme',
      );
      await wait(800);
      const s = await newsState(page);
      assert.equal(s.theme, 'cyber');
      assert.equal(s.panelHidden, false);
      const box = await page.$eval('#situation-panel', (n) => {
        const r = n.getBoundingClientRect();
        return { width: r.width, height: r.height };
      });
      assert.ok(box.width > 200 && box.height > 40, JSON.stringify(box));
      await shot(page, '07-cyber');
      await page.evaluate(() => {
        const select = document.getElementById('hud-layout-select');
        select.value = 'tactical';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await wait(500);
    });

    await step(
      'clean view and recording hide the panel and keep the pins',
      async () => {
        for (const mode of ['ui-clean-view', 'recording-mode']) {
          await page.evaluate(
            (name) => document.body.classList.add(name),
            mode,
          );
          await wait(600);
          const view = await page.$eval('#situation-panel', (node) => {
            const style = getComputedStyle(node);
            return {
              visibility: style.visibility,
              opacity: style.opacity,
              pointerEvents: style.pointerEvents,
            };
          });
          assert.equal(view.visibility, 'hidden', `${mode}: panel visibility`);
          assert.equal(view.pointerEvents, 'none', `${mode}: panel input`);
          assert.ok((await newsState(page)).pins.length > 0, `${mode}: pins`);
          await shot(page, `08-${mode}`);
          await page.evaluate(
            (name) => document.body.classList.remove(name),
            mode,
          );
        }
        await wait(400);
        const restored = await page.$eval(
          '#situation-panel',
          (node) => getComputedStyle(node).visibility,
        );
        assert.equal(restored, 'visible');
      },
    );

    await step(
      'entering Cockpit collapses the panel with the other map panels',
      async () => {
        const entered = await page.evaluate(
          () => window.__godsEyeView.styleManager.cockpitView.enter() === true,
        );
        if (!entered) {
          // Cockpit needs a tracked aircraft; without a live flight feed, drive
          // the panel-chrome hook Cockpit calls on entry and exit.
          console.log(
            '  (no trackable aircraft: using the Cockpit panel hook)',
          );
          await page.evaluate(() =>
            window.__godsEyeView.styleManager._panelChrome.enterCockpit(),
          );
        }
        await wait(1200);
        assert.equal((await newsState(page)).panelCollapsed, true);
        await shot(page, '09-cockpit');
        if (entered)
          await page.evaluate(() =>
            window.__godsEyeView.styleManager.cockpitView.exit(),
          );
        else
          await page.evaluate(() =>
            window.__godsEyeView.styleManager._panelChrome.exitCockpit(),
          );
        await wait(800);
        assert.equal(
          (await newsState(page)).panelCollapsed,
          false,
          'exit restores the panel',
        );
      },
    );

    assert.deepEqual(errors, []);
    console.log(
      `news QA passed (${count} steps); screenshots in ${ARTIFACT_DIR}`,
    );
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
