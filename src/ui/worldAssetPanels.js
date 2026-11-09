import {
  assetCatalog,
  assetClusterMembers,
  assetKinds,
  assetPoint,
  ownedAbroad,
  verifiedOwners,
} from '../layers/world/assets.js';

const draft = 'Draft, not yet reviewed';
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function element(document, tag, content, className) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function link(document, url, label) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  const node = element(document, 'a', label);
  node.href = url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

function details(document, pairs) {
  const list = element(document, 'dl', null, 'world-asset-details');
  for (const [key, value] of pairs) {
    list.append(
      element(document, 'dt', key),
      element(document, 'dd', value ?? 'Unknown'),
    );
  }
  return list;
}

function countryName(snapshot, iso3) {
  return snapshot.countries?.[iso3]?.name ?? iso3;
}

function assetLabel(asset) {
  return assetKinds[asset.type]?.label ?? asset.type;
}

function assetList({ document, snapshot, openCard }, assets) {
  const list = element(document, 'ul', null, 'world-asset-list');
  const sorted = [...assets].sort((a, b) => a.name.localeCompare(b.name));
  for (const asset of sorted) {
    const row = element(document, 'li');
    const button = element(
      document,
      'button',
      asset.name,
      'world-asset-select',
    );
    button.type = 'button';
    button.addEventListener('click', () => openCard('asset', asset.id));
    const summary = [
      assetLabel(asset),
      countryName(snapshot, asset.locatedIn),
      !assetPoint(asset) && 'Map location unavailable',
      asset.historical && 'Historical',
      asset.reviewed === false && draft,
    ].filter(Boolean);
    row.append(
      button,
      element(document, 'span', summary.join(' · '), 'world-asset-meta'),
    );
    list.append(row);
  }
  return list;
}

