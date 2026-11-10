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
