import { aggregateHotspots, hotspotSizePx } from '../news/hotspots.js';

export const assetKinds = {
  power_plant: { label: 'Power plant', glyph: '↯', color: '#f3b665' },
  nuclear_plant: { label: 'Nuclear power plant', glyph: '☢', color: '#d8e880' },
  port: { label: 'Port', glyph: '⚓', color: '#76d9e4' },
  airport: { label: 'Airport', glyph: '✈', color: '#9abfff' },
  spaceport: { label: 'Launch site', glyph: '▲', color: '#d7aff7' },
  fab: { label: 'Semiconductor fab', glyph: '▦', color: '#82dec1' },
  military_base: { label: 'Military base', glyph: '◆', color: '#f2a597' },
};

const categories = Object.entries(assetKinds).map(([id, { label, color }]) => ({
  id,
  label,
  color,
}));
const sourceIds = [
  'wri-power',
  'wikidata-assets',
  'nga-ports',
  'ourairports',
  'curated-assets',
];
const palette = [
  '#68e1dc',
  '#f6bd6e',
  '#8aafff',
  '#e8a7ff',
  '#a5df85',
  '#ff9b94',
];
const cache = new WeakMap();
const EMPTY = {};

function addToIndex(index, key, asset) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(asset);
}

export function verifiedOwners(asset) {
  return asset.reviewed === false
    ? []
    : (asset.owners ?? []).filter(
        (owner) =>
          owner.verified === true && /^[A-Z]{3}$/.test(owner.country ?? ''),
      );
}

export function assetCatalog(snapshot) {
  const features = snapshot.features ?? EMPTY;
  const loaded = cache.get(features);
  if (loaded) return loaded;
  const byId = new Map();
  const byHost = new Map();
  const byOwner = new Map();
  const bySendingCountry = new Map();
  for (const id of sourceIds) {
    for (const asset of features[id]?.rows ?? []) {
      if (byId.has(asset.id)) continue;
      byId.set(asset.id, asset);
      if (asset.locatedIn) addToIndex(byHost, asset.locatedIn, asset);
      if (asset.sendingCountry && asset.sendingCountry !== asset.locatedIn)
        addToIndex(bySendingCountry, asset.sendingCountry, asset);
      for (const country of new Set(
        verifiedOwners(asset).map((owner) => owner.country),
      )) {
        if (asset.locatedIn && asset.locatedIn !== country)
          addToIndex(byOwner, country, asset);
      }
    }
  }
  const catalog = {
    byId,
    byHost,
    byOwner,
    bySendingCountry,
    nuclearBadges: features['curated-assets']?.nuclearBadges ?? [],
  };
  cache.set(features, catalog);
  return catalog;
}

export function ownedAbroad(snapshot, country) {
  return assetCatalog(snapshot).byOwner.get(country) ?? [];
}

export function ownerColor(iso3) {
  const index = [...iso3].reduce(
    (value, c) => (value * 31 + c.charCodeAt(0)) % palette.length,
    0,
  );
  return palette[index];
}

export function ownershipColor(country, snapshot) {
  const hosts = ownedAbroad(snapshot, snapshot.selected);
  return hosts.some(({ locatedIn }) => locatedIn === country.iso3)
    ? [81, 155, 212]
    : null;
}

export const ownershipLens = {
  id: 'ownership',
  label: 'Ownership',
  order: 60,
  color: ownershipColor,
  legend: (snapshot) => ({
    name: 'Ownership',
    stops: [
      'Documented foreign ownership',
      'Grey dashes mark documented military presence',
      'Dotted lines and ? markers show exact site unknown',
    ],
    note: snapshot.selected
      ? `${snapshot.selected} · verified owner evidence · hatching means unknown`
      : 'Select a country to show its documented assets abroad',
  }),
  hover(country, snapshot) {
    if (!country || country.kind === 'disputed') return undefined;
    const count = ownedAbroad(snapshot, snapshot.selected).filter(
      ({ locatedIn }) => locatedIn === country.iso3,
    ).length;
    return count
      ? `${count} documented owned asset${count === 1 ? '' : 's'} abroad`
      : 'Ownership · Unknown';
  },
};

export function boardAssetScale(height, current) {
  if (height > 10_000_000) return 'global';
  if (height < 9_000_000) return 'regional';
  return current;
}

