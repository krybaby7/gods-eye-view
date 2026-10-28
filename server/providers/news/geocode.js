/**
 * Theater gazetteer matcher. Pure: no I/O, no coordinates from anywhere but
 * the supplied gazetteer. Matching is case-, diacritic- and script-variant
 * insensitive; an exact name or alias wins, otherwise the longest gazetteer
 * name contained in the query (on word boundaries) wins.
 */

const LATIN_MARKS = /[̀-ͯ]/g;
// Harakat, Quranic marks, superscript alef and tatweel.
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
// Hebrew cantillation and points (maqaf U+05BE is punctuation, handled below).
const HEBREW_MARKS = /[֑-ׇֽֿׁׂׅׄ]/g;
const APOSTROPHES = /['’‘`´ʼʻ"“”׳״]/g;
const SEPARATORS = /[\s‌‍־\-–—_.,;:/()[\]{}!?|]+/g;
const LETTER_FOLDS = new Map([
  ['ى', 'ي'],
  ['ی', 'ي'],
  ['ې', 'ي'],
  ['ک', 'ك'],
  ['ة', 'ه'],
  ['ۀ', 'ه'],
  ['ٱ', 'ا'],
]);
const LETTER_FOLD_PATTERN = new RegExp(
  `[${[...LETTER_FOLDS.keys()].join('')}]`,
  'g',
);
const LEADING_ARTICLE = /^(?:the|al|el|ad|an|ar|as|at|az|ash) /;
const LATIN_TEXT = /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{M}\p{S}]+$/u;
const PRECISION_RANK = new Map([
  ['country', 1],
  ['region', 2],
  ['water', 2],
  ['city', 3],
  ['locality', 4],
  ['site', 5],
]);

/**
 * Fold a place name to its matching key.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePlaceName(value) {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(LATIN_MARKS, '')
    .replace(ARABIC_MARKS, '')
    .replace(HEBREW_MARKS, '')
    .replace(LETTER_FOLD_PATTERN, (letter) => LETTER_FOLDS.get(letter))
    .replace(APOSTROPHES, '')
    .replace(SEPARATORS, ' ')
    .trim();
}

function stripArticle(key) {
  return key.replace(LEADING_ARTICLE, '');
}

const indexes = new WeakMap();

/** Build (once per gazetteer array) the key → entry map and length-ordered keys. */
function gazetteerIndex(gazetteer) {
  let index = indexes.get(gazetteer);
  if (index) return index;
  // Written spellings, and their article-less forms for exact lookups only:
  // a bare "gulf" must not become a substring target for every Gulf phrase.
  const byKey = new Map();
  const byBareKey = new Map();
  const valid = gazetteer.filter(
    (entry) =>
      entry &&
      typeof entry.name === 'string' &&
      Number.isFinite(entry.lat) &&
      Number.isFinite(entry.lon),
  );
  for (const entry of valid) {
    const spellings = [
      entry.name,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ];
    for (const spelling of spellings) {
      const key = normalizePlaceName(spelling);
      if (key && !byKey.has(key)) byKey.set(key, entry);
      const bare = stripArticle(key);
      if (bare && !byBareKey.has(bare)) byBareKey.set(bare, entry);
    }
  }
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length);
  index = { byKey, byBareKey, keys };
  indexes.set(gazetteer, index);
  return index;
}

function hit(entry) {
  return {
    lat: entry.lat,
    lon: entry.lon,
    precision: typeof entry.precision === 'string' ? entry.precision : 'city',
    method: 'gazetteer',
    name: entry.name,
  };
}

/**
 * Resolve a model-supplied place name against the theater gazetteer.
 * @param {unknown} name
 * @param {Array<{name: string, lat: number, lon: number, precision?: string, aliases?: string[]}>} gazetteer
 * @returns {?{lat: number, lon: number, precision: string, method: 'gazetteer', name: string}}
 */
export function resolvePlace(name, gazetteer) {
  if (!Array.isArray(gazetteer) || !gazetteer.length) return null;
  const key = normalizePlaceName(name);
  if (!key) return null;
  const { byKey, byBareKey, keys } = gazetteerIndex(gazetteer);
  const bare = stripArticle(key);
  const exact =
    byKey.get(key) ||
    byKey.get(bare) ||
    byBareKey.get(key) ||
    byBareKey.get(bare);
  if (exact) return hit(exact);
  // Contained names: among overlapping spellings the longest wins ("Gaza
  // City" over "Gaza"); across separate mentions the finest precision wins
  // ("Bint Jbeil, southern Lebanon" is Bint Jbeil), then the longer name.
  const haystack = ` ${key} `;
  const matched = keys.filter((candidate) =>
    haystack.includes(` ${candidate} `),
  );
  const outermost = matched.filter(
    (candidate) =>
      !matched.some(
        (other) =>
          other.length > candidate.length &&
          ` ${other} `.includes(` ${candidate} `),
      ),
  );
  let best = null;
  for (const candidate of outermost) {
    const rank = PRECISION_RANK.get(byKey.get(candidate).precision) ?? 0;
    if (!best || rank > best.rank) best = { candidate, rank };
  }
  return best ? hit(byKey.get(best.candidate)) : null;
}

/** Whether some rows are flagged for the prompt (`prompt: true`). */
export function hasPromptFlags(gazetteer) {
  return Array.isArray(gazetteer) && gazetteer.some((e) => e?.prompt === true);
}

/**
 * Gazetteer names for the digest instructions: each canonical name with its
 * Latin-script aliases. When some rows carry `prompt: true` (a worldwide
 * gazetteer would cost tens of thousands of input tokens), only those rows
 * are listed, by name alone; matching still uses every row and alias.
 * Coordinates never leave the server's code path.
 * @param {Array<{name: string, aliases?: string[], prompt?: boolean}>} gazetteer
 * @returns {string[]}
 */
export function placeNamesForPrompt(gazetteer) {
  if (!Array.isArray(gazetteer)) return [];
  if (hasPromptFlags(gazetteer))
    return gazetteer
      .filter(
        (entry) => entry.prompt === true && typeof entry.name === 'string',
      )
      .map((entry) => entry.name);
  const lines = [];
  for (const entry of gazetteer) {
    if (!entry || typeof entry.name !== 'string') continue;
    const aliases = (Array.isArray(entry.aliases) ? entry.aliases : []).filter(
      (alias) =>
        typeof alias === 'string' &&
        LATIN_TEXT.test(alias) &&
        normalizePlaceName(alias) !== normalizePlaceName(entry.name),
    );
    lines.push(
      aliases.length ? `${entry.name} (${aliases.join(', ')})` : entry.name,
    );
  }
  return lines;
}
