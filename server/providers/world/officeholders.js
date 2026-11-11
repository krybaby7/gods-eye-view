import corrections from '../../../public/world/curated/people-evidence-corrections.json' with { type: 'json' };
import officeSeats from '../../../public/world/curated/actor-office-seats.json' with { type: 'json' };
import { personNameMatch } from './personIdentity.js';

export const officeRoles = [
  'head-of-state',
  'head-of-government',
  'foreign-minister',
  'defence-minister',
  'vice-president',
];

const actorNames = ({ name, articleTitle, aliases }) =>
  [...new Set([name, articleTitle, ...(aliases ?? [])])].filter(Boolean);

export function compareOfficeholderNames(left, right) {
  if (
    !left ||
    !right ||
    left.country !== right.country ||
    left.role !== right.role
  )
    return null;
  if (/^Q\d+$/.test(left.id) && /^Q\d+$/.test(right.id)) {
    return left.id === right.id
      ? { kind: 'id', leftName: left.name, rightName: right.name }
      : null;
  }
  const alternatives = actorNames(right);
  for (const leftName of actorNames(left)) {
    for (const rightName of alternatives) {
      const kind = personNameMatch(leftName, rightName);
      if (kind) return { kind, leftName, rightName };
    }
  }
  return null;
}

const samePerson = (left, right) =>
  Boolean(compareOfficeholderNames(left, right));

const corroboratedName = (actor, other) =>
  actor.source === 'wikidata'
    ? (compareOfficeholderNames(actor, other)?.leftName ?? actor.name)
    : actor.name;

const orderingDate = (actor) =>
  actor.source === 'wikidata'
    ? (actor.since ?? '')
    : (actor.asOf ?? actor.since ?? '');

function provenance(actor) {
  return {
    name: actor.name,
    source: actor.source,
    asOf:
      actor.source === 'wikidata'
        ? (actor.lastChecked?.slice(0, 10) ?? actor.asOf ?? null)
        : (actor.asOf ??
          actor.lastChecked?.slice(0, 10) ??
          actor.since ??
          null),
    sourceUrl: actor.sourceUrl ?? actor.wikidataUrl,
  };
}

function withEvidence(
  actor,
  ageCutoff,
  otherEvidence = [],
  disagreement,
  ambiguity,
) {
  const primary = provenance(actor);
  const latest = otherEvidence
    .filter(({ agrees }) => agrees)
    .reduce(
      (date, { asOf }) => (asOf && asOf > date ? asOf : date),
      primary.asOf ?? '',
    );
  return {
    ...actor,
    ...primary,
    stale: Boolean(latest && latest < ageCutoff),
    ...(otherEvidence.length && { otherEvidence }),
    ...(disagreement && { disagreement: provenance(disagreement) }),
    ...(ambiguity && { ambiguity }),
  };
}

function corroboration(actor, others) {
  return others
    .filter((other) => other && other !== actor)
    .map((other) => ({
      ...provenance(other),
      name: corroboratedName(other, actor),
      agrees: samePerson(actor, other),
    }));
}

function withIdentity(actor, match) {
  if (!match) return actor;
  return {
    ...actor,
    id: match.id,
    name: corroboratedName(match, actor),
    office: match.office ?? actor.office,
    imageFile: match.imageFile,
    accounts: match.accounts,
    wikidataUrl: match.wikidataUrl,
    since: match.since,
  };
}

export function officialOfficeEvidence(registry, now) {
  const allowed = new Set(registry.countries.map(({ iso3 }) => iso3));
  const today = now.toISOString().slice(0, 10);
  return corrections.rows
    .filter(
      ({ country, checkedOn, until }) =>
        allowed.has(country) && checkedOn <= today && until > today,
    )
    .map(({ checkedOn, reason, ...row }) => ({
      ...row,
      id: 'official-' + row.country.toLowerCase() + '-' + row.role,
      kind: 'person',
      source: 'official',
      asOf: row.evidenceDate,
    }));
}

