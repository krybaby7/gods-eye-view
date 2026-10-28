/**
 * Theater actors and their roles over time. Pure functions.
 *
 * The theater file says who each actor is (id, name, aliases, type) and its
 * starting role. After that, roles come from the stories: each Situation
 * Brief proposes a role per actor with cited stories, and code accepts a
 * change only when at least one cited story is corroborated and tagged with
 * that actor, and those stories' items name the actor from two perspective
 * groups. The same bar applies in both directions, so a role does not flip
 * back on weaker evidence. A brief may also propose an actor the list lacks;
 * code accepts it only with a corroborated cited story that names it (and
 * the same two groups naming it in its items),
 * makes its id from the name, folds a proposal that names an existing actor
 * into that actor, and refuses one whose alias another actor already uses.
 * Actors are never deleted: one the stories stop mentioning keeps its id, so
 * older stories stay tagged correctly.
 */

/** Stored next to the stories in the digest file. */
export const EMPTY_ACTOR_STATE = Object.freeze({
  roles: Object.freeze({}),
  learned: Object.freeze([]),
});

/** Case, accents, punctuation and a leading "the" never tell actors apart. */
export function normalizeActorName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the /, '');
}

/** A stable slug made from the name; the model never chooses ids. */
export function actorSlug(name, existingIds) {
  const base =
    normalizeActorName(name)
      .replace(/[^a-z0-9 ]/g, '')
      .trim()
      .replace(/ +/g, '-')
      .slice(0, 60)
      .replace(/-+$/, '') || 'actor';
  let id = base;
  for (let n = 2; existingIds.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * The existing actor a proposal names. Its name is checked against every
 * name and alias; its aliases only against names, so a stray alias cannot
 * merge two different actors.
 */
export function matchActor(name, aliases, actors) {
  const key = normalizeActorName(name);
  const own = new Set((aliases || []).map(normalizeActorName));
  for (const actor of actors) {
    const names = [actor.name, ...(actor.aliases || [])].map(
      normalizeActorName,
    );
    if (names.includes(key) || own.has(normalizeActorName(actor.name)))
      return actor;
  }
  return null;
}

/**
 * Theater actors and learned ones, each with its current role and when and
 * on which stories that role was last set.
 * @param {Array<object>} theaterActors Validated theater actors.
 * @param {{roles: object, learned: Array<object>}} [state]
 */
export function effectiveActors(theaterActors, state = EMPTY_ACTOR_STATE) {
  const withRole = (actor, learned) => {
    const current = state.roles?.[actor.id];
    return {
      id: actor.id,
      name: actor.name,
      type: actor.type,
      aliases: [...(actor.aliases || [])],
      role: current?.role ?? actor.role,
      startingRole: actor.role,
      roleSince: current?.since ?? null,
      roleStoryIds: [...(current?.storyIds || [])],
      changedFrom: current?.changedFrom ?? null,
      learned,
    };
  };
  return [
    ...theaterActors.map((actor) => withRole(actor, false)),
    ...(state.learned || []).map((actor) => withRole(actor, true)),
  ];
}

function storyText(story) {
  return normalizeActorName(
    [
      story.title,
      story.summary,
      ...(story.claims || []).flatMap((claim) => [claim.text, claim.actor]),
    ].join(' '),
  );
}

function names(text, spellings) {
  const padded = ` ${text} `;
  return spellings
    .map(normalizeActorName)
    .some((spelling) => spelling && padded.includes(` ${spelling} `));
}

/** Why a proposed role or actor was not accepted, for the run record. */
export const ACTOR_HOLD_REASONS = Object.freeze({
  noEvidence: 'no-corroborated-story',
  oneGroup: 'named-by-one-perspective-group',
  duplicateAlias: 'alias-of-another-actor',
});

/**
 * Apply one brief's proposed roles and new actors. Returns a new state and
 * what happened, for the run record.
 *
 * Besides a corroborated cited story tagged with (or, for a new actor,
 * naming) the actor, the stories' own items must name the actor from at
 * least two perspective groups, the same groups the verification label
 * uses. A corroborated story can rest on parts that do not concern the
 * actor; this keeps a single outlet's mention inside one from counting.
 * @param {{
 *   actors: Array<object>,
 *   state: {roles: object, learned: Array<object>},
 *   actorRoles: Array<{actorId: string, role: string, storyIds: string[]}>,
 *   newActors: Array<{name: string, type: string, role: string, aliases: string[], storyIds: string[]}>,
 *   storiesById: Map<string, object>,
 *   itemsById: Map<string, object>,
 *   perspectiveGroups: Map<string, string>,
 *   nowIso: string,
 *   briefId: string,
 * }} update
 */
export function applyActorUpdates({
  actors,
  state,
  actorRoles,
  newActors,
  storiesById,
  itemsById,
  perspectiveGroups,
  nowIso,
  briefId,
}) {
  const next = { roles: { ...state.roles }, learned: [...state.learned] };
  const current = new Map(actors.map((actor) => [actor.id, { ...actor }]));
  const result = {
    changed: [],
    held: [],
    added: [],
    merged: 0,
    refused: [],
  };
  const corroborated = (id) =>
    storiesById.get(id)?.verification === 'corroborated';

  /** Perspective groups whose items in these stories name the actor. */
  function namingGroups(storyIds, spellings) {
    const groups = new Set();
    for (const storyId of storyIds)
      for (const itemId of storiesById.get(storyId)?.itemIds || []) {
        const item = itemsById.get(itemId);
        if (!item) continue;
        const text = normalizeActorName(
          [item.title, item.titleOriginal, item.snippet].join(' '),
        );
        if (names(text, spellings))
          groups.add(
            perspectiveGroups.get(item.perspective) ?? item.perspective,
          );
      }
    return groups;
  }

  function propose(actorId, role, storyIds) {
    const actor = current.get(actorId);
    if (!actor || actor.role === role) return;
    const evidence = storyIds.filter(
      (id) =>
        corroborated(id) &&
        (storiesById.get(id).actorIds || []).includes(actorId),
    );
    const reason = !evidence.length
      ? ACTOR_HOLD_REASONS.noEvidence
      : namingGroups(evidence, [actor.name, ...(actor.aliases || [])]).size < 2
        ? ACTOR_HOLD_REASONS.oneGroup
        : null;
    if (reason) {
      result.held.push({ actorId, from: actor.role, to: role, reason });
      return;
    }
    next.roles[actorId] = {
      role,
      since: nowIso,
      storyIds: evidence,
      changedFrom: actor.role,
      briefId,
    };
    result.changed.push({
      actorId,
      from: actor.role,
      to: role,
      storyIds: evidence,
    });
    actor.role = role;
  }

  for (const line of actorRoles)
    propose(line.actorId, line.role, line.storyIds);

  for (const proposal of newActors) {
    const match = matchActor(proposal.name, proposal.aliases, [
      ...current.values(),
    ]);
    if (match) {
      result.merged++;
      propose(match.id, proposal.role, proposal.storyIds);
      continue;
    }
    // An alias another actor already answers to makes the proposal a
    // possible duplicate ("US Central Command", also "CENTCOM"): refused,
    // neither merged nor added.
    const taken = new Set(
      [...current.values()].flatMap((actor) =>
        (actor.aliases || []).map(normalizeActorName),
      ),
    );
    if (
      proposal.aliases.some((alias) => taken.has(normalizeActorName(alias)))
    ) {
      result.refused.push({
        name: proposal.name,
        reason: ACTOR_HOLD_REASONS.duplicateAlias,
      });
      continue;
    }
    const spellings = [proposal.name, ...proposal.aliases];
    const evidence = proposal.storyIds.filter(
      (id) =>
        corroborated(id) && names(storyText(storiesById.get(id)), spellings),
    );
    const reason = !evidence.length
      ? ACTOR_HOLD_REASONS.noEvidence
      : namingGroups(evidence, spellings).size < 2
        ? ACTOR_HOLD_REASONS.oneGroup
        : null;
    if (reason) {
      result.refused.push({ name: proposal.name, reason });
      continue;
    }
    const id = actorSlug(proposal.name, new Set(current.keys()));
    const aliases = [
      ...new Set(
        proposal.aliases.filter(
          (alias) =>
            normalizeActorName(alias) !== normalizeActorName(proposal.name),
        ),
      ),
    ];
    const learned = {
      id,
      name: proposal.name,
      type: proposal.type,
      role: proposal.role,
      aliases,
      addedAt: nowIso,
      briefId,
    };
    next.learned.push(learned);
    next.roles[id] = {
      role: proposal.role,
      since: nowIso,
      storyIds: evidence,
      changedFrom: null,
      briefId,
    };
    current.set(id, { ...learned, role: proposal.role });
    result.added.push({
      id,
      name: proposal.name,
      role: proposal.role,
      storyIds: evidence,
    });
  }
  return { state: next, ...result };
}
