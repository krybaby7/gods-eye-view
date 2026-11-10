# Prompt: World Board fix round 4, after Claude's third review

Paste everything below the line as the first message of a fresh Codex session. Open the session in
`C:\Users\adami\projects\Hobby\Tier 1\gev-world-board`, use GPT 6.1 Sol as the orchestrator, and give it
full access with no approval prompts.

---

You are finishing the World Board. Fix round 3 worked:

- all nine gates pass, with 7,055 tests;
- the BACI screen is right: Claude rebuilt it independently and matched your table exactly;
- the skipped live tick is fixed;
- CIA World Leaders is in as a second source;
- the hand tables held up against their citations.

Claude's third review found a short list:

- People shows the same person as two people;
- two Energy regressions from round 3's own changes;
- rivals cover only the prompt's examples;
- a GDELT threshold that Claude's own prompt got wrong;
- a few small leftovers.

This round fixes that list. After it, Claude expects to recommend merging all six phase PRs.

Don't ask questions. Decide, record the judgement call and keep going. Claude reviews the result afterwards
and reruns your fact checker.

## Read first

1. **Claude's third review:** `C:\Users\adami\projects\Hobby\Tier 1\world-board-review-3-2026-11-10.md`.
   - Every finding in it is in scope, including the low ones, except two that are accepted as they are:
     - "Jr." stripping in `person-identity.mjs`;
     - the odd fallback import ports (Granville, Broome).
   - Its file:line references point to the reviewed heads:

     | PR | Head |
     | --- | --- |
     | #17 | 80a45bd3 |
     | #18 | 129f2093 |
     | #19 | 92c3087a |
     | #20 | 7c0a6a7c |
     | #21 | 0768bb64 |
     | #22 | 8134fe8d |
     | #23 | 6d9cd2b9 |

