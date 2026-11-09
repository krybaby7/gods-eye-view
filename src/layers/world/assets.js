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

function markerRows(id, feature) {
  if (!feature?.markers) return feature?.rows ?? [];
  const type = id === 'wri-power' ? 'power_plant' : 'airport';
  return feature.markers.map(([id, name, locatedIn, lon, lat, status]) => ({
    id,
    name,
    locatedIn,
    type,
    geometry:
      Number.isFinite(lon) && Number.isFinite(lat)
        ? { type: 'Point', coordinates: [lon, lat] }
        : null,
    status,
  }));
}

export function verifiedOwners(asset) {
  return (asset.owners ?? []).filter(
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
    for (const asset of markerRows(id, features[id])) {
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
      'Fainter lines and outlined markers mark draft evidence',
    ],
    note: snapshot.selected
      ? `${snapshot.selected} · sourced owner or operator home country · hatching means unknown`
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

export function showAssetMarkers(height, lens, selected) {
  if (lens === 'ownership') return Boolean(selected);
  return Number.isFinite(height) && height < 2_000_000;
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
      if (coordinates) {
        const draft =
          asset.reviewed === false ||
          verifiedOwners(asset).some(
            (evidence) =>
              evidence.country === owner && evidence.reviewed === false,
          );
        connections.push({
          asset,
          coordinates,
          approximate: !exact,
          kind,
          draft,
        });
      }
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

function clusterPosition(members) {
  if (members.length === 1) return assetPoint(members[0]);
  const radians = Math.PI / 180;
  const centre = [0, 0, 0];
  const points = members.map((asset) => {
    const [lon, lat] = assetPoint(asset).map((degrees) => degrees * radians);
    const vector = [
      Math.cos(lat) * Math.cos(lon),
      Math.cos(lat) * Math.sin(lon),
      Math.sin(lat),
    ];
    for (let index = 0; index < 3; index++) centre[index] += vector[index];
    return { asset, vector };
  });
  let best;
  let highest = -Infinity;
  for (const { asset, vector } of points) {
    const score = vector.reduce(
      (dot, value, index) => dot + value * centre[index],
      0,
    );
    if (
      score > highest + 1e-12 ||
      (Math.abs(score - highest) <= 1e-12 && asset.id < best.id)
    ) {
      highest = score;
      best = asset;
    }
  }
  return assetPoint(best);
}

export function assetMarkers(snapshot, scale, labelPoint = () => null) {
  const ownership = snapshot.lens === 'ownership';
  if (ownership && !snapshot.selected) return [];
  const focused = new Set(
    assetConnections(snapshot, labelPoint).map(({ asset }) => asset.id),
  );
  const stories = [];
  const approximate = new Map();
  for (const asset of assetCatalog(snapshot).byId.values()) {
    const style = assetKinds[asset.type];
    if (!style || !asset.locatedIn) continue;
    if (
      ownership &&
      asset.locatedIn !== snapshot.selected &&
      !focused.has(asset.id)
    )
      continue;
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
      coordinates: clusterPosition(members),
      members,
      type: first.type,
      owner: owners.size === 1 ? owners.values().next().value : null,
      focus: single && focused.has(first.id),
      closed: members.every(({ status }) => status === 'closed'),
      draft: members.some(({ reviewed }) => reviewed === false),
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
      closed: members.every(({ status }) => status === 'closed'),
      draft: members.some(({ reviewed }) => reviewed === false),
      size: single ? 24 : hotspotSizePx(members.length),
    });
  }
  return markers;
}

export function assetClusterMembers(snapshot, id) {
  const host = /^fallback:([A-Z]{3})$/.exec(id)?.[1];
  if (host) {
    const selected = snapshot.lens === 'ownership' ? snapshot.selected : null;
    return (assetCatalog(snapshot).byHost.get(host) ?? []).filter(
      (asset) =>
        assetKinds[asset.type] &&
        !assetPoint(asset) &&
        (!selected ||
          host === selected ||
          asset.sendingCountry === selected ||
          verifiedOwners(asset).some(({ country }) => country === selected)),
    );
  }
  const scale = /^cluster:(global|regional):/.exec(id)?.[1];
  return scale
    ? (assetMarkers(snapshot, scale).find((marker) => marker.id === id)
        ?.members ?? [])
    : [];
}
