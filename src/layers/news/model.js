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
 * it, a white halo when selected.
 * @param {{color: string, size: number, ring?: boolean, dashed?: boolean, selected?: boolean}} style
 * @returns {string} SVG data URL.
 */
export function newsMarkerImage({
  color,
  size,
  ring = false,
  dashed = false,
  selected = false,
}) {
  const s = Math.max(8, Math.round(size)) + 6;
  const c = s / 2;
  const r = Math.max(3, Math.round(size) / 2 - 1);
  const fill = escapeAttribute(color || '#94a3b8');
  const disc = ring
    ? `<circle cx="${c}" cy="${c}" r="${r - 1.5}" fill="${fill}" fill-opacity="0.18" stroke="${fill}" stroke-width="3"/>`
    : `<circle cx="${c}" cy="${c}" r="${r}" fill="${fill}" fill-opacity="0.9"/>`;
  const outline = `<circle cx="${c}" cy="${c}" r="${r + 1.5}" fill="none" stroke="${selected ? '#ffffff' : '#0b1220'}" stroke-opacity="${selected ? 1 : 0.85}" stroke-width="${selected ? 2.5 : 1.5}"${dashed ? ' stroke-dasharray="3 2.5"' : ''}/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${disc}${outline}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Marker style for a story under its theater's categories. */
export function newsMarkerStyle(story, color, selected = false) {
  return {
    color,
    size: newsMarkerSizePx(story.sourceCount),
    ring: story.verification === 'participant-claim',
    dashed: story.location?.method === 'model',
    selected,
  };
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
