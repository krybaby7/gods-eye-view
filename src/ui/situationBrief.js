/**
 * The Situation Brief section at the top of the Situation panel. Collapsed:
 * headline, change lines, track badges and the Coverage line. Expanded: the
 * actor strip, why now, who is affected, scenarios with signposts and what
 * is poorly known. Every model-written line is a button that opens the
 * stories it cites; code writes the Coverage line, the AI-analysis label,
 * the brief's age and Retry brief. Text is written as text, never markup.
 */
import { newsCoverage } from '../layers/news/coverage.js';
import {
  BRIEF_EXPANDED_KEY,
  actorRoleNote,
  actorStrip as actorStripModel,
  roleChangeLine,
  roleChanges,
  briefAgeLine,
  briefMetaLine,
  briefRunLine,
  horizonLabel,
  retryBriefState,
  trackBadges,
} from './situationBriefModel.js';

const MORE_ID = 'situation-brief-more';

const cites = (storyIds) =>
  storyIds.length === 1
    ? 'Opens the cited story'
    : `Opens the ${storyIds.length} cited stories`;

/**
 * @param {{
 *   h: Function,
 *   replaceChildren: Function,
 *   layer: object,
 *   now: () => number,
 *   storage?: ?Storage,
 *   onOpenStories: (storyIds: string[]) => void,
 * }} options
 * @returns {{root: HTMLElement, render: (snapshot: object) => void}}
 */
