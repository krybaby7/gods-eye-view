export function normalizePersonName(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+(?:jr|junior|al saud)$/, '');
}

function oneEdit(left, right) {
  const a = [...left];
  const b = [...right];
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1)
    return false;
  if (a.length > b.length) return oneEdit(right, left);
  const first = a.findIndex((letter, index) => letter !== b[index]);
  if (first < 0) return a.length !== b.length;
  const offset = a.length === b.length ? 0 : 1;
  return a
    .slice(first + (offset ? 0 : 1))
    .every((letter, index) => letter === b[first + 1 + index]);
}

const regnalNumeral = /^[ivxlcdm]+$/;
const patronymic = /^(?:bin|ibn|bint|ould|walad)$/;

function nameTokens(name) {
  return normalizePersonName(name)
    .replace(
      /^(?:(?:crown prince|king|queen|sultan|emir|sheikh|prince)(?: |$))+/,
      '',
    )
    .replace(/ of .+$/, '')
    .replace(/\babd(?: (?:al|el) |[aeu]l *)/g, 'abdal')
    .split(' ')
    .filter(Boolean);
}

function skeleton(token) {
  if (!/^\p{L}+$/u.test(token) || regnalNumeral.test(token)) return '';
  return token
    .replace(
      /kh|gh|zh|x/g,
      (cluster) => ({ kh: 'k', gh: 'q', zh: 'j', x: 'ks' })[cluster],
    )
    .replace(/[aeiouy]/g, '')
    .replace(/(\p{L})\1+/gu, '$1');
}

function transliteration(left, right) {
  const letters = skeleton(left);
  return Boolean(letters && letters === skeleton(right));
}

// Match distinct token positions, so a repeated token cannot be reused.
function matchTokens(a, b) {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!shorter.length || (shorter.length === 1 && longer.length > 1))
    return null;
  const aPatronymic = a.findIndex((token) => patronymic.test(token));
  const bPatronymic = b.findIndex((token) => patronymic.test(token));
  const aGiven = a[(aPatronymic < 0 ? bPatronymic : aPatronymic) - 1];
  const bGiven = b[(bPatronymic < 0 ? aPatronymic : bPatronymic) - 1];
  const matchesGiven = (matches) =>
    (aPatronymic < 0 && bPatronymic < 0) ||
    (aGiven && bGiven && matches(aGiven, bGiven));
  function covers(matches, index = 0, used = new Set()) {
    if (index === shorter.length) return true;
    return longer.some(
      (token, position) =>
        !used.has(position) &&
        matches(shorter[index], token) &&
        covers(matches, index + 1, new Set([...used, position])),
    );
  }
  const exact = (a, b) => a === b;
  const edit = (a, b) => exact(a, b) || oneEdit(a, b);
  const transliterated = (a, b) => edit(a, b) || transliteration(a, b);
  if (matchesGiven(exact) && covers(exact)) return 'tokens';
  if (matchesGiven(edit) && covers(edit)) return 'one-edit';
  return matchesGiven(transliterated) && covers(transliterated)
    ? 'transliteration'
    : null;
}

const joinArticles = (tokens) =>
  tokens
    .join(' ')
    .replace(/ (al|el) (?=\p{L})/gu, ' $1')
    .split(' ');

export function personNameMatch(left, right) {
  const a = nameTokens(left);
  const b = nameTokens(right);
  const direct = matchTokens(a, b);
  if (direct || !a.length || !b.length) return direct;
  // Arabic definite articles sometimes appear without a word separator
  // (el-Sisi / Elsisi). Keep the separate-token match as the first choice.
  const joinedA = joinArticles(a);
  const joinedB = joinArticles(b);
  return joinedA.length < a.length || joinedB.length < b.length
    ? matchTokens(joinedA, joinedB)
    : null;
}

function wikidataId(person) {
  const id = person?.qid ?? person?.id;
  return /^Q\d+$/i.test(id ?? '') ? id.toUpperCase() : null;
}

export function matchesPerson(actual, expected) {
  const expectedId = wikidataId(expected);
  if (expectedId) return wikidataId(actual) === expectedId;
  const name = normalizePersonName(actual?.name ?? actual);
  return Boolean(
    name &&
    [expected?.name ?? expected, ...(expected?.aliases ?? [])].some(
      (candidate) => name === normalizePersonName(candidate),
    ),
  );
}
