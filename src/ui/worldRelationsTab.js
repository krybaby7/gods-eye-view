import {
  classifyDiplomacy,
  currentRelations,
  relationPeers,
} from '../layers/world/relations.js';

function section(document, label, rows, openCard, name, peers) {
  const node = document.createElement('section');
  const heading = document.createElement('h3');
  heading.className = 'world-kicker';
  heading.textContent = label;
  node.append(heading);
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'world-detail';
    empty.textContent = 'No documented entries in the loaded sources.';
    node.append(empty);
    return node;
  }
  const list = document.createElement('ul');
  for (const row of rows) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.worldRelation = row.id;
    button.textContent = name(row);
    button.addEventListener('click', () => openCard('relation', row.id));
    item.append(button);
    if (label === 'Allies' && row.from === row.to) {
      const allies = document.createElement('span');
      allies.className = 'world-relation-peers world-detail';
      allies.textContent = peers(row).join(' · ');
      button.append(allies);
    }
    if (row.reviewed === false) {
      const badge = document.createElement('span');
      badge.className = 'world-detail';
      badge.textContent = 'Draft, not yet reviewed';
      item.append(badge);
    }
    list.append(item);
  }
  node.append(list);
  return node;
}

export function renderRelationsTab({
  document,
  snapshot,
  sheetModel,
  openCard,
}) {
  const panel = document.createElement('div');
  panel.className = 'world-relations';
  const selected = sheetModel.iso3;
  const rows = currentRelations(snapshot).filter(
    (row) =>
      (!row.end || row.type === 'armed_conflict') &&
      (relationPeers(row, selected).length ||
        row.participants?.includes(selected)),
  );
  const names = new Map(
    snapshot.countryIndex.map(({ iso3, name }) => [iso3, name]),
  );
  const counterpart = (row) =>
    relationPeers(row, selected)[0] ??
    (row.from === selected ? row.to : row.from);
  const name = (row) =>
    row.territory ??
    row.instrument ??
    row.programme ??
    row.title ??
    (row.from === selected ? row.toLabel : row.fromLabel) ??
    names.get(counterpart(row)) ??
    counterpart(row);
  const rivals = new Set();
  for (const row of rows) {
    const other = counterpart(row);
    if (
      names.has(other) &&
      classifyDiplomacy(selected, other, rows) === 'rival'
    )
      rivals.add(other);
  }
  const groups = [
    [
      'Allies',
      rows.filter(
        (row) =>
          ['alliance', 'defence_pact'].includes(row.type) &&
          relationPeers(row, selected).length,
      ),
    ],
    ['Blocs', rows.filter(({ type }) => type === 'bloc_membership')],
    [
      'Rivals',
      [...rivals].flatMap((id) => {
        const candidates = rows.filter(
          (row) =>
            counterpart(row) === id &&
            ['un_alignment', 'diplomatic_rupture'].includes(row.type),
        );
        return candidates
          .sort(
            (a, b) =>
              Number(b.type === 'diplomatic_rupture') -
                Number(a.type === 'diplomatic_rupture') ||
              (b.session ?? 0) - (a.session ?? 0),
          )
          .slice(0, 1);
      }),
    ],
    ['Wars', rows.filter(({ type }) => type === 'armed_conflict')],
    [
      'Sanctions imposed',
      rows.filter(
        ({ type, from }) => type === 'sanctions' && from === selected,
      ),
    ],
    [
      'Sanctions received',
      rows.filter(({ type, to }) => type === 'sanctions' && to === selected),
    ],
    [
      'Partnerships',
      rows.filter(({ type }) =>
        ['diplomatic_partnership', 'defence_cooperation'].includes(type),
      ),
    ],
    [
      'Territorial disputes',
      rows.filter(({ type }) => type === 'territorial_dispute'),
    ],
  ];
  panel.append(
    ...groups.map(([label, items]) =>
      section(document, label, items, openCard, name, (row) =>
        relationPeers(row, selected).map((id) => names.get(id) ?? id),
      ),
    ),
  );
  return panel;
}
