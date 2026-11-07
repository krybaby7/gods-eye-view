import { aggregateHotspots, buildHotspotCard } from '../news/hotspots.js';
import { buildNewsStoryCard, newsMarkerSizePx } from '../news/model.js';
import { NEWS_VERIFICATION_LABELS } from '../news/records.js';
import { FINDING_BASIS, SEARCH_COLORS } from './records.js';

function markerShape(kind, center, radius, attributes) {
  const low = center - radius;
  const high = center + radius;
  if (kind === 'statement')
    return `<rect x="${low}" y="${low}" width="${radius * 2}" height="${radius * 2}" rx="${radius * 0.35}" ${attributes}/>`;
  if (kind === 'place')
    return `<path d="M${center} ${low} ${high} ${center} ${center} ${high} ${low} ${center}Z" ${attributes}/>`;
  return `<circle cx="${center}" cy="${center}" r="${radius}" ${attributes}/>`;
}

export function searchMarkerImage({
  kind,
  colors,
  size,
  dashed = false,
  selected = false,
  fresh = false,
}) {
  const width = Math.max(8, Math.round(size)) + 6;
  const center = width / 2;
  const radius = Math.max(3, Math.round(size) / 2 - 1);
  const palette = colors.filter((color) => /^#[\da-f]{6}$/i.test(color));
  if (!palette.length) palette.push(SEARCH_COLORS[0]);
  const extent = radius + (kind === 'area' ? 1.5 : 0);
  const left = center - extent;
  const stripe = (extent * 2) / palette.length;
  const defs = palette
    .map(
      (_, index) =>
        `<clipPath id="part${index}"><rect x="${left + stripe * index}" y="0" width="${stripe + 0.01}" height="${width}"/></clipPath>`,
    )
    .join('');
  const parts = palette
    .map((color, index) =>
      markerShape(
        kind,
        center,
        radius,
        `clip-path="url(#part${index})" ${kind === 'area' ? `fill="none" stroke="${color}" stroke-width="3"` : `fill="${color}"`}`,
      ),
    )
    .join('');
  const outline = markerShape(
    kind,
    center,
    radius + 1.5,
    `fill="none" stroke="${selected || dashed ? '#f8fafc' : '#0b1220'}" stroke-width="${selected ? 2.5 : 1.5}"${dashed ? ' stroke-dasharray="3 2.5"' : ''}`,
  );
  const dot = fresh
    ? `<circle data-fresh="1" cx="${width - 3.5}" cy="3.5" r="2.5" fill="#f8fafc" stroke="#0b1220" stroke-width="1"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-kind="${kind}" width="${width}" height="${width}" viewBox="0 0 ${width} ${width}"><defs>${defs}</defs>${parts}${outline}${dot}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildSearchMarkers(searches, groupFilters = {}) {
  const byKey = new Map();
  for (const search of searches) {
    if (!search.visible) continue;
    const groupId = groupFilters[search.id];
    const sources = new Map(
      search.sources.map((source) => [source.id, source]),
    );
    for (const finding of search.findings) {
      if (!finding.location || (groupId && finding.groupId !== groupId))
        continue;
      const key = finding.mergeKey ?? `${search.id}:${finding.id}`;
      const members = byKey.get(key) ?? [];
      members.push({
        search,
        finding,
        urls: finding.sourceIds
          .map((id) => sources.get(id)?.canonicalUrl ?? sources.get(id)?.url)
          .filter(Boolean),
      });
      byKey.set(key, members);
    }
  }
  return [...byKey].map(([id, members]) => {
    const { search, finding } = members[0];
    const sourceCount = Math.max(
      new Set(members.flatMap((member) => member.urls)).size,
      ...members.map((member) => member.finding.sourceCount || 0),
    );
    return {
      ...finding,
      id,
      category: search.id,
      members,
      sourceCount,
      colors: [...new Set(members.map((member) => member.search.color))],
      fresh: members.some((member) => member.finding.fresh),
      updatedAt: finding.eventAt || finding.firstSeenAt,
    };
  });
}

export function buildSearchBubbles(markers, searches, selectedId) {
  const categories = searches.map((search) => ({
    id: search.id,
    color: search.color,
  }));
  return aggregateHotspots(markers, { categories, selectedId }).map(
    (bubble) => {
      const counts = new Map();
      for (const marker of bubble.stories) {
        for (const color of marker.colors)
          counts.set(
            color,
            (counts.get(color) || 0) + 1 / marker.colors.length,
          );
      }
      return {
        ...bubble,
        segments: [...counts].map(([color, count]) => ({ color, count })),
        fresh: bubble.stories.some((marker) => marker.fresh),
      };
    },
  );
}

export function searchBubbleCard(bubble, position) {
  const card = buildHotspotCard(bubble, { position });
  const count = `${bubble.count} ${bubble.count === 1 ? 'finding' : 'findings'}`;
  return {
    ...card,
    title: `${bubble.label} · ${count}`,
    details: [
      ...card.details.slice(0, -1),
      'Counts findings. Coverage varies by search.',
    ],
    accessibilityLabel: `${bubble.label}: ${count}. Activate to zoom in and list them.`,
  };
}

export function searchFindingCard(marker, position, selected) {
  const labels = [
    ...new Set(
      marker.members.map(({ search }) => search.label || search.question),
    ),
  ];
  const card = buildNewsStoryCard(marker, {
    position,
    categoryLabel: labels[0],
    color: marker.colors[0],
    selected,
  });
  const basis = FINDING_BASIS[marker.place?.basis];
  const verification = NEWS_VERIFICATION_LABELS[marker.verification];
  const eventTime = Date.parse(marker.eventAt);
  const time =
    Number.isFinite(eventTime) && marker.eventAt.length > 10
      ? new Date(eventTime).toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : marker.eventAt;
  return {
    ...card,
    id: `finding:${marker.id}`,
    details: [
      `${labels.join(' · ')} · ${marker.kind}`,
      [marker.location.name || marker.place?.name, basis]
        .filter(Boolean)
        .join(' · '),
      [
        time,
        `${marker.sourceCount} ${marker.sourceCount === 1 ? 'source' : 'sources'}`,
        verification,
        marker.location.method === 'model' && 'Model-placed',
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    accessibilityLabel: `${marker.title}. ${labels.join(', ')}. ${marker.kind}.`,
  };
}

export function markerImage(marker, selected) {
  return searchMarkerImage({
    kind: marker.kind,
    colors: marker.colors,
    size: newsMarkerSizePx(marker.sourceCount),
    dashed: marker.location.method === 'model',
    selected,
    fresh: marker.fresh,
  });
}