export function mergeOfficeholders(
  wikidata,
  cia,
  now,
  undated = [],
  official = [],
) {
  const age = new Date(now);
  age.setUTCFullYear(age.getUTCFullYear() - 1);
  const ageCutoff = age.toISOString().slice(0, 10);
  const groups = new Map();
  const add = (list, type) => {
    for (const actor of list) {
      const key = actor.country + ':' + actor.role;
      if (!groups.has(key))
        groups.set(key, { wd: [], cia: [], undated: [], official: [] });
      groups.get(key)[type].push(actor);
    }
  };
  add(wikidata, 'wd');
  add(cia, 'cia');
  add(undated, 'undated');
  add(official, 'official');
  return [...groups.values()].flatMap(({ wd, cia, undated, official }) => {
    const [firstWd] = wd;
    const [firstCia] = cia;
    const sample = firstWd ?? firstCia ?? official[0];
    if (!sample) return [];
    const { country, role } = sample;
    const seats = officeSeats.countries[country];
    const vicePresidency = role === 'vice-president' && seats?.vicePresidency;
    const collective =
      vicePresidency?.label ||
      ((role === 'head-of-state' ||
        (country === 'CHE' && role === 'head-of-government')) &&
        seats?.collective);
    if (collective) {
      const expectedSeats =
        vicePresidency?.holders ?? { AND: 2, BIH: 3, CHE: 7, SMR: 2 }[country];
      // A chair or incomplete list cannot replace the collective office.
      const matching = (actor, candidates) =>
        candidates.find((candidate) => samePerson(actor, candidate));
      const newestWikidata = wd.map(orderingDate).sort().at(-1) ?? '';
      const show =
        cia.length === expectedSeats && firstCia.asOf > newestWikidata;
      const primary = show ? cia : wd;
      const secondary = show ? wd : cia;
      const dispute =
        primary.length === expectedSeats && secondary.length === expectedSeats
          ? secondary.find((actor) => !matching(actor, primary))
          : null;
      return primary.map((actor) => {
        const peer = matching(actor, secondary);
        const identities =
          show && vicePresidency && !peer
            ? undated.filter((candidate) => samePerson(actor, candidate))
            : [];
        const identity = identities.length === 1 ? identities[0] : null;
        const preferred = (show && peer) || withIdentity(actor, identity);
        const other = show ? (peer ? actor : identity) : peer;
        return withEvidence(
          {
            ...preferred,
            name: corroboratedName(preferred, other),
            collective,
          },
          ageCutoff,
          corroboration(preferred, [other]),
          peer ? null : dispute,
        );
      });
    }
    const plain = cia.filter(({ plainTitle }) => plainTitle);
    const [ciaChoice, ...alternatives] = plain.length ? plain : cia;
    const competing = alternatives.filter(
      (actor) => !samePerson(ciaChoice, actor),
    );
    const ambiguity = competing.length
      ? { source: ciaChoice.source, alternatives: competing.map(provenance) }
      : undefined;
    const matches = [...wd, ...undated].filter(
      (candidate) => ciaChoice && samePerson(ciaChoice, candidate),
    );
    const match = matches.length === 1 ? matches[0] : null;
    const unconfirmed = undated.some(
      (candidate) => !firstWd || !samePerson(candidate, firstWd),
    );
    const ambiguousWikidata = wd.length > 1 && !match;
    const wdChoice = wd.includes(match) ? match : firstWd;
    const [officialChoice] = official;
    if (
      officialChoice &&
      (!ciaChoice || ciaChoice.asOf <= officialChoice.asOf) &&
      (!wdChoice || orderingDate(wdChoice) <= officialChoice.asOf)
    ) {
      const officialMatch = [...wd, ...undated].find((candidate) =>
        samePerson(candidate, officialChoice),
      );
      const selected = withIdentity(officialChoice, officialMatch);
      const otherEvidence = corroboration(selected, [
        ciaChoice,
        ...new Set([wdChoice, officialMatch]),
      ]);
      const disagreement = [ciaChoice, wdChoice].find(
        (actor) => actor && !samePerson(actor, selected),
      );
      return [
        withEvidence(
          selected,
          ageCutoff,
          otherEvidence,
          disagreement,
          ambiguity,
        ),
      ];
    }
    if (!ciaChoice && (unconfirmed || ambiguousWikidata)) return [];
    const useCia =
      ciaChoice &&
      !wd.includes(match) &&
      (!wdChoice ||
        ambiguousWikidata ||
        (unconfirmed && undated.includes(match)) ||
        ciaChoice.asOf > orderingDate(wdChoice));
    const primary = useCia ? ciaChoice : wdChoice;
    if (!primary) return [];
    const competingHolder = useCia ? wdChoice : ciaChoice;
    const otherEvidence = corroboration(primary, [
      ...new Set([competingHolder, match]),
      ...official,
    ]).filter(({ agrees }) => agrees);
    return [
      withEvidence(
        useCia
          ? withIdentity(primary, match)
          : { ...primary, name: corroboratedName(primary, competingHolder) },
        ageCutoff,
        otherEvidence,
        competingHolder && !samePerson(primary, competingHolder)
          ? competingHolder
          : null,
        ambiguity,
      ),
    ];
  });
}
