import {
  classifyDiplomacy,
  currentRelations,
  relationsBetween,
} from '../../src/layers/world/relations.js';

const checkedOn = '2026-11-09';
const strategy =
  'https://www.whitehouse.gov/releases/2025/04/remarks-by-director-kratsios-at-the-endless-frontiers-retreat/';
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

export default async function checkRelations({ board, getDetail }) {
  const now = Date.now();
  const dayMs = 86_400_000;
  const today = Math.floor(now / dayMs) * dayMs;
  const snapshot = board ?? {};
  const features = snapshot.features ?? {};
  const rows = currentRelations(snapshot, now);
  const detail = await getDetail('USA', 'diplomacy').catch(() => null);
  const usaDetails = currentRelations(detail ?? {}, now);
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
  const rivals = (snapshot.countryIndex ?? [])
    .filter(({ iso3 }) => classifyDiplomacy('USA', iso3, rows) === 'rival')
    .map(({ iso3 }) => ({
      country: iso3,
      sources: relationsBetween('USA', iso3, usaDetails)
        .filter(({ type }) => ['rivalry', 'diplomatic_rupture'].includes(type))
        .flatMap(({ sources }) => sources ?? []),
    }));
  add(
    'usa-rivals',
    { count: 1, countries: ['CHN'] },
    { count: rivals.length, rivals },
    strategy,
    rivals.length === 1 &&
      rivals[0].country === 'CHN' &&
      rivals[0].sources.includes(strategy),
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
