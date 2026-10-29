import { NEWS_VERIFICATION_LABELS } from './records.js';

/**
 * Story pin and card presentation. Pure: positions are supplied by the
 * layer; markers are SVG data URLs, so world text stays in the overlay host.
 */

export const NEWS_OVERLAY_SOURCE_ID = 'news';
export const NEWS_OVERLAY_COHORT_LIMIT = 4;

/** Pin diameter grows with the number of distinct publishers cited. */
export function newsMarkerSizePx(sourceCount) {
  const count = Number.isFinite(sourceCount) ? Math.max(0, sourceCount) : 0;
  return Math.round(Math.min(32, 14 + 4 * Math.log2(1 + count)));
}

function escapeAttribute(value) {
  return String(value).replace(/[^#0-9a-z]/gi, '');
}

/**
 * One story marker: a filled disc, a ring when every source is a party to
 * the conflict, a dashed outline when the model (not the gazetteer) placed
 * it, a white halo when selected, and a small corner dot when the story is
 * new since the viewer's last visit (apart from the verification ring).
 * @param {{color: string, size: number, ring?: boolean, dashed?: boolean, selected?: boolean, fresh?: boolean}} style
 * @returns {string} SVG data URL.
 */
export function newsMarkerImage({
  color,
  size,
  ring = false,
  dashed = false,
  selected = false,
  fresh = false,
}) {
  const s = Math.max(8, Math.round(size)) + 6;
  const c = s / 2;
  const r = Math.max(3, Math.round(size) / 2 - 1);
  const fill = escapeAttribute(color || '#94a3b8');
  const disc = ring
    ? `<circle cx="${c}" cy="${c}" r="${r - 1.5}" fill="${fill}" fill-opacity="0.18" stroke="${fill}" stroke-width="3"/>`
    : `<circle cx="${c}" cy="${c}" r="${r}" fill="${fill}" fill-opacity="0.9"/>`;
  const outline = `<circle cx="${c}" cy="${c}" r="${r + 1.5}" fill="none" stroke="${selected ? '#ffffff' : '#0b1220'}" stroke-opacity="${selected ? 1 : 0.85}" stroke-width="${selected ? 2.5 : 1.5}"${dashed ? ' stroke-dasharray="3 2.5"' : ''}/>`;
  const dot = fresh
    ? `<circle data-fresh="1" cx="${s - 3.5}" cy="3.5" r="2.5" fill="#f8fafc" stroke="#0b1220" stroke-width="1"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${disc}${outline}${dot}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Marker style for a story under its theater's categories. */
export function newsMarkerStyle(story, color, selected = false, fresh = false) {
  return {
    color,
    size: newsMarkerSizePx(story.sourceCount),
    ring: story.verification === 'participant-claim',
    dashed: story.location?.method === 'model',
    selected,
    fresh,
  };
}

/**
 * One hotspot bubble: a dark disc, a ring split by category share (in the
 * order given), the story count in the centre, the pin's white outline when
 * it holds the selected story, and the pin's corner dot when any story is
 * new since the viewer's last visit. The count is part of the image, not a
 * Cesium label: it is the bubble's whole point (as CCTV frames draw text).
 * @param {{size: number, count: number, shares: Array<{color: string, count: number}>, fresh?: boolean, selected?: boolean}} style
 * @returns {string} SVG data URL.
 */
export function newsHotspotImage({
  size,
  count,
  shares = [],
  fresh = false,
  selected = false,
}) {
  const s = Math.max(16, Math.round(size)) + 6;
  const c = s / 2;
  const ringWidth = Math.max(3, Math.round(size / 9));
  const r = Math.round(size) / 2 - ringWidth / 2;
  const total = shares.reduce((sum, share) => sum + share.count, 0);
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const ring = shares
    .map((share) => {
      const length = total ? (circumference * share.count) / total : 0;
      const arc = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${escapeAttribute(share.color || '#94a3b8')}" stroke-width="${ringWidth}" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`;
      offset += length;
      return arc;
    })
    .join('');
  const disc = `<circle cx="${c}" cy="${c}" r="${r}" fill="#0b1220" fill-opacity="0.82"/>`;
  const outline = `<circle cx="${c}" cy="${c}" r="${r + ringWidth / 2 + 1}" fill="none" stroke="${selected ? '#ffffff' : '#0b1220'}" stroke-opacity="${selected ? 1 : 0.85}" stroke-width="${selected ? 2.5 : 1.5}"/>`;
  const label = count > 99 ? '99+' : String(Math.max(0, Math.round(count)));
  const fontSize = Math.round(size * (label.length > 2 ? 0.3 : 0.4));
  const text = `<text x="${c}" y="${c}" dy="0.35em" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${fontSize}" font-weight="700" fill="#f8fafc">${label}</text>`;
  const dot = fresh
    ? `<circle data-fresh="1" cx="${s - 4}" cy="4" r="3" fill="#f8fafc" stroke="#0b1220" stroke-width="1"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${disc}${ring}${outline}${text}${dot}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function clip(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Overlay-host card for a hovered or selected story: title, category,
 * source count and verification label.
 * @param {object} story Normalized story with a location.
 * @param {{position: object, categoryLabel: string, color: string, selected?: boolean}} context
 */
export function buildNewsStoryCard(
  story,
  { position, categoryLabel, color, selected = false },
) {
  const sources =
    story.sourceCount === 1 ? '1 source' : `${story.sourceCount} sources`;
  const label = NEWS_VERIFICATION_LABELS[story.verification] || 'Reported';
  return {
    id: `story:${story.id}`,
    position,
    variant: selected ? 'selected' : 'card',
    title: clip(story.title, 72),
    details: [
      `${categoryLabel} · ${sources}`,
      story.location?.method === 'model' ? `${label} · model-placed` : label,
    ],
    accent: color,
    priority: selected ? Number.MAX_SAFE_INTEGER : story.sourceCount,
    selected,
    protected: selected,
    collisionGroup: 'ambient-card',
    cardStyle: 'tactical',
    gapPx: Math.round(newsMarkerSizePx(story.sourceCount) / 2) + 8,
    leaderOffsetPx: 4,
    verticalOnly: true,
    viewportMargin: 4,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    interactive: true,
    accessibilityLabel: `Story: ${story.title}. ${label}, ${sources}.`,
  };
}

export const NEWS_HOTSPOT_CAVEAT =
  'Counts stories in the latest digest, not severity. Quiet places may be under-reported.';

/**
 * Overlay-host card for a hovered bubble: the place and its story count,
 * up to three story titles (newest first), and what the count means.
 * @param {{key: string, label: string, count: number, stories: Array<{title: string}>}} bubble
 * @param {{position: object, color: string, size: number}} context
 */
export function buildNewsHotspotCard(bubble, { position, color, size }) {
  const stories = bubble.count === 1 ? '1 story' : `${bubble.count} stories`;
  return {
    id: `hotspot:${bubble.key}`,
    position,
    variant: 'card',
    title: clip(`${bubble.label} · ${stories}`, 72),
    details: [
      ...bubble.stories.slice(0, 3).map((story) => clip(story.title, 72)),
      NEWS_HOTSPOT_CAVEAT,
    ],
    accent: color,
    priority: bubble.count,
    selected: false,
    protected: false,
    collisionGroup: 'ambient-card',
    cardStyle: 'tactical',
    gapPx: Math.round(size / 2) + 8,
    leaderOffsetPx: 4,
    verticalOnly: true,
    viewportMargin: 4,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    interactive: true,
    accessibilityLabel: `Hotspot: ${bubble.label}, ${stories}. Opens its stories.`,
  };
}
