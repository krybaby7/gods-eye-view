# Prompt: build the hotspot view (run A, orchestrator with sub-agents)

Paste everything below the line as the first message of a fresh Claude Opus 5.5 session opened in
the `gev-hotspot-a` worktree (branch `feat/hotspot-view-a`), with `.claude/agents/` copied in.
Run B uses `2026-10-29-hotspot-view-prompt-single.md`: this text without the sub-agent section,
and no project agents, so Claude delegates (or not) the way it does by default.
The sub-agent structure follows `../research/2026-10-29-haiku-55-subagent-evidence.md`: Haiku 5.5
as scout, runner and mechanical editor at medium effort with narrow scope; Sonnet 5.5 for
bounded implementation; the orchestrator keeps design, integration and every verdict.

---

You are building the hotspot view in this repo (God's Eye View, a CesiumJS globe OSINT app,
vanilla JS + Vite + Node 24): when the camera is high, the war monitor's news layer draws one
bubble per country or named region instead of one pin per story, clicking a bubble flies there
and filters the Stories list, and the World gazetteer grows so fewer stories are model-placed.
The design is agreed and reviewed against the code. Build it, verify it, open a PR, and report.
The owner is not watching; don't stop to ask questions. Make the call the spec points to, and
list every judgement call in the PR.

Read first, in this order:

1. `docs/superpowers/specs/2026-10-29-world-hotspot-view-design.md`: the spec. Section 8 says
   what its review changed; the rest is what to build.
2. `docs/WAR-MONITOR.md`, then `docs/superpowers/specs/2026-10-28-world-theater-design.md` for
   background on theaters, the gazetteer and the digest.
3. `src/layers/news/index.js`, `src/layers/news/model.js`, `src/layers/news/records.js`,
   `src/layers/news/ownership.test.mjs` (how the layer is tested with a fake viewer).
4. `server/providers/news/index.js` (`service.snapshot()`), `server/providers/news/registry.js`
   (`validateGazetteer`), `server/providers/news/geocode.js`,
   `server/providers/news/digest/stories.js` (`resolveLocation`).
5. `src/worldFocus.js` and `src/worldFocus.test.mjs`.
6. `src/ui/situationPanel.js`, `src/ui/situationPanelModel.js` (`tabCounts`).
7. `scripts/build-world-gazetteer.mjs`, `public/news/theaters/world.json` (skim: row shape),
   `public/news/theaters/iran-israel-us.json`.
8. `scripts/qa-news.mjs` (the `--fixtures` run, `worldSnapshot()`, the `step()` helper).
9. `docs/CODE-BOUNDARIES.md`, `scripts/package-boundaries.json`.

Rules:

- Work only in this worktree, on this branch. Never merge or rebase onto
  `bilawalsidhu/gods-eye-view` (upstream). Open the PR against `krybaby7/gods-eye-view` `main`
  with `gh pr create --repo krybaby7/gods-eye-view --base main`. Don't merge it.
- Follow the spec's decisions as written: grouping on the server, the hotspot keys, the
  `hotspot` framing kind with its radius cap, the far-match guard, the 300,000 city threshold,
  `CITY_HOTSPOTS`, `TOWNS` and the English aliases. Where the spec leaves a detail open, decide
  and record it.
- Write tests first for every pure function and rule in spec section 7, `*.test.mjs` beside the
  code, with the Node test runner the repo uses. Match the surrounding code's comment density,
  naming and idioms. Register new modules in `scripts/package-boundaries.json`.
- Cesium text labels are forbidden (`docs/CODE-BOUNDARIES.md`); the count inside a bubble is
  part of the SVG billboard image, as the spec says.
- `scripts/build-world-gazetteer.mjs` downloads Natural Earth from GitHub; run it for real and
  commit the regenerated `world.json`. Read its log: list the qualified names and check the
  spec's town list against the rows it produced.
- Never run a news digest (Refresh, `POST /api/news/digest` or "refresh news"): it spends money
  and the feature needs none. Verify with `scripts/qa-news.mjs --fixtures`.
- QA on its own port so another run can share the machine: start the app with
  `npm run dev -- --port 5181` and run
  `node scripts/qa-news.mjs --fixtures --url http://127.0.0.1:5181`. Screenshots land in
  `qa-artifacts/news/`.
- Run `npm test`, `npm run build`, `npm run format:check`, `npm run check:boundaries`,
  `npm run layer-token:check -- --base-ref main`, and the QA script. Report actual output. If
  something fails, say so first, in the PR and in your final message.
- Small commits with clear messages, each ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The last commit before the PR is
  the formatting commit if one is needed.
- Don't widen the scope: no voice actions, no polygons, no auto-refresh, no changes to what the
  digest prompt lists (spec section 6).

Sub-agents (the point of this run):

You orchestrate. Four project sub-agents are defined in `.claude/agents/`: `scout` (Haiku 5.5,
read-only search, returns file:line evidence), `runner` (Haiku 5.5, runs given commands, returns
exit codes and raw output), `editor` (Haiku 5.5, mechanical fully specified edits) and `builder`
(Sonnet 5.5, one bounded module with its tests). Use them through the Agent tool by name. The
evidence behind this split: Haiku 5.5 is reliable at bounded search, extraction and evidence
collection, and unreliable as an implementer of multi-file changes or as a judge of whether work
is correct, so you keep every design decision, every integration and every verdict.

