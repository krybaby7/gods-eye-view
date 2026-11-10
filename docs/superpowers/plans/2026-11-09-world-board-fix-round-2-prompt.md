# Prompt: World Board fix round 2, after Claude's review

Paste everything below the line as the first message of a fresh Codex session. Open the session in
`C:\Users\adami\projects\Hobby\Tier 1\gev-world-board`, use GPT 6.1 Sol as the orchestrator, and give it
full access with no approval prompts.

---

You are fixing what Claude's review of the World Board fix round found. The PRs are #17 (phase 1, the
foundation) and #18 to #22 (phases 5, 2, 3, 4 and 6). PR #23 is the combined test branch. Every gate passes
and the board now loads. But the live data is wrong in ways the fixture QA can't see:

- the USA and Mexico have no president;
- Saudi Arabia shows as 100% exposed to Suez because of 31 tonnes of crude;
- the USA is a "rival" of 101 countries;
- Finland has no power plants;
- a single news event flags Canada.

This round fixes the methods behind those errors and proves each fix against published facts, not counts.
Don't ask questions. Decide, record the judgement call and keep going. Claude reviews the result
afterwards and reruns your fact checks.

## Read first

1. **Claude's review:** `C:\Users\adami\projects\Hobby\Tier 1\world-board-review-2026-11-09.md`.
   - Every finding in it is in scope, including the minor ones.
   - Its file:line references point to the reviewed heads: #17 b7b76817, #18 b33c63d6, #19 c318214e, #20
     6e6dd31a, #21 f1bc2dba, #22 16b97e25 and #23 2daf72cd.
