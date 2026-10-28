import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_ACTOR_STATE,
  actorSlug,
  applyActorUpdates,
  effectiveActors,
  matchActor,
  normalizeActorName,
} from '../../server/providers/news/digest/actors.js';

const NOW = '2026-10-28T14:03:00.000Z';
const LATER = '2026-10-29T09:00:00.000Z';
const theaterActors = [
  {
    id: 'saudi-arabia',
    name: 'Saudi Arabia',
    type: 'state',
    role: 'external',
    aliases: ['Riyadh', 'Saudi-led coalition', 'KSA'],
  },
  {
    id: 'pakistan',
    name: 'Pakistan',
    type: 'state',
    role: 'mediator',
    aliases: ['Islamabad'],
  },
  {
    id: 'houthis',
    name: 'Houthis',
    type: 'armed-group',
    role: 'party',
    aliases: ['Ansar Allah'],
  },
];
// Perspective groups as the theater defines them (and the verification
// label uses them): two Israeli outlets are one group.
const perspectiveGroups = new Map([
  ['international-wire', 'international'],
  ['international-regional', 'international'],
  ['houthi', 'axis-armed'],
  ['israel-mainstream', 'israel'],
  ['israel-right', 'israel'],
  ['iran-state', 'iran'],
  ['gulf', 'gulf'],
]);
const items = new Map(
  [
    [
      'i_wire',
      'reuters',
      'international-wire',
      'Saudi-led coalition strikes Sanaa',
    ],
    [
      'i_houthi',
      'almasirah',
      'houthi',
      'Saudi Arabia jets struck Sanaa, Houthis say',
    ],
    ['i_haaretz', 'haaretz', 'israel-mainstream', 'Saudi Arabia joins the war'],
    ['i_hayom', 'israelhayom', 'israel-right', 'Riyadh enters the fight'],
    ['i_talks_irna', 'irna', 'iran-state', 'Pakistan hosts envoys'],
    ['i_talks_wire', 'reuters', 'international-wire', 'Islamabad talks resume'],
    ['i_other', 'reuters', 'international-wire', 'Houthis fire at Aden'],
    ['i_egypt_wire', 'reuters', 'international-wire', 'Egypt pledges support'],
    ['i_egypt_gulf', 'arabnews', 'gulf', 'Egypt backs Riyadh'],
    ['i_egypt_one', 'mee', 'international-regional', 'Egypt deploys jets'],
  ].map(([id, sourceId, perspective, title]) => [
    id,
    { id, sourceId, perspective, title, titleOriginal: title, snippet: '' },
  ]),
);
const story = (id, verification, actorIds, text, itemIds) => ({
  id,
  title: `Story ${id} ${text}`,
  summary: '',
  claims: [],
  verification,
  actorIds,
  itemIds,
});
const stories = new Map(
  [
    // Named by two groups: international and axis-armed.
    story(
      'st_strikes',
      'corroborated',
      ['saudi-arabia', 'houthis'],
      'Coalition strikes in Sanaa',
      ['i_wire', 'i_houthi'],
    ),
    // Two outlets, one group: both Israeli.
    story(
      'st_one_group',
      'corroborated',
      ['saudi-arabia'],
      'Saudi Arabia enters the war',
      ['i_haaretz', 'i_hayom'],
    ),
    story(
      'st_claim',
      'participant-claim',
      ['saudi-arabia'],
      'Houthis say Saudi jets struck',
      ['i_houthi'],
    ),
    story('st_talks', 'corroborated', ['pakistan'], 'Talks in Tehran', [
      'i_talks_irna',
      'i_talks_wire',
    ]),
    story(
      'st_troops',
      'reported',
      ['pakistan'],
      'Pakistan sends troops to Saudi Arabia',
      ['i_talks_wire'],
    ),
    story('st_other', 'corroborated', ['houthis'], 'Houthis fire at Aden', [
      'i_other',
      'i_houthi',
    ]),
    story(
      'st_egypt',
      'corroborated',
      [],
      'Egypt parliament authorises military support',
      ['i_egypt_wire', 'i_egypt_gulf'],
    ),
    story(
      'st_egypt_one',
      'reported',
      [],
      'Egypt deploys jets, one outlet says',
      ['i_egypt_one'],
    ),
    // Corroborated, but only one group names Egypt in its items.
    story(
      'st_egypt_mention',
      'corroborated',
      [],
      'Gulf war widens; Egypt mentioned',
      ['i_egypt_one', 'i_wire'],
    ),
  ].map((entry) => [entry.id, entry]),
);
const apply = (lines = {}, state = EMPTY_ACTOR_STATE, nowIso = NOW) =>
  applyActorUpdates({
    actors: effectiveActors(theaterActors, state),
    state,
    actorRoles: lines.roles || [],
    newActors: lines.added || [],
    storiesById: stories,
    itemsById: items,
    perspectiveGroups,
    nowIso,
    briefId: 'br_1',
  });

