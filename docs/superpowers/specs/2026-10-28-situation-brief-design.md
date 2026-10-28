# Situation Brief: the political view

Date: 2026-10-28. Status: design, location agreed with the owner, not built.
Builds on `2026-10-25-war-monitor-design.md` (fork PR krybaby7/gods-eye-view#1) and a Perplexity
deep research run on the questions that explain a political situation (summary in section 11).

## 0. Shape in one paragraph

The war monitor turns news into stories: one pin per real event, with claims, sources and a
verification label. The Brief sits on top of the stories and explains the whole crisis in under
two minutes: what changed, who is involved, why now, who is affected, which way it is moving,
what could come next and what is poorly known. It is a card at the top of the existing Situation
panel. A second model call writes it on each Refresh, right after the story digest, and every
sentence must cite stories; code drops any sentence that does not. The map still answers
"where"; the Brief answers "so what". It is a situation brief, never a scoreboard.

## 1. Decisions (owner, 2026-10-28)

- The Brief lives at the top of the war monitor's Situation panel. No new mode, no HUD or camera
  takeover.
- Lenses stay as they are: a lens only turns layers on and off. Conflict gains the `news` layer
  once PR #1 is merged (already planned in the lenses spec).
- PR #1's must-fixes are done and PR #1 is merged before the Brief is built.

## 2. The screen: eight questions, who answers each

| # | Question | Shown as | Written by |
|---|---|---|---|
| 1 | What changed? | Headline sentence and up to three change lines; a "new since your last visit" marker on stories and pins | Model (cited); the marker is code |
| 2 | Where? | The existing pins, plus a **Frame theater** button that flies to all located open stories | Code |
| 3 | Who is involved? | Actor strip: one chip per actor with its type and role; clicking a chip filters stories and pins to that actor | Curated actor list; story tagging by the model |
| 4 | Why now? | One trigger line, then up to three deeper drivers | Trigger: model (cited). Drivers: curated in the theater file |
| 5 | Who is affected? | Up to three lines on civilians, displacement, access and services | Model (cited), from the humanitarian stories |
| 6 | Which way is it moving? | One named state per track: military, diplomatic, humanitarian | Model (cited), states from a fixed list |
| 7 | What could happen next? | Two or three scenario cards, each with a time horizon and signposts to watch | Model (cited); signposts marked "seen" only with a citing story |
| 8 | What do we know poorly? | Up to three unknowns, plus a Coverage line | Unknowns: model (cited). Coverage: code, from source health |

The research ranks these as the minimum situation screen. Questions 1, 6 and 8 must be visible
without expanding anything.

## 3. Data

### 3.1 Theater file additions (`public/news/theaters/<id>.json`)

```json
{
  "actors": [
    { "id": "iran", "name": "Iran", "type": "state", "role": "party", "aliases": ["IRGC", "Tehran"] },
    { "id": "oman", "name": "Oman", "type": "state", "role": "mediator", "aliases": ["Muscat"] },
    { "id": "iaea", "name": "IAEA", "type": "institution", "role": "institution", "aliases": [] },
    { "id": "civilians-lebanon", "name": "Civilians in Lebanon", "type": "population", "role": "affected", "aliases": [] }
  ],
  "drivers": [
    { "text": "One sentence on a long-running cause.", "source": { "name": "Crisis Group", "url": "https://..." } }
  ],
  "tracks": [
    { "id": "military", "label": "Military" },
    { "id": "diplomatic", "label": "Diplomatic" },
    { "id": "humanitarian", "label": "Humanitarian" }
  ]
}
```

- `type`: state | armed-group | institution | population.
- `role`: party | mediator | institution | affected | external. Curated roles only record what is
  not in dispute. Who backs whom is contested and changes, so it is left to cited relationships
  (section 9, Phase B), never written into the actor list.
- Drivers change slowly and are opinion-prone, so they are curated with a source link, not
  generated. At most three.
- Claude drafts the Iran / Israel / US actor list and drivers during the build; the owner reviews
  them before merge.

### 3.2 Story additions (digest output)

- `kind`: `event` (something that happened at a place: a strike, a protest) or `development` (a
  change with no meaningful point: a sanction, talks, a ruling, a mobilisation order). The model
  sets it. A development gets no pin; it appears in the Stories list and the Brief.
- `actorIds`: actors the story involves, from the theater's actor list only. The model chooses by
  id; code drops unknown ids. Claim `actor` text stays as it is.

### 3.3 Brief record (what the brief pass produces, after code checks)

```json
{
  "id": "br_3c9d",
  "theater": "iran-israel-us",
  "digestRunId": "run_...",
  "createdAt": "2026-10-28T14:03:10Z",
  "headline": { "text": "One neutral sentence.", "storyIds": ["st_7f3a"] },
  "changes": [{ "text": "...", "storyIds": ["..."] }],
  "trigger": { "text": "...", "storyIds": ["..."] },
  "tracks": [{ "id": "military", "state": "escalating", "reason": "...", "storyIds": ["..."] }],
  "affected": [{ "text": "...", "storyIds": ["..."] }],
  "scenarios": [
    {
      "title": "Talks resume in Muscat",
      "horizon": "weeks",
      "text": "...",
      "storyIds": ["..."],
      "signposts": [{ "text": "Both delegations confirm a date", "seenIn": [] }]
    }
  ],
  "unknowns": [{ "text": "...", "storyIds": ["..."] }],
  "actorNotes": [{ "actorId": "oman", "text": "...", "storyIds": ["..."] }]
}
```

- Track `state`: escalating | easing | stalled | shifting | unclear. `unclear` is the honest answer
  when the stories do not show a direction, and the model is told so.
- `horizon`: days | weeks | months. No probabilities anywhere.
- Limits: changes 3, affected 3, unknowns 3, scenarios 2 to 3, signposts 4 per scenario, one
  actor note per actor. Code enforces them.

**The model owns:** all text, track states, scenario horizons, which stories each line cites and
which signposts it marks seen.

**Code owns, and the model cannot set:**
- Citations: every `storyIds` and `seenIn` entry is checked against the open and recently closed
  stories. Unknown ids are dropped and counted. A line left with no valid story is dropped,
  except a signpost, which may have none (not seen yet). A Brief with no valid headline is
  rejected and the previous one stays.
- Coverage line: sources reporting stale, error or blocked, grouped by perspective; perspectives
  with no item in 24 h ("No Iranian state media in 24 h"); open stories without a location.
- The "new since your last visit" marker, the AI-analysis label and the Brief's age.
- Verification labels stay exactly as the war monitor computes them.

## 4. Brief run protocol

Trigger: the same Refresh. After a successful digest commits its stories, the server runs the
brief pass. A skipped or failed digest runs no brief.

Input assembled by code:
1. Fixed instructions (cacheable): role; the rules in section 8 in model-facing form; "cite story
   ids only; a sentence you cannot cite, leave out; use `unclear` rather than guess a direction;
   describe what parties say as their claims".
2. Theater brief, actor list, drivers and tracks (cacheable).
3. The previous Brief, so "changes" are relative to it.
4. Open stories and stories closed in the last 72 h: id, kind, title, summary, category, place,
   eventAt, updatedAt, whatsNew, claims (text, actor, type, status), contradictions,
   verification, perspectives, actorIds. Cap 80, most recently updated first.
5. Source health summary (the same rows the panel shows).

Request: the same Perplexity Agent API call shape as the digest (`anthropic/claude-sonnet-5-5`,
no tools, one step, strict JSON schema), with `max_output_tokens: 16000`. Hidden reasoning
counts toward that limit (3,100 to 3,700 tokens in the two live digests), and only tokens actually
written are billed. The Brief stays a separate call from the digest so a failed Brief never costs
the stories, and so it reads finished stories rather than raw items.

Cost and budget: expected about 10 to 15 cents a run (the digests cost more than estimated, mostly
from Perplexity's cache-write charge on the input); the first live runs measure it. Brief runs go
into the same run log with `kind: "brief"` (old records read as `"digest"`), so the existing daily
budget covers both. Before the call, code checks that the remaining budget covers a worst-case
brief; if not, the Brief is skipped with the reason shown.

Failure: stories from the digest are kept. The previous Brief stays on screen, marked with its
age ("Brief from 14:02, one digest behind"), and a **Retry brief** button appears. It is the only
way to run a brief without a digest.

Storage: the current and previous Brief live in the theater's digest file next to the stories.
`GET /api/news` adds `brief` and `briefRun` to its snapshot.

## 5. UI

The Brief is a section in `#situation-panel` between the Refresh controls and the category chips.

- **Collapsed (default):** headline, change lines and the three track badges, plus "AI analysis
  · 14:03 · cites 12 stories". This is the part that stays visible while exploring stories.
- **Expanded:** adds the actor strip, why now, who is affected, scenarios with signposts, and
  what we know poorly with the Coverage line. Expanded or collapsed is remembered per viewer like
  the panel's other disclosure state.
- **Every line opens its stories:** clicking a line selects the first cited story (fly-to when it
  has a location) and highlights the others in the Stories tab.
- **Track badges:** the state as a word plus a small direction glyph. Colours stay neutral; red
  and green are not used to mean bad and good.
- **Actor strip:** chips in the theater's order, grouped by role. Each actor has its own identity;
  sides are never colour-coded. Clicking a chip filters the Stories list and the `news` pins to
  stories tagged with that actor, alongside the category toggles; clicking again clears it.
- **Scenario cards:** title, horizon, two sentences, signposts with a "seen" tick when a story
  cites them. The tick opens that story.
- **New since your last visit:** stories updated after the digest the viewer last saw get a quiet
  marker on the row and the pin, distinct from the verification ring. "Last seen" is stored per
  viewer and theater, and moves to the current digest when the panel closes or the page is
  hidden.
- **Frame theater:** next to Refresh; flies to the bounding box of located open stories using the
  same world-focus request as a story click.
- Follows `docs/panel-surfaces.md`, the Cyber one-panel rule and the 720 px layout, like the rest
  of the Situation panel.

## 6. What stays as it is

The story digest, verification rules, pins, category toggles, Raw feed tab, budget and no-timer
rule from the war monitor design. Lenses and the DATA LAYERS panel.

## 7. Open points, with recommendations

1. **Brief on every Refresh, or its own button?** Recommendation: on every Refresh, so one press
   gives one consistent picture; Retry brief covers failures.
2. **Developments without pins.** A ceasefire talk in Doha has a place, but a pin there suggests
   something happened in Doha. Recommendation: no pin for developments; revisit after a week of
   use.
3. **Actor list size.** Recommendation: 12 to 16 actors for this theater, so the strip fits one
   or two rows.

## 8. Rules the Brief never breaks

From the research's pitfalls list, cut to what applies here:

- No single crisis score, health bar, tension percentage or "x% toward war".
- No two coloured teams. Roles, not sides.
- No rolling casualty counters, deltas, sounds, explosion effects or winning and losing language.
  Casualty figures appear only inside cited lines, attributed, with their source.
- No single forecast. Two or three scenarios, no probabilities.
- A party's claim is written as that party's claim. Verification labels come from code.
- Quiet is not calm: the Coverage line says when sources are down or silent.
- Every sentence is labelled AI analysis and opens its stories.

## 9. Phases

- **Before:** PR #1 must-fixes (GDELT query length, `qa-news.mjs` main guard on Windows,
  digest output headroom), merge PR #1, add `news` to the Conflict lens.
- **Phase A (one PR):** theater `actors`, `drivers`, `tracks`; story `kind` and `actorIds`;
  brief runner, validation, storage and route fields; the Brief section, actor filter, new-since
  marker and Frame theater; tests and QA.
- **Phase B:** quiet event cards over the globe for major developments (once per development, no
  sound, "Fly there" and "Open story"); typed, cited actor relationships (backs, supplies,
  mediates, sanctions) with optional arcs, off by default; human-impact figures from ReliefWeb
  once the appname exists; voice ("what's the situation?") reading the headline and tracks.
- **Phase C:** a turning-points timeline, which needs the war monitor's Phase 3 story history.
- **Not planned:** front-line or control maps. The good sources are bot-protected (ISW) or need an
  account and licence (ACLED), and drawing control lines without real data would be the most
  misleading thing the app could show.

## 10. Tests

- Theater validation: actor ids unique, types and roles from the lists, at most three drivers,
  track ids unique.
- Digest validation: `kind` defaults to `event`; unknown `actorIds` are dropped and counted.
- Brief validation: unknown story ids dropped; uncited lines dropped; signposts may be empty;
  limits enforced; track states and horizons clamped; a Brief with no headline is rejected and
  the previous one kept.
- Run protocol: brief runs only after a successful digest; brief failure keeps the stories;
  budget counts brief runs; over-budget skip shows its reason; Retry brief works only after a
  failure.
- Coverage line from source health and item timestamps.
- Panel DOM: collapsed and expanded states; every line opens its stories; the actor filter
  combines with category toggles; the new-since marker follows the stored last-seen digest.
- Browser QA with a fixture Brief: Cyber theme, 720 px and 390 px widths, no horizontal scroll.

## 11. Research basis

Perplexity deep research, run by the owner and pasted on 2026-10-28. Main conclusions used:

- Professional frameworks (PMESII-PT, UN conflict analysis, intelligence tradecraft) and audience
  research converge on actors, causes, dynamics, indicators, assumptions and civilian effects.
  Readers want "update me", "educate me" and "give me perspective".
- The eight-question minimum screen in section 2, in that order.
- Useful patterns: a pinned situation log (Stellaris), one-job map modes (Civilization VI's
  lenses, which the app's lenses already follow), named direction-of-travel states (CrisisWatch),
  signpost lists (intelligence indicators and warnings), evidence stacks (Bellingcat-style).
- Pitfalls in section 8.

Deliberately not adopted: the research's five-object model (Event, Development, Assessment,
Indicator, Situation) is cut to story `kind` plus one Brief; newsroom steps such as human review
and usability testing in several languages do not fit a personal app; a few of its citations are
second-hand (a newspaper article for ACLED's index, a dataset page for GDELT's cadence), which
changes none of the conclusions.
