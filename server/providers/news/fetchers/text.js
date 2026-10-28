/** Plain-text helpers shared by the news fetchers. Pure. */

export const TITLE_MAX = 220;
export const SNIPPET_MAX = 300;
export const FETCHER_ITEM_CAP = 100;

/** Collapse whitespace and clip on a character boundary with an ellipsis. */
export function clip(text, max) {
  const value = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (value.length <= max) return value;
  return `${[...value].slice(0, max - 1).join('')}…`;
}

const HEBREW = /\p{Script=Hebrew}/gu;
const ARABIC = /\p{Script=Arabic}/gu;
const LATIN = /\p{Script=Latin}/gu;
const PERSIAN_LETTERS = /[پچژگکی]/u;

/**
 * Language of a headline by script: Hebrew, Persian (Arabic script with
 * Persian-only letters) or Arabic when that script dominates the letters,
 * otherwise the source's declared language.
 * @param {string} text
 * @param {string} fallback
 */
export function detectLanguage(text, fallback = 'en') {
  const value = String(text || '');
  const hebrew = value.match(HEBREW)?.length || 0;
  const arabic = value.match(ARABIC)?.length || 0;
  const latin = value.match(LATIN)?.length || 0;
  const total = hebrew + arabic + latin;
  if (!total) return fallback;
  if (hebrew / total > 0.3 && hebrew >= arabic) return 'he';
  if (arabic / total > 0.3) return PERSIAN_LETTERS.test(value) ? 'fa' : 'ar';
  if (fallback === 'he' || fallback === 'ar' || fallback === 'fa') return 'en';
  return fallback;
}

/**
 * Official and armed-group sources publish their own statements; their items
 * are the primary source. Everything else leaves primarySource null unless
 * the transport knows better (ReliefWeb report authors).
 */
export function primarySourceFor(source, url) {
  if (source.folder === 'official' || source.folder === 'armed-group')
    return { kind: 'statement', issuer: source.name, url };
  return null;
}

/**
 * Shape one collected headline. Collect never translates: `title` and
 * `titleOriginal` are both the published title; the digest writes the
 * normalized English story headline.
 */
export function candidate(
  source,
  { title, snippet, url, publishedAt, language, primarySource },
) {
  const clean = clip(title, TITLE_MAX);
  const body = clip(snippet, SNIPPET_MAX);
  return {
    sourceId: source.id,
    title: clean,
    titleOriginal: clean,
    snippet: body && body !== clean ? body : '',
    language: detectLanguage(clean, language || source.languages[0] || 'en'),
    url,
    publishedAt: publishedAt || null,
    primarySource:
      primarySource === undefined
        ? primarySourceFor(source, url)
        : primarySource,
    transport: source.transport.type,
  };
}

/** Per-source status record; fetchers fill the fields they know. */
export function sourceStatus(source, fields = {}) {
  return {
    sourceId: source.id,
    transport: source.transport.type,
    ok: false,
    count: 0,
    error: null,
    blocked: false,
    rateLimited: false,
    disabled: false,
    fragile: source.transport.type === 'telegram-public',
    ...fields,
  };
}

/** Errors leave as a short message without URLs, keys or bodies. */
export function errorMessage(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
    return 'timeout';
  if (error?.code === 'RESPONSE_TOO_LARGE') return 'response too large';
  return clip(
    String(error?.message || 'fetch failed').replace(
      /https?:\/\/\S+/g,
      '<url>',
    ),
    120,
  );
}
