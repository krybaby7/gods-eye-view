import { createHash } from 'node:crypto';

import { greatCircleKm, resolvePlace } from '../geocode.js';
import { canonicalizeUrl } from '../store.js';

/**
 * Code-owned story fields. Pure functions: the model never sets location,
 * perspectives, source count or verification; these derive them from the
 * gazetteer and the cited items only.
 */

export const VERIFICATION_LABELS = Object.freeze([
  'participant-claim',
  'reported',
  'corroborated',
  'disputed',
]);
export const CORROBORATING_KINDS = Object.freeze([
  'independent',
  'humanitarian',
  'verification',
]);
const PARTICIPANT_KINDS = new Set(['participant', 'state']);
export const STORY_STALE_MS = 48 * 3600_000;
export const OPEN_STORY_CAP = 60;
/**
 * A gazetteer match farther than this from the model's own coordinates is a
 * namesake (Toledo, Ohio for Toledo, Spain): the model's point is kept.
 */
export const FAR_MATCH_KM = 500;

function groupOf(item, perspectiveGroups) {
  return perspectiveGroups.get(item.perspective) ?? item.perspective;
}

/**
 * Two items relay one primary source when its canonical URLs match or its
 * issuers match: two CENTCOM releases about one strike are still CENTCOM.
 */
function sharePrimarySource(a, b) {
  const first = a?.primarySource;
  const second = b?.primarySource;
  if (!first || !second) return false;
  const url = canonicalizeUrl(first.url);
  if (url && url === canonicalizeUrl(second.url)) return true;
  return (
    Boolean(first.issuer) &&
    String(first.issuer).toLowerCase() ===
      String(second.issuer || '').toLowerCase()
  );
}

function corroborates(a, b, perspectiveGroups) {
  if (groupOf(a, perspectiveGroups) === groupOf(b, perspectiveGroups))
    return false;
  if (
    !CORROBORATING_KINDS.includes(a.kind) &&
    !CORROBORATING_KINDS.includes(b.kind)
  )
    return false;
  return !sharePrimarySource(a, b);
}

/**
 * Verification label from cited items:
 * - corroborated: two items from different perspective groups, at least one
 *   independent, humanitarian or verification, not sharing a primary source;
 * - disputed: contradictions recorded and no corroboration;
 * - participant-claim: every item is a participant or state outlet;
 * - reported: anything else.
 * @param {Array<{kind: string, perspective: string, primarySource?: object}>} items
 * @param {{contradictions?: string[], perspectiveGroups: Map<string, string>}} context
 */
export function deriveVerification(
  items,
  { contradictions = [], perspectiveGroups },
) {
  const list = items.filter(Boolean);
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if (corroborates(list[i], list[j], perspectiveGroups))
        return 'corroborated';
  if (contradictions.some((line) => String(line || '').trim()))
    return 'disputed';
  if (list.length && list.every((item) => PARTICIPANT_KINDS.has(item.kind)))
    return 'participant-claim';
  return 'reported';
}

/** Claim statuses from the items each claim cites; story label otherwise. */
export function deriveClaimStatuses(
  claims,
  itemsById,
  { storyLabel, perspectiveGroups },
) {
  return claims.map((claim) => {
    const items = (claim.itemIds || [])
      .map((id) => itemsById.get(id))
      .filter(Boolean);
    return {
      ...claim,
      status: items.length
        ? deriveVerification(items, { perspectiveGroups })
        : storyLabel,
    };
  });
}

/** Sorted, distinct perspectives of the cited items. */
export function derivePerspectives(items) {
  return [...new Set(items.filter(Boolean).map((item) => item.perspective))]
    .filter(Boolean)
    .sort();
}

/** Distinct publishers among the cited items. */
export function sourceCount(items) {
  return new Set(items.filter(Boolean).map((item) => item.sourceId)).size;
}

/**
 * Story location: the gazetteer match for the model's place name; the
 * model's coordinates only when there is no match (shown as model-placed),
 * or when the match lies over FAR_MATCH_KM from them (`farMatch`, counted in
 * the run record); otherwise null (list-only story).
 */
export function resolveLocation({ placeName, lat, lon }, gazetteer) {
  const match = placeName ? resolvePlace(placeName, gazetteer) : null;
  const modelPoint =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180;
  if (
    match &&
    !(modelPoint && greatCircleKm(match, { lat, lon }) > FAR_MATCH_KM)
  )
    return match;
  if (modelPoint)
    return {
      lat,
      lon,
      precision: 'approximate',
      method: 'model',
      name: placeName || null,
      ...(match ? { farMatch: true } : {}),
    };
  return null;
}

/**
 * Keep model-provided ids (already validated as open stories) and mint
 * deterministic `st_` ids for new stories. Returns new objects.
 * @param {Array<{id: ?string, itemIds: string[]}>} stories
 * @param {{runId: string, existingIds: Set<string>}} context
 */
