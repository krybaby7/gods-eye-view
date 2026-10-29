# Hotspot view: orchestrated versus single-agent build, measured

Date: 2026-10-29. Purpose: build the same feature twice from the same spec and commit, once by an
orchestrator told to use a hardcoded sub-agent structure with Haiku 5.5 in it (run A) and once
by Claude working as it does by default (run B: free to spawn its own built-in sub-agents, which
run on the main model, so in practice it never uses Haiku), and compare wall-clock time, tokens
per model, estimated cost and quality. The question is whether forcing Haiku 5.5 into the
structure pays, against the default. The feature is the hotspot view
(`docs/superpowers/specs/2026-10-29-world-hotspot-view-design.md`).

The prompts: `2026-10-29-hotspot-view-prompt-orchestrated.md` (run A) and
`2026-10-29-hotspot-view-prompt-single.md` (run B). They share every rule, file list and
deliverable, including a delegation table in the PR; run A adds the sub-agent section, run B
says to work as usual with or without sub-agents. Run A's structure comes from
`../research/2026-10-29-haiku-55-subagent-evidence.md`, whose most relevant finding is
Anthropic's own October 2026 experiment: Opus 5.5 with Haiku 5.5 workers cost about 30% less
per attempt than Opus 5.5 alone and passed 3 to 4 points fewer tasks, with no demonstrated
advantage over simply running Opus 5.5 at lower effort. That is the prior this trial tests.

**Optional run C, the control the evidence asks for:** the run B prompt again, in a third
worktree (`gev-hotspot-c`, branch `feat/hotspot-view-c`, port 5183), with the session's effort
set one level below runs A and B. If run A beats run B on cost but not run C, the sub-agent
structure is not what saved the money.

## 1. Setup (owner, before either run)

1. Commit nothing from the working tree. Note the base commit: `git rev-parse main`.
2. Two worktrees from that commit, each on its own branch:

```bash
git worktree add ../gev-hotspot-a -b feat/hotspot-view-a main
```

```bash
git worktree add ../gev-hotspot-b -b feat/hotspot-view-b main
```

3. In each worktree: `npm ci`. The spec, the prompt files and `scripts/measure-session-usage.mjs`
   are untracked on main, so copy them into both worktrees before starting (the prompts tell
   the agent where they are). Copy `.claude/agents/` (scout, runner, editor, builder) into
   worktree A only; run B must not have them, so its Claude has only the built-in agents
   (Explore, general-purpose, Plan) that it would use on any other day. Commit these untracked files in each worktree
   first, in one "chore: hotspot view spec and plan" commit, so the feature diff stays clean.
4. Open two fresh Claude Code sessions, one per worktree, same model (Claude Opus 5.5), same
   effort, same permission mode, fast mode off in both. No shared memory beyond what the app
   loads for every session. Record each session id (the file name under
   `~/.claude/projects/C--Users-adami-projects-Hobby-Tier-1-gods-eye-view/`; a worktree session
   lands under its own slug, so note the folder).
5. Paste the whole prompt file as the first message. Start both within a few minutes of each
   other, or run them one after the other at the same time of day; say which in the results.
6. Do not help either run. Answer a question only with "make the call the spec points to and
   list it in the PR". Count every message you had to send.
7. Each run gets a different dev-server port for QA (the prompts say so), so they can run at the
   same time.

## 2. What is measured

| Measure | How | Notes |
|---|---|---|
| Wall clock | `node scripts/measure-session-usage.mjs <session-id>` (first user message to last assistant message) | Idle time counts; keep both sessions attended the same way |
| Tokens per model | the same script: input, cache writes by TTL, cache reads, output, thinking, calls; main session and sub-agents apart | Sub-agents are read from `<session-id>/subagents/`; the prompt forbids linked sessions and workflows so nothing escapes the count. Check `/tasks` during run A to confirm which model each sub-agent ran on |
| Delegation outcomes | each PR's delegation table: per call, agent, model, used as is / reworked / discarded | Run B's table shows what Claude delegates on its own and to which model; run A's shows where the Haiku savings went and the Haiku implementation trial's result |
| Model mix | the usage script's per-model rows for sub-agents | Expect run B's sub-agents, if any, on Opus 5.5; run A's on Haiku 5.5 and Sonnet 5.5 |
| Estimated cost | the script's price table (list rates, editable) | A subscription bills differently; tokens are the primary comparison |
| Owner attention | number of owner messages after the prompt; minutes the owner spent reading the PR | Written down by the owner |
| Quality | section 3 | Scored by a reviewer who does not know which run is which |

## 3. Quality rubric

Scored per run by one reviewer in a fresh session (Claude Opus 5.5), given both branches under
neutral names (`run-1`, `run-2`, assigned by a coin flip the owner records), the spec, and this
rubric. The reviewer runs the checks itself; it does not trust the PR description.

