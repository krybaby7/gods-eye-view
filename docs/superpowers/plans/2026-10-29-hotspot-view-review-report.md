# Hotspot view: blind review of run-1 and run-2

Date: 2026-10-29. Spec: `docs/superpowers/specs/2026-10-29-world-hotspot-view-design.md` (identical in both folders, `diff` clean). Base `main` = 4f2f0589 in both (`git merge-base HEAD main`). Both worktrees were clean apart from deleted planning/agent files that were already there and are excluded from the review. The feature diff is committed on each branch: run-1 has 29 files, +4401/−176; run-2 has 28 files, +3872/−170. No worktree was modified. QA screenshots went to the gitignored `qa-artifacts/news/`; my own probe scripts and screenshots went to the scratchpad.

## 1. Gates

| Gate | run-1 | run-2 |
| --- | --- | --- |
| `npm test` | `ℹ tests 6723` `ℹ pass 6712` `ℹ fail 1` `ℹ skipped 10` | `ℹ tests 6708` `ℹ pass 6697` `ℹ fail 1` `ℹ skipped 10` |
| the one `✖` | `✖ Codex login resolves an installed executable before PATH and starts browser auth detached` (`src/codexOauthRealtime.test.mjs:146`, `'codex'` vs `'\home\fixture\.local\bin\codex'`) | the same test, same assertion |
| failing file in the run's diff? | no (a Windows path issue, not related to the feature) | no |
| `npm run build` | exit 0, `✓ built in 8.52s` | exit 0, `✓ built in 8.62s` |
| `npm run format:check` | exit 0, `Checked 1391 source files.` | exit 0, `Checked 1391 source files.` |
| `npm run check:boundaries` | exit 0 | exit 0 |
| `npm run layer-token:check -- --base-ref main` | `Layer tokens valid against main: 30 published, 0 new.` | `Layer tokens valid against main: 30 published, 0 new.` |
| fixture QA (`qa-news.mjs --fixtures`, port 5191 / 5192) | `news QA passed (28 steps)`: all steps ok on the first run (2 min 44 s) | `news QA passed (27 steps)`: all steps ok on the first run (2 min 12 s) |
| new QA steps | 18 World zoomed out, 19 hover, 20 click, 21 clear, 22 zoom out again, 24 bubbles and chip in Cyber/720/390; Frame theater mode recorded in 13 and 23 | 19 World zoomed out, 20 hover, 21 click, 22 clear, 23 zoom out again; Frame theater mode recorded in 13 and 18; chip check added to 24 (Cyber/720/390) |
| QA log lines | `frame theater iran-israel-us: mode bubbles, height 3870 km`; `frame theater world: mode bubbles, height 8648 km`; `hotspot flight ended 1668 km up in pins mode` | `Frame theater iran-israel-us: 3870 km, bubbles`; `Frame theater world: 8648 km, bubbles`; `a bubble click ends 1668 km up` |
| bubble screenshots | 29–39 (`29-world-bubbles` … `39-world-chip-390`) | 29–33, plus 25–27 now taken in bubble mode with the chip on |
| unrelated edits (`src/maps/`, `src/voice/`, `server/providers/openai/`, `src/mapStackChips*`, `src/keySetupCore.mjs`) | none | none |
| **Gate verdict** | **pass** | **pass** |

The QA was not rerun for either run because nothing failed.

## 2. Spec compliance (24 points)