export function assignIds(stories, { runId, existingIds }) {
  const used = new Set(existingIds);
  for (const story of stories) if (story.id) used.add(story.id);
  return stories.map((story) => {
    if (story.id) return { ...story };
    for (let attempt = 0; ; attempt++) {
      const id = `st_${createHash('sha1')
        .update(`${runId}:${story.itemIds[0] ?? ''}:${attempt}`)
        .digest('hex')
        .slice(0, 8)}`;
      if (!used.has(id)) {
        used.add(id);
        return { ...story, id };
      }
    }
  });
}

/** item id → story id for the given stories. */
export function storyByItem(stories) {
  const map = new Map();
  for (const story of stories)
    for (const id of story.itemIds || []) map.set(id, story.id);
  return map;
}

/** Processed item ids no story cites. */
export function unassignedItems(processedIds, stories) {
  const cited = storyByItem(stories);
  return processedIds.filter((id) => !cited.has(id));
}

/**
 * Close open stories untouched for 48 h, then the oldest open stories
 * beyond the cap. Returns new objects; closed ones carry `closedReason`.
 */
export function closeStaleStories(
  stories,
  nowMs,
  { maxAgeMs = STORY_STALE_MS, cap = OPEN_STORY_CAP } = {},
) {
  const result = stories.map((story) => {
    if (story.status !== 'open') return story;
    const age = nowMs - Date.parse(story.updatedAt);
    return age > maxAgeMs
      ? { ...story, status: 'closed', closedReason: 'age' }
      : story;
  });
  const open = result
    .filter((story) => story.status === 'open')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const closing = new Set(open.slice(cap).map((story) => story.id));
  return result.map((story) =>
    closing.has(story.id)
      ? { ...story, status: 'closed', closedReason: 'cap' }
      : story,
  );
}

/** Recompute every code-owned field of one story from its cited items. */
export function withComputedFields(
  story,
  { itemsById, gazetteer, perspectiveGroups },
) {
  const items = story.itemIds.map((id) => itemsById.get(id)).filter(Boolean);
  const verification = deriveVerification(items, {
    contradictions: story.contradictions,
    perspectiveGroups,
  });
  return {
    ...story,
    location: resolveLocation(
      {
        placeName: story.place?.name ?? null,
        lat: story.modelLat ?? null,
        lon: story.modelLon ?? null,
      },
      gazetteer,
    ),
    perspectives: derivePerspectives(items),
    sourceCount: sourceCount(items),
    verification,
    claims: deriveClaimStatuses(story.claims || [], itemsById, {
      storyLabel: verification,
      perspectiveGroups,
    }),
  };
}

/**
 * Merge one validated digest into the previous stories.
 * Updated stories take the model's fields and keep earlier citations that
 * no other story claimed in this run; new stories get minted ids; a story
 * whose citations all moved elsewhere is dropped. Untouched stories stay.
 * @returns {{stories: Array<object>, touched: Array<object>, created: number, updated: number}}
 */
export function mergeDigest({
  previous,
  validated,
  itemsById,
  theaterId,
  gazetteer,
  perspectiveGroups,
  runId,
  nowIso,
}) {
  const context = { itemsById, gazetteer, perspectiveGroups };
  const byId = new Map(previous.map((story) => [story.id, story]));
  const withIds = assignIds(validated, {
    runId,
    existingIds: new Set(byId.keys()),
  });
  const claimedNow = storyByItem(withIds);
  const touched = [];
  let created = 0;
  let updated = 0;
  for (const next of withIds) {
    const prior = byId.get(next.id);
    const kept = (prior?.itemIds || []).filter(
      (id) => !claimedNow.has(id) && !next.itemIds.includes(id),
    );
    const story = withComputedFields(
      {
        id: next.id,
        theater: theaterId,
        title: next.title,
        summary: next.summary,
        category: next.category,
        place: next.placeName ? { name: next.placeName } : null,
        modelLat: next.lat,
        modelLon: next.lon,
        eventAt: next.eventAt,
        itemIds: [...next.itemIds, ...kept],
        claims: next.claims,
        whatsNew: next.whatsNew,
        contradictions: next.contradictions,
        status: next.status,
        kind: next.kind === 'development' ? 'development' : 'event',
        actorIds: next.actorIds || [],
        firstSeenAt: prior?.firstSeenAt ?? nowIso,
        updatedAt: nowIso,
        digestRunId: runId,
      },
      context,
    );
    if (prior) updated++;
    else created++;
    touched.push(story);
  }
  const touchedIds = new Set(touched.map((story) => story.id));
  const stories = [];
  for (const story of previous) {
    if (touchedIds.has(story.id)) continue;
    const remaining = (story.itemIds || []).filter((id) => !claimedNow.has(id));
    if (remaining.length === (story.itemIds || []).length) {
      stories.push(story);
    } else if (remaining.length) {
      stories.push(
        withComputedFields({ ...story, itemIds: remaining }, context),
      );
    }
  }
  return { stories: [...touched, ...stories], touched, created, updated };
}
