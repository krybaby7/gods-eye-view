import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRACK_STATE_GLYPHS,
  actorGroups,
  briefAgeLine,
  briefMetaLine,
  briefRunLine,
  briefStoryIds,
  horizonLabel,
  lastSeenKey,
  retryBriefState,
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
  actorNotes: [{ actorId: 'oman', text: 'N.', storyIds: ['g'] }],
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
        actorNotes: [],
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

test('actors group by role in theater order, never by side, with their open story counts', () => {
  const actors = [
    { id: 'iran', name: 'Iran', type: 'state', role: 'party' },
    { id: 'oman', name: 'Oman', type: 'state', role: 'mediator' },
    { id: 'hamas', name: 'Hamas', type: 'armed-group', role: 'party' },
    { id: 'gaza', name: 'Civilians', type: 'population', role: 'affected' },
  ];
  const stories = [
    { id: 'a', status: 'open', actorIds: ['iran', 'hamas'] },
    { id: 'b', status: 'open', actorIds: ['iran'] },
    { id: 'c', status: 'closed', actorIds: ['oman'] },
  ];
  assert.deepEqual(actorGroups(actors, stories), [
    {
      role: 'party',
      label: 'Parties',
      actors: [
        { ...actors[0], typeLabel: 'state', count: 2 },
        { ...actors[2], typeLabel: 'armed group', count: 1 },
      ],
    },
    {
      role: 'mediator',
      label: 'Mediators',
      actors: [{ ...actors[1], typeLabel: 'state', count: 0 }],
    },
    {
      role: 'affected',
      label: 'Affected',
      actors: [{ ...actors[3], typeLabel: 'population', count: 0 }],
    },
  ]);
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