test('names fold case, accents and punctuation; ids are slugs code makes', () => {
  assert.equal(
    normalizeActorName('  The Saudi-led Coalition '),
    'saudi led coalition',
  );
  assert.equal(normalizeActorName('Égypte'), 'egypte');
  assert.equal(actorSlug('Egypt', new Set()), 'egypt');
  assert.equal(actorSlug('Egypt', new Set(['egypt'])), 'egypt-2');
  assert.equal(
    actorSlug('United Arab Emirates', new Set()),
    'united-arab-emirates',
  );
  assert.equal(actorSlug('مصر', new Set()), 'actor');
});

test('a proposed actor matches an existing name or alias, whatever its case', () => {
  const actors = effectiveActors(theaterActors, EMPTY_ACTOR_STATE);
  for (const name of [
    'Saudi Arabia',
    'saudi arabia',
    'KSA',
    'Saudi-led coalition',
    'RIYADH',
  ])
    assert.equal(matchActor(name, [], actors)?.id, 'saudi-arabia', name);
  // A proposed alias matches only an existing actor's name, so a stray
  // alias ("Riyadh" offered for Egypt) cannot merge two different actors.
  assert.equal(
    matchActor('Kingdom', ['saudi arabia'], actors)?.id,
    'saudi-arabia',
  );
  assert.equal(matchActor('Egypt', ['Riyadh'], actors), null);
  assert.equal(matchActor('Egypt', [], actors), null);
});

test('a role changes only with a corroborated story tagged with that actor', () => {
  // Corroborated and tagged: Saudi Arabia becomes a party.
  const { state, changed, held } = apply({
    roles: [
      {
        actorId: 'saudi-arabia',
        role: 'party',
        text: 'Fighting the Houthis.',
        storyIds: ['st_strikes', 'st_claim'],
      },
    ],
  });
  assert.deepEqual(changed, [
    {
      actorId: 'saudi-arabia',
      from: 'external',
      to: 'party',
      storyIds: ['st_strikes'],
    },
  ]);
  assert.deepEqual(held, []);
  assert.deepEqual(state.roles['saudi-arabia'], {
    role: 'party',
    since: NOW,
    storyIds: ['st_strikes'],
    changedFrom: 'external',
    briefId: 'br_1',
  });
  const [saudi] = effectiveActors(theaterActors, state);
  assert.deepEqual(
    [
      saudi.role,
      saudi.startingRole,
      saudi.roleSince,
      saudi.roleStoryIds,
      saudi.changedFrom,
    ],
    ['party', 'external', NOW, ['st_strikes'], 'external'],
  );
});

