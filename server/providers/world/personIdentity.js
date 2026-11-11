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

// Match distinct token positions, so a repeated token cannot be reused.
export function personNameMatch(left, right) {
  const a = normalizePersonName(left).split(' ').filter(Boolean);
  const b = normalizePersonName(right).split(' ').filter(Boolean);
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!shorter.length || (shorter.length === 1 && longer.length > 1))
    return null;
  function covers(matches, index = 0, used = new Set()) {
    if (index === shorter.length) return true;
    return longer.some(
      (token, position) =>
        !used.has(position) &&
        matches(shorter[index], token) &&
        covers(matches, index + 1, new Set([...used, position])),
    );
  }
  if (covers((a, b) => a === b)) return 'tokens';
  return covers((a, b) => a === b || oneEdit(a, b)) ? 'one-edit' : null;
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
