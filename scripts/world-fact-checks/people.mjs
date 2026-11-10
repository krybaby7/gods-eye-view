import { readFile } from 'node:fs/promises';
import { matchesPerson } from '../world-fact-check-utils/person-identity.mjs';

const roles = [
  'head-of-state',
  'head-of-government',
  'foreign-minister',
  'defence-minister',
];
const ministers = roles.slice(2);
const normalizeOffice = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function officeCheck(country, role, records, fetchError) {
  const spec = country.roles[role];
  const { names, name, aliases, qid, office, source, sourceNote } =
    typeof spec === 'string'
      ? { name: spec }
      : Array.isArray(spec)
        ? { names: spec }
        : (spec ?? {});
  const expected = names ?? (name || qid ? [{ name, aliases, qid }] : []);
  const rows = records.filter((actor) => actor.role === role);
  const unmatched = [...rows];
  for (const person of expected) {
    const index = unmatched.findIndex(
      (actor) =>
        matchesPerson(actor, person) &&
        (!office || normalizeOffice(actor.office) === normalizeOffice(office)),
    );
    if (index >= 0) unmatched.splice(index, 1);
  }
  const pass =
    spec !== undefined &&
    !fetchError &&
    rows.length === expected.length &&
    unmatched.length === 0;
  const found = {
    names: [...new Set(rows.map(({ name }) => name))],
    evidence: rows.map(
      ({
        name,
        office,
        asOf,
        source,
        sourceUrl,
        disagreement,
        otherEvidence,
      }) => ({
        name,
        office,
        asOf,
        source,
        sourceUrl,
        disagreement,
        otherEvidence,
      }),
    ),
    ...((sourceNote ?? country.sourceNote) && {
      sourceNote: sourceNote ?? country.sourceNote,
    }),
    ...(!pass && {
      issue:
        fetchError ??
        (!rows.length
          ? 'Neither source supplied a resolved current holder in the board directory.'
          : rows.length !== expected.length
            ? `The board returned ${rows.length} holders. The independent source names ${expected.length}.`
            : 'The displayed holder or office differs from the independent source. The selected dates and any source disagreement are in evidence.'),
    }),
  };
  const accepted = names ?? (name ? [name] : []);
  return {
    id: `people-${country.country}-${role}`,
    expected: office || qid ? { names: accepted, office, qid } : accepted,
    found,
    source: source ?? country.source,
    checkedOn: spec?.checkedOn ?? country.checkedOn ?? country.asOf,
    pass,
  };
}

