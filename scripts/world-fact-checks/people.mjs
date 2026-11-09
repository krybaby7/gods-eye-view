import { readFile } from 'node:fs/promises';
import core from './people.expect.json' with { type: 'json' };

const roles = [
  'head-of-state',
  'head-of-government',
  'foreign-minister',
  'defence-minister',
];
const normalize = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function officeCheck(country, role, records, fetchError) {
  const spec = country.roles[role];
  const { names, name, aliases, office, source, sourceNote } =
    typeof spec === 'string'
      ? { name: spec }
      : Array.isArray(spec)
        ? { names: spec }
        : (spec ?? {});
  const expected = names ?? (name ? [name] : []);
  const rows = records.filter((actor) => actor.role === role);
  const found = [...new Set(rows.map(({ name }) => name))];
  const matches =
    expected.length === found.length &&
    expected.every((person) => {
      const accepted = [
        person,
        ...(expected.length === 1 ? (aliases ?? []) : []),
      ].map(normalize);
      return rows.some(
        (row) =>
          accepted.includes(normalize(row.name)) &&
          (!office || normalize(row.office) === normalize(office)),
      );
    });
  const pass = spec !== undefined && !fetchError && matches;
  return {
    id: `people-${country.country}-${role}`,
    expected: office ? { names: expected, office } : expected,
    found: {
      names: found,
      ...((sourceNote ?? country.sourceNote) && {
        sourceNote: sourceNote ?? country.sourceNote,
      }),
      ...(office && { titles: rows.map((row) => row.office) }),
      ...(!pass && {
        issue:
          fetchError ??
          (!found.length
            ? 'No current officeholder returned'
            : 'Names or title differ from the source'),
      }),
    },
    source: source ?? country.source,
    checkedOn: country.checkedOn ?? core.asOf,
    pass,
  };
}

export default async function checkPeople({ board, getDetail }) {
  const sample = await readFile(
    new URL('./people.sample.json', import.meta.url),
    'utf8',
  ).then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
    return [];
  });
  const countries = [
    ...new Map(
      [...sample, ...core.countries].map((entry) => [entry.country, entry]),
    ).values(),
  ];
  const governmentTypes = board?.features?.wikidata?.governments ?? {};
  const filled = (board?.countryIndex ?? []).filter(({ iso3, kind }) => {
    if (kind !== 'state') return false;
    const forms = governmentTypes[iso3];
    return Array.isArray(forms) ? forms.length > 0 : Boolean(forms);
  }).length;
  const directory = board?.features?.wikidata?.actors ?? [];
  const checks = [
    {
      id: 'people-government-type-coverage',
      expected: 'At least 180 states with a government type',
      found: filled,
      source: core.coverageSource,
      checkedOn: core.asOf,
      pass: filled >= 180,
    },
  ];
  const sampleChecks = [];
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
    sampleChecks.push(
      ...roles.map((role) => officeCheck(country, role, domestic, detailError)),
    );
  }
  const passed = sampleChecks.filter(({ pass }) => pass).length;
  checks.push(...sampleChecks, {
    id: 'people-four-office-sample',
    expected: 'At least 95% of all four roles across 30 countries',
    found: {
      countries: countries.length,
      passed,
      total: sampleChecks.length,
      percent: Math.round((1000 * passed) / sampleChecks.length) / 10,
    },
    source:
      'scripts/world-fact-checks/people.expect.json and people.sample.json',
    checkedOn: core.asOf,
    pass: countries.length >= 30 && passed / sampleChecks.length >= 0.95,
  });
  for (const { country, roles, names, source } of core.stale) {
    const namesToExclude = names.map(normalize);
    const found = directory
      .filter(
        (actor) =>
          actor.country === country &&
          roles.includes(actor.role) &&
          namesToExclude.includes(normalize(actor.name)),
      )
      .map(({ name, role }) => ({ name, role }));
    checks.push({
      id: `people-${country}-stale-officeholders`,
      expected: { excluded: names },
      found,
      source,
      checkedOn: core.asOf,
      pass: found.length === 0,
    });
  }
  return checks;
}
