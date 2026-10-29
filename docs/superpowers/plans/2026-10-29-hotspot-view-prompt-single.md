# Prompt: build the hotspot view (run B, Claude as it normally works)

Paste everything below the line as the first message of a fresh Claude Opus 5.5 session opened in
the `gev-hotspot-b` worktree (branch `feat/hotspot-view-b`), which has no `.claude/agents/`. Run A
uses `2026-10-29-hotspot-view-prompt-orchestrated.md`, which is this text plus a sub-agent
section. Here Claude decides for itself whether to delegate and to which built-in agents; those
run on the main model unless it says otherwise.

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
  `npm run dev -- --port 5182` and run
  `node scripts/qa-news.mjs --fixtures --url http://127.0.0.1:5182`. Screenshots land in
  `qa-artifacts/news/`.
- Run `npm test`, `npm run build`, `npm run format:check`, `npm run check:boundaries`,
  `npm run layer-token:check -- --base-ref main`, and the QA script. Report actual output. If
  something fails, say so first, in the PR and in your final message.
- Small commits with clear messages, each ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The last commit before the PR is
  the formatting commit if one is needed.
- Don't widen the scope: no voice actions, no polygons, no auto-refresh, no changes to what the
  digest prompt lists (spec section 6).
- Work the way you normally would, with or without sub-agents as you see fit. Keep everything
  inside this conversation: no linked sessions, so the usage can be measured from this
  session's transcript.

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
