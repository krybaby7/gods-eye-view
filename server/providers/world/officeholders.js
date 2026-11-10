import corrections from '../../../public/world/curated/people-evidence-corrections.json' with { type: 'json' };
import officeSeats from '../../../public/world/curated/actor-office-seats.json' with { type: 'json' };
import { normalizePersonName } from './personIdentity.js';

export const officeRoles = [
  'head-of-state',
  'head-of-government',
  'foreign-minister',
  'defence-minister',
];

function samePerson(left, right) {
  if (/^Q\d+$/.test(left.id) && /^Q\d+$/.test(right.id))
    return left.id === right.id;
  const signature = (name) =>
    normalizePersonName(name).split(' ').sort().join(' ');
  return [left.name, ...(left.aliases ?? [])].some((name) =>
    [right.name, ...(right.aliases ?? [])].some(
      (other) => signature(name) === signature(other),
    ),
  );
}

function provenance(actor) {
  return {
    name: actor.name,
    source: actor.source,
    asOf: actor.asOf ?? actor.since ?? null,
    sourceUrl: actor.sourceUrl ?? actor.wikidataUrl,
  };
}

function withEvidence(actor, ageCutoff, other) {
  const evidence = provenance(actor);
  return {
    ...actor,
    ...evidence,
    stale: Boolean(evidence.asOf && evidence.asOf < ageCutoff),
    ...(other && { disagreement: provenance(other) }),
  };
}

function withIdentity(actor, match) {
  if (!match) return actor;
  return {
    ...actor,
    id: match.id,
    name: match.name,
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
    const collective =
      (role === 'head-of-state' ||
        (country === 'CHE' && role === 'head-of-government')) &&
      officeSeats.countries[country]?.collective;
    if (collective) {
      const expectedSeats = { AND: 2, BIH: 3, CHE: 7, SMR: 2 }[country];
      // A chair or incomplete list cannot replace the collective office.
      const matching = (actor, candidates) =>
        candidates.find((candidate) => samePerson(actor, candidate));
      const newestWikidata =
        wd
          .map(({ asOf, since }) => asOf ?? since ?? '')
          .sort()
          .at(-1) ?? '';
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
        const preferred =
          peer && (peer.asOf ?? peer.since) > (actor.asOf ?? actor.since)
            ? show
              ? peer
              : withIdentity(peer, actor)
            : show
              ? withIdentity(actor, peer)
              : actor;
        return withEvidence(
          { ...preferred, collective },
          ageCutoff,
          peer ? null : dispute,
        );
      });
    }
    const matches = [...wd, ...undated].filter((candidate) =>
      cia.some((actor) => samePerson(actor, candidate)),
    );
    const match = matches.length === 1 ? matches[0] : null;
    const unconfirmed = undated.some(
      (candidate) => !firstWd || !samePerson(candidate, firstWd),
    );
    const ambiguousWikidata = wd.length > 1 && !match;
    const ambiguousCia = cia.length > 1 && !match;
    const ciaChoice = match
      ? cia.find((actor) => samePerson(actor, match))
      : firstCia;
    const wdChoice = wd.includes(match) ? match : firstWd;
    const [officialChoice] = official;
    if (
      officialChoice &&
      (!ciaChoice || ciaChoice.asOf <= officialChoice.asOf) &&
      (!wdChoice ||
        (wdChoice.asOf ?? wdChoice.since ?? '') <= officialChoice.asOf)
    ) {
      const officialMatch = [...wd, ...undated].find((candidate) =>
        samePerson(candidate, officialChoice),
      );
      const other = [ciaChoice, wdChoice].find(
        (actor) => actor && !samePerson(actor, officialChoice),
      );
      return [
        withEvidence(
          {
            ...withIdentity(officialChoice, officialMatch),
            otherEvidence: [ciaChoice, wdChoice]
              .filter(Boolean)
              .map(provenance),
          },
          ageCutoff,
          other,
        ),
      ];
    }
    if (ambiguousCia && (ambiguousWikidata || !wdChoice)) return [];
    if (!ciaChoice && (unconfirmed || ambiguousWikidata)) return [];
    if (!ciaChoice) return wdChoice ? [withEvidence(wdChoice, ageCutoff)] : [];
    if (
      !ambiguousCia &&
      (!wdChoice ||
        ambiguousWikidata ||
        (unconfirmed && undated.includes(match)) ||
        ciaChoice.asOf > (wdChoice.asOf ?? wdChoice.since ?? ''))
    ) {
      return [
        withEvidence(
          withIdentity(ciaChoice, match),
          ageCutoff,
          wdChoice && !samePerson(ciaChoice, wdChoice) ? wdChoice : null,
        ),
      ];
    }
    return [
      withEvidence(
        wdChoice,
        ageCutoff,
        samePerson(wdChoice, ciaChoice) ? null : ciaChoice,
      ),
    ];
  });
}
