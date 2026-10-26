import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import {
  normalizeRssArticles,
  parseFeedEntries,
} from '../../server/providers/common/rss.js';
import { fetchRegionalNews } from '../../server/providers/regional/news.js';
import { fetchRssSource } from '../../server/providers/news/fetchers/rss.js';
import {
  fetchTelegramSource,
  parseTelegramPreview,
} from '../../server/providers/news/fetchers/telegramPublic.js';
import {
  buildGdeltDomainQuery,
  createGdeltQueue,
  fetchGdeltDomainGroup,
  groupGdeltSources,
} from '../../server/providers/news/fetchers/gdeltDomain.js';
import {
  fetchReliefwebSource,
  reliefwebRequestBody,
} from '../../server/providers/news/fetchers/reliefweb.js';
import { detectLanguage } from '../../server/providers/news/fetchers/text.js';

const source = (id, transport, overrides = {}) => ({
  id,
  name: id.toUpperCase(),
  folder: 'reporting',
  kind: 'independent',
  perspective: 'international-wire',
  languages: ['en'],
  starred: false,
  transport,
  ...overrides,
});

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Fixture</title><language>en-gb</language>
<item><title><![CDATA[Strike reported near Bandar Abbas]]></title>
<link>https://example.org/a?utm=1</link>
<description><![CDATA[<p>Officials said the port&#8217;s fuel depot was hit &amp; burning.</p><script>alert(1)</script>]]></description>
<pubDate>Sun, 25 Oct 2026 14:02:00 GMT</pubDate></item>
<item><title>Escaped &amp;lt;b&amp;gt; markup</title>
<link>https://example.org/b</link>
<description>&lt;p&gt;Second &amp;amp; final&lt;/p&gt;</description></item>
<item><title>No link</title></item>
<item><title>Bad scheme</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="he">
<entry><title>עדכון</title><link rel="self" href="https://example.org/self"/>
<link rel="alternate" href="https://example.org/alt"/>
<summary type="html">&lt;b&gt;Summary&lt;/b&gt; text</summary>
<published>2026-10-25T10:00:00+02:00</published></entry>
</feed>`;

const respond = (body, init = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8' },
    ...init,
  });

test('shared RSS parser keeps the cockpit headline contract', () => {
  const xml = Array.from(
    { length: 7 },
    (_, i) =>
      `<item><title>Story ${i}</title><link>https://news.example/${i}</link><source url="https://pub.example">Pub</source><pubDate>Sun, 25 Oct 2026 10:00:00 GMT</pubDate></item>`,
  ).join('');
  const articles = normalizeRssArticles(
    `<rss>${xml}<item><title>Story 0</title><link>https://news.example/0b</link><source>Pub</source></item></rss>`,
  );
  assert.equal(articles.length, 5);
  assert.deepEqual(articles[0], {
    title: 'Story 0',
    url: 'https://news.example/0',
    domain: 'Pub',
    publishedAt: '2026-10-25T10:00:00.000Z',
    sourceCountry: null,
  });
});

test('the regional provider still serves Google News headlines', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.match(String(url), /^https:\/\/news\.google\.com\/rss\/search\?/);
    return respond(
      '<rss><item><title>Local story</title><link>https://local.example/x</link><source>Local</source></item></rss>',
    );
  });
  const result = await fetchRegionalNews({ locality: 'Haifa' });
  assert.equal(result.status, 'ready');
  assert.equal(result.source, 'Google News RSS');
  assert.equal(result.articles[0].title, 'Local story');
});

