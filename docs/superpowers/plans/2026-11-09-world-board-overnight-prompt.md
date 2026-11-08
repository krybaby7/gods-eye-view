# Prompt: build World Board phases 2 to 6 overnight

Paste everything below the line as the first message of a fresh Codex session. Open the session in
`C:\Users\adami\projects\Hobby\Tier 1\gev-world-board`, use GPT 6.1 Sol as the orchestrator, and give it
full access with no approval prompts, because nobody is awake to answer them.

Phase 7 (Claude estimates and stakes) is not part of this run. It needs PR #15, which the owner tests
first.

---

You are the **overnight orchestrator** for phases 2 to 6 of the World Board in this repo. The owner is
asleep until morning. Nobody will answer questions, so never stop to ask. Decide, write the decision
down as a judgement call, and keep going. Claude, the owner's reviewer, reads everything you produce in
the morning, so make each decision easy to check.

God's Eye View is a CesiumJS 3D globe for open-source intelligence. It uses vanilla JavaScript, Vite,
Node 24, the Node test runner, Prettier, a package-boundary checker and Puppeteer QA scripts.

The World Board turns the app's globe into a strategy view of every country, like a
Civilization-style game:

- It is drawn on the real globe, with real borders over the real imagery. There are **no tiles or hex
  boards**.
- Code computes every number from published data.