export function createSituationBrief({
  h,
  replaceChildren,
  layer,
  now,
  storage,
  onOpenStories,
}) {
  let expanded = false;
  try {
    expanded = storage?.getItem(BRIEF_EXPANDED_KEY) === '1';
  } catch {
    // storage unavailable: collapsed
  }
  const root = h('section', {
    className: 'situation-brief',
    'aria-label': 'Situation brief',
  });
  let snapshot = null;

  function setExpanded(next) {
    expanded = next;
    try {
      storage?.setItem(BRIEF_EXPANDED_KEY, next ? '1' : '0');
    } catch {
      // storage unavailable: the choice lasts this page only
    }
    root.dataset.key = '';
    render(snapshot);
  }

  function lineButton(line, focusKey, className = '') {
    return h(
      'button',
      {
        type: 'button',
        className: `situation-brief-line${className ? ` ${className}` : ''}`,
        'data-focus-key': focusKey,
        'data-story-ids': line.storyIds.join(' '),
        title: cites(line.storyIds),
        onClick: () => onOpenStories(line.storyIds),
      },
      line.text,
    );
  }

  const lineList = (lines, prefix, label) =>
    h(
      'ul',
      { className: 'situation-brief-lines', 'aria-label': label },
      lines.map((line, index) =>
        h('li', {}, lineButton(line, `${prefix}-${index}`)),
      ),
    );
  const heading = (text) => h('p', { className: 'situation-subhead', text });
  const muted = (text) => h('p', { className: 'situation-note', text });

  function trackRow(badges) {
    if (!badges.length) return null;
    return h(
      'div',
      {
        className: 'situation-tracks',
        role: 'group',
        'aria-label': 'Which way it is moving',
      },
      badges.map((badge) =>
        h(
          'button',
          {
            type: 'button',
            className: 'situation-track',
            'data-state': badge.state || 'none',
            'data-focus-key': `track-${badge.id}`,
            'data-story-ids': badge.storyIds.join(' '),
            disabled: !badge.storyIds.length,
            title: badge.reason
              ? `${badge.reason} ${cites(badge.storyIds)}.`
              : 'The brief gave no cited reading for this track',
            'aria-label': `${badge.label}: ${badge.stateLabel}`,
            onClick: () => onOpenStories(badge.storyIds),
          },
          h('span', { className: 'situation-track-label', text: badge.label }),
          h(
            'span',
            { className: 'situation-track-state' },
            h('span', { 'aria-hidden': 'true', text: badge.glyph }),
            ` ${badge.stateLabel}`,
          ),
        ),
      ),
    );
  }

  function actorFilterLine(snap) {
    const actor = (snap.theater?.actors || []).find(
      (entry) => entry.id === snap.actorFilter,
    );
    if (!actor) return null;
    return h(
      'p',
      { className: 'situation-brief-filter' },
      `Showing stories involving ${actor.name} · `,
      h('button', {
        type: 'button',
        className: 'situation-link-button',
        'data-focus-key': 'actor-clear',
        text: 'Show all',
        onClick: () => layer.setActorFilter?.(null),
      }),
    );
  }

  function actorStrip(snap, nowMs) {
    const active = snap.actorFilter;
    const { groups, hidden } = actorStripModel(
      snap.theater?.actors,
      snap.stories,
      { activeId: active },
    );
    if (!groups.length) return null;
    const activeActor = (snap.theater?.actors || []).find(
      (entry) => entry.id === active,
    );
    const note = (snap.brief?.actorRoles || []).find(
      (entry) => entry.actorId === active,
    );
    const changes = roleChanges(snap.theater?.actors);
    return [
      heading('Who is involved'),
      h(
        'div',
        {
          className: 'situation-actors',
          role: 'group',
          'aria-label': 'Actors',
        },
        groups.map((group) =>
          h(
            'div',
            { className: 'situation-actor-group' },
            h('span', { className: 'situation-actor-role', text: group.label }),
            group.actors.map((actor) =>
              h(
                'button',
                {
                  type: 'button',
                  className: 'situation-actor data-toggle-chip',
                  'aria-pressed': active === actor.id ? 'true' : 'false',
                  'data-actor-id': actor.id,
                  'data-focus-key': `actor-${actor.id}`,
                  title: `${
                    active === actor.id
                      ? 'Show all stories again'
                      : `Show only stories involving ${actor.name} (${actor.typeLabel}, ${actor.count} open)`
                  }. ${actorRoleNote(actor, nowMs)}.`,
                  onClick: () =>
                    layer.setActorFilter?.(
                      active === actor.id ? null : actor.id,
                    ),
                },
                actor.name,
                h('span', {
                  className: 'situation-actor-type',
                  text: actor.typeLabel,
                }),
                h('span', {
                  className: 'situation-actor-count',
                  text: String(actor.count),
                }),
              ),
            ),
          ),
        ),
      ),
      hidden
        ? h('p', {
            className: 'situation-note',
            text: `${hidden} more ${hidden === 1 ? 'actor has' : 'actors have'} no open stories and ${hidden === 1 ? 'is' : 'are'} not shown.`,
          })
        : null,
      activeActor
        ? h(
            'p',
            { className: 'situation-actor-role-note' },
            activeActor.roleStoryIds.length
              ? h('button', {
                  type: 'button',
                  className: 'situation-link-button',
                  'data-focus-key': 'actor-role-evidence',
                  'data-story-ids': activeActor.roleStoryIds.join(' '),
                  text: actorRoleNote(activeActor, nowMs),
                  onClick: () => onOpenStories(activeActor.roleStoryIds),
                })
              : actorRoleNote(activeActor, nowMs),
          )
        : null,
      note ? lineButton(note, 'actor-note', 'situation-actor-note') : null,
      changes.length
        ? h(
            'div',
            { className: 'situation-role-changes' },
            h('p', {
              className: 'situation-brief-kicker',
              text: 'Role changes, set from corroborated stories',
            }),
            h(
              'ul',
              {
                className: 'situation-brief-lines',
                'aria-label': 'Role changes',
              },
              changes.map((change) =>
                h(
                  'li',
                  {},
                  lineButton(
                    {
                      text: roleChangeLine(change, nowMs),
                      storyIds: change.storyIds,
                    },
                    `role-change-${change.actorId}`,
                    'situation-role-change',
                  ),
                ),
              ),
            ),
          )
        : null,
    ];
  }

  function whyNow(snap, brief) {
    const drivers = snap.theater?.drivers || [];
    return [
      heading('Why now'),
      brief.trigger
        ? lineButton(brief.trigger, 'trigger')
        : muted('The stories show no single trigger.'),
      drivers.length
        ? h(
            'div',
            { className: 'situation-drivers' },
            h('p', {
              className: 'situation-brief-kicker',
              text: 'Background, curated (not AI)',
            }),
            h(
              'ul',
              {},
              drivers.map((driver) =>
                h(
                  'li',
                  {},
                  `${driver.text} `,
                  driver.source.url
                    ? h('a', {
                        href: driver.source.url,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        className: 'situation-open-original',
                        text: driver.source.name,
                      })
                    : `(${driver.source.name})`,
                ),
              ),
            ),
          )
        : null,
    ];
  }

  function scenarioCards(brief) {
    if (!brief.scenarios.length)
      return muted('No scenarios: fewer than two could be cited.');
    return brief.scenarios.map((scenario, index) =>
      h(
        'article',
        { className: 'situation-scenario', 'aria-label': scenario.title },
        h(
          'p',
          { className: 'situation-scenario-head' },
          h('span', {
            className: 'situation-scenario-title',
            text: scenario.title,
          }),
          h('span', {
            className: 'situation-scenario-horizon',
            text: horizonLabel(scenario.horizon),
          }),
        ),
        lineButton(
          { text: scenario.text, storyIds: scenario.storyIds },
          `scenario-${index}`,
        ),
        scenario.signposts.length
          ? h(
              'ul',
              {
                className: 'situation-signposts',
                'aria-label': 'Signposts to watch',
              },
              scenario.signposts.map((signpost, at) =>
                h(
                  'li',
                  {},
                  signpost.seenIn.length
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'situation-signpost-seen',
                          'data-focus-key': `signpost-${index}-${at}`,
                          'data-story-ids': signpost.seenIn.join(' '),
                          title: `Seen. ${cites(signpost.seenIn)}`,
                          onClick: () => onOpenStories(signpost.seenIn),
                        },
                        h('span', { 'aria-hidden': 'true', text: '✓ ' }),
                        'seen',
                      )
                    : h('span', {
                        className: 'situation-signpost-open',
                        text: 'not yet seen',
                      }),
                  ` ${signpost.text}`,
                ),
              ),
            )
          : null,
      ),
    );
  }

  function render(next) {
    snapshot = next;
    // A theater with the Brief off (World) shows nothing here.
    if (!snapshot?.ready || snapshot.theater?.situationBrief === false) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const nowMs = now();
    const brief = snapshot.brief;
    const coverage = newsCoverage({
      sources: snapshot.sources,
      perspectives: snapshot.theater?.perspectives,
      items: snapshot.items,
      stories: snapshot.stories,
      nowMs,
    });
    const badges = trackBadges(snapshot.theater?.tracks, brief);
    const retry = retryBriefState(snapshot);
    const meta = brief ? briefMetaLine(brief, nowMs) : '';
    const age = briefAgeLine(brief, snapshot.briefStatus, nowMs);
    const failure = briefRunLine(snapshot.briefRun, snapshot.briefStatus);
    const strip = actorStripModel(snapshot.theater?.actors, snapshot.stories, {
      activeId: snapshot.actorFilter,
    });
    const key = JSON.stringify([
      brief,
      expanded,
      snapshot.actorFilter,
      coverage,
      badges,
      retry,
      meta,
      age,
      failure,
      strip,
      snapshot.theater?.actors,
      snapshot.theater?.drivers,
    ]);
    if (root.dataset.key === key) return;
    root.dataset.key = key;
    root.classList.toggle(
      'situation-brief-expanded',
      Boolean(brief && expanded),
    );

    const head = h(
      'div',
      { className: 'situation-brief-head' },
      h('p', { className: 'situation-subhead', text: 'Situation brief' }),
      brief
        ? h('button', {
            type: 'button',
            className: 'situation-link-button situation-brief-toggle',
            'aria-expanded': expanded ? 'true' : 'false',
            'aria-controls': MORE_ID,
            'data-focus-key': 'brief-toggle',
            text: expanded ? 'Show less' : 'Show more',
            onClick: () => setExpanded(!expanded),
          })
        : null,
    );
    const status = [
      meta ? h('p', { className: 'situation-brief-meta', text: meta }) : null,
      age ? h('p', { className: 'situation-brief-age', text: age }) : null,
      failure
        ? h('p', {
            className: 'situation-brief-failure panel-surface-error',
            role: 'status',
            text: failure,
          })
        : null,
      retry.visible
        ? h('button', {
            type: 'button',
            className: 'panel-surface-control situation-brief-retry',
            'data-focus-key': 'retry-brief',
            disabled: retry.disabled,
            title: retry.reason,
            text: 'Retry brief',
            onClick: (event) => {
              if (event.currentTarget?.disabled) return;
              void layer.requestBrief?.();
            },
          })
        : null,
    ];
    const coverageLine = h('p', {
      className: 'situation-brief-coverage',
      text: coverage.summary,
    });
    if (!brief) {
      replaceChildren(
        root,
        head,
        failure
          ? null
          : muted(
              'No brief yet. After each Refresh, a brief is written from the digested stories.',
            ),
        actorFilterLine(snapshot),
        coverageLine,
        status,
      );
      return;
    }
    const more = h('div', {
      id: MORE_ID,
      className: 'situation-brief-more',
      hidden: !expanded,
    });
    if (expanded)
      more.append(
        ...[
          actorStrip(snapshot, nowMs),
          whyNow(snapshot, brief),
          heading('Who is affected'),
          brief.affected.length
            ? lineList(brief.affected, 'affected', 'Who is affected')
            : muted('No cited lines on civilians in this brief.'),
          heading('What could happen next'),
          scenarioCards(brief),
          heading('What we know poorly'),
          brief.unknowns.length
            ? lineList(brief.unknowns, 'unknown', 'What we know poorly')
            : muted('The brief named no unknowns.'),
          coverageLine,
          coverage.details.length
            ? h(
                'ul',
                {
                  className: 'situation-brief-coverage-details',
                  'aria-label': 'Coverage',
                },
                coverage.details.map((detail) => h('li', { text: detail })),
              )
            : null,
        ]
          .flat()
          .filter(Boolean),
      );
    // The label, the age and a failure stay right under the badges, so they
    // are seen without scrolling in either view.
    replaceChildren(
      root,
      head,
      lineButton(brief.headline, 'headline', 'situation-brief-headline'),
      brief.changes.length
        ? lineList(brief.changes, 'change', 'What changed')
        : null,
      trackRow(badges),
      status,
      expanded ? null : coverageLine,
      expanded
        ? h(
            'ul',
            {
              className: 'situation-brief-lines situation-track-reasons',
              'aria-label': 'Track reasons',
            },
            badges
              .filter((badge) => badge.reason)
              .map((badge) =>
                h(
                  'li',
                  {},
                  lineButton(
                    {
                      text: `${badge.label}: ${badge.reason}`,
                      storyIds: badge.storyIds,
                    },
                    `track-reason-${badge.id}`,
                  ),
                ),
              ),
          )
        : null,
      actorFilterLine(snapshot),
      more,
    );
  }

  return { root, render };
}