| # | Point | run-1 | run-2 |
| --- | --- | --- | --- |
| 1 | `hotspots.js` exists, pure, registered | 1. `server/providers/news/hotspots.js` returns new objects and doesn't mutate its input (tested at `newsHotspots.test.mjs:265`); registered in `package-boundaries.json:314` | 1. Same file; its only state is a per-gazetteer WeakMap cache; purity is tested at `newsHotspots.test.mjs:194`; registered at `package-boundaries.json:314` |
| 2 | Applied in `snapshot()`, disk format unchanged | 1. `index.js:584`. The digest store isn't touched. | 1. `index.js:587`, same |
| 3 | `normalizeStory` passes `hotspot`, with test | 1. `records.js:156` (with a validating `normalizeHotspot`); test at `source.test.mjs:373` covers ten malformed cases | 1. `records.js:146`; test at `source.test.mjs:70` covers four malformed cases |
| 4 | Rule 1 (link), with test | 1. `hotspots.js:55-57`; Hebron → West Bank test at `newsHotspots.test.mjs:70` | 1. `hotspots.js:55-68`; test at `newsHotspots.test.mjs:63` |
| 5 | Rule 2 (region or water), with test | 1. `hotspots.js:58`; region and water tests at `:80` and `:90` | 1. `hotspots.js:59`; test at `:75` covers both |
| 6 | Rule 3 at the country row, plus the no-row average, with test | 1. `hotspots.js:59-72`; Caracas → Venezuela and the Georgia label (`:100`, `:119`); Haifa average (`:126`) | 1. `hotspots.js:69-75`; Caracas and Tbilisi → Georgia (`:97`); Vienna/Graz average (`:118`) |
| 7 | Rule 4 (within 100 km), with test | 1. `hotspots.js:37-44, 94`; Toledo/Madrid → Spain test at `:159` | 1. `hotspots.js:44-51, 100`; Toledo/Madrid test plus a story near Hebron (`:129`) |
| 8 | Rule 5 (`place:` / `point:`), with test incl. a shared key | 1. `hotspots.js:77-86`; Wonsan/WŌNSAN share a key, and the point key is tested (`:177`, `:201`) | 1. `hotspots.js:79-95`; Wonsan shared key and point key (`:140`) |
| 9 | Stale name → model-placed; no location and developments → none | 1. `hotspots.js:93-94, 136`; tests at `:210`, `:230`, and the route test at `newsDigestRoute.test.mjs:328` | 1. `hotspots.js:97-100, 144-150`; tests at `:169`, `:186` |
| 10 | Registry accepts, validates, keeps; a city or unknown target fails | 1. `registry.js:233, 240-261` (also rejects chains and self-links); tests at `newsRegistry.test.mjs:267`, `:298` | 1. `registry.js:223-249`; test at `newsRegistry.test.mjs:267` (unknown, city, `''`, `7`) |
| 11 | Far-match guard, `farMatches` in the run record, tests | 1. `stories.js:140`, counted at `stories.js:322` → `index.js:385`. Tests: guard at `newsStories.test.mjs:315`, count of 1 at `:542`, 0 on the route | 1. `stories.js:136`, `index.js:387`. Guard test at `newsStories.test.mjs:309`. The count is only asserted as `0` (`newsDigestRoute.test.mjs:280`), so a non-zero count is untested (weak) |
| 12 | 300,000; `CITY_HOTSPOTS`, `TOWNS`, `CITY_ALIASES`; duplicate town logged; `toEntry` writes `hotspot` | 1. `build-world-gazetteer.mjs:61`, `:1326` (inverted from a region→cities list), `:791` (59 towns), `:183`, `:1765` (`findDuplicateTowns`), `:1728`; tests at `newsWorldTheater.test.mjs` | 1. `:62`, `:1213`, `:786` (58 towns), `:186`, `:1536`, `:1602`; a mini Natural Earth build test (`newsWorldGazetteerBuild.test.mjs`) covers before/after counts, links and the duplicate log |
| 13 | `world.json` regenerated | 1. 1,874 rows, 60 linked. Rebuilding from Natural Earth 5.1.2 in memory gives byte-identical output. | 1. 1,873 rows, 73 linked. Rebuild is byte-identical. |
| 14 | Iran · Israel · US links, no new rows | 1. 259 → 259 rows, only `hotspot` added (66 links) | 1. 259 → 259, only `hotspot` added (57 links) |
| 15 | 3,500 / 3,000 km hysteresis in preRender before the cull; on enable and on apply | 1. `index.js:278-296` (`updateMode` before `cullBehindHorizon`), `:506`, `:591`; tests at `hotspots.test.mjs:39` and `ownership.test.mjs` | 1. `index.js:286-311`, `:519`, `:605`; tests at `hotspots.test.mjs:55` and `ownership.test.mjs` |
| 16 | Bubble SVG: √ size 22–54, ring in theater order, count, dot, outline; tests | 1. `model.js:73-105`. Size, share order and the fresh/selected flags are tested on the data; only the count and the white outline are asserted on the SVG (`ownership.test.mjs`). The drawn ring and dot are untested (weak) | 1. `hotspots.js:147-183`. The SVG itself is asserted: segment order and shares, the `<text>` count, the `data-fresh` dot and the outline (`hotspots.test.mjs:105-192`) |
| 17 | Pins and bubbles never together; no cards or contexts in bubble mode | 1. `index.js:213, 345` (contexts come only from pin entities); ownership test | 1. `index.js:218, 355, 385`; ownership tests |
| 18 | Only visible pinned stories; emptied bubble gone; horizon cull | 1. `index.js:191` (`visibleStories()` via `buildHotspots` with `isPinnedStory`), cull over `_bubbles`; tests | 1. `index.js:203` (`visibleStories().filter(isPinnedStory)`), cull over `_bubbles`; tests |
| 19 | Hover card | 1. `model.js:160-187`: title, three newest titles, caveat, `hotspot:<key>`, largest-category accent | 1. `hotspots.js:196-222`, same; tested with 4 stories, so the 3-title cap is covered |
| 20 | `focusHotspot` kind and radius; `worldFocus` 1,000 km cap; tests | 1. `index.js:744`; `worldFocus.js:24, 110`; tests in `worldFocus.test.mjs` and ownership | 1. `index.js:759`; `worldFocus.js:24, 108`; tests in `worldFocus.test.mjs`, ownership and situationBrief |
| 21 | Place filter in the snapshot and its list only; cleared/replaced per spec | 1. `index.js:765, 964-974`; ✕, theater, `disable()` and replace all clear or replace it; tests in ownership | 1. `index.js:782, 982-991`; same, with tests in ownership and in a panel DOM test |
| 22 | Chip with its accessible name, empty note, cited hint | 1. `situationPanelModel.js:173-194`, `situationPanel.js:614-632`; model tests only | 1. `situationPanel.js:612-720` (the hint also names the place); DOM tests that click ✕ (`situationBrief.test.mjs:791`) |
| 23 | `WAR-MONITOR.md` paragraph and table row | 1. A pointer in the Map item, a `## Hotspot view` section, and a "Hotspot" row in the ownership table | 1. A `### Hotspot view` section under "Using it" and a "Hotspot" row |
| 24 | QA steps from spec §7 | 1. All steps, with real mouse hover and click, and dedicated bubble and chip shots in Cyber, 720 and 390 | 1. All steps with real mouse hover and click; Cyber, 720 and 390 are the existing World shots, now taken in bubble mode with the chip |
| | **Spec total** | **24** | **24** |

