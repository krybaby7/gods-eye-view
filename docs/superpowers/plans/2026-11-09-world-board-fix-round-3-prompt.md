# Prompt: World Board fix round 3, after Claude's second review

Paste everything below the line as the first message of a fresh Codex session. Open the session in
`C:\Users\adami\projects\Hobby\Tier 1\gev-world-board`, use GPT 6.1 Sol as the orchestrator, and give it
full access with no approval prompts.

---

You are finishing the World Board. Fix round 2 worked:

- all nine gates pass;
- the heads of state and government are right;
- the Energy lens ranks by volume;
- Diplomacy no longer invents rivals;
- every country's power plants are in;
- the board is 0.4 MB compressed instead of 19 MB.

Claude's second review found a shorter list:

- stale ministers;
- two Energy method bugs;
- a live scheduling bug that skips every other tick;
- an almost empty "rival" class;
- a few small defects.

This round fixes that list. After it, Claude expects to recommend merging.

Don't ask questions. Decide, record the judgement call and keep going. Claude reviews the result afterwards
and reruns your fact checker.

## Read first

1. **Claude's second review:** `C:\Users\adami\projects\Hobby\Tier 1\world-board-review-2-2026-11-09.md`.
   - Every finding in it is in scope, including the low ones.
   - Its file:line references point to the reviewed heads:

     | PR | Head |
     | --- | --- |
     | #17 | a5a591cc |
     | #18 | 6b8892c9 |
     | #19 | 7ba05ffe |
     | #20 | afecd9ca |
     | #21 | c9a6f78d |
     | #22 | 288e484c |
     | #23 | 1d69c337 |

