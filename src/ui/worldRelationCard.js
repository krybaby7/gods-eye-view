import {
  currentRelations,
  DIPLOMACY_RULES,
} from '../layers/world/relations.js';

function text(document, tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function relationCard({ document, snapshot, id }) {
  const card = document.createElement('article');
  card.className = 'world-relation-card';
  const row = currentRelations(snapshot).find((entry) => entry.id === id);
  if (!row) {
    card.textContent = 'This relation is unavailable in the current turn.';
    return card;
  }
  const names = new Map(
    snapshot.countryIndex.map(({ iso3, name }) => [iso3, name]),
  );
  const side = (key) => row[key + 'Label'] ?? names.get(row[key]) ?? row[key];
  const parties =
    row.from === row.to && row.participants?.length
      ? row.participants.map((actor) => names.get(actor) ?? actor).join(' · ')
      : [side('from'), side('to')].join(row.directed ? ' → ' : ' ↔ ');
  card.append(
    text(
      document,
      'h3',
      (row.type === 'armed_conflict'
        ? 'Armed conflict in ' + row.period + ' (UCDP)'
        : null) ??
        row.territory ??
        row.instrument ??
        row.programme ??
        row.title ??
        row.type.replaceAll('_', ' '),
      'world-kicker',
    ),
    text(document, 'p', parties),
    text(document, 'p', row.detail),
  );
  for (const value of [
    row.conditions,
    row.reference,
    row.start
      ? 'Start ' + row.start
      : row.type === 'diplomatic_relation' && !row.end
        ? 'Undated'
        : null,
    row.end ? 'End ' + row.end : null,
    row.session
      ? 'UN voting session ' + row.session + ' · ' + row.period
      : null,
    Number.isFinite(row.agreement)
      ? 'UN voting closeness: ' + (row.agreement * 100).toFixed(1) + '%'
      : null,
    row.scope === 'persons' ? 'Sanctions on persons in ' + side('to') : null,
    ...(row.events ?? []).map(
      ({ id, date }) => 'UCDP event ' + id + ' · ' + date,
    ),
    row.dateChecked ? 'Checked ' + row.dateChecked : null,
    row.reviewed === false ? 'Draft, not yet reviewed' : null,
  ]) {
    if (value) card.append(text(document, 'p', value, 'world-detail'));
  }
  const list = document.createElement('ul');
  for (const source of row.sources ?? []) {
    const url = URL.parse(source);
    if (url?.protocol !== 'https:') continue;
    const item = document.createElement('li');
    const link = text(document, 'a', url.hostname);
    link.href = url.href;
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
    item.append(link);
    list.append(item);
  }
  card.append(
    text(document, 'h4', 'Sources', 'world-kicker'),
    list,
    text(document, 'p', DIPLOMACY_RULES, 'world-detail'),
  );
  return card;
}

export function renderRelationCard(context) {
  const { getDetail, snapshot, id } = context;
  const card = relationCard(context);
  if (!getDetail || !snapshot.selected || id.startsWith('rel_ucdp_live_'))
    return card;
  getDetail(snapshot.selected, 'diplomacy')
    .then(({ features }) => {
      const content = relationCard({
        ...context,
        snapshot: {
          ...snapshot,
          features: { ...snapshot.features, ...features },
        },
      });
      card.replaceChildren(...content.childNodes);
    })
    .catch(() => {});
  return card;
}