## 3. Defects

I also ran my own fixture checks against both apps, with the same script for each. It covered:

- an animated `flyTo` from 12,000 km to 1,500 km, sampled every frame;
- mouse-wheel zoom out and back in;
- hysteresis at 3,200 km from either side;
- selecting a story in bubble mode;
- the horizon cull seen from the Pacific;
- hover and click on the World Darfur bubble;
- switching theater with the place filter on, and switching back;
- a bubble replacing the filter, and the empty-list note;
- `disable()` and re-enable.

Both passed 24 of 24: no mixed frames and no wrong-mode frames during the flight, and the filter is cleared by a theater switch in both. Gazetteer outputs were checked against Natural Earth 5.1.2.

### run-1 (3 defects)

1. **The shared selection is lost after a bubble round trip.** In `src/layers/news/index.js:278-290`, `updateMode` re-registers contexts after returning to pins but never re-selects the story. Entering bubble mode drops the record, and `contextStore.removeEntityContextsForLayer` clears `selectedEntityId`.
   - Scenario: select a story, zoom above 3,500 km, zoom back below 3,000 km. The layer still has `selectedStoryId = 'a'` and draws its selected card, but the shared context selection is `null`, so voice and context no longer know the selection.
   - I confirmed this with a scratch test using the run's own harness: `null !== 'news:a'`. run-2 passes the same test.
