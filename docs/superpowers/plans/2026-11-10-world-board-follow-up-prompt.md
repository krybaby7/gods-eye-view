# Prompt: World Board follow-up on main, after Claude's fourth review

Paste everything below the line as the first message of a fresh Codex session. Open the session in
`C:\Users\adami\projects\Hobby\Tier 1\gev-world-board`, use GPT 6.1 Sol as the orchestrator, and give it
full access with no approval prompts.

---

The World Board is merged. All six phase PRs went into main on 10 November 2026 (main a9601c8d), and all
nine gates pass there. Claude's fourth review found a short list of leftovers. They are about how the data
reads, not broken code. This follow-up fixes them in one branch and one PR.

Don't ask questions. Decide, record the judgement call and keep going. Claude reviews the result afterwards
and reruns your fact checker.

## Read first

1. **Claude's fourth review:** `C:\Users\adami\projects\Hobby\Tier 1\world-board-review-4-2026-11-10.md`.
   - Its file:line references point to the reviewed heads. Main's code is identical to the combined head
     ca1d0b78, so they hold on main.
   - Every leftover in it is in scope. These are accepted as they are:
     - the three calibration gaps (Malacca oil, Malacca LNG, Dardanelles), which keep their labels;
     - Murmu without a portrait;
     - Malaysia–Singapore stays a rival;
     - GDELT stays draft.