2. **Last round's work:** the "Fix round" section of
   `C:\Users\adami\projects\Hobby\Tier 1\world-board-overnight-report.md`, and your evidence in
   `C:\Users\adami\projects\Hobby\Tier 1\world-board-downloads\fix-round-2026-11-09\`.
3. **The overnight prompt:** `C:\Users\adami\projects\Hobby\Tier 1\world-board-overnight-prompt.md`.
   These sections of it all apply to this round:
   - "Worktrees, branches and ports";
   - "Rules for every phase";
   - "Hand tables";
   - "Sub-agents";
   - "Safety rules for the night";
   - "Gates, on every branch";
   - "Each PR description".
4. **The spec:** `docs/superpowers/specs/2026-11-08-world-board-design.md`, for the sections named below.

## What the owner decided

1. **Energy.** The gaps at Suez, Bab el-Mandeb and the Cape are accepted as the model's shortest-route
   assumption.
   - Label them "shortest route, before the Red Sea diversions" in the chokepoint cards and the
     calibration table.
   - Don't model the diversions.
   - The other chokepoint gaps are bugs, covered below.
2. **Diplomacy.** UN voting alone no longer makes a pair "rival". The same applies to "partner". Voting
   shows as "UN voting closeness" in the Relations tab.
3. **Assets on the globe.** Asset markers show only on the Ownership lens or when zoomed in.
4. **PortWatch.** It stays gated. Don't change it.

## The proof standard: facts, not counts

Last round reported "190 heads of state" and "143 importers covered". Both counts were true, while the
names and the shares were wrong. This round, every data fix is proved against facts published outside
this code.

**The fact checker.** Phase 1 adds `scripts/world-fact-check.mjs --url U --out DIR`.
- It reads the board from a running server, including the detail endpoints added below.
- It runs every check module in `scripts/world-fact-checks/*.mjs`. Each phase adds its own module, so the
  combined branch has all of them with no merge conflicts.
- For each check, it prints the expected value, the value found, the source and pass or fail.
- It writes `fact-checks.json` and `fact-checks.md` to `--out`, and exits non-zero if any check fails.
- It makes no web requests itself. Expected values are recorded in the modules, or in a data file next to
  them, each with its source URL and the date checked.
- Values that change over time, such as office holders, go in the data file with an `asOf` date, so Claude
  can update them later.

**Rules for the checks.**
- **Expected values come from outside the pipeline:** an official government page, the publisher's own
  table, or an EIA analysis. Never use Wikidata, or the file the adapter reads; that proves nothing.
- **Fix the method, not the row.** Override a single country only when the source itself is wrong. The
  override then goes in a hand table with a citation, and the PR lists it.
- **Don't game the checks.** No thresholds tuned or multipliers added to make a check pass. If a check still
  fails at the end, leave it failing and explain why.
- **It's a dev tool, not a gate.** The fact checker runs on live data. The fixture gates stay as they are.
  Every fix also gets a unit test that fails before the fix.

Each phase section below lists the checks its module must contain. Add more where they help.

## Order of work

1. **Phase 1 first (#17),** on `codex/world-board-phase-1` in this worktree: the foundation fixes, the
   fact checker and the lighter board. Push.
2. **Bring phase 1 into every phase.** Merge `codex/world-board-phase-1` into each phase branch, in its
   own worktree (`gev-wb-phase-2` to `gev-wb-phase-6`). Use merge commits only; no rebase, no force-push,
   no stash.
3. **Fix the phases, at most three at a time.**
   - Wave A: assets (#21), people (#18) and energy (#19).
   - Wave B: relations (#20) and live condition (#22).
   - Each phase keeps its QA port from the overnight prompt.
4. **Rebuild the test branch** in a new local clone, as described in "The combined branch".
5. **Run the live proof** on the combined branch.
6. **Update the PRs and the report.**

If time runs short, work in this order: the items marked **Blocker**, then the rest of each numbered
list, then the "Also fix" items. Anything left undone goes in a "Not fixed" list in its PR, with the
reason.

**Hard stop:** 8 hours after you start.

## 1. Phase 1 (#17): the foundation

1. **Bad downloads must not be cached.** `download.js:187` caches files as immutable, and V-Dem and UCDP
   use it.
   - Before keeping a file, check that it's what it should be: the ZIP signature for a ZIP, the gzip header,
     an expected CSV header line, and never an HTML page.
   - When parsing a cached file fails, delete it and mark the source failed, so the next Refresh downloads
     it again.
   - Tests: an HTML page served with status 200 in place of a ZIP is rejected. A ZIP with a bad CRC is
     deleted once its parse fails, then downloaded again on the next turn.
2. **Start the timers when the host queue releases the request,** not when it joins the queue. This
   applies to the request deadline (`imf.js:145-149`, `ucdp.js:192-199`) and the download stall timer
   (`download.js:219`).
   - Test: two requests to the same host, where the first takes longer than the second's deadline. Both
     must succeed.
3. **Polling survives a failed poll.** Today one failure stops it for good (`src/layers/world/index.js:231-238`,
   `worldPanel.js:418-421`).
   - Retry with backoff: 1, 2, 4 seconds and so on, up to 30.
   - Clear the progress line when the server says no Refresh is running, and re-enable Refresh.
   - Test: one poll fails in the middle of a Refresh. Progress resumes, and Refresh is enabled again at
     the end.
4. **A lighter board.** `/api/world` is 19 MB uncompressed, and during a Refresh the client fetches all of
   it every second.
   - **Poll a small progress endpoint** of under 20 KB instead. Fetch the full board once when a source
     lands and once when the turn ends.
   - **Move heavy detail out of the board.** Voting pairs, plant lists, energy dependency rows and the
     people extras are only needed for a selected country. Serve them from a detail endpoint, per country
     or per lens, and cache them in the browser. Phase 1 adds the mechanism; phases 2, 3, 4 and 5 move
     their detail onto it.
   - **Compress the responses** with gzip or brotli.
   - **Targets,** measured on the combined branch with the live cache:
     - the board under 4 MB uncompressed and under 1 MB compressed;
     - the first board from the cache in under 1 second locally;
     - no request over 1 MB during a Refresh, except the board fetches above.
5. **Rebuild derived data when the code that makes it changes.**
   - Give each adapter a version constant, and bump it whenever its output changes.
   - Store that version with each source's result. When it differs, derive the result again from the
     cached download instead of keeping the old rows.
   - Without this, the warm Refresh in "Live proof" would keep the wrong data.
6. **Also fix:**
   - On the log10 slots (S1, S2, S6 and S12), a measured 0 is a real value, not unknown (`scores.js:9-11`).
     Define the floor and mark it draft.
   - UCDP: a country missing from the file counts as 0 deaths only if the release covers it; otherwise it's
     unknown (`ucdp.js:281-286`). Record the coverage rule.
   - Prune old downloads. Keep each source's current file and one previous file, and delete `.part` files
     older than a day.
   - A restart during the first launch must not undercount turn 1.
   - Make `sourceQueue.test.mjs:5` and `index.test.mjs:120` prove what their names claim.
7. **Fact checks** (module `foundation.mjs`):
   - the board size, raw and compressed;
   - the progress poll size;
   - a Refresh fetches the full board no more than (number of sources + 1) times.

## 2. Phase 5 (#18): people

1. **Blocker: current office holders come from the person, not from the office** (`wikidata.js:37-42`).
   The office's P1308 list keeps people who left years ago.
   - Use the office's P1308 only to find candidates.
   - A candidate is current when their own P39 (position held) statement for that office has a P580
     start date, no P582 end date and no P1366 (replaced by).
   - If several are current, take the latest start date. On a real tie, show both, never none.
2. **Blocker: the USA and Mexico have no head of state or government,** and neither do Andorra, San Marino,
   Bosnia and Herzegovina, or Switzerland (`wikidata.js:133-140`).
   - Apply the same rule as in item 1.
   - Collective and dual heads show every current holder, labelled: Switzerland's Federal Council, Bosnia
     and Herzegovina's three-member presidency, Andorra's co-princes and San Marino's Captains Regent.
3. **One office that is both head of state and head of government,** as in Ghana, the USA and Mexico:
   show one person with both roles. Never fall back to a stale P6 (`wikidata.js:33-36`).
4. **A title belongs to the person's own statement** (`wikidata.js:32,36`). A head of state is never
   labelled with the head-of-government office.
5. **Government type is empty everywhere** (`wikidata.js:211-216`). Several P122 values are normal, not a
   conflict. Show them all, the most specific first.
6. **A slow query service must not stall a Refresh for 9 minutes** (`wdqs.js:6,24`,
   `wikidata.js:248-290`).
   - After 3 timeouts in a row, skip the remaining batches for this turn and keep the last good directory.
   - Give the whole people pull a budget of about 4 minutes.
   - Wait out a Retry-After of up to 60 seconds. A longer one skips that batch, not the whole run.
7. **Label acting holders "acting".** Use the P5102 (nature of statement) qualifier, or the office's own
   acting item.
8. **Move the people extras** onto the phase 1 detail endpoint.
9. **Also fix:**
   - The CSP's `frame-src` must allow the X embed: `https://platform.twitter.com` and
     `https://syndication.twitter.com`. Prove that an embed renders.
   - Accept CC0 portraits. Today only the spelling "CC 0" matches.
   - Show a Bluesky profile only when its handle matches the person's Bluesky handle on Wikidata, or when
     the profile links to the person's official site.
   - Fetch the organisations' Bluesky and YouTube accounts too, or remove their empty slots.
10. **Fact checks** (module `people.mjs`, data file `people.expect.json`):
    - **Named holders.** The USA's head of state and government is Donald Trump, Mexico's is Claudia
      Sheinbaum, and Ghana's is John Mahama. Verify each again live before relying on it.
    - **Never shown as current:**
      - Aung San Suu Kyi as Myanmar's foreign minister;
      - Karin Kneissl as Austria's foreign minister;
      - Marise Payne or Christopher Pyne as an Australian minister;
      - Nana Akufo-Addo in Ghana.
    - **Iran:** each person's title matches their own office.
    - **Collective heads:** Switzerland, Bosnia and Herzegovina, Andorra and San Marino show all their
      current holders.
    - **Government type** is filled for at least 180 states.
    - **A sample of 30 countries** across every region, including all of the G20:
      - check the head of state, head of government, foreign minister and defence minister;
      - check them against each government's official site. If that's unreachable, use the CIA World
        Leaders directory or the current English Wikipedia list, and record which you used;
      - target at least 95% matching, and explain every miss.

## 3. Phase 2 (#19): energy

1. **Blocker: rank by volume, not by the share of a single item** (`energy.js:149-166`,
   `worldEnergyPanels.js:419-431`).
   - **The exposure measure.** A country's exposure to a chokepoint is the energy-weighted share of its
     imports that pass through it. Convert crude, refined products, LNG and coal to one energy unit, add
     them up, then divide. Keep both denominators: seaborne imports and all imports.
   - **Small importers.** A country whose total energy imports fall below a small floor shows as "minor
     importer", not as a colour. Define the floor and mark it draft.
   - **The hover** names the chokepoint, the share, the volume and the main product.
   - **The chokepoint dependents** are ranked by the volume that passes through the chokepoint.
2. **Blocker: no Atlantic–Pacific route through Arctic waters, and no Kiel Canal for energy cargoes**
   (`scripts/world-energy-model.mjs:125`).
   - Remove the Northern Sea Route, the Northwest Passage and the Bering Strait links.
   - Remove the Kiel Canal edge; tankers don't fit through it.
   - Arctic ports that ship year-round (Murmansk, Hammerfest and Sabetta) still route west through the
     Norwegian Sea.
3. **Blocker: real export ports, per country and per product** (`build-world-energy-model.mjs:171`).
   - **A port hand table.** Replace Natural Earth's port ranking with a hand table of energy export and
     import ports. Cover the 40 largest energy exporters and importers by volume, with a source for each
     row.
   - **A resolution test.** Every row and override must resolve to a port in the network. The Iran and
     Kuwait overrides never matched.
   - **Several ports per country.** Where a country exports a product from several ports, split its flows
     by the ports' published throughput shares, and state that as an assumption. These matter most:
     - Russia: the Baltic, Black Sea, Pacific and Arctic ports;
     - Saudi Arabia: the Gulf ports versus Yanbu;
     - the UAE: the Gulf ports versus Fujairah;
     - Iraq: Basra versus Ceyhan.

     The last three decide how much passes through Hormuz.
   - **Kazakhstan.** CPC crude is a sea export from the CPC terminal near Novorossiysk, not land trade.
4. **Blocker: screen the BACI quantities.** UAE→Thailand crude is 151.7 Mt at $97 a tonne, about three
   times Thailand's total crude imports.
   - For each HS code, compare each row's value per tonne with the median for that code.
   - Where a row falls outside a third of the median to three times it, re-estimate its tonnage from its
     value at the median price, and flag the row "quantity re-estimated".
   - Report how many rows this changed.
5. **Taiwan.** BACI code 490 / `S19` ("Other Asia, nes") is Taiwan. Map it to TWN.
6. **Also fix:**
   - **Land routes** count only where the two countries' main landmasses touch, or where a sourced
     pipeline exists. Overseas territories and shared islands don't count, as with French Guiana or Borneo.
   - **Coastal importers with no port** in the table use their nearest network port, flagged as
     approximate. Don't leave them silently unknown.
   - **Labels:** fix the Øresund and Danish Straits labels.
   - **A test:** `energy.test.mjs:136` passes for the wrong reason.
   - **The owner's decision 1:** add the shortest-route labels.
   - **Detail endpoint:** move the energy dependency rows onto it.
7. **Rebuild the model** with the BACI archive already in
   `C:\Users\adami\projects\Hobby\Tier 1\world-board-downloads\baci`, the build script's default cache.
   Don't download it again.
8. **Fact checks** (module `energy.mjs`):
   - **Hormuz dependents by volume.** The top four are China, India, Japan and South Korea, in any order.
     EIA reported that together they took 69% of the crude and condensate through Hormuz in 2024
     (https://www.eia.gov/todayinenergy/detail.php?id=65504). Verify that page live and cite it.
   - **No exporter in the dependents through a trivial import.** No exporter of a product (Saudi Arabia,
     Kuwait, Qatar, Iran, the UAE, Russia and so on) appears in any chokepoint's top 10 dependents because
     of a trivial import.
   - **Before and after values** for Saudi Arabia, Iran, Qatar, Kuwait, Gambia, Japan, India, China and
     South Korea, shown in the PR.
   - **Routes.** No route crosses the Arctic between the Atlantic and the Pacific, and none uses the Kiel
     Canal.
   - **Thailand.** Its total modelled crude imports are within 25% of a published figure. That figure is
     on the order of 1 mb/d, about 50 Mt in 2024; cite your source.
   - **Taiwan** appears, with crude, LNG and coal imports.
   - **Russia's ports.** India's crude through the Dardanelles is explained by the Russian port split, and
     Russian Baltic crude passes the Danish Straits.
   - **Calibration.** The EIA calibration table, before and after, for every chokepoint.
     - The gaps at the Danish Straits and the Turkish Straits should shrink.
     - Hormuz and Malacca should stay within 25%.
     - No fitted multipliers.

## 4. Phase 3 (#20): relations

1. **Blocker: the owner's decision 2** (`relations.js:4-5,59-68`).
   - Voting alone sets neither rival nor partner.
   - Rival comes only from a diplomatic rupture, or from a sourced rivalry row in a hand table.
   - Partner comes only from partnership rows.
   - The Relations tab shows "UN voting closeness: N%" for the pair, with the session year.
2. **Blocker: "At war" only with current evidence** (`relationsUcdp.js:92-95,134`). Today's armed-conflict
   rows are 2025 UCDP dyads with `end = null`.
   - **Painting at war.** A pair is painted at war only when current data shows fighting between those two
     sides in the last 90 days, from phase 6's rolling UCDP window or another keyless current source.
   - **Read through the snapshot.** Read that data through the snapshot, so that phase 3 still works
     without phase 6.
   - **Without current evidence,** the pair shows "Armed conflict in 2025 (UCDP)" in the tab. On the lens,
     it gets its own lighter class or none; your call, recorded.
3. **Sanctions programmes: complete, and scoped** (`relationsSanctions.js:51-125,135-164`).
   - **Map every country programme** in the UK and OFAC files. A test fails if any programme in the
     downloaded file is neither mapped to a country nor listed as thematic.
   - **Give each programme a scope,** taken from its official description:
     - "state" means it targets the government or the economy, as for Russia, Iran or North Korea;
     - "persons" means it targets people or groups in that country.
   - **On the lens and in the tab.** Only state scope paints the Sanctions class. Persons scope shows in
     the tab as "Sanctions on persons in X".
4. **The Houthis.** UCDP's "Government of Yemen (North Yemen)" is the Houthi movement, a non-state actor.
   Don't map it to YEM (`relationsUcdp.js:57-66`).
5. **`dateChecked`** comes from the download: its Last-Modified date, or the date it was fetched. Not the
   hard-coded '2026-11-09' (`relationsSanctions.js:9,237`).
6. **Move the voting pairs** onto the phase 1 detail endpoint. They're 7.7 MB today.
7. **Also fix:**
   - Coalition dyads name the right side (`worldRelationsTab.js:73`).
   - Source links go to the dataset's page, not to the raw 145 MB file.
   - Wikidata diplomatic rows get their dates, and an evidence label other than 'seed'.
   - Hand-check African Union and Arab League membership, including suspensions.
   - Give the UN members list its licence mark, and the Rio Treaty row its participants.
8. **Fact checks** (module `relations.mjs`):
   - **The USA's rivals:** the count and the list, each with its source.
   - **Not rivals:** none of France, the UK, Germany, Japan, Mexico, India or Brazil is a rival of the
     USA or under its state-scope sanctions.
   - **Sanctions pairs:** USA–Russia, USA–Iran and USA–North Korea are in the Sanctions class (state
     scope), with their programme names.
   - **At war:** every pair painted at war, with the events that justify it.
   - **Houthis:** no Houthi dyad is mapped to YEM.
   - **Programme coverage:** for UK and OFAC, the counts mapped, thematic and unmapped. Unmapped must be 0.

## 5. Phase 4 (#21): assets

1. **Blocker: the resolver drops countries when aliases collide** (`asset-common.js:26,32,40`).
   - **What goes wrong.** Finland has 0 plants because the Åland alias claims FIN. Brazil, France,
     Australia and Kazakhstan have 0 airports, because the codes BR, FR, AU and KZ are shared with
     territories.
   - **The rule.** A sovereign state's own code always beats a territory alias. Resolve a collision by
     that rule; never drop both.
   - **The test.** Run it against the full registry, not the 4-country one in `phase-4.test.mjs:137`.
2. **Blocker: the Ownership lens is empty on real data.** 0 of 9,533 assets have a verified owner.
   - **Company owners.** Take owners from Wikidata P127 (owned by) and P137 (operator) when the owner is a
     company. Use the company's own country (P17, or the country of its P159 headquarters), labelled
     "owner's home country".
   - **Hand-table owners.** The foreign bases and the fabs come from hand tables, which give their owners
     directly.
   - **Intel Fab 34.** Remove the hard-coded entry (`server/providers/world/assets.js:269-272`). If it's
     needed, it belongs in the fabs hand table with a citation.
   - **Draft owners.** Show draft owner rows with a draft cue, instead of hiding them.
   - **QA** must not depend on a fixture owner.
3. **The owner's decision 3, and where clusters sit.**
   - **Ownership lens:** show the selected country's assets and owner lines at any zoom.
   - **Other lenses:** show asset markers only below a camera height of about 2,000 km. Record the value
     you choose.
   - **Cluster position:** place each cluster on the member nearest the members' centre, not on an
     arbitrary member (`src/layers/world/assets.js:203-219`, `assets.test.mjs:161`).
4. **Move the plant lists** onto the phase 1 detail endpoint. They're 5 MB today.
5. **Also fix:**
   - closed plants look closed;
   - the 41 assets named with a bare Q-id get a name, or are dropped;
   - Hammaguir closed in 1967, so it isn't a current French base;
   - a lens switch doesn't redraw every marker;
   - add the FAS no-licence warning to `DATA_SOURCES.md`;
   - the "?" marker doesn't take the click on small countries;
   - draft presence lines get the draft cue.
6. **Fact checks** (module `assets.mjs`):
   - **Counts per country.** Plant counts equal WRI's own count, for every country. Airport counts equal
     OurAirports' `iso_country` counts, for the airport types kept. Report any difference.
   - **Named assets.** Finland includes Olkiluoto and Loviisa; France, Paris-Charles de Gaulle; Brazil,
     São Paulo-Guarulhos; Australia, Sydney; and Kazakhstan, Astana.
   - **Ownership on China** shows sourced lines. Report the count and five examples with their sources. If
     Piraeus (COSCO), Hambantota (China Merchants Port) and the Djibouti base are missing, say why.
   - **Ownership on the USA:** the same.

## 6. Phase 6 (#22): live condition

1. **Blocker: a live tick is not a turn** (`index.js:283-311`).
   - Turns come only from the first launch and from Refresh, as spec section 5 says.
   - A live tick updates the live condition in its own small file, without rewriting `state.json`.
   - A Refresh pressed during a tick is queued and runs after it, and the panel says so. It's never
     dropped, as `start(): if (active) return` does today.
2. **Blocker: one GDELT event must not flag a country** (`liveGovernance.js:284-316`).
   - Flag only on several events from several distinct sources within a rolling 72 hours. Start at 5
     events from 3 source domains, and mark it draft.
   - Let old batches expire.
   - Label every GDELT flag "news-derived, low confidence".
3. **Stale, not cleared.**
   - Each live feed keeps the time of its last good pull.
   - If the feed fails, its flags show "stale since …".
   - When the data ages out, the flag shows "no recent data".
   - It shows "cleared" only when a fresh pull shows the condition ended.
4. **UNHCR.**
   - Ask for the latest year that has data, falling back one year at a time. It must work in March as well
     as in November.
   - Don't flag old stocks as new.
5. **Also fix:**
   - a complete GDELT FIPS→ISO3 table; 29 states are missing, including Serbia and Angola;
   - coup names for Congo, São Tomé and eSwatini;
   - draft and rule labels on every flag rule, not only CPI and UCDP;
   - CPI uses a published year-on-year figure where one exists, and explain Rwanda and Malawi at exactly
     20.0%;
   - licence marks on unconfirmed licences;
   - an alias table and a threshold for the optional UCDP-token feed;
   - IODA maps every country it covers;
   - the two weak tests.
6. **Fact checks** (module `live.mjs`):
   - **GDELT flags.** List each flagged country with its event count, its distinct sources and three
     source URLs. Canada, New Zealand and Ireland aren't flagged on a single event.
   - **Turns.** The turn count doesn't change over 4 live ticks, and a Refresh pressed during a tick runs
     after it.
   - **Stale feeds.** A failed feed shows stale flags, with its last good time.
   - **UNHCR** reports its year, with a fixed-clock test for March and for November.

## Live calls in this round

Same rules as last round:

- free, keyless sources only;
- one request at a time per host;
- no tight loops;
- Retry-After honoured;
- a User-Agent with no personal data.

Never call paid services, use keys, create accounts, request emailed downloads, or press any Claude or
Perplexity Refresh. Fetch the fact-check sources, such as government pages and EIA, the same way.

## The combined branch

- **Two checkouts are in use.** `gev-wb-test-all` (port 5189) is the owner's, and
  `gev-wb-test-all-fix-round` (port 5191) is Claude's review copy. Leave both checkouts, their caches and
  their servers alone.
- **Make a new local clone,** `C:\Users\adami\projects\Hobby\Tier 1\gev-wb-test-all-fix-round-2`:
  - clone it from `gev-wb-test-all-fix-round`, with no network;
  - set `origin` to GitHub;
  - check out `codex/world-board-test-all`;
  - install from your offline npm cache.
- **Merge** the updated phase branches in the order 2, 3, 5, 4, 6, then push to PR #23 by fast-forward.

## Live proof

No cold launch this time. It would cost the owner about 230 MB of 4G data and prove little new.

1. **Set up.** Copy `world-board-downloads\fix-round-2026-11-09\combined-live-cache` into a new folder
   under this round's evidence folder. Run the combined branch on port 5190 with that cache.
2. **Refresh once.** With phase 1's adapter versions, every changed source should derive its result again
   from its cached download. Report:
   - the time to finish;
   - the megabytes downloaded;
   - each source's result;
   - which sources derived their results again.
3. **Run the fact checker:**
   `node scripts/world-fact-check.mjs --url http://127.0.0.1:5190 --out <evidence>\fact-checks`.
4. **Measure:**
   - the board's size, raw and compressed;
   - the progress poll's size;
   - the time to the first board from the cache.
5. **Take screenshots** on the live data:
   - the Energy lens, and India's Exposure tab;
   - the Hormuz card;
   - the Diplomacy lens on the USA;
   - Ownership on China;
   - the People tabs for the USA and Ghana;
   - the Condition lens with its live flags;
   - the globe at board zoom on the Condition lens, with no asset markers;
   - the globe zoomed in on Europe.

All evidence goes in `C:\Users\adami\projects\Hobby\Tier 1\world-board-downloads\fix-round-2\`.

## Report

In each PR's description, add a "Fix round 2" section with:

- what changed;
- that phase's fact-check lines, with their sources;
- the gate output;
- a "Not fixed" list, with reasons.

Append a "Fix round 2" section to the overnight report. End it with two tables:

1. every fact check: expected, found, source, and pass or fail;
2. each PR: its verdict, and what the owner must still do.

End your final message with those two tables and the PR #23 link.