Phase 1 is built and waits for the owner's review: [PR #17](https://github.com/krybaby7/gods-eye-view/pull/17),
branch `codex/world-board-phase-1`. It is stacked on the docs branch `docs/world-board-spec`
([PR #16](https://github.com/krybaby7/gods-eye-view/pull/16)).

## What the owner should find in the morning

1. **PR #17 with a few extra commits:** phase 1's open problems fixed, and the extension points that
   phases 2 to 6 plug into.
2. **One PR per phase, 2 to 6:**
   - each based on `codex/world-board-phase-1`;
   - each with passing gates and its own owner's live check;
   - a phase that could not be finished is a **draft** PR that says where it stopped.
3. **One test branch:**
   - it merges every finished phase on top of phase 1;
   - every gate and every QA script passes on it;
   - it is opened as a draft PR titled "World Board phases 2–6 combined (test branch, do not merge)";
   - the owner tests the whole board from it in one go.
4. **The report:** `C:\Users\adami\projects\Hobby\Tier 1\world-board-overnight-report.md`. It ends with a
   short table listing each PR, its verdict and what the owner must do.

## Order of work

Run the steps in this order:

1. step 0, on the phase 1 branch;
2. wave 1: phases 2, 3 and 5, in parallel;
3. wave 2: phases 4 and 6, each starting as soon as a wave 1 slot frees up;
4. the test branch;
5. the report.

**If time or usage runs short,** finish work in this order of value:

1. step 0;
2. phase 2;
3. phase 3;
4. phase 5;
5. phase 4;
6. phase 6;
7. the test branch.

Finishing fewer phases well beats starting all of them. Before you start a phase, check that you have
the usage left to finish it. If you don't, close out the phases already in flight instead.

**Hard stop:** 10 hours after you start, start nothing new. Close out, update the report and finish.

**Hand tables start at once.** During step 0, start the research sub-agents for the hand tables (see
"Hand tables" below). They write outside the repo and touch no code, so they run alongside everything
else.

## Step 0, on the phase 1 branch (PR #17)

Work in this worktree, `gev-world-board`, on branch `codex/world-board-phase-1`. Keep step 0 small:

- aim for under about 400 changed lines;
- phase 1's tests and QA must still pass unchanged.

1. **The World Bank live failure.** In phase 1's live Refresh every World Bank request failed, so C2
   had no population denominator.
   - Find out why with a handful of live requests. They are keyless and free; make no loops.
   - Likely suspects: timeouts on `per_page=20000`, too many requests at once, or missing retries.
   - Fix it, and add a fixture test for the failure mode you found.
   - Then run one live Refresh. Record the counts per source, the duration and the cache size.
2. **C6 is unknown.** V-Dem's Core v16 file has no `v2cacamps`.
   - Check whether the full V-Dem dataset (Country-Year: V-Dem Full+Others v16) has it, and how big
     its download is.
   - If it has the variable and the zip is under about 200 MB:
     - switch C6 to that file;
     - stream out only that column;
     - keep the download out of git and out of the repo;
     - store the observations.
   - Otherwise, leave C6 unknown and say why.
   - Never substitute another variable or source. That is the owner's call.
   - Record the outcome as a judgement call.
3. **Hardware frame timing.** Phase 1 measured lens recolouring only under software rendering.
   - Try one headed or GPU-enabled Chrome run on this PC and record the frame times.
   - If that can't be done, say so, and the owner checks it.
4. **Extension points.** Phases 2 to 6 run in parallel, so they must not all edit the same lines.
   Wherever phase 1 has one hard-coded list that every phase would edit, turn it into a registry. Each
   phase then extends the registry from its own file, with one registration line. Check at least these
   lists:
   - the sheet tabs (`TABS` in `src/ui/worldPanel.js`), with one renderer per tab;
   - the lenses in `src/layers/world/index.js` and the lens bar, each lens defined with its legend;
   - cards: clicking a line, marker or icon opens a card in the right rail;
   - the globe overlays beside the fills (markers, lines, icons, portraits), each shown or hidden by
     zoom;
   - the Refresh step list and the adapter map in `server/providers/world/index.js`;
   - the QA steps in `scripts/qa-world.mjs`, split into one checks file per phase, all run by the one
     script;
   - the styles, with one CSS file per phase imported from one place.

   Data tables such as `public/world/sources.json` can stay single files. Additions there are expected
   to conflict, and you resolve them on the test branch.
5. **Close out step 0:**
   - commit and push;
   - add one comment to PR #17 listing what step 0 changed and the live Refresh numbers;
   - update the "not verified" list in PR #17's description.

Then cut every phase branch from the new tip of `codex/world-board-phase-1`.

## Worktrees, branches and ports

| Work | Branch | Worktree | QA port |
|---|---|---|---|
| Step 0 | `codex/world-board-phase-1` | `gev-world-board` (this one) | 5183 |
| Phase 2 | `codex/world-board-phase-2` | `gev-wb-phase-2` | 5184 |
| Phase 3 | `codex/world-board-phase-3` | `gev-wb-phase-3` | 5185 |
| Phase 4 | `codex/world-board-phase-4` | `gev-wb-phase-4` | 5186 |
| Phase 5 | `codex/world-board-phase-5` | `gev-wb-phase-5` | 5187 |
| Phase 6 | `codex/world-board-phase-6` | `gev-wb-phase-6` | 5188 |
| Test branch | `codex/world-board-test-all` | `gev-wb-test-all` | 5189 |

- **Location.** All the worktrees sit in `C:\Users\adami\projects\Hobby\Tier 1\`.
- **Creating one.** Use `git worktree add -b <branch> "<path>" codex/world-board-phase-1`, then run
  `npm ci` in it.
- **No keys.** Never copy a `.env` file or any key store into a worktree.
- **Cache.** Each worktree keeps its own `.gev-cache/`.
- **QA.** Run every QA script with `--url` set to that worktree's port, for example
  `npm run dev -- --port 5184` and then `node scripts/qa-world.mjs --fixtures --url http://127.0.0.1:5184`.
- **Limits.**
  - At most three phases are in flight at once.
  - Two agents share a worktree only when their files don't overlap.

## Read first

1. `docs/superpowers/specs/2026-11-08-world-board-design.md`, the spec. Read it all once yourself:
   - section 11 lists the phases;
   - sections 1 and 13 hold the owner's decisions;
   - everything in it is agreed.
2. `docs/superpowers/plans/2026-11-08-world-board-phase1-prompt.md`. Its rules, gates and PR format
   carry over to every phase.
3. PR #17's code. Build on its store, registry, scores, turn record, layer and panel. Don't duplicate
   them.
4. Each phase's research file, named in its section below, in `docs/superpowers/research/`.
5. `docs/superpowers/research/2026-11-07-terra-delegation.md`, which says what Terra handles well, and
   `.claude/agents/*.md`.

Send Terra scouts at long files. Keep your own context lean, and use the report file as your memory.

## Rules for every phase

- **New files for new code.** Each phase gets its own:
  - adapters, as `server/providers/world/sources/<id>.js`;
  - server modules, as `server/providers/world/<topic>.js` (spec section 10);
  - a globe module, as `src/layers/world/<topic>.js`;
  - sheet tab and card modules;
  - a QA checks file;
  - a CSS file.

  Shared files get registration lines only.
- **Lens bar order,** as in the mock the owner approved: CONDITION, STRENGTH, ENERGY, DATA AGE,
  DIPLOMACY, OWNERSHIP.
- **Lenses.**
  - Every new lens has its own legend.
  - Unknown is hatched, never coloured as low.
  - Switching lenses recolours the existing geometry and never rebuilds it.
- **Lines and markers** follow spec section 6. With no country selected, only the largest flows show.
- **Sources.**
  - Every source gets its row in `sources.json`: licence, attribution, access mode, release rhythm and
    any mark (NonCommercial, ShareAlike, or no stated licence).
  - Every source also gets its entry in `DATA_SOURCES.md`, and in `src/data/dataCredits.js` where the
    app credits sources.
- **Derived figures.** Every derived figure says how it was made (computed, modelled or source
  forecast) in its "why this number" view.
- **Everything stays inside the World Board layer.** There is no new layer and no new share token.
- **Not in phases 2 to 6:**
  - Claude calls;
  - voice actions;
  - MCP tools;
  - any total score;
  - Cesium text labels (use billboards).

  The Stakes tab keeps its phase 7 placeholder.
- **Tests first,** with `*.test.mjs` beside the code. Fixtures cover India, China and Japan, the UK
  pieces, Kosovo, one disputed area and one country missing several values, plus each phase's own
  cases.

## Phase 2: Energy and shipping

Spec: 4.8, 4.9, 6 (Lines, Chokepoints), 7.1 (Exposure, Leverage), 7.2 (chokepoint card) and 8.2.
Research: `2026-11-08-world-board-energy-shipping.md`.

- **PortWatch adapter** (keyless ArcGIS):
  - pull the chokepoint list once;
  - pull daily transits by vessel type for the last 400 days;
  - re-fetch the last 14 days on every turn;
  - show "data to <date>".
- **Chokepoint status.** Compare the 7- and 28-day means with the same weeks of the last 12 months.
  - A ratio below 0.5 for 7 days gives `reduced`.
  - `disrupted` needs an open PortWatch disruption record as well.
  - Never label PortWatch's `capacity` as tonnes of oil.
  - Øresund stands in for the Danish straits.
- **EIA chokepoint volumes.** Put them in `public/world/curated/eia-chokepoints.json`: oil in mb/d and
  LNG in bcf/d, to the first half of 2025, with one source per row.
- **Dependencies, modelled** (spec 8.2):
  - **Trade data:** BACI 2024, HS 2709, 2710, 271111 and 2701. Tag 271121 as land.
  - **A build-time job, not a Refresh step.** Keep the raw download outside the repo. Commit only the
    compact derived file, with the BACI version.
  - **Routing:** route each exporter–importer pair over a sea-route network whose licence you have
    checked. Prefer Node, and add no Python requirement to the app.
  - **Chokepoints:** tag the chokepoints each route crosses.
  - **Calibration:** calibrate against the EIA totals and report the gap for each chokepoint. A gap of
    about 15% for Hormuz is acceptable.
  - **Labels** as spec 8.2 gives them, with two denominators: share of seaborne imports and share of
    all imports.
- **Buffers.**
  - Use World Bank `EG.IMP.CONS.ZS`, with its year.
  - Use IEA stock cover only if its terms allow it.
  - JODI and AGSI+ wait.
  - Everything else is `unknown`.
- **Prices.** Monthly, from FRED's keyless CSVs.
- **Globe.**
  - Chokepoint gauge markers show today's traffic against the baseline, red when disrupted.
  - With a country selected: its dependency lines, coloured by item.
  - With none selected: only the largest flows through chokepoints.
- **Panels.**
  - The Exposure tab and the Leverage tab.
  - The chokepoint card: a traffic chart, the status history, and the dependent countries ranked by
    share.
  - The Energy exposure lens.
- **Fallback.** If BACI or the routing can't be finished tonight, still ship:
  - the chokepoints and their status;
  - the EIA flows;
  - the chokepoint card;
  - the Exposure tab's buffer row.

  The Energy lens then shows unknown, with the reason. Never fill the gap with guessed shares.
- **QA checks:**
  - the markers appear;
  - the Hormuz fixture is `reduced` from traffic alone, and `disrupted` with a disruption record;
  - the chokepoint card opens with its chart;
  - the Energy lens recolours, and its legend changes;
  - Japan's Exposure tab shows a fixture dependency with its denominator;
  - lines appear when a country is selected and clear when it is deselected.

## Phase 3: Relations

Spec: 4.7, 6 (Diplomacy lens, Lines), 7.1 (Relations), 7.2 (relation card) and 8.4. Research:
`2026-11-08-world-board-assets-relations.md`.

- **Conflicts.** UCDP/PRIO Armed Conflict and Dyadic v26.1, bulk files with no token, at the 25
  battle-deaths threshold.
- **Blocs.**
  - Wikidata P463, with its start and end qualifiers.
  - About 15 blocs checked by hand: NATO, EU, AU, GCC, BRICS, SCO, CSTO, ASEAN, OPEC+ and others.
  - Quad and AUKUS go in the alliance table.
- **Alliances and defence pacts.** A hand table of what is promised and under what conditions, with
  treaty citations.
- **UN voting alignment.** Voeten agreement scores v39, from Harvard Dataverse.
- **Sanctions.**
  - The UN Security Council list, the UK Sanctions List (OGL v3) and OFAC.
  - Reduce each to imposer → target country, per programme.
  - The EU list waits, because it needs a token. OpenSanctions is not used.
- **Diplomatic relations.** Wikidata P530 as the seed, with ruptures checked by hand.
- **Territorial disputes.** A hand table of about 40, using Wikidata P1336.
- **Not tonight:**
  - arms supply, because of SIPRI's terms;
  - foreign troop presence, which phase 4's foreign-bases table covers.
- **The Diplomacy lens.** Pick a country, and the world recolours by its relation to that country:
  ally, partner, neutral, rival, sanctions or at war.
  - The spec doesn't define the rule for each class. Write it as one pure, tested function with an
    explicit precedence, for example at war, then sanctions, ally, rival, partner, neutral.
  - Use only the relations above.
  - Show the rule in the legend and in the relation card.
  - Mark thresholds such as the UN agreement cut-off as draft anchors, and list them as judgement
    calls.
  - An ally's strength is never added to a country's own.
- **Relation lines:** war dotted red, alliance dashed. Clicking a line opens the relation card.
- **QA checks:**
  - picking India recolours the world, with a legend of the six classes;
  - a fixture war dyad draws a dotted red line, and a fixture alliance a dashed one;
  - the relation card opens with its sources;
  - the Relations tab lists allies, blocs, rivals, wars, and sanctions given and received.

## Phase 4: Assets

Spec: 4.6, 6 (Assets, Ownership lens), 7.1 (Assets), 7.2 (asset card) and 8.5. Research:
`2026-11-08-world-board-assets-relations.md`.

- **Sources tonight:**
  - the WRI Global Power Plant Database v1.3, as the fallback;
  - nuclear power plants from Wikidata;
  - the NGA World Port Index large harbours, with operators from Wikidata;
  - the OurAirports large airports with scheduled service;
  - space launch sites from Wikidata.
- **Global Energy Monitor waits.** Its downloads come by an emailed link, and each file's licence must
  be checked first. List it for the owner.
- **Hand tables:**
  - foreign military bases, about 100 rows, each with the host, the owning country and a source;
  - semiconductor fabs, about 50, from company filings;
  - the nuclear weapons badge: 9 cited facts from FAS Status of World Nuclear Forces, shown as a badge
    and never added to any score;
  - USGS critical-mineral shares, only if time allows.
- **Existing layers stay separate.** OSM military bases (ODbL) are never merged into the asset file.
  The submarine cables stay in their own layer.
- **`canInterrupt`** stays empty unless an entry has a mechanism, evidence, and a "hypothesis" or
  "documented" label.
- **Globe.**
  - Icons by type, clustered when zoomed out, using the hotspot aggregation.
  - The Ownership lens: pick a country, and its assets abroad light up, with lines back to it and an
    owner-colour ring.
- **Panels.** The asset card. The Assets tab, with key assets at home and assets owned abroad.
- **QA checks:**
  - icons cluster when zoomed out;
  - picking China under Ownership lights its fixture assets abroad, with lines;
  - the asset card shows the owner, operator, status, source and licence.

## Phase 5: People

Spec: 4.11, 6 (People), 7.1 (header, People), 7.2 (actor card) and 8.6. Research:
`2026-11-08-world-board-actors-x.md`.

- **The directory.**
  - A weekly Wikidata SPARQL job (keyless) collects, per country: the head of state, the head of
    government, the foreign minister and the defence minister.
  - A hand list keyed by Wikidata id covers militaries, central banks and armed groups.
  - Send a User-Agent that names the app and the repo URL, with no personal email.
- **Portraits.** Commons thumbnails, never originals, with the author and licence shown.
- **Posts, at no cost:**
  - Bluesky's public API, shown inline;
  - YouTube channel RSS and official government RSS;
  - link-out buttons for every account;
  - a "Show X timeline" button that inserts X's official embed for one actor. No X script loads
    before the click. A note says the embed may need the viewer to be signed in to X.
- **Not used:** the X API, scraping x.com, Nitter-style mirrors, Telegram.
- **Globe.** A leader portrait billboard sits beside the country code at board zoom. Clicking it opens
  the actor card.
- **The sheet header** shows the head of state and the head of government, with portraits.
- **QA checks:**
  - India's sheet header shows two fixture portraits with attribution;
  - the People tab lists actors with their accounts;
  - the portrait billboard opens the actor card;
  - the X button inserts nothing until it is clicked;
  - fixture Bluesky posts render.

## Phase 6: Live condition flags

Spec: 8.3, 4.10 and 5 (live feeds on timers). Research: `2026-11-08-world-board-live-feeds.md`.

- **Flags.** Each flag is dated and sourced and sits on a Condition bar. A flag never moves a score.
- **Live tonight, keyless:**
  - the Powell and Thyne coups CSV (weekly);
  - GDELT conflict and protest codes, shown as "reported" because they are noisy;
  - GDACS alerts, credited to GDACS;
  - the FAO Food Price Index, as a world banner;
  - IMF monthly CPI;
  - Frankfurter FX;
  - UNHCR displacement;
  - UCDP, from what phase 1 uses.
- **These need the owner.** Build each with fixtures, keep it off until it is configured, and list it:
  - ElectionGuide: a free token;
  - HDX HAPI: an app identifier made from an email the owner chooses;
  - IODA: its licence must be confirmed;
  - UCDP Candidate: a token.
- **The debt-distress list** is a hand table from the latest IMF/World Bank LIC DSA list, with its
  date and source.
- **Not in v1:** ACLED, Cloudflare Radar, Electricity Maps, open.er-api.com.
- **Timers.** Live feeds update on their own timers only while the board is on. Fixture mode turns the
  timers off.
- **Where flags show:** on the Condition rows and in the hover card. The turn change list includes
  flags set and cleared.
- **QA checks:**
  - a fixture GDACS red alert flags Essential services for its country without changing the score;
  - a fixture FX drop flags Fiscal;
  - removing the fixture clears the flag on the next turn.

## Hand tables

Research sub-agents on Sol compile these tables:

- alliances and defence pacts;
- territorial disputes;
- foreign military bases;
- semiconductor fabs;
- the nuclear weapons facts;
- the hand list of militaries, central banks and armed groups;
- the debt-distress list;
- the EIA chokepoint volumes.

The rules:

- **Sources.** Every row has a source URL from a primary or authoritative source, and the date it was
  checked. A row that can't be sourced is left out. Never invent a row or a number.
- **Review flag.** Every row carries `"reviewed": false`. While any row is unreviewed, the board shows
  that table's data with a "draft, not yet reviewed" note.
- **Where they go.** Drafts go first to `C:\Users\adami\projects\Hobby\Tier 1\world-board-hand-tables\`.
  The phase that uses a table copies the checked version into `public/world/curated/` on its branch.
- **In the PR.** Each PR lists its tables under "Hand tables to review", with the row counts and three
  rows you checked against their sources yourself.
- **No copied tables.** Never copy a protected table wholesale (SIPRI, Lowy, SEMI, IISS Military
  Balance). Enter only cited facts.

## Sub-agents

Use **only GPT 6.1 Sol and GPT 6.1 Terra**, following the delegation table. If either is unavailable,
write that in the report and stop.

- **Phase leads.** If your harness lets a sub-agent start its own sub-agents, give each phase to a Sol
  phase lead that follows this prompt's section for its phase. Otherwise, lead each phase yourself.
- **Sol** takes one bounded work package at a time, with its tests, and does the hand-table research.
- **Terra** takes:
  - scouting;
  - exact registrations;
  - docs drafted from an outline;
  - running the gates and returning the raw output.
- **You keep:**
  - every design decision;
  - the Cesium layer lifecycle;
  - integration;
  - every verdict on correctness;
  - the test branch.

  Before a phase PR is marked ready, read its final diff yourself against its spec sections.
- **Briefs** name the spec sections, the file paths, the public API, the rules to test and the
  commands to run.

## Safety rules for the night

- **Git.**
  - Push only to branches you create, plus `codex/world-board-phase-1` for step 0.
  - Open PRs with `gh pr create --repo krybaby7/gods-eye-view --base codex/world-board-phase-1`.
  - Never touch upstream `bilawalsidhu/gods-eye-view`.
  - Never merge a PR, and never push to `main`.
  - Never force-push.
  - Never use `git stash`, because the stash is shared with other worktrees.
  - Never delete a branch or worktree you didn't create.
  - Make small commits with clear messages.
- **Leave these alone:**
  - PR #15 and PR #16;
  - the main checkout `gods-eye-view`, which holds PR #15's branch;
  - the worktrees `gev-search-layers`, `gev-search-toolkit` and `gev-wm-review`;
  - the worktrees under `gods-eye-view/.claude/worktrees/`.
- **Live calls.**
  - Outside the tests, each phase may make one live check per free, keyless source.
  - Run them one after another, respect rate limits, and back off on HTTP 429.
  - Use a User-Agent with no personal data.
  - Record the counts and duration in the PR.
- **Never:**
  - call a paid service;
  - use any API key;
  - create an account;
  - fill in a form or request an emailed download link;
  - accept terms on the owner's behalf;
  - press the war monitor's Perplexity Refresh or any Claude Refresh.
- **Downloads.**
  - Bulk files go to `C:\Users\adami\projects\Hobby\Tier 1\world-board-downloads\`, outside every repo.
  - Check the size before downloading. Skip anything over 2 GB.
  - Never run anything that came in a download.
- **Packages.**
  - Add an npm package only when it is clearly needed and its licence is permissive (MIT, BSD, ISC or
    Apache-2.0).
  - List each one in the PR.
  - No global installs.
- **This PC.**
  - Change no system settings and install no system software.
  - Write only inside `C:\Users\adami\projects\Hobby\Tier 1\` and Codex's own folders.
  - Stop every dev server and browser you start.
- **Timebox.** Stop a piece of work and move on when either happens:
  - a phase still fails its gates after about 3 hours;
  - one blocker has taken 45 minutes.

  Then commit, push, open a draft PR with a "Where I stopped" section, and move on.
- **Scope.** Build only what the phase says. Where the spec leaves a detail open, decide, and list it
  as a judgement call tied to its spec section.

## Gates, on every branch, with the output pasted

- `npm run format:check`
- `npm run check:boundaries`
- `npm run layer-token:check -- --base-ref main`
- `npm test`
- `npm run build`
- `node scripts/qa-world.mjs --fixtures --url <its port>`
- as regressions, each with `--url <its port>`:
  - `node scripts/qa-searches.mjs --fixtures`
  - `node scripts/qa-news.mjs --fixtures`
  - `node scripts/qa-lenses.mjs --skip-performance`

If something fails, say so first, in the PR and in the report.

## The test branch

1. Create `codex/world-board-test-all` from the tip of `codex/world-board-phase-1`.
2. Merge each finished phase branch with `git merge --no-ff`, in the order 2, 3, 5, 4, 6.
3. Resolve each conflict by keeping both sides' additions. Record every conflict and how you resolved
   it.
4. Run every gate and every QA script. Take screenshots of each lens, with India, Japan and China
   selected.
5. Open it as a draft PR, with the conflict list, the gate output and the screenshots.

Draft phases (unfinished ones) stay out of the test branch. List them in the PR.

## The report file, which is also your progress log

Keep `C:\Users\adami\projects\Hobby\Tier 1\world-board-overnight-report.md` up to date after every
finished step. It is the resume point. It holds:

- **Progress log:** the time, the step and the result.
- **Per phase:**
  - the PR link;
  - ready or draft;
  - the gate summary;
  - the live checks (source, counts, duration);
  - the judgement calls;
  - what was not verified, and why;
  - what the owner must do.
- **Hand tables to review.**
- **Needs the owner:** keys, accounts, emailed downloads, licence confirmations, anchor reviews.
- **Delegation log:** every sub-agent call with its model, task and outcome, and whether its output
  was used as is, reworked or discarded.
- **Final table:** each PR, its verdict, and what the owner must do.

**If you are restarted,** read the progress log and `git worktree list` first. Continue from the last
unfinished step, and don't redo finished work.

## Each PR description, in plain words for a non-technical owner

- What changed, by area.
- The sources: the route each adapter took, its licence and mark, and the counts from its live check.
- Test and QA results, pasted, with screenshot file names.
- Every judgement call, tied to its spec section.
- The hand tables to review.
- What was not verified, and why.
- The delegation log.
- **The owner's live check,** as numbered steps for this phase.
- A note: "Based on PR #17. Merge after it."

## Your final message

1. The PR URLs, each with a one-line verdict: ready, draft, or ready after the owner decides something
   (name it).
2. The test branch PR.
3. The "Needs the owner" list.
4. The path to the report.