2. **Your last round:** the "Fix round 4" section of
   `C:\Users\adami\projects\Hobby\Tier 1\world-board-overnight-report.md`, and its evidence in
   `C:\Users\adami\projects\Hobby\Tier 1\world-board-downloads\fix-round-4\`.
3. **The round 4 prompt:** `C:\Users\adami\projects\Hobby\Tier 1\world-board-fix-round-4-prompt.md`. Its
   "Read first" list still applies, including the proof standard and the live-call rules of earlier rounds.

## Set-up

1. This worktree is on `codex/world-board-phase-1`, which is merged. Fetch, then create
   `codex/world-board-follow-up` from `origin/main` here.
2. First commit: copy this prompt file to
   `docs/superpowers/plans/2026-11-10-world-board-follow-up-prompt.md`.
3. Open one PR to main. Don't merge it.
4. Leave every other folder alone, especially `gev-wb-test-all` (the owner's, port 5189) and the main
   checkout `gods-eye-view` (the owner's war monitor test).

If time runs short, work in the order the sections are numbered. Anything left undone goes in a "Not
fixed" list in the PR, with the reason.

**Hard stop:** 3 hours after you start.

## 1. People

1. **Transliterations count as the same person** (`officeholders.js`, name matching).
   - Two name tokens also match when their transliteration skeletons are equal. To build a skeleton:
     - fold diacritics and case;
     - join "Abd al-", "Abd el-" and "Abdul" into one form;
     - map kh→k, gh→q, zh→j and x→ks;
     - drop vowels, including y;
     - collapse doubled letters.
   - Wikidata's English aliases and the English Wikipedia article title (without a bracketed
     disambiguation) count as names of the item. Add them to the people query if it doesn't fetch them,
     and bump the query version.
   - Before comparing, strip honorifics (King, Queen, Sultan, Emir, Sheikh, Prince, Crown Prince) and a
     trailing "of <country>" ("Philippe of Belgium").
   - Keep the current guard: same country, same office, every token of the shorter name matched, at least
     two tokens unless it is a one-token or regnal name.
   - **Patronymic guard:** when either name contains "bin", "ibn", "bint", "ould" or "walad", the token
     before the first such word must match too. "Hamdan bin Mohammed bin Rashid Al Maktoum" must not match
     "Mohammed bin Rashid Al Maktoum". Add that pair, and Oman's "Theyazin bin Haitham bin Tariq Al Said"
     against his father "Haitham bin Tariq Al Said", as tests.
   - When the match comes through an alias or the article title, show that name, not the label. This fixes
     the vandalised labels: Guyana's prime minister (labelled "Hugo Chávez"), and the Eswatini and Tuvalu
     prime ministers.
   - **Acceptance:**
     - the UAE's president, vice president and prime minister, Saudi Arabia's king, Qatar's emir, Egypt's
       Sisi, Israel's Herzog, Kazakhstan's Tokayev, Belarus's Lukashenka, the Philippines' Marcos and
       Belgium's Philippe show one name, a portrait and no disagreement;
     - Guyana, Eswatini and Tuvalu show their real prime ministers;
     - report the disagreement count before (143) and after, and the stale count before (76) and after;
     - list every pair that matches only through the new rules, with both names, so Claude can check
       none is two different people.
2. **Congo-Kinshasa's foreign minister** (`cia-world-leaders.js:51`).
   - Map "Dep. Prime Min. and Min. of <office>" to the minister of that office.
   - Accept a "Min. of State of/for Foreign Affairs" title only when it is the page's only foreign-affairs
     title.
   - **Acceptance:**
     - Congo-Kinshasa's foreign minister is Therese Kayikwamba Wagner;
     - Jordan's is the holder of "Dep. Prime Min. and Min. of Foreign Affairs & Expatriates", not the
       Minister of State;
     - Rwanda's is still Nduhungirehe;
     - list every role whose holder changed because of this item.
3. **Name casing** (`cia-world-leaders.js`, the casing rules).
   - Keep Mc and Mac capitals only for a short list of names known to use them. "Mackenna" and
     "Mchengerwa" stay as written.
   - Two-letter particles such as "Di", "De", "Da" and "Le" are title-cased ("Di Maio").
   - When a CIA name matches a Wikidata name, show the Wikidata spelling, as now.

## 2. Relations

1. **Drop ten rival rows** (`public/world/curated/rivalries.json`), recording each exclusion with the
   source given in the review:
   - SAU–SYR and TUR–SYR: the rivalry was with Assad's government, as for Qatar–Syria;
   - SAU–QAT, ARE–QAT, BHR–QAT and EGY–QAT: ended by the Al-Ula Declaration (2021);
   - EGY–TUR and SAU–TUR: ties restored in 2023;
   - GNQ–GAB: the 28 July 2026 agreement to implement the World Court ruling;
   - ERI–SDN: Eritrean troops fight alongside Sudan's army in the current war.
   - Report the rival rows before (54) and after (44), and the painted rival pairs before (49) and after.
2. **Add the Makkah defence pact** as a treaty alliance among Saudi Arabia, Türkiye and Pakistan: signed on
   7 August 2026, ratified by Türkiye's parliament on 5 November 2026. Cite the three sources the review
   lists. Saudi Arabia–Türkiye then paints ally; record what the other two pairs showed before.
3. **Group repeated UCDP support rows.** China's card lists "Government of Central African Republic" three
   times, once per rebel group. Show each supported party once, with the number of dyads. Add "(UN mission
   troop contributor, per UCDP)" only when the data says the support is a UN mission contribution.
4. **Fact checks:** SAU–TUR is ally, SAU–QAT is not rival, CHN–IND is still rival, and China's card shows
   the Central African Republic once.

## 3. Energy

Rebuild from the cached BACI archive in `world-board-downloads\baci`. Never download it again.

1. **Russia→China percentages** (`world-energy-model.mjs:413`). Port and passage shares shown next to the
   sea-only volume are shares of the sea volume, not of sea plus pipeline. Kozmino reads about 77% and
   Malacca about 23%. The tonnes don't change.
2. **The border-size rule** (`build-world-energy-model.mjs:275`). A land border counts only when both
   touching polygons are at least a third of their own country's largest polygon.
   - **Acceptance:**
     - MYS–THA, ARE–OMN, ARE–SAU, DEU–DNK, CMR–GNQ and GAB–GNQ stay borders;
     - France–Brazil (French Guiana), Britain–Ireland (Northern Ireland), Russia–Lithuania (Kaliningrad)
       and Angola–Congo (Cabinda) are no longer land routes;
     - Britain's refined products to Ireland go by sea again;
     - list every border pair the rule adds or removes against main.
3. **Indonesia's import port.** The one-third fallback rule moved it from Jakarta to Banjarmasin, which
   sends about 7.5 Mt more oil through Malacca. Put it back on Java. Prefer curated, cited Indonesian
   import terminals; otherwise use an explicit Java exception. Record which you chose.
4. **The Malacca LNG label:** "US LNG to Asia is routed via Panama in this model. In 2024 much of it went
   round the Cape of Good Hope and through Malacca."
5. **The calibration table** before (main) and after, for every passage, as in round 4. The BACI cargo
   cases, the Hormuz top four and Sakhalin LNG must not change.

## The live proof

No cold launch; it would cost the owner's 4G data.

1. **Set up.**
   - Copy `world-board-downloads\fix-round-4\combined-energy-replay-cache` into a new folder under this
     round's evidence folder.
   - Run this branch on port 5190 with that copy.
2. **Refresh once in the browser,** recording a trace. It must run the people query with aliases and
   article titles end to end.
   - Report:
     - the time and the megabytes downloaded;
     - each source's result, and which sources re-derived;
     - the Wikidata people batches: their HTTP statuses, and how many completed and were kept.
3. **Run the fact checker:**
   `node scripts/world-fact-check.mjs --url http://127.0.0.1:5190 --trace <trace file> --out <evidence>\fact-checks`.
4. **Take screenshots** on the live data:
   - the People tabs of the UAE, Guyana, Congo-Kinshasa and Jordan;
   - the Diplomacy lens on Saudi Arabia and on Qatar;
   - China's relation card with the grouped support row;
   - Russia→China crude routes, and Indonesia's Exposure tab.

Evidence goes in `C:\Users\adami\projects\Hobby\Tier 1\world-board-downloads\follow-up\`. Copy every hand
table you changed to `C:\Users\adami\projects\Hobby\Tier 1\world-board-hand-tables\follow-up\`.

## Gates

All nine, on the final head: format:check, check:boundaries, `layer-token:check -- --base-ref main`,
`npm test`, `npm run build`, and the qa-world, qa-searches, qa-news and qa-lenses (`--skip-performance`)
fixture runs.

## Report

In the PR description:

- what changed;
- the fact-check lines, with their sources;
- the gate output;
- "Not fixed", with reasons.

Append a "Follow-up" section to the overnight report. End it with two tables:

1. every fact check: expected, found, source, and pass, fail or not measured;
2. what the owner must still do.

End your final message with those two tables and the PR link.