function roundFourChecks(board, directory, spec) {
  const { checkedOn, baseline } = spec;
  const rows = directory.filter(({ role }) => roles.includes(role));
  const available = rows.length > 0;
  const foundOrMissing = (value) =>
    available ? value : { reason: 'People directory unavailable' };
  const checks = ['disagreement', 'stale'].map((field) => {
    const disagreement = field === 'disagreement';
    const before = disagreement ? baseline.disagreements : baseline.stale;
    const after = rows.filter((row) => row[field]).length;
    return {
      id: disagreement ? 'people-office-disagreements' : 'people-stale-cues',
      expected: `Fewer than ${before} of ${baseline.roles} shown in the third review`,
      found: foundOrMissing({
        before,
        beforeRoles: baseline.roles,
        after,
        afterRoles: rows.length,
      }),
      source:
        'world-board-review-3-2026-11-10.md, People (#18), compared with the running board',
      checkedOn,
      pass: available ? after < before : null,
    };
  });
  const portraits = board?.features?.['wikimedia-commons']?.portraits ?? {};
  for (const expected of spec.corroborated) {
    const { country, role, name, source } = expected;
    const found = rows
      .filter((row) => row.country === country && row.role === role)
      .map(({ name, id, imageFile, disagreement }) => {
        const metadata = portraits[imageFile];
        return {
          name,
          id,
          imageFile,
          thumbnail: metadata?.thumbnail,
          attributed: Boolean(metadata?.author && metadata?.licence),
          disagreement: disagreement?.name ?? null,
        };
      });
    checks.push({
      id: `people-${country}-${role}-corroborated`,
      expected: {
        name,
        holders: 1,
        wikidataIdentity: true,
        attributedPortrait: true,
        disagreement: null,
      },
      found: foundOrMissing(found),
      source,
      checkedOn,
      pass: available
        ? found.length === 1 &&
          matchesPerson(found[0], expected) &&
          /^Q\d+$/.test(found[0].id) &&
          Boolean(found[0].thumbnail) &&
          found[0].attributed &&
          !found[0].disagreement
        : null,
    });
  }
  for (const [country, source] of Object.entries(spec.fresh)) {
    const found = rows
      .filter((row) => row.country === country)
      .map(({ name, role, asOf, stale }) => ({ name, role, asOf, stale }));
    checks.push({
      id: `people-${country}-confirmations-fresh`,
      expected: 'All four roles have a dated confirmation and no stale cue',
      found: foundOrMissing(found),
      source,
      checkedOn,
      pass: available
        ? roles.every((role) =>
            found.some(
              (row) =>
                row.role === role &&
                /^\d{4}-\d{2}-\d{2}$/.test(row.asOf) &&
                row.stale === false,
            ),
          )
        : null,
    });
  }
  for (const expected of spec.officeholders) {
    const { country, role, name, acting, source } = expected;
    const found = rows
      .filter((row) => row.country === country && row.role === role)
      .map(({ name, source, asOf, acting, ambiguity }) => ({
        name,
        source,
        asOf,
        acting,
        ambiguity,
      }));
    checks.push({
      id: `people-${country}-${role}-round4`,
      expected: { name, acting },
      found: foundOrMissing(found),
      source,
      checkedOn,
      pass: available
        ? found.length === 1 &&
          matchesPerson(found[0], expected) &&
          (acting === undefined || acting === found[0].acting)
        : null,
    });
  }
  return checks;
}

