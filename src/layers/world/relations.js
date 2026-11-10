const alliances = new Set(['alliance', 'defence_pact']);
const partnerships = new Set(['diplomatic_partnership', 'defence_cooperation']);

const DAY = 86_400_000;

export const DIPLOMACY_RULES =
  'Priority runs from at war through sanctions, ally, rival, partner and neutral. ' +
  'Current armed conflict requires a dated UCDP event between the two states in the past 90 days. ' +
  'Sanctions colour applies to state measures. UN voting is shown separately.';

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
      (id) =>
        (row.from !== 'CSTO' || id !== 'ARM') &&
        !row.inactiveParticipants?.includes(id),
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

function currentEvent(event, today) {
  const date = Date.parse(event?.date);
  const source = URL.parse(event?.sourceUrl ?? '');
  return (
    event?.id != null &&
    event.id !== '' &&
    Number.isFinite(date) &&
    new Date(date).toISOString().slice(0, 10) === event.date &&
    today - date >= 0 &&
    today - date <= 90 * DAY &&
    source?.origin === 'https://ucdp.uu.se'
  );
}

function dayStart(now) {
  return Math.floor(new Date(now).getTime() / DAY) * DAY;
}

export function isDocumentedRivalry({ type, sources, hostilityOn }) {
  if (type === 'rivalry') return Boolean(sources?.length);
  return (
    type === 'diplomatic_rupture' &&
    sources?.length >= 2 &&
    /^\d{4}-\d{2}-\d{2}$/.test(hostilityOn) &&
    hostilityOn >= '2023-01-01'
  );
}

export function classifyDiplomacy(from, to, relations, now = Date.now()) {
  const rows = relationsBetween(from, to, relations);
  const today = dayStart(now);
  if (
    rows.some(
      (row) =>
        row.type === 'current_armed_conflict' &&
        [row.from, row.to].includes(from) &&
        [row.from, row.to].includes(to) &&
        row.events?.some(
          (event) =>
            currentEvent(event, today) &&
            ((event.a === from && event.b === to) ||
              (event.b === from && event.a === to)),
        ),
    )
  )
    return 'at-war';
  if (rows.some(({ type, scope }) => type === 'sanctions' && scope === 'state'))
    return 'sanctions';
  if (rows.some(({ type }) => alliances.has(type))) return 'ally';
  if (rows.some(isDocumentedRivalry)) return 'rival';
  if (
    rows.some(({ type, sources }) => partnerships.has(type) && sources?.length)
  )
    return 'partner';
  if (rows.some(({ type }) => type === 'diplomatic_relation')) return 'neutral';
  return null;
}

export function currentRelations(snapshot, now = Date.now()) {
  const features = snapshot.features ?? {};
  const relations = Object.values(features).flatMap(
    (data) => data?.relations ?? [],
  );
  for (const [from, to] of features['relations-diplomatic']?.pairs ?? []) {
    relations.push({ type: 'diplomatic_relation', from, to });
  }
  const pairs = new Map();
  const today = dayStart(now);
  for (const event of features['live-ucdp-saved']?.bilateralEvents ?? []) {
    if (
      !currentEvent(event, today) ||
      event.a === event.b ||
      !/^[A-Z]{3}$/.test(event.a) ||
      !/^[A-Z]{3}$/.test(event.b)
    )
      continue;
    const [from, to] = [event.a, event.b].sort();
    const id = 'rel_ucdp_live_' + from + '_' + to;
    if (!pairs.has(id))
      pairs.set(id, {
        id,
        type: 'current_armed_conflict',
        from,
        to,
        events: [],
        title: 'Current armed conflict (UCDP)',
        detail: 'Reported state-on-state fighting within the past 90 days.',
        sources: [],
      });
    const row = pairs.get(id);
    if (row.events.some(({ id }) => id === event.id)) continue;
    row.events.push(event);
    if (!row.sources.includes(event.sourceUrl))
      row.sources.push(event.sourceUrl);
  }
  return [...relations, ...pairs.values()];
}