2. **Your last round:** the "Fix round 3" section of
   `C:\Users\adami\projects\Hobby\Tier 1\world-board-overnight-report.md`, and its evidence in
   `C:\Users\adami\projects\Hobby\Tier 1\world-board-downloads\fix-round-3\`.
3. **The round 3 prompt:** `C:\Users\adami\projects\Hobby\Tier 1\world-board-fix-round-3-prompt.md`.
   Its "Read first" list still applies, including the round 2 prompt's proof standard and live-call rules
   and the overnight prompt's sections.

## What the owner decided

All earlier decisions stand. New this round:

1. **Rivals:** use the whole cited dataset. Section 4 has the details.

## Order of work

1. **Phase 1 first (#17),** on `codex/world-board-phase-1` in this worktree. Push.
2. **Bring phase 1 into every phase.** Merge `codex/world-board-phase-1` into each phase branch, in its own
   worktree. Use merge commits only; no rebase, force-push or stash.
3. **Fix the phases, at most three at a time.**
   - Wave A: people (#18), energy (#19) and live condition (#22).
   - Wave B: relations (#20) and assets (#21).
4. **Rebuild the test branch** in `C:\Users\adami\projects\Hobby\Tier 1\gev-wb-test-all-fix-round-2`.
   Claude has finished with it. Merge in the order 2, 3, 5, 4, 6, then push by fast-forward to PR #23.
   Leave `gev-wb-test-all` (the owner's, port 5189) and `gev-wb-test-all-fix-round` alone.
5. **Run the live proof** on the combined branch.
6. **Update the PRs and the report.**

If time runs short, work in the order the items are numbered. Anything left undone goes in a "Not fixed"
list in its PR, with the reason.

**Hard stop:** 4 hours after you start.

## 1. Phase 1 (#17): foundation

1. `scripts/world-fact-checks/foundation.mjs:2`: take `checkedOn` from the run date, not a fixed string.
2. Add a test for the runner's "missing local file → not measured" branch (`world-fact-check.mjs:153-166`).

## 2. Phase 5 (#18): people

1. **Same person, different spelling** (`officeholders.js:12-22, 43-55`). This is the main item.
   - Two names are the same person when every token of the shorter name matches a token of the longer one
     and at least two tokens match. A one-token name matches only another one-token name, or the same
     regnal name ("Felipe VI").
   - Tokens match when they are equal after `normalizePersonName`, or when both have 5+ letters and differ
     by one edit ("Drupadi" and "Droupadi").
   - When CIA and Wikidata name the same person, show the Wikidata name, Q-id, portrait and accounts, and
     no disagreement. The CIA page date still counts as a confirmation date.
   - Acceptance:
     - Putin, Mishustin, Lavrov, Belousov, Netanyahu, Sheinbaum, Ramaphosa, Prabowo, Felipe VI, Sánchez,
       Mohammed VI and Murmu show one name, a portrait and no disagreement.
     - Report the disagreement count before (266) and after, and list every remaining disagreement with
       both names.
     - List every pair matched only by the one-edit rule, so Claude can check none is two different people.
2. **The stale cue and "as of"** (`officeholders.js:33-41`).
   - Wikidata states who holds an office now. Its "as of" is the date the Refresh read it. Show its P580 as
     "since <date>".
   - "Newer evidence wins" keeps comparing the CIA page date with the Wikidata holder's start date.
   - "May be out of date" shows only when the newest confirmation of the holder shown is over 12 months
     old. A confirmation is any of these: the Wikidata read date when Wikidata names that holder, a CIA
     page date when CIA names them, or an official row's date.
   - Acceptance:
     - The holders of the USA and China are not stale.
     - Report the stale count before (369 of 780) and after, and list the roles still stale.
3. **Ambiguous CIA titles** (`cia-world-leaders.js:42, 50`; `officeholders.js:150, 183-184`).
   - Junior titles ("Min. of State for …", deputy titles) don't map to the minister role. Neither do
     compound titles whose main office is another one.
   - When several CIA rows still match one role, prefer the plain title, then the first one listed.
   - A role that stays ambiguous must not fall back to a Wikidata holder older than the CIA page. Flag it
     instead.
   - Acceptance:
     - Rwanda's foreign minister is Nduhungirehe.
     - Guinea-Bissau's head of government follows CIA's 2026 page.
     - List the ambiguous roles before and after.
4. **The CIA page loop** (`cia-world-leaders.js:290-311`) gets a run budget and stops after 3 failures in a
   row, like the Wikidata adapter.
5. **Name casing** (`cia-world-leaders.js:112-121`):
   - keep a regnal numeral anywhere in the name ("Carl XVI Gustaf");
   - keep Mc and Mac capitals ("McGuinty").
6. **Fact checks:**
   - the item 1 acceptance list;
   - the disagreement and stale counts;
   - Rwanda and Guinea-Bissau;
   - the 30-country sample stays at or above 90%.

## 3. Phase 2 (#19): energy

Rebuild from the cached BACI archive. Never download it again.

1. **Replace the 1.5× port cut** (`build-world-energy-model.mjs:473-475`, `world-energy-model.mjs:274`) with
   an allocation that keeps each port's national share.
   - For each exporter and product:
     - each port supplies its national share (from `energy-ports.json`) of the exporter's total;
     - each destination receives its BACI volume.
   - Fit both totals with biproportional fitting. Seed it with a distance decay, so near ports serve near
     destinations. Record the decay you chose.
   - Exporters with no port-share rows keep the shortest-route behaviour.
   - Acceptance:
     - Every port's allocated total is within 2% of its share.
     - Russia→India crude: Kozmino under 20%. `energy-russian-baltic-routes` passes.
     - Danish Straits oil gap no worse than round 2 (−40.9%).
     - Malacca LNG back within ±10%.
     - Pacific LNG from Sakhalin within 25% of EIA's 9.7 Mt.
     - Hormuz's top four unchanged.
     - Report Suez, Bab el-Mandeb and the Cape with their labels. They don't need to improve.
2. **Land borders use every polygon again** (`build-world-energy-model.mjs:260-281`).
   - The "mainland" is only for placing fallback ports. Use the capital's polygon there only when it is at
     least a third of the largest polygon's area; otherwise use the largest.
   - Acceptance:
     - MYS–THA stays a border.
     - ARE–OMN, ARE–SAU, DEU–DNK, CMR–GNQ and GAB–GNQ are borders again.
     - UAE→Saudi refined products go by land, not through Hormuz.
     - Denmark's Danish Straits crude share is back near round 2's.
3. **The calibration table** before (round 3) and after, for every passage, as in round 3.
4. **Fact checks:**
   - the acceptance numbers above;
   - the land-border list;
   - the three BACI cargo cases unchanged.

## 4. Phase 3 (#20): relations

1. **Rivals from the whole dataset** (`public/world/curated/rivalries.json`).
   - Assess every rivalry the cited dataset (Thompson, Sakuwa and Suhas) marks as ongoing in 2020: 56 rows.
   - Add each pair whose two states are on the board, unless a cited source shows the rivalry has ended.
     Record each such exclusion with its source.
   - Each row:
     - cites the dataset and reads "ongoing at 2020, per the dataset";
     - adds a 2023+ hostility citation where one is easy to find.
   - The precedence order doesn't change: a pair under sanctions or allied stays so.
   - Report the rival count before (7) and after, with every row and every exclusion.
2. **Allies with a documented rivalry,** such as Greece–Türkiye: the relation card adds one line, "Allies,
   with a documented rivalry", and its citation.
3. **Re-derive stamping** (`relationsSanctions.js:294`). When a re-derive serves the cached file, return
   `checkedRelease: false`, as #17 does for V-Dem and UCDP.
4. **Fact checks:**
   - CHN–IND, VEN–GUY and SYR–ISR are rivals;
   - GRC–TUR shows the cue;
   - the USA's classes, with any change explained.

## 5. Phase 4 (#21): assets

1. **Re-derive stamping** (`ourairports.js:81`, `nga-ports.js:202-219`). Same fix as section 4, item 3.
2. **Make the OurAirports aggregate fact measurable.**
3. **Guard `QUERY_VERSION`** (`wikidata-assets.js:22`). Add a test that fails when the query text changes
   and the version doesn't.

## 6. Phase 6 (#22): live condition

1. **GDELT threshold** (`liveGovernance.js:218`).
   - Keep the event key (date, CAMEO root, ADM1).
   - Flag at 3 events from 3 domains. With the 5-event rule, one region can never reach the threshold in
     72 hours, because the window spans only 4 dates.
   - Rerun the frozen and the fresh samples and report the flags before and after.
   - If a quiet country (Canada, New Zealand, Ireland) gets flagged, also require 2 distinct dates.
     Record which rule you kept. Still marked draft.
2. **UCDP-token coverage is per month,** not per country (`liveOptional.js:264`). A flagged country with no
   events in a published month shows "Cleared".
3. **The GDELT before/after counts** move into the fact checker (`scripts/world-fact-checks/live.mjs`).
4. **Client retries back off** (`events.js`) as the poll does, up to 30 seconds, instead of retrying every
   5 seconds forever.

## The live proof

No cold launch; it would cost the owner's 4G data.

1. **Set up.**
   - Copy `world-board-downloads\fix-round-3\combined-people-followup-cache` into a new folder under this
     round's evidence folder.
   - Run the combined branch on port 5190 with that copy.
2. **Refresh once in the browser,** recording a trace.
   - This Refresh must run the corrected Wikidata people query end to end. A version bump that forces a
     fresh people pull is fine.
   - Report:
     - the time and the megabytes downloaded;
     - each source's result, and which sources re-derived;
     - the Wikidata people batches: their HTTP statuses, and how many completed and were kept.
3. **Run the fact checker:**
   `node scripts/world-fact-check.mjs --url http://127.0.0.1:5190 --trace <trace file> --out <evidence>\fact-checks`.
4. **Take screenshots** on the live data:
   - the People tabs of the USA, Russia, India and Rwanda;
   - Denmark's Exposure tab, and India's Russian crude routes;
   - the Diplomacy lens on China and on Greece.

Evidence goes in `C:\Users\adami\projects\Hobby\Tier 1\world-board-downloads\fix-round-4\`. Copy every hand
table you changed to `C:\Users\adami\projects\Hobby\Tier 1\world-board-hand-tables\fix-round-4\`.

## Report

In each PR's description, add a "Fix round 4" section with:

- what changed;
- that phase's fact-check lines, with their sources;
- the gate output;
- "Not fixed", with reasons.

Append a "Fix round 4" section to the overnight report. End it with two tables:

1. every fact check: expected, found, source, and pass, fail or not measured;
2. each PR: its verdict, and what the owner must still do.

End your final message with those two tables and the PR #23 link.
