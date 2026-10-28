import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRACK_STATE_GLYPHS,
  actorRoleNote,
  actorStrip,
  briefAgeLine,
  briefMetaLine,
  briefRunLine,
  briefStoryIds,
  horizonLabel,
  lastSeenKey,
  retryBriefState,
  roleChangeLine,
  roleChanges,
  trackBadges,
} from './situationBriefModel.js';

const NOW = Date.parse('2026-10-28T15:00:00Z');
const UTC = { timeZone: 'UTC' };
const line = (text, storyIds) => ({ text, storyIds });
const brief = {
  id: 'br_1',
  digestRunId: 'run_1',
  createdAt: '2026-10-28T14:03:00Z',
  headline: line('Headline.', ['a', 'b']),
  changes: [line('Change.', ['b', 'c'])],
  trigger: line('Trigger.', ['d']),
  tracks: [
    { id: 'military', state: 'escalating', reason: 'R.', storyIds: ['a'] },
  ],
  affected: [],
  scenarios: [
    {
      title: 'Talks',
      horizon: 'weeks',
      text: 'T.',
      storyIds: ['e'],
      signposts: [{ text: 'S', seenIn: ['f'] }],
    },
  ],
  unknowns: [line('U.', ['a'])],
  actorRoles: [
    { actorId: 'oman', role: 'mediator', text: 'N.', storyIds: ['g'] },
  ],
};

test('a brief cites the distinct stories of every line, signposts included', () => {
  assert.deepEqual(briefStoryIds(brief), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(briefStoryIds(null), []);
});

test('the AI-analysis line names its time and how many stories it cites', () => {
  assert.equal(
    briefMetaLine(brief, NOW, UTC),
    'AI analysis · 14:03 · cites 7 stories',
  );
  assert.equal(
    briefMetaLine(
      {
        ...brief,
        changes: [],
        trigger: null,
        tracks: [],
        scenarios: [],
        unknowns: [],
        actorRoles: [],
        headline: line('H.', ['a']),
      },
      NOW,
      UTC,
    ),
    'AI analysis · 14:03 · cites 1 story',
  );
});

test('a brief behind the latest digest says by how much; a current one says nothing', () => {
  assert.equal(
    briefAgeLine(brief, { digestsBehind: 1 }, NOW, UTC),
    'Brief from 14:03, one digest behind',
  );
  assert.equal(
    briefAgeLine(brief, { digestsBehind: 2 }, NOW, UTC),
    'Brief from 14:03, two digests behind',
  );
  assert.equal(
    briefAgeLine(brief, { digestsBehind: 5 }, NOW, UTC),
    'Brief from 14:03, 5 digests behind',
  );
  assert.equal(briefAgeLine(brief, { digestsBehind: 0 }, NOW, UTC), '');
  assert.equal(briefAgeLine(null, { digestsBehind: 1 }, NOW, UTC), '');
});

test('a failed or skipped brief explains itself only while Retry applies', () => {
  const retryable = { retryable: true };
  assert.equal(
    briefRunLine(
      { status: 'failed', error: 'truncated', costUsd: 0.09 },
      retryable,
    ),
    'The latest brief failed: it hit its output limit (cost 9¢).',
  );
  assert.equal(
    briefRunLine({ status: 'failed', error: 'no_headline' }, retryable),
    'The latest brief failed: it had no cited headline.',
  );
  assert.equal(
    briefRunLine({ status: 'failed', error: 'weird' }, retryable),
    'The latest brief failed: weird.',
  );
  assert.equal(
    briefRunLine(
      { status: 'skipped', message: 'Brief skipped: $0.10 left' },
      retryable,
    ),
    'Brief skipped: $0.10 left.',
  );
  assert.equal(
    briefRunLine(
      { status: 'failed', error: 'truncated' },
      { retryable: false },
    ),
    '',
  );
});

test('Retry brief shows only after a failure and says why it is disabled', () => {
  assert.deepEqual(retryBriefState({ briefStatus: { retryable: false } }), {
    visible: false,
    disabled: true,
    reason: null,
  });
  assert.deepEqual(
    retryBriefState({
      briefStatus: { retryable: true, retryDisabledReason: null },
      digest: { running: false },
    }),
    { visible: true, disabled: false, reason: null },
  );
  assert.deepEqual(
    retryBriefState({
      briefStatus: { retryable: true, retryDisabledReason: 'over_budget' },
      digest: { running: false },
    }),
    {
      visible: true,
      disabled: true,
      reason: "Today's budget is used up",
    },
  );
  assert.equal(
    retryBriefState({
      briefStatus: { retryable: true },
      digest: { running: true },
    }).reason,
    'A digest or brief is running',
  );
});

const actor = (id, role, extra = {}) => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  type: 'state',
  role,
  ...extra,
});