**Gates** (fail any: the run fails):

- `npm test`, `npm run build`, `npm run format:check`, `npm run check:boundaries`,
  `npm run layer-token:check -- --base-ref <base commit>` all pass on the branch.
- `scripts/qa-news.mjs --fixtures` passes, with the new steps, and the screenshots exist.
- The diff contains nothing from the owner's uncommitted imagery-clarity work.

**Spec compliance** (one point each, 24):

1. `server/providers/news/hotspots.js` exists, is pure, and is registered in
   `scripts/package-boundaries.json`.
2. Hotspot is applied in `service.snapshot()`; the digest file format is unchanged.
3. `normalizeStory` passes `hotspot` through.
4. Rule 1 (explicit link) with test.
5. Rule 2 (region or water row) with test.
6. Rule 3 (country, placed at the country row) with test, and the no-country-row average case.
7. Rule 4 (model-placed within 100 km) with test.
8. Rule 5 (`place:` and `point:` keys) with test, including two stories sharing a `place:` key.
9. Stale gazetteer name treated as model-placed; no location and developments get no hotspot.
10. Registry accepts, validates and keeps `hotspot`; a city or unknown target fails.
11. Far-match guard in `resolveLocation` with `farMatches` in the run record, with tests.
12. `CITY_MIN_POPULATION` 300,000; `CITY_HOTSPOTS`, `TOWNS` and `CITY_ALIASES` additions;
    the script logs a hand town that duplicates a Natural Earth row; `toEntry` writes `hotspot`.
13. `world.json` regenerated; the PR reports the counts before and after.
14. `iran-israel-us.json` has `hotspot` links and no new rows.
15. Mode switch at 3,500 km / 3,000 km with hysteresis, evaluated in the preRender callback
    before the horizon early return, on enable and on snapshot apply.
16. Bubble SVG: square-root size 22 to 54 px, category ring in theater order, count, new-since
    dot, selected outline; tests.
17. Pins and bubbles never coexist; no story cards and no entity contexts in bubble mode.
18. Bubbles count only visible pinned stories; an emptied bubble disappears; horizon culling.
19. Hover card with the stated title, up to three titles newest first, and the counts line.
20. `focusHotspot` requests kind `hotspot` with the enclosing radius; `src/worldFocus.js` has
    the `hotspot` framing with the 1,000 km cap; tests.
21. Place filter: snapshot `placeFilter` and `visibleStories`; the layer's own `visibleStories()`
    untouched; cleared by ✕, theater switch, `disable()`, replaced by another bubble.
22. Panel chip with the accessible name, empty-list note, cited hint.
23. `docs/WAR-MONITOR.md` paragraph and table row.
24. PR description has every section the prompt asks for and names what was not verified.

**Defects** (minus one each, found by the reviewer running the app against fixtures and by
`/code-review` at the same level on both branches): a wrong behaviour against the spec, a test
that passes without testing the rule, a console error, a regression in the existing QA steps.

**Honesty** (recorded, not scored): claims in the PR description that the reviewer could not
reproduce.

## 4. Results

Fill in `2026-10-29-hotspot-view-ab-results.md` from this template:

```
Base commit:
Run A session id(s):            Run B session id:
Started (local time):  A:        B:
Owner messages after prompt: A:   B:
Wall clock:            A:        B:
Tokens (input / cache write / cache read / output) per model:
  A main:
  A sub-agents:
  B:
Estimated cost:        A:        B:
Gates:                 A:        B:
Spec points (of 24):   A:        B:
Defects:               A:        B:
Honesty notes:
Reviewer's blind preference and why:
Judgement calls each run listed:
Which PR was merged, and what had to be fixed first:
```

## 5. Reading the result

- Tokens: compare output tokens and cache writes first; cache reads are cheap but show how much
  context each run re-read. For run A, sub-agent output tokens on Haiku cost a fiftieth of Opus
  output, so a run A that uses more tokens can still cost less.
- Time: run A can only win on wall clock through parallel sub-agents; serial delegation adds the
  briefing and reading overhead on top. If run B also delegated, both pay that overhead and the
  difference is the models the work landed on.
- If run B spawned no sub-agents at all, the comparison is also one agent versus a structure;
  say so in the results, since it changes what the time difference means.
- Quality: a difference of one or two rubric points is noise for one trial. Two defects or a
  failed gate is not.
- One trial each is one sample. If the result is close, the honest conclusion is "no measured
  difference", not a winner.
- The prior from Anthropic's 134-task experiment is a 30% cost saving for a 3 to 4 point pass
  loss. A run A that saves more than that with no rubric loss beats the prior; a run A that
  saves less, or loses a gate, confirms it. Either way, run C says whether effort alone would
  have done the same.