test('feed entries: RSS CDATA, escaped markup, entities, Atom links and language', () => {
  const rss = parseFeedEntries(RSS);
  assert.equal(rss.language, 'en');
  assert.equal(rss.entries.length, 2);
  assert.equal(rss.entries[0].title, 'Strike reported near Bandar Abbas');
  assert.equal(
    rss.entries[0].description,
    'Officials said the port’s fuel depot was hit & burning.',
  );
  assert.equal(rss.entries[0].publishedAt, '2026-10-25T14:02:00.000Z');
  assert.equal(rss.entries[1].title, 'Escaped <b> markup');
  assert.equal(rss.entries[1].description, 'Second & final');
  const atom = parseFeedEntries(ATOM);
  assert.equal(atom.language, 'he');
  assert.equal(atom.entries[0].url, 'https://example.org/alt');
  assert.equal(atom.entries[0].description, 'Summary text');
  assert.equal(atom.entries[0].publishedAt, '2026-10-25T08:00:00.000Z');
});

test('RSS fetcher returns candidates, inflates gzip bodies and never throws', async () => {
  const rss = source('wire', { type: 'rss', url: 'https://example.org/feed' });
  const calls = [];
  const ok = await fetchRssSource(rss, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return respond(gzipSync(Buffer.from(RSS)));
    },
  });
  assert.equal(calls[0].url, 'https://example.org/feed');
  assert.match(calls[0].init.headers['User-Agent'], /GodsEyeView/);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(ok.status.ok, true);
  assert.equal(ok.status.count, 2);
  assert.deepEqual(ok.items[0], {
    sourceId: 'wire',
    title: 'Strike reported near Bandar Abbas',
    titleOriginal: 'Strike reported near Bandar Abbas',
    snippet: 'Officials said the port’s fuel depot was hit & burning.',
    language: 'en',
    url: 'https://example.org/a?utm=1',
    publishedAt: '2026-10-25T14:02:00.000Z',
    primarySource: null,
    transport: 'rss',
  });

  const blocked = await fetchRssSource(rss, {
    fetchImpl: async () => new Response('denied', { status: 403 }),
  });
  assert.deepEqual(blocked.items, []);
  assert.equal(blocked.status.blocked, true);
  assert.equal(blocked.status.error, 'HTTP 403');

  const down = await fetchRssSource(rss, {
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED https://example.org/feed?key=1');
    },
  });
  assert.equal(down.status.ok, false);
  assert.doesNotMatch(down.status.error, /example\.org/);

  const html = await fetchRssSource(rss, {
    fetchImpl: async () => respond('<html><body>Not a feed</body></html>'),
  });
  assert.equal(html.status.error, 'not a feed');
});

test('official sources mark their items as primary statements', async () => {
  const centcom = source(
    'centcom',
    { type: 'rss', url: 'https://example.org/feed' },
    { folder: 'official', kind: 'state', name: 'US Central Command' },
  );
  const { items } = await fetchRssSource(centcom, {
    fetchImpl: async () => respond(RSS),
  });
  assert.deepEqual(items[0].primarySource, {
    kind: 'statement',
    issuer: 'US Central Command',
    url: 'https://example.org/a?utm=1',
  });
});

const TELEGRAM = `<html><body>
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="idfofficial/101" data-view="x">
<div class="tgme_widget_message_text js-message_text" dir="auto">Sirens sounded in the north.<br/>Interceptors launched &amp; tracking.</div>
<a class="tgme_widget_message_date" href="https://t.me/idfofficial/101"><time datetime="2026-10-25T14:02:00+00:00" class="time">14:02</time></a></div></div>
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="idfofficial/102">
<div class="tgme_widget_message_photo_wrap"></div>
<a class="tgme_widget_message_date" href="https://t.me/idfofficial/102"><time datetime="2026-10-25T14:05:00+00:00">14:05</time></a></div></div>
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="otherchannel/7">
<div class="tgme_widget_message_text js-message_text">Forwarded elsewhere</div></div></div>
</body></html>`;

