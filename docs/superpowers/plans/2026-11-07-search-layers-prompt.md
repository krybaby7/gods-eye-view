# Prompt: build search layers, phases 1 and 2

Paste everything below the line as the first message of a fresh session on
`krybaby7/gods-eye-view`, in a harness that can run sub-agents on GPT 6.1 Sol and GPT 6.1 Terra
(for example Codex). Claude Code sub-agents can only run Claude models, so this prompt doesn't fit
there as written. The spec and this prompt are on branch `claude/project-fork-status-g62efv`; if
that branch has been merged, start from `main`.

---

You are building **search layers** in this repo. God's Eye View is a CesiumJS 3D globe for
open-source intelligence: vanilla JavaScript, Vite, Node 24, the Node test runner, Prettier, a
package-boundary checker and Puppeteer QA scripts. The owner asks the globe a question in plain
words. An agent researches it on the web. Code places the answer on the globe as a new layer they
can toggle, keeps every earlier answer so they can go back in time, and merges findings that two
searches share. The design is agreed. Build Phase 1, then Phase 2, verify both, open the pull
requests and report.

Start your work branch from `claude/project-fork-status-g62efv`, or from `main` if that branch has
been merged. It holds the spec and this prompt.

## Read first, in this order

1. `docs/superpowers/specs/2026-11-06-search-layers-design.md`: the spec. Section 1 lists the
   owner's decisions. Everything in it is agreed.
2. `docs/WAR-MONITOR.md`, then `docs/superpowers/specs/2026-10-29-world-hotspot-view-design.md`.
   The feature reuses the war monitor's gazetteer, hotspot grouping, verification rule, markers and
   panel patterns.
3. `docs/superpowers/research/2026-10-29-hotspot-view-ab-lessons.md` and
   `docs/superpowers/research/2026-10-29-haiku-55-subagent-evidence.md`: what this repo learned
   about delegating to cheaper sub-agents. Also read `.claude/agents/*.md`, the role definitions
   used then (scout, runner, editor, builder).
4. Server: `server/providers/news/index.js`, `server/providers/news/digest/stories.js`
   (`resolveLocation`, `deriveVerification`), `server/providers/news/hotspots.js`
   (`assignHotspots`), `server/providers/news/geocode.js`, `server/providers/news/store.js`
   (`canonicalizeUrl`), `server/providers/regional/place.js` (Nominatim queue),
   `server/providers/common/` (same-site gate, rate limiter, capped fetch helpers).
5. Client: `src/layers/news/index.js`, `model.js`, `hotspots.js`, `records.js`, `source.js`;
   `src/ui/situationPanel.js` and its mount path (`src/app/tools.js`, `attachSituation` in
   `src/ui/layerPanel.js`, `#situation-panel` in `src/ui/templates/context.html`);
   `docs/panel-surfaces.md`.
6. Registration of the `news` layer: `src/app/layers/news.js`, `src/app/constructCatalog.js`,
   `src/app/sourceComposition.js`, `src/standalone/layerSources.js`, `src/data/layerState.js`,
   `src/data/layerStateTokenReservations.json`, `src/voice/layerManifest.js`,
   `src/voice/actionSchemas.js`, `src/voice/gevActions.js`,
   `server/providers/openai/toolDescriptions.js`.
7. `scripts/qa-news.mjs` (its `--fixtures` mode), `docs/CODE-BOUNDARIES.md`,
   `scripts/package-boundaries.json`, `docs/MCP_SETUP.md`, `TESTING.md`.

Send Terra scouts at the long files (`src/layers/news/index.js`, `src/ui/situationPanel.js`,
`scripts/qa-news.mjs`, `server/providers/news/index.js`) for the specific seams you need, rather
than reading them whole. Read the spec yourself.

## Step 0: two short research tasks before any code

**0a. What fits GPT 6.1 Terra.** Spend a few minutes finding out which kinds of tasks GPT 6.1
Terra does reliably and where it falls short, compared with GPT 6.1 Sol. Use the official model
documentation available to you plus the two research files above. Turn that into a delegation
table for this build: task type, model, scope limits (files, turns, size), and how you will check
its output. Lean towards Terra wherever the evidence says it is reliable, to save cost and time.
Save the table and its sources as `docs/superpowers/research/2026-11-07-terra-delegation.md`, and
put a summary in the first PR.