2. **Natural Earth name errata left in `world.json`.** Two rows that come in at 300,000 carry another place's English name:
   - "Thi Qar" sits at Al Amarah (NE_ID 1159142649, Maysan, about 120 km from Thi Qar's Nasiriyah);
   - "Lunan" sits at Hangu, Tianjin (1159130209).
   - Scenario: a story placed at "Thi Qar" with no coordinates is pinned in the wrong governorate. Within 500 km, model coordinates don't help, because the guard keeps the row.
3. **`CITY_HOTSPOTS` misses cities inside existing region rows**, including towns this run added itself in `TOWNS`:
   - Tyre and Nabatieh are not linked to Southern Lebanon;
   - Raqqa and Qamishli are not linked to Northeast Syria;
   - Sukhumi is not linked to Abkhazia, and Maiduguri is not linked to Lake Chad Basin;
   - Nabatieh is also unlinked in `iran-israel-us.json`, while the rest of Southern Lebanon there is linked.
   - Scenario: in World, a Tyre strike story makes a `country:Lebanon` bubble next to the `region:Southern Lebanon` bubble, splitting one place's news in two.

### run-2 (2 defects)

1. **Natural Earth name errata left in `world.json`.** This is the same class of defect as run-1's, but larger. It has the two rows above plus "Juarez" at Mazatlán (1159150755, about 1,000 km from Ciudad Juárez), "Taza" at Oujda, "Guanajuato" at Celaya, "Pochinki" at Cuttack (India), "sharkia" at Mansoura, and a "Mazatán" row. As a result Mazatlán and Mansoura no longer resolve at all.
   - Scenario: a "Taza" story is pinned at Oujda, 200 km away, and the guard keeps it. A "Mazatlán" story falls back to model-placed.
   - run-1 fixed exactly these rows with `PLACE_ERRATA`/`PLACE_RENAMES` and tests them.
2. **`CITY_HOTSPOTS` misses Donbas cities.** Horlivka and Makiivka are Natural Earth rows in Donetsk Oblast but carry no `hotspot`.
   - Scenario: a Horlivka shelling story joins `country:Ukraine` instead of `region:Donbas`.

Noted, not counted (the same in both or a matter of choice):

- Both store a new `location.farMatch` field on disk; the guard needs one.
- run-2 averages a country-less bubble over all stories, while run-1 uses open stories only.
- run-1's `point:` key can be `-0.0`.
- Namesake judgement calls differ: run-1 leaves "Pasadena" bound to Texas; run-2 leaves Syracuse, Hamilton and Arlington bare.

## 4. Screenshots

In both runs the bubbles are small, crisp dark discs. The white count is legible at 22 px, and Darfur's two-category ring shows clearly. Nothing overlaps on the World view, but bubbles near the right edge sit under the Situation panel, and the Iran · Israel · US bubbles for Northern Israel and Gaza Strip sit close together at 4,500 km. The hover card ("Darfur · 2 stories", titles, caveat) sits cleanly above its bubble. Neither run's rendering is visibly better than the other's. The globe is white because the headless renderer has no imagery.

## 5. Totals

| | run-1 | run-2 |
| --- | --- | --- |
| Gates | pass | pass |
| Spec points | 24 | 24 |
| Defects | −3 | −2 |
| **Total** | **21** | **22** |

## 6. Blind preference: run-2, narrowly

- **Where it wins:** run-2 handles the one behavioural edge the spec left open: it restores the shared selection after a bubble round trip, and it tests that. Its tests check the bubble SVG and the panel DOM directly, where run-1 checks the data behind them.
- **Where run-1 is stronger:** its gazetteer work is more careful. It fixed the Natural Earth name errata the threshold brought in, enforces link rules in the registry, and has the richer QA with dedicated bubble shots at every width.
- **Why run-2 still wins:** on balance it has one confirmed defect fewer. Its remaining gazetteer gaps are data fixes in one script, while run-1's selection bug is a runtime inconsistency in the layer.
