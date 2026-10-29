import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  GDELT_MAX_QUERY_CHARS,
  buildGdeltDomainQuery,
  createGdeltQueue,
  fetchGdeltDomainGroup,
  groupGdeltSources,
} from '../../server/providers/news/fetchers/gdeltDomain.js';
import {
  fetchReliefwebSource,
  reliefwebRequestBody,
} from '../../server/providers/news/fetchers/reliefweb.js';
import {
  detectLanguage,
  linkedStatement,
  statementHosts,
} from '../../server/providers/news/fetchers/text.js';
import { withTestGdeltSources } from '../testSupport/newsRoot.mjs';

const readJson = (relative) =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const registry = readJson('../../public/news/sources.json');
const theaterFile = readJson('../../public/news/theaters/iran-israel-us.json');
const worldTheaterFile = readJson('../../public/news/theaters/world.json');

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

test('feed entries read Drupal dates with a dash and no zone as UTC', () => {
  const feed = (date) =>
    parseFeedEntries(
      `<rss><channel><item><title>T</title><link>https://x.example/1</link><pubDate>${date}</pubDate></item></channel></rss>`,
    ).entries[0].publishedAt;
  assert.equal(
    feed('Friday, October 23, 2026 - 18:13'),
    '2026-10-23T18:13:00.000Z',
  );
  assert.equal(feed('October 23, 2026 - 9:05'), '2026-10-23T09:05:00.000Z');
  assert.equal(feed('not a date - 18:13'), null);
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

test('an entry linking to an official website records that statement', async () => {
  const hosts = statementHosts(registry.sources);
  assert.equal(hosts.get('centcom.mil'), 'US Central Command');
  assert.equal(hosts.has('t.me'), false, 'shared platforms name no issuer');
  const wire = source('wire', { type: 'rss', url: 'https://example.org/feed' });
  const feed = `<rss><channel>
<item><title>Strike near port</title><link>https://wire.example/1</link>
<description><![CDATA[<p>Via <a href="https://t.me/idfofficial/9">a channel</a> and
<a href="https://www.centcom.mil/MEDIA/PRESS-RELEASES/Article/42/">CENTCOM</a>.</p>]]></description></item>
<item><title>Unrelated</title><link>https://wire.example/2</link>
<description><![CDATA[<a href="https://t.me/idfofficial/10">post</a>]]></description></item>
</channel></rss>`;
  const { items } = await fetchRssSource(wire, {
    fetchImpl: async () => respond(feed),
    statementHosts: hosts,
  });
  assert.deepEqual(items[0].primarySource, {
    kind: 'statement',
    issuer: 'US Central Command',
    url: 'https://www.centcom.mil/MEDIA/PRESS-RELEASES/Article/42/',
  });
  assert.equal(items[1].primarySource, null);
  assert.equal(
    linkedStatement(['https://news.centcom.mil/x'], hosts)?.issuer,
    'US Central Command',
    'subdomains count',
  );
  assert.equal(linkedStatement(['https://notcentcom.mil/x'], hosts), null);
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

// Two posts from t.me/s/idfofficial on 2026-10-28 (a photo-only post, then a
// text post), trimmed of the avatar, bubble tail and image URLs.
const TELEGRAM_2026_10 = `<section class="tgme_channel_history js-message_history">
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="idfofficial/19427" data-view="eyJjIjotMTM0MTAyODUxMSwicCI6MTk0MjcsInQiOjE3OTMyMjEyMzgsImgiOiI3ZGEwMzliOGI4ZWEyYTYzOWIifQ">
  <div class="tgme_widget_message_bubble">
    <div class="tgme_widget_message_author accent_color"><a class="tgme_widget_message_owner_name" href="https://t.me/idfofficial"><span dir="auto">Israel Defense Forces</span></a></div>
<a class="tgme_widget_message_photo_wrap 5985528460673224383 1393614444_460000959" href="https://t.me/idfofficial/19427" style="width:800px;background-image:url('https://cdn4.telesco.pe/file/x.jpg')">
  <div class="tgme_widget_message_photo" style="padding-top:56.25%"></div>
</a>
<div class="tgme_widget_message_footer compact js-message_footer">
  <div class="tgme_widget_message_info short js-message_info">
    <span class="tgme_widget_message_views">6.22K</span><span class="copyonly"> views</span><span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/idfofficial/19427"><time datetime="2026-10-28T07:03:25+00:00" class="time">07:03</time></a></span>
  </div>
</div>
  </div>
</div></div>
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="idfofficial/19432" data-view="eyJjIjotMTM0MTAyODUxMSwicCI6MTk0MzIsInQiOjE3OTMyMjEyMzgsImgiOiJkODFhNGZlNmMzNmRmZjU4NDgifQ">
  <div class="tgme_widget_message_bubble">
    <div class="tgme_widget_message_author accent_color"><a class="tgme_widget_message_owner_name" href="https://t.me/idfofficial"><span dir="auto">Israel Defense Forces</span></a></div>
<div class="tgme_widget_message_text js-message_text" dir="auto">IDF: A short while ago, an interceptor was launched toward a suspicious aerial target identified in the area in which IDF soldiers are operating in southern Lebanon.<br/><br/>No sirens were sounded in accordance with protocol.</div>
<div class="tgme_widget_message_footer compact js-message_footer">
  <div class="tgme_widget_message_info short js-message_info">
    <span class="tgme_widget_message_views">977</span><span class="copyonly"> views</span><span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/idfofficial/19432"><time datetime="2026-10-28T20:38:40+00:00" class="time">20:38</time></a></span>
  </div>
</div>
  </div>
</div></div>
</section>`;

// What t.me/s/almasirahnet redirected to on 2026-10-28: the username's
// contact page, which has no posts (trimmed).
const TELEGRAM_CONTACT_PAGE = `<html><head><meta property="og:title" content="Telegram: Contact @almasirahnet"></head>
<body><div class="tgme_page_wrap"><div class="tgme_page"><div class="tgme_page_description">If you have <strong>Telegram</strong>, you can contact <a class="tgme_username_link" href="tg://resolve?domain=almasirahnet">@almasirahnet</a> right away.</div>
<div class="tgme_page_action"><a class="tgme_action_button_new" href="tg://resolve?domain=almasirahnet">Send Message</a></div></div></div></body></html>`;

test('Telegram previews parse with the October 2026 markup', async () => {
  assert.deepEqual(parseTelegramPreview(TELEGRAM_2026_10, 'idfofficial'), [
    {
      url: 'https://t.me/idfofficial/19432',
      text: 'IDF: A short while ago, an interceptor was launched toward a suspicious aerial target identified in the area in which IDF soldiers are operating in southern Lebanon.\nNo sirens were sounded in accordance with protocol.',
      publishedAt: '2026-10-28T20:38:40.000Z',
    },
  ]);
  const idf = source(
    'idf',
    { type: 'telegram-public', channel: 'idfofficial' },
    { folder: 'official', kind: 'state' },
  );
  const result = await fetchTelegramSource(idf, {
    fetchImpl: async () =>
      respond(TELEGRAM_2026_10, { headers: { 'content-type': 'text/html' } }),
  });
  assert.equal(result.status.ok, true);
  assert.equal(result.items.length, 1);
});

test('a channel whose preview redirects away reports no public preview', async () => {
  const almasirah = source(
    'almasirah',
    { type: 'telegram-public', channel: 'almasirahnet' },
    { folder: 'armed-group', kind: 'participant', languages: ['ar'] },
  );
  const result = await fetchTelegramSource(almasirah, {
    fetchImpl: async () => {
      const response = respond(TELEGRAM_CONTACT_PAGE, {
        headers: { 'content-type': 'text/html' },
      });
      // fetch followed t.me/s/almasirahnet → t.me/almasirahnet.
      Object.defineProperty(response, 'url', {
        value: 'https://t.me/almasirahnet',
      });
      return response;
    },
  });
  assert.equal(result.status.ok, false);
  assert.equal(
    result.status.error,
    'no public preview: t.me/s/almasirahnet redirects to a contact page',
  );
  assert.deepEqual(result.items, []);
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

test('GDELT groups keep every query, terms included, within the length limit', () => {
  const sources = Array.from({ length: 14 }, (_, i) =>
    source(`s${i}`, {
      type: 'gdelt-domain',
      domain: `outlet-number-${i}.example.com`,
    }),
  );
  const terms = ['Iran', 'Israel', 'Red Sea', 'Hormuz'];
  const groups = groupGdeltSources(sources, terms, { maxChars: 200 });
  assert.ok(groups.length > 2);
  assert.deepEqual(
    groups.flat().map((s) => s.id),
    sources.map((s) => s.id),
  );
  for (const group of groups)
    assert.ok(
      buildGdeltDomainQuery(
        group.map((s) => s.transport.domain),
        terms,
      ).length <= 200,
    );
  const tooLong = groupGdeltSources(sources.slice(0, 2), terms, {
    maxChars: 20,
  });
  assert.deepEqual(
    tooLong.map((group) => group.length),
    [1, 1],
    'a domain that cannot fit still gets its own query',
  );
});

test('every theater keeps its GDELT terms within the query limit', () => {
  const sources = withTestGdeltSources(registry.sources);
  for (const terms of [theaterFile.gdeltTerms, worldTheaterFile.gdeltTerms]) {
    const groups = groupGdeltSources(sources, terms);
    assert.ok(groups.length >= 1);
    for (const group of groups)
      assert.ok(
        buildGdeltDomainQuery(
          group.map((s) => s.transport.domain),
          terms,
        ).length <= GDELT_MAX_QUERY_CHARS,
      );
  }
});

test('the GDELT queue spaces requests; after a 429 the whole queue waits', async () => {
  let clock = 0;
  const sleeps = [];
  const queue = createGdeltQueue({
    spacingMs: 5500,
    backoffMs: 15 * 60_000,
    maxBackoffMs: 60 * 60_000,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  const sent = [];
  const task = (status) => async () => {
    sent.push([clock, status]);
    return { status };
  };
  const results = await Promise.all([
    queue.run(task(200)),
    queue.run(task(429)),
    queue.run(task(200)),
    queue.run(task(200)),
  ]);
  // The two queued behind the 429 are never sent and never wait.
  assert.deepEqual(sent, [
    [0, 200],
    [5500, 429],
  ]);
  assert.deepEqual(sleeps, [5500]);
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 429, 429, 429],
  );
  assert.equal(results[2].backoffUntil, 5500 + 15 * 60_000);
  assert.equal(queue.state().pending, 0);
  // The pause doubles on each 429 in a row, up to an hour, and a success
  // clears it.
  const pauses = [];
  for (const status of [429, 429, 429, 200]) {
    clock = queue.state().backoffUntil;
    await queue.run(task(status));
    pauses.push(queue.state().backoffMs);
  }
  assert.deepEqual(pauses, [30 * 60_000, 60 * 60_000, 60 * 60_000, 0]);
});

test('one search request per group per cycle: a repeat reuses the answer', async () => {
  let clock = 0;
  const queue = createGdeltQueue({
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  let sent = 0;
  const task = async () => {
    sent++;
    return { status: 200, ok: true, text: '{}' };
  };
  const first = await queue.run(task, { key: 'group 1' });
  clock += 60_000;
  assert.equal(await queue.run(task, { key: 'group 1' }), first);
  assert.equal(sent, 1);
  await queue.run(task, { key: 'group 2' });
  assert.equal(sent, 2);
  clock += 14 * 60_000;
  await queue.run(task, { key: 'group 1' });
  assert.equal(sent, 3, 'the next cycle asks again');
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
  const throttledQueue = createGdeltQueue({
    sleep: async () => {},
    now: () => Date.parse('2026-10-28T21:00:00Z'),
  });
  const throttled = await fetchGdeltDomainGroup(group, {
    queue: throttledQueue,
    fetchImpl: async () => new Response('slow down', { status: 429 }),
  });
  assert.equal(throttled.statuses[0].rateLimited, true);
  assert.equal(throttled.statuses[0].error, 'HTTP 429');
  let sentDuringPause = false;
  const paused = await fetchGdeltDomainGroup(group, {
    terms: ['Iran'],
    queue: throttledQueue,
    fetchImpl: async () => {
      sentDuringPause = true;
      return Response.json({ articles: [] });
    },
  });
  assert.equal(sentDuringPause, false);
  assert.deepEqual(
    paused.statuses.map((s) => [s.sourceId, s.rateLimited, s.error]),
    [
      ['alarabiya', true, 'GDELT: rate limited, next try after 21:15 UTC'],
      ['tasnim', true, 'GDELT: rate limited, next try after 21:15 UTC'],
    ],
  );
  const text = await fetchGdeltDomainGroup(group, {
    queue: createGdeltQueue({ sleep: async () => {} }),
    fetchImpl: async () =>
      new Response('Your search contained an invalid term'),
  });
  assert.match(text.statuses[0].error, /^GDELT: Your search/);
  const tooLong = await fetchGdeltDomainGroup(group, {
    queue: createGdeltQueue({ sleep: async () => {} }),
    fetchImpl: async () =>
      new Response('Your query was too short or too long.'),
  });
  assert.deepEqual(
    tooLong.statuses.map((s) => [s.sourceId, s.ok, s.error]),
    [
      ['alarabiya', false, 'GDELT: Your query was too short or too long.'],
      ['tasnim', false, 'GDELT: Your query was too short or too long.'],
    ],
  );
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

test('Telegram posts that open with the same header line stay separate items', async () => {
  const post = (id, text) =>
    `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="almasirahnet/${id}">
<div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div>
<a class="tgme_widget_message_date" href="https://t.me/almasirahnet/${id}"><time datetime="2026-10-25T14:0${id}:00+00:00">14:0${id}</time></a></div></div>`;
  const html = `<html><body>${post(1, '🔴 عاجل<br/>قصف على ميناء الحديدة')}${post(2, '🔴 عاجل<br/>غارات على صنعاء')}</body></html>`;
  const almasirah = source(
    'almasirah',
    { type: 'telegram-public', channel: 'almasirahnet' },
    { folder: 'armed-group', kind: 'participant', languages: ['ar'] },
  );
  const result = await fetchTelegramSource(almasirah, {
    fetchImpl: async () =>
      respond(html, { headers: { 'content-type': 'text/html' } }),
  });
  assert.deepEqual(
    result.items.map((item) => item.title),
    ['🔴 عاجل · قصف على ميناء الحديدة', '🔴 عاجل · غارات على صنعاء'],
  );
});