test('the strip groups actors by current role, never by side, and shows only those in open stories', () => {
  const actors = [
    actor('iran', 'party'),
    actor('oman', 'mediator'),
    actor('hamas', 'party', { type: 'armed-group' }),
    actor('gaza', 'affected', { type: 'population' }),
    actor('egypt', 'external', { learned: true }),
  ];
  const stories = [
    { id: 'a', status: 'open', actorIds: ['iran', 'hamas', 'egypt'] },
    { id: 'b', status: 'open', actorIds: ['iran', 'gaza'] },
    { id: 'c', status: 'closed', actorIds: ['oman'] },
  ];
  const strip = actorStrip(actors, stories);
  assert.deepEqual(
    strip.groups.map((group) => [
      group.label,
      group.actors.map((entry) => [entry.id, entry.typeLabel, entry.count]),
    ]),
    [
      [
        'Parties',
        [
          ['iran', 'state', 2],
          ['hamas', 'armed group', 1],
        ],
      ],
      ['External', [['egypt', 'state', 1]]],
      ['Affected', [['gaza', 'population', 1]]],
    ],
  );
  // Oman has no open story: hidden, not deleted.
  assert.equal(strip.hidden, 1);
  // The active filter always shows.
  assert.deepEqual(
    actorStrip(actors, stories, { activeId: 'oman' }).groups.map(
      (group) => group.label,
    ),
    ['Parties', 'Mediators', 'External', 'Affected'],
  );
  // Before any story is tagged, the theater's own actors show.
  assert.deepEqual(
    actorStrip(actors, [])
      .groups.flatMap((group) => group.actors)
      .map((entry) => entry.id),
    ['iran', 'hamas', 'oman', 'gaza'],
  );
});

test('the strip shows at most 16, keeping those with the most open stories', () => {
  const actors = Array.from({ length: 20 }, (_, n) =>
    actor(`a${String(n).padStart(2, '0')}`, 'party'),
  );
  const stories = actors.map((entry, n) => ({
    id: `s${n}`,
    status: 'open',
    actorIds: n < 4 ? [entry.id, 'a19'] : [entry.id],
  }));
  const strip = actorStrip(actors, stories, { activeId: 'a05' });
  const shown = strip.groups[0].actors.map((entry) => entry.id);
  assert.equal(shown.length, 16);
  assert.equal(strip.hidden, 4);
  assert.ok(shown.includes('a19'), 'five stories');
  assert.ok(shown.includes('a05'), 'the active filter');
});

test('role changes list who moved, from what, when, and on which stories', () => {
  const actors = [
    actor('iran', 'party'),
    actor('saudi', 'party', {
      changedFrom: 'external',
      roleSince: '2026-10-28T14:03:00Z',
      roleStoryIds: ['st_1', 'st_2'],
    }),
    actor('egypt', 'external', {
      learned: true,
      roleSince: '2026-10-28T14:30:00Z',
      roleStoryIds: ['st_3'],
    }),
  ];
  const changes = roleChanges(actors);
  assert.deepEqual(
    changes.map((change) => roleChangeLine(change, NOW, UTC)),
    ['Egypt: added as external · 14:30', 'Saudi: external → party · 14:03'],
  );
  assert.deepEqual(changes[1].storyIds, ['st_1', 'st_2']);
  assert.equal(
    actorRoleNote(actors[1], NOW, UTC),
    'Party since 14:03, on 2 corroborated stories',
  );
  assert.equal(
    actorRoleNote(actors[0], NOW, UTC),
    'Party: starting role from the theater file',
  );
});

test('track badges follow the theater; a track the brief left out has no reading', () => {
  const tracks = [
    { id: 'military', label: 'Military' },
    { id: 'diplomatic', label: 'Diplomatic' },
  ];
  assert.deepEqual(trackBadges(tracks, brief), [
    {
      id: 'military',
      label: 'Military',
      state: 'escalating',
      stateLabel: 'escalating',
      glyph: '↑',
      reason: 'R.',
      storyIds: ['a'],
    },
    {
      id: 'diplomatic',
      label: 'Diplomatic',
      state: null,
      stateLabel: 'no cited reading',
      glyph: '·',
      reason: '',
      storyIds: [],
    },
  ]);
  assert.deepEqual(TRACK_STATE_GLYPHS, {
    escalating: '↑',
    easing: '↓',
    stalled: '–',
    shifting: '↔',
    unclear: '?',
  });
});

test('horizons read as plain time spans; storage keys are per theater', () => {
  assert.equal(horizonLabel('days'), 'within days');
  assert.equal(horizonLabel('months'), 'within months');
  assert.equal(horizonLabel(null), 'no time horizon given');
  assert.equal(
    lastSeenKey('iran-israel-us'),
    'godsEyeView.v1.situationLastSeen.iran-israel-us',
  );
});