**0b. How to run Claude and Codex on the owner's subscriptions.** The research agents are the
owner's Claude Code and Codex CLI, already signed in on their machine (spec section 4.1). From each
product's current official documentation, establish:

- how to run it non-interactively from a Node child process, with machine-readable output;
- how to allow only web search and page fetch, with no file-writing or shell tools;
- where its web search results and fetched URLs appear in that output;
- its structured-output option, if any;
- how to pass an MCP configuration for one run only;
- how to choose the model;
- how to check that it is installed and signed in;
- whether this use by the owner, on their own machine, with their subscription, is supported by its
  terms.

Add what you find to the spec as a short section "4.1a Adapter details (verified <date>)", with
links, before you build the adapters. If either product doesn't support this use, or its terms
don't allow it, **stop and tell the owner** with the options. Never read or forward session tokens
and never call private endpoints.

## Sub-agents

You orchestrate. Use **only two models for sub-agents: GPT 6.1 Sol and GPT 6.1 Terra**.

- **GPT 6.1 Sol:** the main implementation tasks. One bounded module or work package at a time,
  with its tests.
- **GPT 6.1 Terra:** small tasks and secretary work. That means scouting files for seams,
  mechanical edits you specify exactly (registrations, boundary entries, docs text you give it),
  drafting docs and the changelog from your outline, running the check commands and returning exit
  codes and raw output, and basic test runs. Extend its share as far as your Step 0a table supports.

If your harness names these models differently, use the matching ones. If either is unavailable,
stop and tell the owner rather than substituting another model.

**You keep:** every design decision, cross-module integration, the Cesium layer lifecycle, every
verdict on whether work is correct, the final gate run and a full read of the diff against the spec.

**Lessons from this repo's last trial:**

- A brief is all a sub-agent knows. Name the spec sections, exact file paths, the public API
  (names and signatures), the rules to test, the commands to run and what to report.
- Give a command-running agent enough turns to finish. A cheap runner with an 8-turn cap failed
  last time.
- Treat a sub-agent's exit codes as evidence; its opinion isn't.
- Run independent sub-agents in parallel, on files no two of them share.
- Don't delegate what you can do in a few tool calls.

## Phase 1 (first pull request)

Everything in the spec except section 14's Phase 2 and Later lists. A split that keeps files
disjoint (adjust it to your Step 0a table):

| Work package | Owner | Files |
|---|---|---|
| Pure server logic: code checks, merges across searches, history snapshots and run comparisons | Sol | `server/providers/search/findings.js`, `dedupe.js`, `history.js` and tests |
| Agents: interface, Claude and Codex adapters, research step, map step, fake executable and recorded-output fixtures | Sol | `server/providers/search/agents/*`, `research.js`, `mapper.js` and tests |
| Store, routes, per-agent run queue, cancel and timeout, server wiring, agent status and default choice in Provider Settings | Sol | `server/providers/search/store.js`, `index.js`, wiring files, tests |
| The `searches` layer: markers by shape, bubbles, merged markers, past-day drawing | You | `src/layers/searches/*` |
| Layer registration and share token (`npm run layer-token:next`) | Terra, from your exact list | the files in spec 6.2 |
| Searches panel: ask box, agent choice, running state, list grouped by day, day picker, runs, Changes, findings, place chip | Sol | `src/ui/searchesPanel.js`, a model module, styles, the mount hook, template |
| Voice: `ask_globe` and the manifest entry | Sol | the voice files in spec 10 |
| Fixture browser QA | Sol | `scripts/qa-searches.mjs` |
| Docs: `docs/SEARCH-LAYERS.md`, `DATA_SOURCES.md`, `CHANGELOG.md`, `docs/CURRENT-STATE.md`; boundary entries | Terra, from your outline | those files |

## Phase 2 (second pull request, stacked on the first)

Spec section 14, Phase 2:

1. **Evaluate sources.** Terra scouts gather facts on the candidate MCP servers and APIs: what
   exists, keyless or keyed, terms, rate limits, reliability. You choose the first set and record
   why in `docs/SEARCH-LAYERS.md`.
2. **Wire the toolkit.** Sol generates one MCP configuration per run for whichever agent runs it,
   with a per-tool allowlist, the app's own MCP server (`server/mcp/stdio.js`) among the tools, and
   keys from Provider Settings only.
3. **Measure.** Sol writes a benchmark: `scripts/bench-searches.mjs`, a fixed set of about 8
   questions (news, "who is saying what", "where are"). It records per agent and per run: duration,
   source count, findings placed, list-only, dropped, `checkedBy` mix, and reported usage. It runs
   against fixtures here, and live on the owner's machine.

Phase 2 changes only `research.js`, the adapters' tool configuration, Provider Settings for keys,
the benchmark and docs.

## Rules

- **Git.** Work on your own branch. Never merge or rebase onto `bilawalsidhu/gods-eye-view`
  (upstream). Open each PR against `krybaby7/gods-eye-view`; the Phase 2 PR targets the Phase 1
  branch. Don't merge either PR. Make small commits with clear messages.
- **Tests first** for every pure function and every rule in the spec, `*.test.mjs` beside the code.
  Match the surrounding code's comment density, naming and idioms. Register new modules in
  `scripts/package-boundaries.json`.
- **No live calls in tests.** Adapters are tested with recorded output and a fake executable. Never
  run the war monitor's digest (Refresh, `POST /api/news/digest`, "refresh news"): it spends the
  owner's Perplexity money and this feature doesn't need it.
- **Live check, only if both are true:** `claude` and `codex` are installed and signed in where you
  run, and the owner has said yes in this session. Then ask one real question per agent and report
  it. Otherwise leave the live check to the owner (below).
- **Don't widen the scope.** No budget or daily cap for searches. No timers or auto-update. No
  changes to the war monitor's digest provider. No pulling from upstream. No Cesium text labels
  (`docs/CODE-BOUNDARIES.md`): text on the globe goes in billboard images, as the news layer does.
  No secrets in the repository.
- **QA on its own port:** `npm run dev -- --port 5182`, then
  `node scripts/qa-searches.mjs --fixtures --url http://127.0.0.1:5182`.
- **Gates for each PR, with actual output reported:** `npm run format:check`,
  `npm run check:boundaries`, `npm run layer-token:check -- --base-ref main`, `npm test`,
  `npm run build`, `node scripts/qa-searches.mjs --fixtures`, and as regressions
  `node scripts/qa-news.mjs --fixtures` and `node scripts/qa-lenses.mjs --skip-performance`
  (all against your port). On 2026-11-06, `main` passed all of them on Node 24: 6,723 unit tests
  with 0 failures, news QA 27/27, lenses QA 22/22. If something fails, say so first, in the PR and
  in your final message.
- **Where the spec leaves a detail open,** decide, and list the decision as a judgement call tied to
  its spec section.

## Each PR description, in plain words for a non-technical owner

- What changed, by area.
- The adapter details from Step 0b and the delegation table from Step 0a (first PR).
- Test and QA results, pasted, with screenshot file names.
- Every judgement call, each tied to a spec section.
- What was not verified, and why.
- A delegation log: every sub-agent call with its model (Sol or Terra), task, outcome, and whether
  its output was used as is, reworked or discarded. Then one line on whether the Step 0a table held
  up, and what you would hand Terra next time.
- **The owner's live check**, as numbered steps:
  1. Sign in to `claude` and `codex`.
  2. `npm run dev`, then turn on Searches.
  3. Ask "What's going on with crypto?" with Claude, and "Where are the world's lithium mines?"
     with Codex.
  4. What to look for: markers by shape and colour, sources marked `tool-result` or `fetch`, a
     merged finding when both searches share one.
  5. Run Update on one search, then go back a day with the day picker.
  6. For Phase 2: `node scripts/bench-searches.mjs`, and where its report lands.

End your final message with both PR URLs and a one-line verdict for each: ready, or ready after the
owner decides something (name it).
