import {
  classifyDiplomacy,
  currentRelations,
  isDocumentedRivalry,
  relationsBetween,
} from '../../src/layers/world/relations.js';
import expectations from './relations.expect.json' with { type: 'json' };

const { checkedOn, round2 } = expectations;
const nato =
  'https://www.nato.int/en/about-us/organization/nato-member-countries';
const ofac =
  'https://ofac.treasury.gov/sanctions-programs-and-country-information/';
const oas = 'https://www.oas.org/juridico/english/sigs/b-29.html';
const ucdp = 'https://ucdp.uu.se/downloads/';
const tags =
  'https://ofac.treasury.gov/specially-designated-nationals-list-sdn-list/program-tag-definitions-for-ofac-sanctions-lists';
const nonrivals = {
  FRA: nato,
  GBR: nato,
  DEU: nato,
  JPN: 'https://www.whitehouse.gov/fact-sheets/2026/03/fact-sheet-president-donald-j-trump-strengthens-u-s-japan-alliance-for-the-benefit-of-all-americans/',
  MEX: 'https://ustr.gov/trade-agreements/free-trade-agreements/united-states-mexico-canada-agreement',
  IND: 'https://www.whitehouse.gov/briefings-statements/2026/02/united-states-india-joint-statement/',
  BRA: oas,
};
const sanctions = {
  RUS: ['Russia sanctions', 'RUSSIA-EO14024', 'russia-related-sanctions'],
  IRN: ['Iran sanctions', 'IRAN', 'iran-sanctions'],
  PRK: ['North Korea sanctions', 'DPRK', 'north-korea-sanctions'],
};
const pairKey = (a, b) => [a, b].sort().join('–');
const disputedRio =
  'https://documents.un.org/doc/undoc/gen/n19/291/27/pdf/n1929127.pdf';

