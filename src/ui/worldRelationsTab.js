import {
  classifyDiplomacy,
  currentRelations,
  isDocumentedRivalry,
  relationPeers,
  supportDyadSummary,
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

function relationsTab({ document, snapshot, sheetModel, openCard }) {
  const panel = document.createElement('div');
  panel.className = 'world-relations';
  const selected = sheetModel.iso3;
  const rows = currentRelations(snapshot).filter(
    (row) =>
      (!row.end || ['armed_conflict', 'support_to_party'].includes(row.type)) &&
      (relationPeers(row, selected).length ||
        row.participants?.includes(selected)),
  );
  const names = new Map(
    snapshot.countryIndex.map(({ iso3, name }) => [iso3, name]),
  );
  const counterpart = (row) =>
    relationPeers(row, selected)[0] ??
    (row.from === selected ? row.to : row.from);
  const name = (row) => {
    const other = names.get(counterpart(row)) ?? counterpart(row);
    const opposingSide =
      row.from === selected || row.fromActors?.includes(selected)
        ? row.toLabel
        : row.fromLabel;
    const support = supportDyadSummary(row);
    if (support) return (opposingSide ?? other) + ' · ' + support;
    if (row.type === 'un_alignment') {
      return (
        'UN voting closeness: ' +
        (row.agreement * 100).toFixed(1) +
        '% · ' +
        other +
        ' · ' +
        row.period +
        ' (session ' +
        row.session +
        ')'
      );
    }
    if (row.type === 'diplomatic_relation')
      return other + ' · ' + (row.start ?? 'Undated');
    if (row.membershipStatus === 'suspended')
      return other + ' · participation suspended';
    if (row.type === 'sanctions' && row.scope === 'persons') {
      return (
        'Sanctions on persons in ' +
        (names.get(row.to) ?? row.to) +
        ' · ' +
        row.programme
      );
    }
    return (
      row.territory ??
      row.instrument ??
      row.programme ??
      row.title ??
      opposingSide ??
      other
    );
  };
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
          (row) => counterpart(row) === id && isDocumentedRivalry(row),
        );
        return candidates.slice(0, 1);
      }),
    ],
    [
      'Current armed conflict',
      rows.filter(({ type }) => type === 'current_armed_conflict'),
    ],
    [
      'Armed conflict in 2025 (UCDP)',
      rows.filter(({ type }) => type === 'armed_conflict'),
    ],
    [
      'Support to a party in 2025 (UCDP)',
      rows.filter(({ type }) => type === 'support_to_party'),
    ],
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
    [
      'UN voting closeness',
      rows
        .filter(({ type }) => type === 'un_alignment')
        .sort((a, b) =>
          (names.get(counterpart(a)) ?? counterpart(a)).localeCompare(
            names.get(counterpart(b)) ?? counterpart(b),
          ),
        ),
    ],
    [
      'Diplomatic relations',
      rows.filter(({ type, id }) => type === 'diplomatic_relation' && id),
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

export function renderRelationsTab(context) {
  const { document, getDetail, snapshot, sheetModel } = context;
  const panel = relationsTab(context);
  if (!getDetail) return panel;
  getDetail(sheetModel.iso3, 'diplomacy')
    .then(({ features }) => {
      const content = relationsTab({
        ...context,
        snapshot: {
          ...snapshot,
          features: { ...snapshot.features, ...features },
        },
      });
      panel.replaceChildren(...content.childNodes);
    })
    .catch(() => {
      const message = document.createElement('p');
      message.className = 'world-detail';
      message.textContent = 'Additional relations data is unavailable.';
      panel.append(message);
    });
  return panel;
}