function assetSection(context, heading, assets, empty) {
  const { document } = context;
  const section = element(document, 'section', null, 'world-asset-section');
  section.append(
    element(
      document,
      'h3',
      assets.length ? `${heading} · ${number.format(assets.length)}` : heading,
    ),
  );
  if (assets.length <= 12) {
    section.append(
      assets.length
        ? assetList(context, assets)
        : element(document, 'p', empty, 'world-asset-meta'),
    );
    return section;
  }
  const grouped = new Map();
  for (const asset of assets) {
    const label = assetLabel(asset);
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(asset);
  }
  for (const [label, group] of [...grouped.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const disclosure = element(
      document,
      'details',
      null,
      'world-asset-disclosure',
    );
    disclosure.append(
      element(document, 'summary', `${label} · ${number.format(group.length)}`),
    );
    function show() {
      if (!disclosure.open) return;
      disclosure.append(assetList(context, group));
      disclosure.removeEventListener('toggle', show);
    }
    disclosure.addEventListener('toggle', show);
    section.append(disclosure);
  }
  return section;
}

export function renderAssetsTab(context) {
  const { document, snapshot, sheetModel } = context;
  const { iso3 } = sheetModel;
  const { byHost, bySendingCountry } = assetCatalog(snapshot);
  const content = element(document, 'div', null, 'world-assets');
  content.append(
    assetSection(
      context,
      'Assets at home',
      byHost.get(iso3) ?? [],
      'No asset records available here.',
    ),
    assetSection(
      context,
      'Verified assets owned abroad',
      ownedAbroad(snapshot, iso3),
      'Documented foreign ownership is unknown.',
    ),
  );
  const presence = bySendingCountry.get(iso3);
  if (presence?.length) {
    content.append(
      assetSection(
        context,
        'Military presence abroad',
        presence,
        'Foreign military presence is unknown.',
      ),
    );
  }
  return content;
}

function ownerText(owner) {
  const share = Number.isFinite(owner.share)
    ? `${number.format(owner.share * 100)}%`
    : null;
  return [owner.actor, owner.country, share].filter(Boolean).join(' · ');
}

export function renderAssetCard(context) {
  const { document, snapshot, id } = context;
  const root = element(document, 'section', null, 'world-assets');
  root.dataset.worldAsset = id;
  const asset = assetCatalog(snapshot).byId.get(id);
  if (!asset) {
    const cluster = assetClusterMembers(snapshot, id);
    if (cluster.length)
      root.append(
        assetSection(
          context,
          assetLabel(cluster[0]) + ' cluster',
          cluster,
          'No mapped members.',
        ),
      );
    else root.append(element(document, 'p', 'Asset record unavailable.'));
    return root;
  }

  root.append(element(document, 'h3', asset.name));
  root.append(element(document, 'p', assetLabel(asset), 'world-asset-meta'));
  if (asset.reviewed === false)
    root.append(element(document, 'p', draft, 'world-asset-draft'));
  if (asset.historical)
    root.append(
      element(
        document,
        'p',
        asset.sourceVersion ?? 'Historical source',
        'world-asset-meta',
      ),
    );
  const owners = verifiedOwners(asset);
  const reported = (asset.owners ?? []).filter(
    (owner) => !owners.includes(owner),
  );
  const pairs = [
    ['Host location', countryName(snapshot, asset.locatedIn)],
    ['Legal jurisdiction', countryName(snapshot, asset.jurisdiction)],
    ['Legal owner', owners.length ? owners.map(ownerText).join(' / ') : null],
    ['Operator', asset.operator],
    [
      'Status',
      asset.status
        ? asset.status.charAt(0).toUpperCase() + asset.status.slice(1)
        : null,
    ],
    ['Map location', assetPoint(asset) ? 'Source coordinates' : 'Unavailable'],
    ['Licence', asset.licence],
    ['Date checked', asset.lastVerified],
  ];
  if (asset.statusAsOf)
    pairs.push(['Status reference period', asset.statusAsOf]);
  if (asset.sendingCountry)
    pairs.push([
      'Sending military',
      countryName(snapshot, asset.sendingCountry),
    ]);
  if (asset.basis) pairs.push(['Basis for military presence', asset.basis]);
  if (asset.capacity)
    pairs.push([
      'Reported capacity',
      `${number.format(asset.capacity.value)} ${asset.capacity.unit}`,
    ]);
  if (reported.length)
    pairs.push([
      asset.historical
        ? 'Reported historical owner'
        : 'Reported owner awaiting verification',
      reported.map(ownerText).join(' / '),
    ]);
  if (asset.reportedGroup)
    pairs.push([
      'Reported group affiliation',
      ownerText({
        actor: asset.reportedGroup.name,
        country: asset.reportedGroup.country,
        share: asset.reportedGroup.share,
      }),
    ]);
  root.append(details(document, pairs));
  if (asset.statusDetail)
    root.append(element(document, 'p', asset.statusDetail, 'world-asset-meta'));

  const publisher =
    snapshot.sources?.find(({ id }) => id === asset.source)?.name ??
    'Primary source';
  const links = [
    link(
      document,
      asset.sourceUrl,
      asset.sourceLocator ? `${publisher} · ${asset.sourceLocator}` : publisher,
    ),
    link(document, asset.operatorSourceUrl, 'Operator source'),
    link(document, asset.operatorReferenceUrl, 'Operator reference'),
    ...owners.map((owner) =>
      link(document, owner.sourceUrl, `Ownership evidence · ${owner.actor}`),
    ),
  ].filter(Boolean);
  if (links.length) {
    const list = element(document, 'ul', null, 'world-asset-sources');
    for (const reference of links) {
      const item = element(document, 'li');
      item.append(reference);
      list.append(item);
    }
    root.append(list);
  }
  return root;
}

export function renderNuclearBadge({ document, snapshot, sheetModel }) {
  const badge = assetCatalog(snapshot).nuclearBadges.find(
    ({ countryCode, nuclearArmed }) =>
      countryCode === sheetModel?.iso3 && nuclearArmed,
  );
  if (!badge) return null;
  const node = element(document, 'div', null, 'world-asset-badge');
  node.append(element(document, 'span', `Nuclear-armed · ${badge.asOf}`));
  if (badge.reviewed === false)
    node.append(element(document, 'span', draft, 'world-asset-draft'));
  const reference = link(
    document,
    badge.sourceUrl,
    'Federation of American Scientists',
  );
  if (reference) node.append(reference);
  return node;
}