export default async function checkRelations({ board, getDetail }) {
  const now = Date.now();
  const dayMs = 86_400_000;
  const today = Math.floor(now / dayMs) * dayMs;
  const snapshot = board ?? {};
  const features = snapshot.features ?? {};
  const rows = currentRelations(snapshot, now);
  const [detail, ukDetail] = await Promise.all(
    ['USA', 'GBR'].map((country) =>
      getDetail(country, 'diplomacy').catch(() => null),
    ),
  );
  const usaDetails = currentRelations(detail ?? {}, now);
  const ukDetails = currentRelations(ukDetail ?? {}, now);
  const checks = [];
  const add = (id, expected, found, source, pass) =>
    checks.push({
      id: 'relations-' + id,
      expected,
      found,
      source,
      checkedOn,
      pass,
    });
  const rivalryRows = rows.filter(
    ({ type, end }) => type === 'rivalry' && !end,
  );
  const hostileRuptures = rows.filter(
    (row) =>
      row.type === 'diplomatic_rupture' && !row.end && isDocumentedRivalry(row),
  );
  const painted = new Map();
  for (const { from, to, sources } of [...rivalryRows, ...hostileRuptures]) {
    if (classifyDiplomacy(from, to, rows, now) !== 'rival') continue;
    const pair = pairKey(from, to);
    painted.set(pair, [...new Set([...(painted.get(pair) ?? []), ...sources])]);
  }
  for (const [
    from,
    to,
    start,
    hostilityOn,
    citation,
  ] of expectations.rivalries) {
    const found = relationsBetween(from, to, rivalryRows);
    add(
      'rivalry-' + from + '-' + to,
      { start, hostilityOn, reviewed: false },
      { rows: found, mapClass: classifyDiplomacy(from, to, rows, now) },
      [expectations.dataset, citation],
      found.length === 1 &&
        found[0].start === start &&
        found[0].hostilityOn === hostilityOn &&
        found[0].reviewed === false &&
        found[0].sources?.includes(expectations.dataset) &&
        found[0].sources.includes(citation),
    );
  }
  add(
    'armenia-azerbaijan-deescalation',
    'The 2025 initialled peace agreement supersedes the 2023 evidence for an active strategic rivalry',
    relationsBetween('ARM', 'AZE', rivalryRows),
    expectations.deescalation,
    Boolean(board) && !relationsBetween('ARM', 'AZE', rivalryRows).length,
  );
  const expectedRivalryPairs = expectations.rivalries
    .map(([a, b]) => pairKey(a, b))
    .sort();
  add(
    'rivalry-list',
    {
      configured: expectedRivalryPairs,
      round2Configured: round2.configuredRivalries,
      round2Painted: round2.paintedRivals,
    },
    {
      configured: rivalryRows.length,
      painted: painted.size,
      paintedPairs: Object.fromEntries([...painted].sort()),
      maskedPairs: [...rivalryRows, ...hostileRuptures]
        .filter(({ from, to }) => !painted.has(pairKey(from, to)))
        .map(({ from, to, sources }) => ({
          pair: pairKey(from, to),
          classification: classifyDiplomacy(from, to, rows, now),
          sources,
        })),
    },
    expectations.dataset,
    rivalryRows
      .map(({ from, to }) => pairKey(from, to))
      .sort()
      .join() === expectedRivalryPairs.join() &&
      hostileRuptures.length === expectations.ruptures.length &&
      expectations.ruptures.every(([a, b, date, citation]) =>
        relationsBetween(a, b, hostileRuptures).some(
          ({ hostilityOn, sources }) =>
            hostilityOn === date && sources.includes(citation),
        ),
      ),
  );
  const usaClasses = {
    ...Object.fromEntries(
      Object.keys(round2.usaClasses).map((key) => [key, 0]),
    ),
    unknown: 0,
  };
  const rivals = [];
  for (const { iso3 } of snapshot.countryIndex ?? []) {
    if (iso3 === 'USA') continue;
    const classification =
      classifyDiplomacy('USA', iso3, rows, now) ?? 'unknown';
    usaClasses[classification]++;
    if (classification === 'rival')
      rivals.push({
        country: iso3,
        sources: painted.get(pairKey('USA', iso3)) ?? [],
      });
  }
  const chinaRival = expectations.rivalries
    .find(([from, to]) => from === 'CHN' && to === 'USA')
    .at(-1);
  add(
    'usa-rivals',
    { countries: ['CHN'], round2Classes: round2.usaClasses },
    { classes: usaClasses, rivals },
    chinaRival,
    rivals.length === 1 &&
      rivals[0].country === 'CHN' &&
      rivals[0].sources.includes(chinaRival),
  );
  const rio = rows.find(({ id }) => id === 'rel_rio');
  const rioParties = (rio?.participants ?? []).filter(
    (party) => party !== 'VEN',
  );
  const rioAllies = rioParties.filter(
    (party) => classifyDiplomacy('VEN', party, rows, now) === 'ally',
  );
  add(
    'venezuela-rio-treaty',
    'Venezuela is inactive in the Rio Treaty and none of its other parties is classified as an ally',
    {
      parties: rioParties,
      allies: rioAllies,
      inactive: rio?.inactiveParticipants,
    },
    [oas, disputedRio],
    rioParties.length > 0 &&
      rio.inactiveParticipants?.includes('VEN') &&
      rio.sources?.includes(oas) &&
      rio.sources.includes(disputedRio) &&
      rioAllies.length === 0,
  );
  for (const [
    actor,
    target,
    programmeId,
    scope,
    source,
  ] of expectations.sanctions) {
    const found = (actor === 'USA' ? usaDetails : ukDetails).filter(
      (row) =>
        row.type === 'sanctions' &&
        row.from === actor &&
        row.programmeId === programmeId,
    );
    add(
      'scope-' + actor + '-' + programmeId,
      { target, scope },
      found,
      source,
      found.length === 1 &&
        found[0].to === target &&
        found[0].scope === scope &&
        found[0].sources?.includes(source),
    );
  }
  const unCoverage = features['relations-sanctions-un']?.coverage;
  const actorOnly = unCoverage?.thematicDetails ?? [];
  add(
    'un-actor-only-programmes',
    'QD, SO and TA are documented targeted programmes without state sanctions edges',
    { thematic: actorOnly, unmapped: unCoverage?.unmapped },
    Object.values(expectations.un),
    Object.entries(expectations.un).every(
      ([programmeId, source]) =>
        actorOnly.some(
          (row) =>
            row.programmeId === programmeId &&
            row.scope === 'persons' &&
            row.sources?.includes(source),
        ) &&
        !rows.some(
          (row) => row.from === 'UN' && row.programmeId === programmeId,
        ),
    ),
  );
  for (const [iso3, source] of Object.entries(nonrivals)) {
    const classification = classifyDiplomacy('USA', iso3, rows);
    const stateMeasures = relationsBetween('USA', iso3, rows)
      .filter(
        ({ type, scope, from }) =>
          type === 'sanctions' && scope === 'state' && from === 'USA',
      )
      .map(({ programme }) => programme);
    add(
      'usa-nonrival-' + iso3,
      'No rivalry or US state-scope sanctions',
      { classification, stateMeasures },
      [source, ofac],
      Boolean(detail) &&
        Boolean(
          snapshot.countryIndex?.some((country) => country.iso3 === iso3),
        ) &&
        classification !== 'rival' &&
        stateMeasures.length === 0,
    );
  }
  for (const [iso3, [programme, programmeId, page]] of Object.entries(
    sanctions,
  )) {
    const classification = classifyDiplomacy('USA', iso3, rows);
    const names = relationsBetween('USA', iso3, usaDetails)
      .filter(
        ({ type, scope, from }) =>
          type === 'sanctions' && scope === 'state' && from === 'USA',
      )
      .map(({ programme, programmeId }) => ({ programme, programmeId }));
    add(
      'usa-sanctions-' + iso3,
      { classification: 'sanctions', programme, programmeId },
      { classification, programmes: names },
      ofac + page,
      classification === 'sanctions' &&
        names.some(
          (entry) =>
            entry.programme === programme && entry.programmeId === programmeId,
        ),
    );
  }
  const wars = rows.filter(({ type }) => type === 'current_armed_conflict');
  add(
    'current-war-pairs',
    'Every painted pair has one or more UCDP events for its exact sides in the last 90 days',
    wars.map(({ from, to, events }) => ({ from, to, events })),
    ucdp,
    Boolean(board) &&
      wars.every(
        ({ from, to, events }) =>
          events.length > 0 &&
          classifyDiplomacy(from, to, rows, now) === 'at-war' &&
          events.every(({ a, b, date, sourceUrl }) => {
            const eventDay = Date.parse(date);
            return (
              ((a === from && b === to) || (a === to && b === from)) &&
              today - eventDay >= 0 &&
              today - eventDay <= 90 * dayMs &&
              new Date(eventDay).toISOString().slice(0, 10) === date &&
              URL.parse(sourceUrl)?.origin === 'https://ucdp.uu.se'
            );
          }),
      ),
  );
  const annual = features['relations-ucdp'];
  const houthi = annual?.houthiActors ?? [];
  add(
    'houthi-actor',
    'At least one Houthi dyad, with actor 123 separate from Yemen',
    houthi,
    'https://ucdp.uu.se/additionalinfo/14595/4',
    houthi.length > 0 &&
      houthi.every(
        ({ actor, states }) => actor !== 'YEM' && !states.includes('YEM'),
      ) &&
      houthi.some(({ actor }) => actor === 'ucdp:actor:123'),
  );
  add(
    'annual-conflict-detail',
    '2025 UCDP dyads remain in the selected-country detail',
    {
      annual: annual?.historicalDyads,
      selectedUSA: usaDetails
        .filter(
          ({ type, period }) => type === 'armed_conflict' && period === '2025',
        )
        .map(({ id }) => id),
    },
    'https://ucdp.uu.se/year/2025',
    annual?.historicalDyads > 0 &&
      usaDetails.some(
        ({ type, period }) => type === 'armed_conflict' && period === '2025',
      ),
  );
  for (const [id, minimum, source] of [
    ['ofac', 72, tags],
    [
      'uk',
      31,
      'https://www.gov.uk/government/collections/uk-sanctions-regimes-under-the-sanctions-act',
    ],
  ]) {
    const data = features['relations-sanctions-' + id];
    const coverage = data?.coverage;
    add(
      id + '-programme-coverage',
      { minimum, unmapped: 0 },
      { dateChecked: data?.dateChecked, ...coverage },
      source,
      Boolean(data?.dateChecked) &&
        coverage?.programmes >= minimum &&
        coverage.unmappedProgrammes === 0 &&
        coverage.mappedProgrammes + coverage.thematicProgrammes ===
          coverage.programmes,
    );
  }
  return checks;
}
