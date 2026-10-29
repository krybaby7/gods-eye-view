/**
 * Shared RSS and Atom parsing for the news providers. Regex-based on purpose:
 * feeds are untrusted markup, nothing here builds a DOM or follows links, and
 * every field leaves as plain text or an http(s) URL.
 */

function decodeRssText(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rssTag(block, tag) {
  return decodeRssText(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(
      block,
    )?.[1] || '',
  );
}

/**
 * Cockpit Regional News headlines from a Google News RSS search: title,
 * link, publisher and date, deduplicated on title plus publisher.
 * @param {string} xml
 * @param {number} [limit]
 */
function normalizeRssArticles(xml, limit = 5) {
  const seen = new Set();
  const articles = [];
  for (const match of String(xml || '').matchAll(
    /<item>([\s\S]*?)<\/item>/gi,
  )) {
    const item = match[1];
    const title = rssTag(item, 'title').slice(0, 180);
    const url = rssTag(item, 'link');
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      continue;
    }
    if (!title || !['http:', 'https:'].includes(parsedUrl.protocol)) continue;
    const source = rssTag(item, 'source');
    const signature = `${title.toLowerCase()}|${source.toLowerCase() || parsedUrl.hostname}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const rawDate = rssTag(item, 'pubDate');
    articles.push({
      title,
      url: parsedUrl.href,
      domain: source || parsedUrl.hostname.replace(/^www\./, ''),
      publishedAt: Number.isNaN(Date.parse(rawDate))
        ? null
        : new Date(rawDate).toISOString(),
      sourceCountry: null,
    });
    if (articles.length >= limit) break;
  }
  return articles;
}

const NAMED_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['hellip', '…'],
  ['mdash', '—'],
  ['ndash', '–'],
  ['lsquo', '‘'],
  ['rsquo', '’'],
  ['ldquo', '“'],
  ['rdquo', '”'],
  ['laquo', '«'],
  ['raquo', '»'],
]);

/** Decode named and numeric character references in one pass (no double decoding). */
function decodeEntities(text) {
  return String(text || '').replace(
    /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi,
    (whole, ref) => {
      if (ref[0] === '#') {
        const code =
          ref[1] === 'x' || ref[1] === 'X'
            ? Number.parseInt(ref.slice(2), 16)
            : Number.parseInt(ref.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return NAMED_ENTITIES.get(ref.toLowerCase()) ?? whole;
    },
  );
}

/**
 * Plain text of one feed field: unwrap CDATA, decode escaped markup, strip
 * tags and scripts, decode the remaining references, collapse whitespace.
 * @param {string} raw Inner markup of the element.
 */
function feedFieldText(raw) {
  const value = String(raw || '').trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(value);
  const markup = cdata ? cdata[1] : decodeEntities(value);
  return decodeEntities(
    markup
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * Absolute http(s) links in one feed field's markup, read before
 * feedFieldText strips the tags.
 * @param {string} raw Inner markup of the element.
 */
function feedFieldLinks(raw) {
  const value = String(raw || '').trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(value);
  const markup = cdata ? cdata[1] : decodeEntities(value);
  const links = [];
  for (const match of markup.matchAll(/<a\b[^>]*>/gi)) {
    const href = httpUrl(attribute(match[0], 'href'));
    if (href) links.push(href);
  }
  return links;
}

function firstElement(block, tags) {
  for (const tag of tags) {
    const match = new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      'i',
    ).exec(block);
    if (match) return match[1];
  }
  return '';
}

function attribute(tag, name) {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`,
    'i',
  ).exec(tag);
  return match ? decodeEntities(match[2] ?? match[3] ?? '') : '';
}

function httpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// Drupal's default "Friday, October 23, 2026 - 18:13" (Crisis Group), with no
// zone: read as UTC so the result does not depend on the server's zone.
const DRUPAL_DATE =
  /^(?:[a-z]+,\s*)?([a-z]+ \d{1,2}, \d{4}) - (\d{1,2}:\d{2})$/i;

function isoDate(raw) {
  const text = feedFieldText(raw);
  if (!text) return null;
  const drupal = DRUPAL_DATE.exec(text);
  const ms = Date.parse(drupal ? `${drupal[1]} ${drupal[2]} UTC` : text);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Atom entries carry their link in an attribute; prefer rel="alternate". */
function atomLink(block) {
  let fallback = null;
  for (const match of block.matchAll(/<link\b[^>]*>/gi)) {
    const href = httpUrl(attribute(match[0], 'href'));
    if (!href) continue;
    const rel = attribute(match[0], 'rel') || 'alternate';
    if (rel === 'alternate') return href;
    fallback ??= href;
  }
  return fallback;
}

/**
 * Parse RSS 2.0 items and Atom entries into plain records.
 * @param {string} xml Feed body.
 * @returns {{language: ?string, entries: Array<{title: string, url: string, description: string, links: string[], publishedAt: ?string, source: ?string, guid: ?string}>}}
 */
function parseFeedEntries(xml) {
  const text = String(xml || '');
  const head = text.slice(0, 4000);
  const languageText = feedFieldText(firstElement(head, ['language']));
  const xmlLang = /<feed\b[^>]*\sxml:lang\s*=\s*["']([^"']+)["']/i.exec(head);
  const language =
    (languageText || xmlLang?.[1] || '').toLowerCase().split(/[-_]/)[0] || null;
  const entries = [];
  const blocks = [
    ...text.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...text.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ];
  for (const match of blocks) {
    const block = match[1];
    const atom = match[0].slice(0, 6).toLowerCase() === '<entry';
    const title = feedFieldText(firstElement(block, ['title']));
    const url = atom
      ? atomLink(block)
      : httpUrl(feedFieldText(firstElement(block, ['link']))) ||
        httpUrl(feedFieldText(firstElement(block, ['guid'])));
    if (!title || !url) continue;
    const bodyTags = atom
      ? ['summary', 'content']
      : ['description', 'content:encoded', 'summary'];
    const description = feedFieldText(firstElement(block, bodyTags));
    // Links from every body field: the short description often omits the
    // statement the full content links to.
    const links = [
      ...new Set(
        bodyTags.flatMap((tag) => feedFieldLinks(firstElement(block, [tag]))),
      ),
    ];
    entries.push({
      title,
      url,
      description,
      links,
      publishedAt: isoDate(
        firstElement(
          block,
          atom
            ? ['published', 'updated']
            : ['pubDate', 'dc:date', 'published', 'updated'],
        ),
      ),
      source: feedFieldText(firstElement(block, ['source'])) || null,
      guid: feedFieldText(firstElement(block, ['guid', 'id'])) || null,
    });
  }
  return { language, entries };
}

export {
  decodeEntities,
  decodeRssText,
  feedFieldText,
  normalizeRssArticles,
  parseFeedEntries,
};