test('two outlets from one perspective group naming an actor: held', () => {
  // Haaretz and Israel Hayom both name Saudi Arabia in a corroborated story
  // tagged with it, but both are the Israeli group.
  const held = apply({
    roles: [
      {
        actorId: 'saudi-arabia',
        role: 'party',
        text: 'x',
        storyIds: ['st_one_group'],
      },
    ],
  });
  assert.deepEqual(held.changed, []);
  assert.deepEqual(held.held, [
    {
      actorId: 'saudi-arabia',
      from: 'external',
      to: 'party',
      reason: 'named-by-one-perspective-group',
    },
  ]);
  // Two groups (a wire and a Houthi outlet) naming it: accepted. Aliases
  // count, and so do the evidence stories' items together.
  const accepted = apply({
    roles: [
      {
        actorId: 'saudi-arabia',
        role: 'party',
        text: 'x',
        storyIds: ['st_one_group', 'st_strikes'],
      },
    ],
  });
  assert.deepEqual(accepted.changed, [
    {
      actorId: 'saudi-arabia',
      from: 'external',
      to: 'party',
      storyIds: ['st_one_group', 'st_strikes'],
    },
  ]);
  // A new actor named by one group only, even in a corroborated story.
  const single = apply({
    added: [
      {
        name: 'Egypt',
        type: 'state',
        role: 'external',
        aliases: [],
        text: 'x',
        storyIds: ['st_egypt_mention'],
      },
    ],
  });
  assert.deepEqual(single.refused, [
    { name: 'Egypt', reason: 'named-by-one-perspective-group' },
  ]);
});

test('evidence about something else, or one side only, does not count', () => {
  const cases = [
    // Corroborated, but tagged with the Houthis only.
    ['saudi-arabia', 'party', ['st_other']],
    // Tagged, but only one side's claim.
    ['saudi-arabia', 'party', ['st_claim']],
    // Tagged, but a single outlet: Pakistan stays a mediator.
    ['pakistan', 'party', ['st_troops']],
    // Unknown story ids prove nothing.
    ['pakistan', 'external', ['st_ghost']],
  ];
  for (const [actorId, role, storyIds] of cases) {
    const result = apply({ roles: [{ actorId, role, text: 'x', storyIds }] });
    assert.deepEqual(result.changed, [], `${actorId} ${storyIds}`);
    assert.equal(result.held.length, 1);
    assert.equal(result.state.roles[actorId], undefined);
  }
});

test('a downgrade needs the same evidence as an upgrade; restating a role changes nothing', () => {
  const first = apply({
    roles: [
      {
        actorId: 'saudi-arabia',
        role: 'party',
        text: 'x',
        storyIds: ['st_strikes'],
      },
    ],
  });
  // Back to external on a one-sided claim: held.
  const weak = apply(
    {
      roles: [
        {
          actorId: 'saudi-arabia',
          role: 'external',
          text: 'x',
          storyIds: ['st_claim'],
        },
      ],
    },
    first.state,
    LATER,
  );
  assert.deepEqual(weak.changed, []);
  assert.equal(weak.state.roles['saudi-arabia'].role, 'party');
  // The same role again keeps its original date and evidence.
  const same = apply(
    {
      roles: [
        {
          actorId: 'saudi-arabia',
          role: 'party',
          text: 'x',
          storyIds: ['st_strikes'],
        },
      ],
    },
    first.state,
    LATER,
  );
  assert.equal(same.state.roles['saudi-arabia'].since, NOW);
  // With corroborated, tagged evidence the downgrade goes through.
  const strong = apply(
    {
      roles: [
        {
          actorId: 'saudi-arabia',
          role: 'mediator',
          text: 'x',
          storyIds: ['st_strikes'],
        },
      ],
    },
    first.state,
    LATER,
  );
  assert.equal(strong.state.roles['saudi-arabia'].role, 'mediator');
  assert.equal(strong.state.roles['saudi-arabia'].changedFrom, 'party');
  assert.equal(strong.state.roles['saudi-arabia'].since, LATER);
});