test('Telegram previews parse into canonical message URLs and snippets', async () => {
  assert.deepEqual(parseTelegramPreview(TELEGRAM, 'idfofficial'), [
    {
      url: 'https://t.me/idfofficial/101',
      text: 'Sirens sounded in the north.\nInterceptors launched & tracking.',
      publishedAt: '2026-10-25T14:02:00.000Z',
    },
  ]);
  const idf = source(
    'idf',
    { type: 'telegram-public', channel: 'idfofficial' },
    { folder: 'official', kind: 'state' },
  );
  let requested;
  const result = await fetchTelegramSource(idf, {
    fetchImpl: async (url) => {
      requested = url;
      return respond(TELEGRAM, { headers: { 'content-type': 'text/html' } });
    },
  });
  assert.equal(requested, 'https://t.me/s/idfofficial');
  assert.equal(result.status.fragile, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Sirens sounded in the north.');
  assert.equal(
    result.items[0].snippet,
    'Sirens sounded in the north. Interceptors launched & tracking.',
  );
  const changed = await fetchTelegramSource(idf, {
    fetchImpl: async () => respond('<html>new layout</html>'),
  });
  assert.equal(changed.status.error, 'preview markup not found');
});

test('GDELT domain queries group ten domains and quote multiword terms', () => {
  assert.equal(
    buildGdeltDomainQuery(['a.com', 'b.org'], ['Iran', 'Red Sea']),
    '(domainis:a.com OR domainis:b.org) (Iran OR "Red Sea")',
  );
  assert.equal(
    buildGdeltDomainQuery(['a.com'], ['Iran']),
    'domainis:a.com Iran',
  );
  const sources = Array.from({ length: 23 }, (_, i) =>
    source(`s${i}`, { type: 'gdelt-domain', domain: `d${i}.com` }),
  );
  sources.push(source('feed', { type: 'rss', url: 'https://x.org/rss' }));
  assert.deepEqual(
    groupGdeltSources(sources).map((group) => group.length),
    [10, 10, 3],
  );
});

test('the GDELT queue spaces requests and backs off after 429', async () => {
  let clock = 0;
  const sleeps = [];
  const queue = createGdeltQueue({
    spacingMs: 5500,
    backoffMs: 60_000,
    maxBackoffMs: 100_000,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  const order = [];
  const task = (status) => async () => {
    order.push(clock);
    return { status };
  };
  await Promise.all([
    queue.run(task(200)),
    queue.run(task(429)),
    queue.run(task(429)),
    queue.run(task(200)),
    queue.run(task(200)),
  ]);
  assert.deepEqual(order, [0, 5500, 65_500, 165_500, 171_000]);
  assert.deepEqual(sleeps, [5500, 60_000, 100_000, 5500]);
  assert.equal(queue.state().pending, 0);
});

test('GDELT domain results are attributed to sources by hostname', async () => {
  const group = [
    source('alarabiya', { type: 'gdelt-domain', domain: 'alarabiya.net' }),
    source('tasnim', { type: 'gdelt-domain', domain: 'tasnimnews.com' }),
  ];
  const queue = createGdeltQueue({ sleep: async () => {} });
  let requested;
  const result = await fetchGdeltDomainGroup(group, {
    terms: ['Iran'],
    queue,
    fetchImpl: async (url) => {
      requested = new URL(url);
      return Response.json({
        articles: [
          {
            url: 'https://english.alarabiya.net/news/1',
            title: 'Gulf states meet',
            seendate: '20261025T140200Z',
            language: 'English',
          },
          {
            url: 'https://www.tasnimnews.com/fa/news/2',
            title: 'خبر فوری درباره تنگه هرمز',
            seendate: '20261025T130000Z',
            language: 'Persian',
          },
          {
            url: 'https://elsewhere.example/3',
            title: 'Unrelated',
            seendate: '20261025T130000Z',
          },
        ],
      });
    },
  });
  assert.equal(
    requested.searchParams.get('query'),
    '(domainis:alarabiya.net OR domainis:tasnimnews.com) Iran',
  );
  assert.equal(requested.searchParams.get('mode'), 'artlist');
  assert.equal(requested.searchParams.get('timespan'), '24h');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].sourceId, 'alarabiya');
  assert.equal(result.items[0].publishedAt, '2026-10-25T14:02:00Z');
  assert.equal(result.items[1].language, 'fa');
  assert.deepEqual(
    result.statuses.map((s) => [s.sourceId, s.ok, s.count]),
    [
      ['alarabiya', true, 1],
      ['tasnim', true, 1],
    ],
  );
  const throttled = await fetchGdeltDomainGroup(group, {
    queue,
    fetchImpl: async () => new Response('slow down', { status: 429 }),
  });
  assert.equal(throttled.statuses[0].rateLimited, true);
  const text = await fetchGdeltDomainGroup(group, {
    queue,
    fetchImpl: async () =>
      new Response('Your search contained an invalid term'),
  });
  assert.match(text.statuses[0].error, /^GDELT: Your search/);
});

test('ReliefWeb stays disabled without an appname and parses v2 reports', async () => {
  const reliefweb = source(
    'reliefweb',
    { type: 'reliefweb', countries: ['PSE', 'LBN'] },
    { folder: 'humanitarian', kind: 'humanitarian' },
  );
  let called = false;
  const off = await fetchReliefwebSource(reliefweb, {
    fetchImpl: async () => {
      called = true;
    },
  });
  assert.equal(called, false);
  assert.equal(off.status.disabled, true);
  assert.deepEqual(off.items, []);

  const body = reliefwebRequestBody(['PSE'], '2026-10-23T00:00:00.000Z');
  assert.deepEqual(body.filter.conditions[0], {
    field: 'country.iso3',
    value: ['PSE'],
    operator: 'OR',
  });
  let request;
  const result = await fetchReliefwebSource(reliefweb, {
    appname: 'gev-fixture',
    now: () => Date.parse('2026-10-26T00:00:00Z'),
    fetchImpl: async (url, init) => {
      request = { url, init };
      return Response.json({
        data: [
          {
            id: 1,
            fields: {
              title: 'Gaza: Humanitarian Situation Update #300',
              url_alias:
                'https://reliefweb.int/report/occupied-palestinian-territory/x',
              date: { created: '2026-10-25T09:00:00+00:00' },
              source: [
                {
                  name: 'UN Office for the Coordination of Humanitarian Affairs',
                  shortname: 'OCHA',
                },
              ],
              language: [{ code: 'en' }],
              body: '## Highlights\n* [Water](https://x) supply fell **sharply**.',
            },
          },
          { id: 2, fields: { title: 'No url' } },
        ],
      });
    },
  });
  assert.equal(
    request.url,
    'https://api.reliefweb.int/v2/reports?appname=gev-fixture',
  );
  assert.equal(request.init.method, 'POST');
  const sent = JSON.parse(request.init.body);
  assert.deepEqual(sent.filter.conditions[0].value, ['PSE', 'LBN']);
  assert.equal(
    sent.filter.conditions[1].value.from,
    '2026-10-23T00:00:00.000Z',
  );
  assert.equal(result.items.length, 1);
  assert.equal(
    result.items[0].snippet,
    'Highlights Water supply fell sharply .',
  );
  assert.deepEqual(result.items[0].primarySource, {
    kind: 'report',
    issuer: 'OCHA',
    url: 'https://reliefweb.int/report/occupied-palestinian-territory/x',
  });
});

test('language follows the dominant script, else the source language', () => {
  assert.equal(detectLanguage('صواريخ على حيفا', 'en'), 'ar');
  assert.equal(detectLanguage('حمله به پایگاه', 'en'), 'fa');
  assert.equal(detectLanguage('אזעקות בצפון', 'en'), 'he');
  assert.equal(detectLanguage('Breaking: strike', 'ar'), 'en');
  assert.equal(detectLanguage('Frappe signalée', 'fr'), 'fr');
  assert.equal(detectLanguage('', 'fr'), 'fr');
});
