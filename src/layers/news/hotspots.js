import { isNewSince, newsCategoryColor } from './records.js';

/**
 * Hotspot bubbles: the zoomed-out view of the news layer, one bubble per
 * server-computed hotspot (a country, region, water or unknown place)
 * instead of one pin per story. Pure: the layer supplies the visible pinned
 * stories and positions; markers are SVG data URLs like the pins, and the
 * story count is drawn into the image (no Cesium text label).
 */

/** Bubbles above this camera height (m above the ellipsoid)... */
export const NEWS_BUBBLE_HEIGHT_M = 3_500_000;
/** ...pins below this one; between the two the current mode stays. */
export const NEWS_PIN_HEIGHT_M = 3_000_000;
export const HOTSPOT_CARD_NOTE =
  'Counts stories in the latest digest, not severity. Quiet places may be under-reported.';
const MIN_SIZE_PX = 22;
const MAX_SIZE_PX = 54;
const MAX_SIZE_COUNT = 25;
const EARTH_RADIUS_M = 6_371_000;

/**
 * Pins or bubbles for a camera height, with a dead band so zooming through
 * the threshold does not flicker. An unknown height keeps the current mode.
 * @param {number} heightM
 * @param {'pins'|'bubbles'} current
 */
export function newsMapMode(heightM, current) {
  if (!Number.isFinite(heightM)) return current;
  if (heightM > NEWS_BUBBLE_HEIGHT_M) return 'bubbles';
  if (heightM < NEWS_PIN_HEIGHT_M) return 'pins';
  return current;
}

/** Bubble diameter grows with the square root of its story count. */
export function hotspotSizePx(count) {
  const n = Math.min(MAX_SIZE_COUNT, Math.max(1, count || 0));
  return Math.round(
    MIN_SIZE_PX +
      ((MAX_SIZE_PX - MIN_SIZE_PX) * (Math.sqrt(n) - 1)) /
        (Math.sqrt(MAX_SIZE_COUNT) - 1),
  );
}

