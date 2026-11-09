const alliances = new Set(['alliance', 'defence_pact']);
const partnerships = new Set(['diplomatic_partnership', 'defence_cooperation']);

const RIVAL_AGREEMENT = 0.4;
const PARTNER_AGREEMENT = 0.8;

export const DIPLOMACY_RULES =
  'Priority runs from at war through sanctions, ally, rival, partner and neutral. ' +
  'Draft voting anchors are below ' +
  RIVAL_AGREEMENT * 100 +
  '% for rival and ' +
  PARTNER_AGREEMENT * 100 +
  '% or more for partner.';

export const DIPLOMACY_CLASSES = [
  ['at-war', 'At war', [219, 71, 79]],
  ['sanctions', 'Sanctions', [232, 147, 63]],
  ['ally', 'Ally', [61, 161, 234]],
  ['rival', 'Rival', [178, 94, 197]],
  ['partner', 'Partner', [62, 175, 151]],
  ['neutral', 'Neutral', [148, 159, 175]],
];

export function relationPeers(row, actor) {
  const from = row.fromActors?.length ? row.fromActors : [row.from];
  const to = row.toActors?.length ? row.toActors : [row.to];
  if (
    row.from === row.to &&
    (alliances.has(row.type) || partnerships.has(row.type))
  ) {
    // Armenia's treaty participation is frozen. It remains in the instrument card.
    const participants = (row.participants ?? []).filter(
      (id) => row.from !== 'CSTO' || id !== 'ARM',
    );
    return participants.includes(actor)
      ? participants.filter((id) => id !== actor)
      : [];
  }
  return from.includes(actor) ? to : to.includes(actor) ? from : [];
}

export function relationsBetween(from, to, relations) {
  if (!from || !to || from === to) return [];
  return relations.filter(
    (row) => !row.end && relationPeers(row, from).includes(to),
  );
}

export function classifyDiplomacy(from, to, relations) {
  const rows = relationsBetween(from, to, relations);
  if (rows.some(({ type }) => type === 'armed_conflict')) return 'at-war';
  if (rows.some(({ type }) => type === 'sanctions')) return 'sanctions';
  if (rows.some(({ type }) => alliances.has(type))) return 'ally';
  const alignment = rows.reduce((latest, row) => {
    if (row.type !== 'un_alignment' || !Number.isFinite(row.agreement))
      return latest;
    return latest && latest.session >= row.session ? latest : row;
  }, null);
  if (
    alignment?.agreement < RIVAL_AGREEMENT ||
    rows.some(({ type }) => type === 'diplomatic_rupture')
  )
    return 'rival';
  if (
    alignment?.agreement >= PARTNER_AGREEMENT ||
    rows.some(({ type }) => partnerships.has(type))
  )
    return 'partner';
  if (alignment || rows.some(({ type }) => type === 'diplomatic_relation'))
    return 'neutral';
  return null;
}

export function currentRelations(snapshot) {
  return Object.values(snapshot.features ?? {}).flatMap(
    (data) => data?.relations ?? [],
  );
}