2. **Your last round:** the "Fix round 2" section of
   `C:\Users\adami\projects\Hobby\Tier 1\world-board-overnight-report.md`, and its evidence in
   `C:\Users\adami\projects\Hobby\Tier 1\world-board-downloads\fix-round-2\`.
3. **The round 2 prompt:** `C:\Users\adami\projects\Hobby\Tier 1\world-board-fix-round-2-prompt.md`. Its
   section "The proof standard: facts, not counts" still applies in full, and so does its "Live calls in
   this round".
4. **The overnight prompt:** `C:\Users\adami\projects\Hobby\Tier 1\world-board-overnight-prompt.md`. These
   sections apply:
   - "Worktrees, branches and ports";
   - "Rules for every phase";
   - "Hand tables";
   - "Sub-agents";
   - "Safety rules for the night";
   - "Gates, on every branch";
   - "Each PR description".

## What the owner decided

1. **Ministers.** Add CIA World Leaders as a second source for the four roles. The newer evidence wins.
   Every holder shows "as of <date> · <source>", and disagreements between the sources are flagged. Details
   are in section 2.
2. **Rivals.** Fill "rival" from published, cited rows, so the Diplomacy lens shows who is against whom.
   Details are in section 4.
3. **China's "Malaysian" crude.** The reassignment of China's reported Malaysian crude to Iran stays, with
   its EIA citation. Label it where it changes a number.
4. **Draft hand tables.** Claude spot-checks them against their citations in the next review, so every row
   must keep a working citation. You don't need the owner to review them.
5. **PortWatch.** It stays gated.

## Order of work

1. **Phase 1 first (#17),** on `codex/world-board-phase-1` in this worktree. Push.
2. **Bring phase 1 into every phase.** Merge `codex/world-board-phase-1` into each phase branch, in its
   own worktree. Use merge commits only; no rebase, force-push or stash.
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

**Hard stop:** 6 hours after you start.

## 1. Phase 1 (#17): foundation

1. **Re-deriving must not skip a release check that was due.** Today a re-derive skips the release and
   catalogue checks (`vdem.js:72-88`, `ucdp.js:216-236`), then `index.js:321-324` stamps the source as
   checked.
   - Re-derive from the cached file only when the source isn't due anyway. When it is due, run the normal
     check.
   - Test: V-Dem last checked in February, a version bump in April, and a March release must still be
     found.
2. **A failed poll must not freeze the panel** (`src/layers/world/index.js:264-271`).
   - Clear `progress`, show the error and re-enable Refresh, while the backoff retry continues.
   - Test: the server goes down in the middle of a turn. The panel shows the error, and Refresh is enabled.
3. **Evict a cached file only on an integrity error:** the signature, the ZIP structure, the CRC or
   truncation (`download.js:513-518`).
   - Any other parse error keeps the file and fails the source with a clear message. The file isn't
     downloaded again until the source has a new release.
   - Test: "CSV missing from ZIP" doesn't trigger a download on the next Refresh.
4. **Also fix:**
   - Each caller of a shared detail request applies only its own abort signal (`source.js:62-77`).
   - Run a one-time cleanup of untagged downloads older than 30 days that no current source uses
     (`download.js:140`).
   - Re-derived readings count as new observations only when their value changed (`index.js:331`).
   - Use `return await sendJson(...)` inside the try (`index.js:511-532`).
   - `worldbank.js:31` starts its deadline at dispatch.
5. **The fact checker.**
   - **Measurements with no trace.** A measurement that needs a browser trace reports "not measured", not
     "fail", when no trace is given. Add a `--trace FILE` option, and record a trace in the live proof.
   - **Missing files.** A module never crashes on a missing local file. It reports "not measured" with the
     reason. `live.mjs` crashed on `phase6-gdelt-manifest.txt`.
   - **Same person, different spelling.** Expected people rows accept aliases, and names are compared after
     normalising case, accents, punctuation and suffixes such as "Jr." or "Al Saud". Where an expected row
     has a Wikidata Q-id, compare Q-ids. The 11 same-person "failures" in round 2 must pass for the right
     reason.

## 2. Phase 5 (#18): people

1. **CIA World Leaders as a second source** (the owner's decision 1).
   - **Where the data is.** Each country's data is JSON at
     `https://www.cia.gov/resources/world-leaders/page-data/foreign-governments/<slug>/page-data.json`. It
     has `result.data.page.date_updated` and `leaders[]` with `name` and `title`. Find the country list
     the same way, from the index page's `page-data.json`.
   - **Terms.** Check the reuse terms live and record them in `sources.json` and `DATA_SOURCES.md`. The
     directory is a US government publication, described as public domain; confirm it.
   - **Be polite.** One request per country, one at a time, with a short pause. Cache the pages, and fetch
     them again at most weekly; the directory itself is weekly. Expect about 195 small pages.
   - **Titles to roles.** Map CIA titles to the four roles (head of state, head of government, foreign
     minister, defence minister) with a pattern table, plus per-country overrides, for example "Pres.",
     "Prime Min.", "Min. of Foreign Affairs", "Sec. of State" and "Min. of Defense".
     - Test the table against every country.
     - Report the countries where a role stays unmapped.
   - **Names.** CIA writes surnames in capitals; display them in normal case. Match each CIA name to the
     Wikidata person by normalised name, country and office, so the portrait and accounts still attach. If
     nothing matches, show the CIA name without a portrait.
   - **Which source wins.** For each role, compare the Wikidata holder (their P580 start date) with the
     CIA holder (the page's `date_updated`).
     - The same person: show them, "as of" the newer date.
     - Different people: show the one with the newer date, and flag "sources disagree: <other name> per
       <source>, <date>".
     - Only one source: show it, with its date.
   - **On screen.** Every role shows "as of <date> · <source>". If the newest evidence is more than 12
     months old, add a "may be out of date" cue.
2. **A successor without a start date must not leave the predecessor current** (`wd:147-167, 312-325`).
   - Reject a holder when the same seat has another holder with a later P580, or when the holder's own
     statement has a P582 or P1366.
   - When the other holder has no P580, let the CIA source decide. Never keep two holders silently.
   - Test it with Argentina's foreign minister and Bangladesh's.
3. **Keep the finished batches when the timeout stop fires** (`wd:563-573`). Merge them into the
   directory instead of discarding them. On the owner's connection this is why the round 2 warm Refresh
   kept the old people.
4. **Retry-After and 429s.**
   - A Retry-After longer than 60 seconds stops the remaining batches for this turn, and the finished ones
     are kept.
   - A 429 counts toward the 3-strike stop; it doesn't reset the counter (`wd:418`, `wdqs.js:64-66`).
5. **A skipped sitelink pass doesn't mark roles as completed** (`wd:520`).
6. **Government type.** Where Wikidata has no P122, show "not recorded". The 180-state target is dropped.
7. **Fact checks** (in `people.mjs` and `people.expect.json`, with aliases):
   - the same 30-country sample of four roles. Target: at least 90% matching, and every miss explained;
   - how many roles come from each source, and how many disagreements were flagged;
   - Japan's and South Korea's defence and foreign ministers, with the "as of" date shown;
   - none of the old stale names returns.

## 3. Phase 2 (#19): energy

1. **The quantity screen must not cut real cargoes** (`build:48-62`).
   - Use a median per HS code weighted by tonnes, not the plain median of rows.
   - Re-estimate only the rows priced below a third of that median; their declared tonnage is implausibly
     high. Leave rows priced above it at their declared tonnage, flagged if you like.
   - Claude's check on the cached BACI file shows the effect. Use these as tests:

     | Flow | Code | Declared | Plain median now | Expected |
     | --- | --- | --- | --- | --- |
     | Indonesia→China coal | 270119 | 49.6 Mt | cut to 15.2 Mt | stays 49.6 Mt |
     | Mexico→USA refined | 271000 | 10.7 Mt | cut to 2.7 Mt | stays 10.7 Mt |
     | UAE→Thailand crude | 270900 | 151.7 Mt at $97/t | re-estimated | still re-estimated, to about 25 Mt |

   - Report the number of rows touched, and the totals per code before and after.
2. **Fallback ports only on the main landmass** (`build:244-280`).
   - The main landmass is the polygon holding the capital; if there's none, use the largest polygon. No
     overseas territories and no remote islands.
   - Report France's, Portugal's and Australia's import ports after the fix. Today they're Pointe-à-Pitre,
     the Azores and Thursday Island.
   - The same rule fixes Malaysia: its mainland is the peninsula, which restores the Malaysia–Thailand land
     border.
3. **Split ports per destination** (`build:338-353`).
   - For each flow, keep only the origin ports whose route to that destination is at most 1.5 times the
     shortest. Renormalise their throughput shares over those ports. Mark the 1.5 draft.
   - Report Suez LNG before and after: modelled 5.4 against 0.5 published. Also report where Russia's
     Pacific LNG goes.
4. **Rows with no quantity** (189 of them) get a tonnage estimated from their value at the weighted median
   price, and are flagged. They no longer switch their group to value-based shares (`build:142, 170-172`).
5. **The "trivial exporter" fact checks what its name says.** A top-10 dependent of a chokepoint must carry
   at least 1% of that chokepoint's modelled total. Name the countries that fail it, if any.
6. **Labels.**
   - **The China–Iran reassignment:** on the Hormuz and Malacca cards and in the calibration table, "China's
     reported Malaysian crude treated as Iranian (EIA)".
   - **The Dardanelles row:** "BACI holds about 4.8 Mt of Türkiye's crude imports; Türkiye reports about
     30 Mt".
7. **Rebuild** from the cached BACI archive in
   `C:\Users\adami\projects\Hobby\Tier 1\world-board-downloads\baci`. Don't download it again.
8. **Fact checks:**
   - the three cargo cases above;
   - Hormuz's top four still China, India, Japan and South Korea;
   - the calibration table for every chokepoint, before and after;
   - Suez LNG;
   - the import ports of France, Portugal and Australia.

## 4. Phase 3 (#20): relations

1. **Sourced rivals** (the owner's decision 2).
   - **Build the rivalry hand table from published sources.**
     - Start from a published dataset of strategic or enduring rivalries. Find one, check its terms, and
       record its coverage years.
     - Every pair that stays in the table also needs a source from 2023 or later showing the hostility
       continues.
   - **Pairs with no diplomatic relations** count as rivals only with a cited, documented hostility. No
     relations alone isn't enough; Bhutan has no relations with many states.
   - **What a row holds:** the pair, the start year, the evidence label, the citation, and the date
     checked.
   - **Examples to check, not to assume:** Israel–Iran, South Korea–North Korea, India–Pakistan,
     Armenia–Azerbaijan, Morocco–Algeria, Greece–Türkiye and China–Japan. Keep each one only if the
     sources support it.
   - **Report:** the rival count before and after, and the list with citations.
2. **Venezuela and the Rio Treaty.** Add VEN to the treaty's `inactiveParticipants`
   (`alliances.json:153-155`), citing the denunciation that took effect in 2013. Note the 2019 opposition
   re-accession as disputed. Venezuela must no longer show as an ally of the treaty's parties.
3. **Fix the three broken AU links** (`bloc-memberships.json:27,32,37`).
4. **Recheck four programme scopes** against the official programme descriptions, and cite each one:
   - UK Iran 2023 (`:269`);
   - SSIDES and UKRAINE-EO13660, both Russia-related (`:169`);
   - BELARUS-EO14038 (`:34`);
   - UK Syria after the 2025 easing (`:312`).
5. **Wikidata diplomatic rows.** Give them their dates where Wikidata has them. Label the rest "undated".
6. **Fact checks:**
   - the rivals list, with citations;
   - Venezuela isn't an ally of any Rio party;
   - the four scopes;
   - the USA's classes, compared with round 2. The rival count may grow, but only with cited rows.

## 5. Phase 4 (#21): assets

1. **The "?" asset card works over land.** Use `else if (hit)` at `src/layers/world/index.js:184`.
   - Test: with China selected on Ownership, clicking a Chinese asset abroad opens the asset, not the host
     country.
2. **Closed foreign assets** appear in the tab's abroad list, with the closed cue, consistent with the
   lens (`server assets.js:160`, `src assets.js:79-84`).
3. **Owner labels** use the server's `countryLabel`, not "Owner's home country" for every owner
   (`worldAssetPanels.js:225`).
4. **Hammaguir** moves out of code (`wikidata-assets.js:99-110`) into a hand table, with a citation.
5. **Ports' `lastVerified`** comes from the data, not the hard-coded '2026-11-09' (`server assets.js:70`).
6. **The new Wikidata owner query must really run.**
   - A query change has to force a fresh pull on the next Refresh, not just a re-derive from the old cached
     records.
   - Prove it live: the number of assets with an owner, and Ownership counts for China and the USA, before
     and after.

## 6. Phase 6 (#22): live condition

1. **Every other live tick is skipped** (`index.js:383-389`, `liveFeedCommon.js:11-13`).
   - Store the tick's start time as `lastCheckedAt` for the due check. Keep `lastGoodAt` for display.
   - Test: 8 ticks 15 minutes apart, each with a 3-second download, make 8 fetches.
2. **"Since last turn" shows the net change** (`index.js:467,486`). At turn time, compare the flags active
   at the previous turn with the flags active now.
   - Test: a flag that flaps three times between turns shows at most once, and only if it's active now.
3. **The UCDP-token feed** stops showing "cleared" before UCDP publishes a month (`liveOptional.js:219-230`).
   Pass `covered`, or use the latest month present in the rows.
4. **The client doesn't drop a tick** when two feeds come due together (`events.js:139-141`,
   `index.js:211-214`). Advance a feed's timer only after its request was sent.
5. **"No recent data" flags expire** after their rule's time window (`conditionEvents.js:166`).
6. **A tick's save error stays visible** after a queued Refresh starts (`index.js:509`).
7. **GDELT event identity.**
   - Make the event key coarser: the date, the CAMEO root code and the ADM1 region.
   - Protest events don't need a second actor.
   - Keep 5 events and 3 domains, marked draft.
   - Report the flags before and after, on the frozen round 2 export and on one fresh sample.
8. **Fact checks:** the 8-tick test; the flapping test; the GDELT counts.

## The live proof

No cold launch again; it would cost the owner's 4G data.

1. **Set up.** Copy `world-board-downloads\fix-round-2\combined-live-cache` into a new folder under this
   round's evidence folder. Run the combined branch on port 5190 with that copy.
2. **Refresh once,** recording a browser trace. Report:
   - the time and the megabytes downloaded;
   - each source's result, and which sources re-derived;
   - how many Wikidata people batches completed and were kept;
   - the CIA World Leaders pull, with its page count and duration;
   - the Wikidata asset owner pull.
3. **Run the fact checker:**
   `node scripts/world-fact-check.mjs --url http://127.0.0.1:5190 --trace <trace file> --out <evidence>\fact-checks`.
4. **Take screenshots** on the live data:
   - the People tabs of the USA, Japan and South Korea, showing "as of" and any disagreement;
   - the Diplomacy lens on Israel and on the USA;
   - the Energy lens, with France's Exposure tab;
   - the Hormuz card;
   - Ownership on China.

Evidence goes in `C:\Users\adami\projects\Hobby\Tier 1\world-board-downloads\fix-round-3\`. Copy every
hand table you changed to `C:\Users\adami\projects\Hobby\Tier 1\world-board-hand-tables\fix-round-3\`.

## Report

In each PR's description, add a "Fix round 3" section with:

- what changed;
- that phase's fact-check lines, with their sources;
- the gate output;
- "Not fixed", with reasons.

Append a "Fix round 3" section to the overnight report. End it with two tables:

1. every fact check: expected, found, source, and pass, fail or not measured;
2. each PR: its verdict, and what the owner must still do.

End your final message with those two tables and the PR #23 link.