function distanceM(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * One bubble per hotspot key over the given stories (the caller passes the
 * visible pinned ones, so filters change the counts and an emptied bubble
 * is simply absent). Largest first.
 * @param {Array<object>} stories Normalized stories with `hotspot`.
 * @param {{categories?: Array<object>, newSinceMs?: ?number, selectedId?: ?string}} [options]
 * @returns {Array<{key: string, label: string, kind: string, lat: number, lon: number, count: number, stories: Array<object>, segments: Array<{category: string, color: string, count: number}>, accent: string, fresh: boolean, selected: boolean, radiusM: number}>}
 */
export function aggregateHotspots(
  stories,
  { categories = [], newSinceMs = null, selectedId = null } = {},
) {
  const groups = new Map();
  for (const story of stories || []) {
    const hotspot = story?.hotspot;
    if (!hotspot?.key) continue;
    let group = groups.get(hotspot.key);
    if (!group) {
      group = { hotspot, stories: [] };
      groups.set(hotspot.key, group);
    }
    group.stories.push(story);
  }
  const order = categories.map((category) => category.id);
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  return [...groups.values()]
    .map(({ hotspot, stories: members }) => {
      const counts = new Map();
      for (const story of members)
        counts.set(story.category, (counts.get(story.category) || 0) + 1);
      const segments = [...counts]
        .sort(([a], [b]) => rank(a) - rank(b))
        .map(([category, count]) => ({
          category,
          color: newsCategoryColor(category, categories),
          count,
        }));
      const largest = segments.reduce((best, segment) =>
        segment.count > best.count ? segment : best,
      );
      const centre = { lat: hotspot.lat, lon: hotspot.lon };
      return {
        key: hotspot.key,
        label: hotspot.label,
        kind: hotspot.kind,
        lat: hotspot.lat,
        lon: hotspot.lon,
        count: members.length,
        stories: [...members].sort(
          (a, b) =>
            (Date.parse(b.updatedAt || '') || 0) -
            (Date.parse(a.updatedAt || '') || 0),
        ),
        segments,
        accent: largest.color,
        fresh: members.some((story) => isNewSince(story, newSinceMs)),
        selected:
          Boolean(selectedId) && members.some((s) => s.id === selectedId),
        radiusM: Math.max(
          0,
          ...members.map((story) => distanceM(centre, story.location)),
        ),
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Marker style for one bubble. */
export function hotspotStyle(bubble) {
  return {
    size: hotspotSizePx(bubble.count),
    count: bubble.count,
    segments: bubble.segments,
    selected: bubble.selected,
    fresh: bubble.fresh,
  };
}

function escapeAttribute(value) {
  return String(value).replace(/[^#0-9a-z]/gi, '');
}

const fixed = (value) => Math.round(value * 100) / 100;

/**
 * One bubble: a dark disc, a ring split by category share (theater order,
 * clockwise from the top), the story count in the centre, a white outline
 * when it holds the selected story and a corner dot when any story is new
 * since the viewer's last visit.
 * @param {{size: number, count: number, segments: Array<{color: string, count: number}>, selected?: boolean, fresh?: boolean}} style
 * @returns {string} SVG data URL.
 */
export function hotspotBubbleImage({
  size,
  count,
  segments,
  selected = false,
  fresh = false,
}) {
  const s = Math.round(size) + 6;
  const c = s / 2;
  const ringWidth = 4;
  const r = Math.round(size) / 2 - ringWidth / 2;
  const total = segments.reduce((sum, segment) => sum + segment.count, 0) || 1;
  const circumference = 2 * Math.PI * r;
  let start = 0;
  const ring = segments
    .map((segment) => {
      const share = segment.count / total;
      const length = circumference * share;
      const dash =
        segments.length === 1
          ? ''
          : ` stroke-dasharray="${fixed(length)} ${fixed(circumference - length)}" stroke-dashoffset="${fixed(-start)}"`;
      start += length;
      return `<circle data-share="${fixed(share)}" cx="${c}" cy="${c}" r="${fixed(r)}" fill="none" stroke="${escapeAttribute(segment.color)}" stroke-width="${ringWidth}"${dash} transform="rotate(-90 ${c} ${c})"/>`;
    })
    .join('');
  const disc = `<circle cx="${c}" cy="${c}" r="${fixed(r)}" fill="#0b1220" fill-opacity="0.82"/>`;
  const outline = `<circle cx="${c}" cy="${c}" r="${fixed(r + ringWidth / 2 + 1)}" fill="none" stroke="${selected ? '#ffffff' : '#0b1220'}" stroke-opacity="${selected ? 1 : 0.85}" stroke-width="${selected ? 2.5 : 1.5}"/>`;
  const label = String(Math.max(0, Math.floor(count) || 0));
  const fontSize = fixed(Math.max(10, size * (label.length > 2 ? 0.3 : 0.4)));
  const text = `<text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="700" fill="#f8fafc">${label}</text>`;
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
 * Overlay-host card for a hovered bubble: place and story count, up to
 * three titles (newest first), and what the count does not mean.
 * @param {object} bubble From aggregateHotspots.
 * @param {{position: object}} context
 */
export function buildHotspotCard(bubble, { position }) {
  const stories = bubble.count === 1 ? '1 story' : `${bubble.count} stories`;
  return {
    id: `hotspot:${bubble.key}`,
    position,
    variant: 'card',
    title: clip(`${bubble.label} · ${stories}`, 72),
    details: [
      ...bubble.stories.slice(0, 3).map((story) => clip(story.title, 72)),
      HOTSPOT_CARD_NOTE,
    ],
    accent: bubble.accent,
    priority: bubble.count,
    selected: false,
    protected: false,
    collisionGroup: 'ambient-card',
    cardStyle: 'tactical',
    gapPx: Math.round(hotspotSizePx(bubble.count) / 2) + 8,
    leaderOffsetPx: 4,
    verticalOnly: true,
    viewportMargin: 4,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    interactive: true,
    accessibilityLabel: `${bubble.label}: ${stories}. Activate to zoom in and list them.`,
  };
}