test('a new actor needs a corroborated story naming it; code makes its id', () => {
  const { state, added, refused } = apply({
    added: [
      {
        name: 'Egypt',
        type: 'state',
        role: 'external',
        aliases: ['Cairo', 'Egypt', 'Cairo'],
        text: 'Its parliament authorised military support for Saudi Arabia.',
        storyIds: ['st_egypt'],
      },
    ],
  });
  assert.deepEqual(refused, []);
  assert.deepEqual(added, [
    { id: 'egypt', name: 'Egypt', role: 'external', storyIds: ['st_egypt'] },
  ]);
  assert.deepEqual(state.learned, [
    {
      id: 'egypt',
      name: 'Egypt',
      type: 'state',
      role: 'external',
      aliases: ['Cairo'],
      addedAt: NOW,
      briefId: 'br_1',
    },
  ]);
  const egypt = effectiveActors(theaterActors, state).at(-1);
  assert.deepEqual(
    [egypt.id, egypt.learned, egypt.role, egypt.roleSince, egypt.changedFrom],
    ['egypt', true, 'external', NOW, null],
  );
  // One outlet, or a corroborated story that does not name it: not added.
  for (const storyIds of [['st_egypt_one'], ['st_strikes']]) {
    const weak = apply({
      added: [
        {
          name: 'Egypt',
          type: 'state',
          role: 'external',
          aliases: [],
          text: 'x',
          storyIds,
        },
      ],
    });
    assert.equal(weak.refused.length, 1, String(storyIds));
    assert.deepEqual(weak.state.learned, []);
  }
});

test('a proposal using another actor’s alias is refused, neither merged nor added', () => {
  for (const proposal of [
    // Would duplicate Saudi Arabia under a new name.
    { name: 'Coalition forces', aliases: ['Saudi-led coalition'] },
    // A stray alias must not fold Egypt into Saudi Arabia either.
    { name: 'Egypt', aliases: ['Riyadh'] },
  ]) {
    const result = apply({
      added: [
        {
          ...proposal,
          type: 'state',
          role: 'party',
          text: 'x',
          storyIds: ['st_strikes', 'st_egypt'],
        },
      ],
    });
    assert.deepEqual(result.refused, [
      { name: proposal.name, reason: 'alias-of-another-actor' },
    ]);
    assert.equal(result.merged, 0);
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.state.learned, []);
  }
});

test('no duplicates: a proposal that matches an existing actor becomes that actor', () => {
  const { state, added, merged, changed } = apply({
    added: [
      {
        name: 'KSA',
        type: 'state',
        role: 'party',
        aliases: [],
        text: 'x',
        storyIds: ['st_strikes'],
      },
      {
        name: 'Egypt',
        type: 'state',
        role: 'external',
        aliases: [],
        text: 'x',
        storyIds: ['st_egypt'],
      },
      {
        name: 'Arab Republic of Egypt',
        type: 'state',
        role: 'external',
        aliases: ['egypt'],
        text: 'x',
        storyIds: ['st_egypt'],
      },
    ],
  });
  assert.equal(merged, 2);
  assert.deepEqual(
    added.map((entry) => entry.id),
    ['egypt'],
  );
  // "KSA" counted as Saudi Arabia, with its evidence checked as usual.
  assert.deepEqual(
    changed.map((entry) => [entry.actorId, entry.to]),
    [['saudi-arabia', 'party']],
  );
  assert.equal(state.learned.length, 1);
});

test('actors are never deleted: a learned actor stays when later briefs ignore it', () => {
  const first = apply({
    added: [
      {
        name: 'Egypt',
        type: 'state',
        role: 'external',
        aliases: [],
        text: 'x',
        storyIds: ['st_egypt'],
      },
    ],
  });
  const next = apply({}, first.state, LATER);
  assert.deepEqual(
    next.state.learned.map((actor) => actor.id),
    ['egypt'],
  );
  assert.deepEqual(
    effectiveActors(theaterActors, next.state).map((actor) => actor.id),
    ['saudi-arabia', 'pakistan', 'houthis', 'egypt'],
  );
  // A second Egypt later is still the same actor.
  const again = apply(
    {
      added: [
        {
          name: 'egypt',
          type: 'state',
          role: 'external',
          aliases: [],
          text: 'x',
          storyIds: ['st_egypt'],
        },
      ],
    },
    next.state,
    LATER,
  );
  assert.equal(again.state.learned.length, 1);
  assert.equal(again.merged, 1);
});