- **Briefs.** A sub-agent has none of your context. Every brief names the spec sections, the
  exact file paths, the public API (names and signatures), the rules to test, the commands to
  run and what to report. Keep a Haiku agent's scope small enough that its context stays under
  100,000 tokens (above that its price is five times higher); never raise its effort above
  medium. Run independent sub-agents in parallel in one message. Don't delegate what you can do
  in a handful of tool calls.
- **Phase 0, your own reading.** Read items 1 to 6 and 9 of the list yourself: the spec, the
  layer, the server entry points, world focus and the panel are design-sensitive. For the long
  files in items 7 and 8, send three scouts in parallel instead of reading them whole:
  - `scout` on `scripts/build-world-gazetteer.mjs`: where `CITY_MIN_POPULATION`, `HOTSPOTS`,
    `CITY_ALIASES`, `hotspotRows`, `placeRows`, `uniqueNames`, `uniqueAliases`, `toEntry` and
    `main` are, the shape of one `HOTSPOTS` entry, how the log is printed, and what the script
    validates before writing;
  - `scout` on `scripts/qa-news.mjs`: `step()`'s signature and how a step is recorded,
    `worldSnapshot()`'s story shape, how `serveFixtures` answers `/api/news`, how the World run
    switches theater, how the page's layer and viewer are reached from Puppeteer, how
    screenshots are named, and any existing camera driving;
  - `scout` on `src/ui/situationPanel.js`, `src/ui/situationPanelModel.js` and
    `src/layers/news/ownership.test.mjs`: every read of `visibleStories`, `tabCounts`,
    `renderStories`, `storiesNote` and `citedNote`, and how the test builds its fake viewer,
    camera and overlay host.
- **Phase 1, parallel builders on disjoint files**, while you build the layer yourself:
  - `builder` "server": `server/providers/news/hotspots.js` and its test (spec section 2, every
    rule); wiring in `service.snapshot()`; `hotspot` in `validateGazetteer` with tests;
    `normalizeStory` pass-through in `src/layers/news/records.js` with a test; the far-match
    guard in `digest/stories.js` with the `farMatches` run count and tests (spec section 3);
    registering the new module in `scripts/package-boundaries.json`. Files: those, plus the
    existing tests beside them.
  - `builder` "gazetteer": `scripts/build-world-gazetteer.mjs` (threshold, `CITY_HOTSPOTS`,
    `TOWNS` with sources, `CITY_ALIASES` for Al-Ubayyid, Ta'izz and Al Hudaydah, `toEntry`,
    the duplicate-town log; spec section 3), run it for real, keep the log, and add the
    `hotspot` links to `public/news/theaters/iran-israel-us.json`. Files: the script and the two
    theater files.
  - `builder` "focus", **run with the Agent tool's `model: haiku` and `effort: medium`
    overrides**: the `hotspot` framing kind and per-kind radius cap in `src/worldFocus.js` with
    tests in `src/worldFocus.test.mjs` (spec section 5). This is the one bounded implementation
    trial for Haiku. When it reports, read its diff, then break the cap yourself for a moment
    and check that its tests fail; record in the PR whether its work was used as is, reworked,
    or redone.
  - You, meanwhile: `src/layers/news/hotspots.js` (bubble aggregation and marker style, pure,
    with tests), the mode switch, bubbles, `focusHotspot` and the place-filter state in
    `src/layers/news/index.js`, the bubble SVG and card in `src/layers/news/model.js`, and the
    layer tests (spec sections 4 and 5).
- **Phase 2**, once your layer's snapshot fields and methods exist:
  - `builder` "panel": the place-filter chip, the empty-list note and the cited hint in
    `src/ui/situationPanel.js`, tests in `src/ui/situationPanelModel.test.mjs`, and the new QA
    steps in `scripts/qa-news.mjs` (spec section 7; fixture stories get `hotspot` by importing
    the server grouping function). Give it the exact snapshot fields and layer methods.
  - `editor`, in parallel: the `docs/WAR-MONITOR.md` paragraph and table row, with the text you
    write in the brief, and any `scripts/package-boundaries.json` entry still missing.
- **Phase 3, verification.** `runner` runs the full check list and the QA script on port 5181
  and returns exit codes and raw output. Fix what fails, or send the fix to the builder that
  owns the file. Then run the final gate yourself once, `npm test` and the QA script with output
  to a file, and read the summary lines: a sub-agent's exit code is evidence, its opinion is
  not. Read the whole diff yourself against the spec before opening the PR. Never ask a Haiku
  agent whether work is correct.
- No linked sessions and no Workflow tool: sub-agents only, so the usage can be measured from
  this session's transcript.

The PR description must include, in plain words for a non-technical owner:

- what changed, by area: server grouping, registry, gazetteer script and data, layer rendering
  and mode switch, camera framing, place filter and panel, docs;
- the gazetteer counts before and after (countries, capitals, cities, hotspots, aliases), the
  qualified names the script logged, the towns added by hand, and the English aliases added;
- the thresholds and framing numbers as built, and what Frame theater ends in for each theater;
- test and QA results, pasted, with the screenshot file names;
- every judgement call, each tied to a spec section;
- what was not verified, and why;
- a delegation table: every sub-agent call with its agent, model, task, outcome, and whether its
  output was used as is, reworked or discarded, followed by your judgement of each delegation
  ("none" if you used no sub-agents).

End your final message with the PR URL and the one-line verdict: ready, or ready after the owner
decides something (name it).
