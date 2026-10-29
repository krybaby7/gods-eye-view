import { isNewSince, isPinnedStory, newsCategoryColor } from './records.js';

/**
 * Hotspot view: zoomed out, one bubble per hotspot (a country, or a named
 * region or water) instead of one pin per story. The server computes each
 * story's `hotspot` from the theater gazetteer; this module only groups the
 * visible stories and styles the bubbles. Pure.
 */

/** Above this camera height the map draws bubbles. */
export const HOTSPOT_BUBBLE_HEIGHT_M = 3_500_000;
/** Below this camera height the map draws pins; in between the mode stays. */
export const HOTSPOT_PIN_HEIGHT_M = 3_000_000;

const MIN_SIZE_PX = 22;
const MAX_SIZE_PX = 54;
const MAX_SIZE_COUNT = 25;
const EARTH_RADIUS_M = 6_371_000;

/**
 * The map mode for a camera height, with hysteresis between the two
 * thresholds so zooming through them does not flicker.
 * @param {'pins' | 'bubbles'} current
 * @param {number} heightM Camera height above the ellipsoid.
 */
export function nextMapMode(current, heightM) {
  if (!Number.isFinite(heightM)) return current;
  if (heightM > HOTSPOT_BUBBLE_HEIGHT_M) return 'bubbles';
  if (heightM < HOTSPOT_PIN_HEIGHT_M) return 'pins';
  return current;
}

/** Bubble diameter: 22 px for one story, growing with the square root to 54 px at 25. */
export function hotspotSizePx(count) {
  const n = Math.min(MAX_SIZE_COUNT, Math.max(1, count || 0));
  return Math.round(
    MIN_SIZE_PX +
      ((MAX_SIZE_PX - MIN_SIZE_PX) * (Math.sqrt(n) - 1)) /
        (Math.sqrt(MAX_SIZE_COUNT) - 1),
  );
}

/**
 * Group stories into bubbles. Only pinned stories with a hotspot count, so
 * the caller passes the stories its filters leave visible; a hotspot with
 * none has no bubble. Largest bubble first.
 * @param {Array<object>} stories
 * @param {Array<{id: string, color: string}>} categories Theater order.
 * @param {{newSinceMs?: ?number, selectedId?: ?string}} [options]
 */
export function buildHotspots(
  stories,
  categories = [],
  { newSinceMs = null, selectedId = null } = {},
) {
  const groups = new Map();
  for (const story of stories) {
    if (!isPinnedStory(story) || !story.hotspot?.key) continue;
    const group = groups.get(story.hotspot.key);
    if (group) group.stories.push(story);
    else
      groups.set(story.hotspot.key, {
        hotspot: story.hotspot,
        stories: [story],
      });
  }
  const order = new Map(
    categories.map((category, index) => [category.id, index]),
  );
  return [...groups.values()]
    .map(({ hotspot, stories: members }) => {
      const counts = new Map();
      for (const story of members)
        counts.set(story.category, (counts.get(story.category) || 0) + 1);
      const shares = [...counts]
        .map(([category, count]) => ({
          category,
          color: newsCategoryColor(category, categories),
          count,
        }))
        .sort(
          (a, b) =>
            (order.get(a.category) ?? Infinity) -
              (order.get(b.category) ?? Infinity) ||
            a.category.localeCompare(b.category),
        );
      const top = shares.reduce((best, share) =>
        share.count > best.count ? share : best,
      );
      return {
        key: hotspot.key,
        label: hotspot.label,
        kind: hotspot.kind,
        lat: hotspot.lat,
        lon: hotspot.lon,
        count: members.length,
        stories: [...members].sort(
          (a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0),
        ),
        shares,
        topColor: top.color,
        fresh: members.some((story) => isNewSince(story, newSinceMs)),
        selected:
          Boolean(selectedId) && members.some((s) => s.id === selectedId),
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Marker style for one bubble (drawn by `newsHotspotImage`). */
export function hotspotMarkerStyle(bubble) {
  return {
    size: hotspotSizePx(bubble.count),
    count: bubble.count,
    shares: bubble.shares,
    fresh: bubble.fresh,
    selected: bubble.selected,
  };
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

/** Radius enclosing a bubble's stories from the bubble's position, in metres. */
export function hotspotRadiusM(bubble) {
  return Math.max(
    0,
    ...bubble.stories.map((story) => distanceM(bubble, story.location)),
  );
}