export function assetPoint(asset) {
  if (asset.geometry?.type !== 'Point') return null;
  const [lon, lat] = asset.geometry.coordinates ?? [];
  return Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    Math.abs(lon) <= 180 &&
    Math.abs(lat) <= 90
    ? [lon, lat]
    : null;
}

function countryPoint(iso3, labelPoint) {
  const point = labelPoint(iso3);
  return point ? [point.lon, point.lat] : null;
}

export function assetConnections(snapshot, labelPoint) {
  if (snapshot.lens !== 'ownership' || !snapshot.selected) return [];
  const owner = snapshot.selected;
  const holdings = ownedAbroad(snapshot, owner);
  const holdingIds = new Set(holdings.map(({ id }) => id));
  const presence = (
    assetCatalog(snapshot).bySendingCountry.get(owner) ?? []
  ).filter(
    (asset) => asset.status === 'operating' && !holdingIds.has(asset.id),
  );
  const connections = [];
  for (const [assets, kind] of [
    [holdings, 'ownership'],
    [presence, 'presence'],
  ]) {
    for (const asset of assets) {
      const exact = assetPoint(asset);
      const coordinates = exact ?? countryPoint(asset.locatedIn, labelPoint);
      if (coordinates)
        connections.push({ asset, coordinates, approximate: !exact, kind });
    }
  }
  return connections;
}

function markerOwner(asset, selected) {
  const owners = verifiedOwners(asset);
  return (
    owners.find((owner) => owner.country === selected)?.country ??
    owners[0]?.country ??
    null
  );
}

export function assetMarkers(snapshot, scale, labelPoint = () => null) {
  const ownership = snapshot.lens === 'ownership';
  const focused = new Set(
    assetConnections(snapshot, labelPoint).map(({ asset }) => asset.id),
  );
  const stories = [];
  const approximate = new Map();
  for (const asset of assetCatalog(snapshot).byId.values()) {
    const style = assetKinds[asset.type];
    if (!style || !asset.locatedIn) continue;
    const position = assetPoint(asset);
    if (!position) {
      addToIndex(approximate, asset.locatedIn, asset);
      continue;
    }
    const [lon, lat] = position;
    const countryType = `${asset.locatedIn}:${asset.type}`;
    const group = focused.has(asset.id)
      ? `individual:${asset.id}`
      : scale === 'global'
        ? countryType
        : `${countryType}:${Math.floor((lon + 180) / 3)}:${Math.floor((lat + 90) / 3)}`;
    stories.push({
      id: asset.id,
      asset,
      category: asset.type,
      location: { lon, lat },
      hotspot: {
        key: group,
        label: `${asset.locatedIn} · ${style.label}`,
        kind: 'asset',
        lon,
        lat,
      },
    });
  }

  const markers = aggregateHotspots(stories, { categories }).map((group) => {
    const members = group.stories.map(({ asset }) => asset);
    const single = members.length === 1;
    const first = members[0];
    const owners = ownership
      ? new Set(members.map((asset) => markerOwner(asset, snapshot.selected)))
      : new Set();
    return {
      id: single ? first.id : `cluster:${scale}:${group.key}`,
      coordinates: [group.lon, group.lat],
      members,
      type: first.type,
      owner: owners.size === 1 ? owners.values().next().value : null,
      focus: single && focused.has(first.id),
      size: single ? 24 : hotspotSizePx(members.length),
    };
  });
  for (const [host, members] of approximate) {
    const coordinates = countryPoint(host, labelPoint);
    if (!coordinates) continue;
    const first = members[0];
    const single = members.length === 1;
    markers.push({
      id: single ? first.id : `fallback:${host}`,
      coordinates,
      members,
      type: first.type,
      approximate: true,
      owner: ownership && single ? markerOwner(first, snapshot.selected) : null,
      focus: members.some(({ id }) => focused.has(id)),
      size: single ? 24 : hotspotSizePx(members.length),
    });
  }
  return markers;
}

export function assetClusterMembers(snapshot, id) {
  const host = /^fallback:([A-Z]{3})$/.exec(id)?.[1];
  if (host)
    return (assetCatalog(snapshot).byHost.get(host) ?? []).filter(
      (asset) => assetKinds[asset.type] && !assetPoint(asset),
    );
  const scale = /^cluster:(global|regional):/.exec(id)?.[1];
  return scale
    ? (assetMarkers(snapshot, scale).find((marker) => marker.id === id)
        ?.members ?? [])
    : [];
}