export default async function checkPeople({
  board,
  getDetail,
  samplePath = new URL('./people.sample.json', import.meta.url),
  expectedPath = new URL('./people.expect.json', import.meta.url),
}) {
  const paths = [expectedPath, samplePath];
  const inputs = await Promise.allSettled(
    paths.map((path) => readFile(path, 'utf8').then(JSON.parse)),
  );
  const missing = inputs.findIndex(({ status }) => status === 'rejected');
  if (missing >= 0) {
    const { reason } = inputs[missing];
    return [
      {
        id: 'people-reference-inputs',
        expected: 'Independent People references for the 30-country sample',
        found: {
          reason: `${paths[missing]} ${reason.code === 'ENOENT' ? 'not found' : reason.message}`,
        },
        source:
          'scripts/world-fact-checks/people.expect.json and people.sample.json',
        pass: null,
      },
    ];
  }
  const [{ value: core }, { value: sample }] = inputs;
  const countries = [
    ...new Map(
      [...sample, ...core.countries].map((entry) => [
        entry.country,
        { asOf: core.asOf, ...entry },
      ]),
    ).values(),
  ];
  const governmentTypes = board?.features?.wikidata?.governments ?? {};
  const states = (board?.countryIndex ?? []).filter(
    ({ kind }) => kind === 'state',
  );
  const recorded = states.filter(({ iso3 }) => {
    const forms = governmentTypes[iso3];
    return Array.isArray(forms) ? forms.length > 0 : Boolean(forms);
  }).length;
  const directory = board?.features?.wikidata?.actors ?? [];
  const sourceCounts = {
    wikidata: 0,
    'cia-world-leaders': 0,
    official: 0,
  };
  let disagreements = 0;
  let undated = 0;
  for (const role of directory) {
    if (!roles.includes(role.role)) continue;
    sourceCounts[role.source ?? 'not recorded'] =
      (sourceCounts[role.source ?? 'not recorded'] ?? 0) + 1;
    if (role.disagreement) disagreements++;
    if (!role.asOf) undated++;
  }
  const checks = [
    {
      id: 'people-government-type-coverage',
      expected:
        'Recorded government forms or not recorded if there is no Wikidata form',
      found: states.length
        ? { recorded, notRecorded: states.length - recorded }
        : { reason: 'Country registry unavailable' },
      source: 'Wikidata P122 and World Board country registry',
      checkedOn: core.asOf,
      pass: states.length ? true : null,
    },
    {
      id: 'people-office-source-counts',
      expected: 'Each displayed role has a source and a dated observation',
      found: board?.features?.wikidata
        ? { sourceCounts, disagreements, undated }
        : { reason: 'People directory unavailable' },
      source:
        'Wikidata P580, CIA World Leaders country page dates and cited official evidence',
      checkedOn: core.asOf,
      pass: board?.features?.wikidata
        ? !undated && !sourceCounts['not recorded']
        : null,
    },
  ];
  if (core.round4)
    checks.push(...roundFourChecks(board, directory, core.round4));
  const sampleChecks = [];
  const dated = [];
  for (const country of countries) {
    let detailError;
    const detail = await getDetail(country.country, 'people').catch((error) => {
      detailError = error.message;
      return null;
    });
    const records = detail?.features?.wikidata?.actors ?? directory;
    const domestic = records.filter(
      (actor) => actor.country === country.country,
    );
    const comparisons = roles.map((role) =>
      officeCheck(country, role, domestic, detailError),
    );
    sampleChecks.push(...comparisons);
    if (['JPN', 'KOR'].includes(country.country)) {
      for (const role of ministers) {
        const comparison = comparisons[roles.indexOf(role)];
        const evidence = comparison.found.evidence;
        dated.push({
          ...comparison,
          id: comparison.id + '-dated',
          expected: {
            names: comparison.expected,
            provenance: 'as of YYYY-MM-DD · source',
          },
          found: {
            ...comparison.found,
            ...(comparison.pass &&
              !evidence.every(
                ({ asOf, source }) =>
                  source && /^\d{4}-\d{2}-\d{2}$/.test(asOf),
              ) && {
                issue: 'Correct holder, but the source or date is missing.',
              }),
          },
          pass:
            comparison.pass &&
            evidence.every(
              ({ asOf, source }) => source && /^\d{4}-\d{2}-\d{2}$/.test(asOf),
            ),
        });
      }
    }
  }
  const passed = sampleChecks.filter(({ pass }) => pass).length;
  checks.push(...sampleChecks, ...dated, {
    id: 'people-four-office-sample',
    expected: 'At least 90% of all four roles across 30 countries',
    found: {
      countries: countries.length,
      passed,
      total: sampleChecks.length,
      percent: Math.round((1000 * passed) / sampleChecks.length) / 10,
      misses: sampleChecks.filter(({ pass }) => !pass).map(({ id }) => id),
    },
    source:
      'scripts/world-fact-checks/people.expect.json and people.sample.json',
    checkedOn: core.asOf,
    pass: countries.length === 30 && passed / sampleChecks.length >= 0.9,
  });
  for (const { country, roles, names, source, checkedOn, key } of core.stale) {
    const found = directory
      .filter(
        (actor) =>
          actor.country === country &&
          roles.includes(actor.role) &&
          names.some((name) => matchesPerson(actor, name)),
      )
      .map(({ name, role, asOf, source }) => ({ name, role, asOf, source }));
    checks.push({
      id: `people-${country}${key ? '-' + key : ''}-stale-officeholders`,
      expected: { excluded: names },
      found: board?.features?.wikidata
        ? found
        : { reason: 'People directory unavailable' },
      source,
      checkedOn: checkedOn ?? core.asOf,
      pass: board?.features?.wikidata ? found.length === 0 : null,
    });
  }
  return checks;
}
