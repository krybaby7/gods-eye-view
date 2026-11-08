# Prompt: build the World Board, phase 1

Paste everything below the line as the first message of a fresh session on
`krybaby7/gods-eye-view`, in a harness that can run sub-agents on GPT 6.1 Sol and GPT 6.1 Terra
(for example Codex). The spec and this prompt are on branch `docs/world-board-spec`
([PR #16](https://github.com/krybaby7/gods-eye-view/pull/16)). If that PR has been merged, start
from `main`. Phase 1 does not depend on PR #15.

---

You are building **phase 1 of the World Board** in this repo. God's Eye View is a CesiumJS 3D globe
for open-source intelligence: vanilla JavaScript, Vite, Node 24, the Node test runner, Prettier, a
package-boundary checker and Puppeteer QA scripts.

The World Board turns the app's existing globe into a strategy view of every country, like a
Civilization-style game. It is drawn on the real globe, with real borders over the real imagery.
There are **no tiles or hex boards**. Each country is coloured by a lens. Clicking a country opens
its character sheet. Code computes every number from published data, and Refresh runs one turn
that pulls new data and lists what changed.

Phase 1 is the foundation, and it alone must give the strategy-board look. The design is agreed,
and the owner approved a visual mock on 2026-11-08. Build phase 1, verify it, open the pull request
and report.

Start your work branch from `docs/world-board-spec`, or from `main` if PR #16 has been merged.

## Read first, in this order

1. `docs/superpowers/specs/2026-11-08-world-board-design.md`, the spec. Read all of it; phase 1 is
   section 11, item 1. Sections 1 and 13 hold the owner's decisions. Everything in it is agreed.
2. `docs/superpowers/research/2026-11-08-world-board-base-indicators.md`, the source facts behind
   spec 8.1.
3. `docs/superpowers/specs/2026-11-06-search-layers-design.md`, section 6.2: the layer
   registrations a new layer needs. The World Board follows the same pattern.
4. `docs/superpowers/research/2026-11-07-terra-delegation.md`, this repo's table of which tasks
   Terra handles well. Also read `.claude/agents/*.md`.
5. Country shapes and outlines:
   - `src/data/adminBoundaries.js` and `src/data/local_data/natural_earth/countries.json`;
   - the admin outline code under `src/annotations/`;
   - `scripts/qa-admin-outlines.mjs`.
6. The hotspot view's zoom hysteresis (spec of 2026-10-29, `docs/superpowers/specs/`) and
   `src/layers/news/hotspots.js`.
7. `docs/panel-surfaces.md`, `docs/CODE-BOUNDARIES.md`, `scripts/package-boundaries.json`,
   `DATA_SOURCES.md`, `TESTING.md`, `scripts/qa-lenses.mjs` (its `waitSettled` pattern) and the
   Searches layer's files as a model for a server provider plus a client layer.

Send Terra scouts at long files for the seams you need. Read the spec yourself.

## Scope of phase 1

From spec section 11:

- the world store and the indicator registry;
- the source adapters for spec 8.1's 18 seed indicators;
- pure scores, Refresh and the turn record;
- country fills with the Condition, Strength-area and Data age lenses;
- the character sheet's Strength and Condition sections, with "why this number".

Also in scope:

- the World Board layer with its registrations and share token;
- the zoom fade;
- the turn summary;
- `scripts/qa-world.mjs --fixtures`;
- the docs.

**Not in phase 1:**

- chokepoints, dependencies, the Energy exposure lens (phase 2);
- relations and the Diplomacy lens (phase 3);
- assets and the Ownership lens (phase 4);
- people and portraits (phase 5);
- live condition flags (phase 6);
- Claude estimates, stakes and the estimates toggle (phase 7);
- any total score;
- any Claude call;
- voice actions beyond the layer's manifest entry.

## The data

**Registry.** `public/world/indicators.json` holds the 18 indicators of spec 8.1, in the shape of
spec 4.2. Anchors version 1 are the draft anchors below. Mark them `"draft": true` until the owner
reviews them.

The score is `z = 100 · clip((f(x) − a) / (b − a), 0, 1)`, reversed when `direction` is
`higher-is-worse`.

| Slot | Code | f(x) | a | b | Direction | Role |
|---|---|---|---|---|---|---|
| S1 | `NY.GDP.MKTP.PP.CD` | log10 | 10 | 13.5 | higher-is-better | size |
| S2 | `FI.RES.TOTL.CD` | log10 | 8.5 | 12.5 | higher-is-better | buffer |
| S3 | `GOV_WGI_GE.SC` | x | 0 | 100 | higher-is-better | adequacy |
| S4 | `SP.DYN.LE00.IN` | x | 50 | 85 | higher-is-better | adequacy |
| S5 | `GOV_WGI_RL.SC` | x | 0 | 100 | higher-is-better | adequacy |
| S6 | `MS.MIL.XPND.CD` | log10 | 8 | 12 | higher-is-better | size |
| S7 | `EG.IMP.CONS.ZS` | x | −100 | 100 | higher-is-worse | exposure |
| S8 | `SN.ITK.DEFC.ZS` | x | 2.5 | 40 | higher-is-worse | adequacy |
| S9 | `LP.LPI.OVRL.XQ` | x | 1.5 | 4.3 | higher-is-better | adequacy |
| S10 | `IT.NET.USER.ZS` | x | 0 | 100 | higher-is-better | adequacy |
| S11 | `NE.TRD.GNFS.ZS` | x | 10 | 150 | higher-is-better | exposure (placeholder, low confidence) |
| S12 | `BX.GSR.ROYL.CD` | log10 | 6 | 11 | higher-is-better | size (placeholder, low confidence) |
| C1 | `GOV_WGI_PV.SC` | x | 0 | 100 | higher-is-better | adequacy |
| C2 | UCDP Candidate, deaths in the last 12 months per million people | log10(1 + x) | 0 | 3 | higher-is-worse | adequacy |
| C3 | `SH.IMM.IDPT` | x | 50 | 99 | higher-is-better | adequacy |
| C4 | IMF `PCPIPCH`, current year | x | 2 | 30 | higher-is-worse | adequacy |
| C5 | IMF `GGXWDG_NGDP`, current year | x | 30 | 150 | higher-is-worse | adequacy |
| C6 | V-Dem `v2cacamps` | x | from the codebook | | higher-is-worse | adequacy |

For C2, take the population from World Bank `SP.POP.TOTL`. For C6, verify the code and its scale in
the V-Dem codebook, then set the anchors to its documented range. Record each choice as a
judgement call.

**Adapters.** Put them in `server/providers/world/sources/<id>.js`, with one entry per source in
`public/world/sources.json`. Each entry records the licence, the release rhythm and any mark
(NonCommercial or ShareAlike).

- **World Bank** (keyless). Use
  `https://api.worldbank.org/v2/country/all/indicator/<code>?format=json&per_page=20000&mrnev=1`
  for the latest non-empty value per economy. It worked for all 14 World Bank codes in the table
  on 2026-11-08. `SP.POP.TOTL` was not tried.
  - The response includes regional aggregates. Drop them using the World Bank country list (an
    aggregate's region id is `NA`).
  - Store every row as an observation (spec 4.3), with the period and the retrieval date.
  - Two of these series are World Bank re-serves of other publishers' data: `MS.MIL.XPND.CD` is
    SIPRI's and `IT.NET.USER.ZS` is ITU's. Both originals are NonCommercial, so mark them.
- **IMF DataMapper** (keyless). Use
  `https://www.imf.org/external/datamapper/api/v1/<code>?periods=<year>,<year+1>`. It returned
  2026 values for 226 economies (inflation) and 224 (debt) on 2026-11-08.
  - Store the current year as `method: "source-forecast"`.
  - Record the fetch date. If you can find the WEO vintage, record that too.
- **UCDP Candidate Events** (monthly, CC BY 4.0). The research says the API is keyless, but the
  citation check found it has needed a token since February 2026.
  - Use the public bulk download if one exists.
  - If only the API works, the token goes in Provider Settings, never in the repo. Without a
    token, C2 shows unknown.
  - Say which route you used.
- **V-Dem** (CC BY-SA 4.0, so mark it ShareAlike).
  - Download the country-year core file once per release (March), keep only the one variable, and
    store observations.
  - If the download is unreasonable for a Refresh (over about 200 MB), or the variable is not
    there, leave C6 unknown and report why. Don't substitute another source silently.

**Countries.** Spec 4.1 has the map-unit rules found while building the mock:

- Group the UK's pieces by the pack's `country` field.
- Put the aliases in `public/world/countries.json`: `KOS` → `XKX` or `UVK`, `PSX` → `PSE` or
  `WBG`, `SDS` → `SSD`, `ALD` → `FIN`.
- Treat the no-data areas as `disputed`.
- Clicking any piece of a group selects the whole group.

**Scores.** Write them as pure functions in `server/providers/world/scores.js`, with tests first.

- **Area or bar score:** the mean of its indicator scores, with `coverage` and oldest period. It is
  `unknown` below half coverage. Phase 1 has one indicator per slot, so a slot is either known or
  unknown.
- **Condition lens:** colours by the weakest known bar. It is unknown when fewer than half of the
  bars are known.
- **Data age:** the median period year of the country's latest annual observations, excluding
  `source-forecast`.
- **Stale:** an observation older than `staleAfterMonths`. Use 18 for annual series, 8 for IMF
  current-year values and 3 for UCDP.

**Refresh and turns** (spec 5 and 4.12, without live feeds and without Claude):

- Each adapter checks whether its source may have something new, then stores the new
  observations.
- Recompute, then write a turn record with a code-generated change list.
- On first launch, the base data downloads with a progress line.
- Opening the app loads the last saved board immediately from `.gev-cache/world/`, using atomic
  writes.
- Only one Refresh runs at a time.
- One adapter failing does not fail the turn. The turn records it.
- Never run the war monitor's digest or Perplexity Refresh.

## The look (the owner approved this mock on 2026-11-08)

The mock was a single screen. Fit its parts into the app's existing surfaces
(`docs/panel-surfaces.md`), and don't cover the app's own controls: the title, the layer cluster,
the right-rail panels and the bottom dock. Use the app's HUD style:

- JetBrains Mono, uppercase with letter-spacing, for labels;
- Inter for body text;
- dark translucent rounded panels;
- the accent `#00d4ff`.

- **Country fills.** Semi-transparent fills over the imagery (alpha about 0.55), with thin light
  borders (about `rgba(182,248,250,0.4)`). The selected country gets a thick `#00d4ff` outline.
  The hovered country gets a lighter outline.
  - The colour ramp runs from low to high: `#c2410c`, `#f08c3a`, `#d9c58f`, `#4aa8d8`, `#1d6fd1`
    (orange for weak, blue for strong).
  - **Unknown and disputed areas are hatched**, never coloured as low. A Cesium stripe material is
    fine.
  - Switching lenses recolours the existing geometry, for example through per-instance colour
    attributes. It never rebuilds it. Aim for under 100 ms.
- **Lens bar** at the top of the board: CONDITION, STRENGTH and DATA AGE buttons, plus REFRESH.
  - With STRENGTH active, a second row shows the 12 area chips, S1 Economy to S12 Culture.
  - Active buttons get the cyan border and tint.
  - Buttons are real `<button>` elements with `aria-pressed`.
- **Hover card.** It shows the country name and the lens value in words, with the period. For
  example: "Weakest bar: Fiscal 56 / 100", or "Typical data year 2024 (2 years old)".
- **Character sheet** in the right rail:
  - **Header:** an ISO3 badge and the name, then an "HP" bar showing the weakest Condition bar
    with its name and score. Below that, the coverage line, for example "16 of 18 indicators have
    a published value · fetched 2026-11-08".
  - **Tabs:** CONDITION, STRENGTH, EXPOSURE, RELATIONS, ASSETS, STAKES and PEOPLE. In phase 1 only
    Condition and Strength have content. The other tabs show one line naming the phase that fills
    them.
  - **Rows:** each row is a button showing the slot id, the area name, the score, a bar, and one
    detail line. The detail line gives the measure, the formatted value, the period in brackets
    and the source.
  - **Row flags:** UNKNOWN (with a hatched bar), WEAKEST, STALE, and LOW CONF. for S11 and S12.
  - **Why this number:** clicking a row opens it. It shows the measure, source and code, period,
    raw value, the formula with its anchors, the score, and "draft anchors".
  - A territory with no data says so, and every bar shows unknown.
- **Legend**, bottom-left: the lens name, three ramp stops in words, a hatched "Unknown or
  disputed" swatch, and a one-line source note.
- **Turn summary.** Show "TURN n" and the change list, both in the sheet as "since last turn" and as
  a compact chip by the lens bar. The first turn says what loaded, with counts per source.
- **Country codes on the globe:** only for large countries. Follow the no-Cesium-text rule
  (`docs/CODE-BOUNDARIES.md`) and draw them as billboard images, as the news layer does.
- **Zoom.** The board is the zoomed-out view. Below about 3,500 km the fills fade, reusing the
  hotspot view's hysteresis.

## Sub-agents

You orchestrate. Use **only GPT 6.1 Sol and GPT 6.1 Terra**, following the delegation table in
`docs/superpowers/research/2026-11-07-terra-delegation.md`. If either is unavailable, stop and tell
the owner.

**Terra** handles:

- scouting;
- exact registrations and boundary entries;
- docs drafted from your outline;
- running the gates and returning the raw output.

**Sol** handles one bounded work package at a time, with its tests.

**You keep:**

- every design decision;
- the Cesium layer lifecycle;
- integration;
- every verdict on correctness;
- the final gate run;
- a full read of the diff against the spec.

Briefs name the spec sections, the file paths, the public API, the rules to test and the commands
to run. Give a command runner enough turns to finish. Run independent agents in parallel on files
that don't overlap.

A suggested split, to adjust to the table:

| Work package | Owner | Files |
|---|---|---|
| Registry, countries table, scores, turn diff (pure) | Sol | `public/world/*.json`, `server/providers/world/registry.js`, `scores.js`, `turn.js` and tests |
| Adapters and fixtures | Sol | `server/providers/world/sources/*`, recorded fixtures, tests |
| Store, routes, Refresh queue, first-launch progress | Sol | `server/providers/world/store.js`, `index.js`, wiring, tests |
| The `world` layer: fills, lenses, hatch, selection, fade, code billboards | You | `src/layers/world/*` |
| Registration and share token (`npm run layer-token:next`) | Terra, from your exact list | the files in Searches spec 6.2 |
| Lens bar, sheet, why-this-number, legend, turn summary | Sol | `src/ui/worldPanel.js`, a model module, styles, mount hook |
| Fixture browser QA | Sol | `scripts/qa-world.mjs` |
| Docs: `docs/WORLD-BOARD.md`, `DATA_SOURCES.md`, `CHANGELOG.md`, `docs/CURRENT-STATE.md`; the `world-provider` boundary package | Terra, from your outline | those files |

## Rules

- **Git.**
  - Work on your own branch and open one PR against `krybaby7/gods-eye-view`.
  - Never touch upstream `bilawalsidhu/gods-eye-view`.
  - Don't merge.
  - Make small commits with clear messages.
- **Tests first** for every pure function and every spec rule, with `*.test.mjs` beside the code.
  Above all, test that unknown is never treated as zero, the anchors and direction, the coverage
  rule, the weakest-bar rule, map-unit grouping and the turn change list. Match the surrounding
  code's idioms.
- **No live calls in tests.** Adapters are tested with recorded responses. The fixtures should
  cover a few countries:
  - India;
  - China;
  - the UK pieces;
  - Kosovo;
  - one disputed area;
  - one country missing several values.
- **One live Refresh is allowed** outside the tests, against the free keyless sources (World Bank,
  IMF, and UCDP/V-Dem if keyless). Report the counts per source, the duration and the cache size.
  Never press the war monitor's Perplexity Refresh or call any paid service.
- **Don't widen the scope.** Build nothing from later phases. Add no Claude calls, no total score,
  no Cesium text labels and no secrets in the repo.
- **QA on its own port:** `npm run dev -- --port 5183`, then
  `node scripts/qa-world.mjs --fixtures --url http://127.0.0.1:5183`. The script should check:
  - the layer toggles on and off cleanly;
  - each lens recolours, and the legend changes with it;
  - unknown and disputed areas are hatched;
  - clicking India opens its sheet, and its Condition and Strength rows match the fixture values;
  - "why this number" shows the formula;
  - selecting one UK piece selects the whole group;
  - a fixture Refresh writes turn 2 with a change list;
  - the fills fade when zoomed in.

  Save screenshots.
- **Gates, with the actual output reported:**
  - `npm run format:check`
  - `npm run check:boundaries`
  - `npm run layer-token:check -- --base-ref main`
  - `npm test`
  - `npm run build`
  - `node scripts/qa-world.mjs --fixtures`
  - `node scripts/qa-searches.mjs --fixtures`, `node scripts/qa-news.mjs --fixtures` and
    `node scripts/qa-lenses.mjs --skip-performance`, as regressions

  If something fails, say so first, in the PR and in your final message.
- **Where the spec leaves a detail open,** decide, and list it as a judgement call tied to its
  spec section.

## The PR description, in plain words for a non-technical owner

- What changed, by area.
- The sources: which route each adapter took (bulk or API, token or not), counts from the live
  Refresh, and each source's licence and mark.
- Test and QA results, pasted, with screenshot file names.
- Every judgement call, each tied to a spec section. The C2 and C6 choices are among them.
- What was not verified, and why.
- A delegation log: every sub-agent call with its model, task and outcome, and whether its output
  was used as is, reworked or discarded.
- **The owner's live check**, as numbered steps:
  1. `npm run dev`, then turn on World Board. The first launch downloads the base data; note how
     long it takes.
  2. Try each lens. Open India's sheet, then open "why this number" on its weakest bar.
  3. Find a hatched area and hover it.
  4. Press Refresh and read the turn summary.
  5. Zoom in until the fills fade, then zoom back out.

End your final message with the PR URL and a one-line verdict: ready, or ready after the owner
decides something (name it).
