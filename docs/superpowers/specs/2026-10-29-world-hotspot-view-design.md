# Hotspot view: country bubbles when zoomed out

Date: 2026-10-29. Status: design, agreed with the owner, reviewed against `main` the same day,
not built. Builds on `docs/WAR-MONITOR.md`, `2026-10-28-world-theater-design.md` and the news
layer (`src/layers/news/`). Section 8 lists what the review changed and the points the owner
may still want to strike.

## 0. Shape in one paragraph

Zoomed out, the war monitor's story pins scatter over the globe and overlap where news is dense;
the owner's goal is to read the whole world at a glance. When the camera is high, the news layer
draws one bubble per hotspot instead of one pin per story. A hotspot is a country, or a named
region or water such as Gaza, the West Bank, Donbas, Kashmir or the Red Sea, so the map never
decides who owns a disputed place. A bubble's size shows how many stories it holds, a ring shows
the category mix, and the count sits inside. Zooming in turns the bubbles back into story pins.
Clicking a bubble flies there and filters the Stories list to that place. It works for every
theater; it matters most for World.

## 1. Decisions (owner, 2026-10-29)

- Country bubbles (not tinted countries, not a heat glow).
- The switch between bubbles and pins is automatic by camera height. No button.
- Clicking a bubble zooms to it and filters the Stories list to that place until cleared.

## 2. Which bubble a story belongs to (code-owned, server-side)

Every located story gets a `hotspot` field, computed by code from the theater's gazetteer, never
by the model.

**Where.** A pure function in a new module `server/providers/news/hotspots.js`, beside
`geocode.js` (register it under `news-provider` in `scripts/package-boundaries.json`). It is
applied in `service.snapshot()` in `server/providers/news/index.js` when the `stories` array is
built for `GET /api/news`, so the digest file on disk is unchanged and stories digested before this
change get a hotspot too. The client does not receive the gazetteer (the snapshot's `theater` holds
only id, name, categories, perspectives, actors, drivers and tracks), so grouping cannot move to
the browser. On the client, `normalizeStory` in `src/layers/news/records.js` must pass `hotspot`
through: today it copies known fields only and would drop it.

```json
"hotspot": { "key": "region:West Bank", "label": "West Bank", "kind": "region", "lat": 31.95, "lon": 35.25 }
```

`kind` is `region`, `water`, `country` or `place`. `key` is stable across snapshots so the
client's place filter can hold it.

**How a story maps to a gazetteer row.** A story's `location` carries `method` and `name`
(`server/providers/news/digest/stories.js`, `resolveLocation`). With `method: "gazetteer"`,
`name` is the matched row's canonical name: look the row up by name. With `method: "model"`,
`name` is the model's place text and there is no row. A gazetteer-matched story whose name is no
longer a row (the gazetteer was regenerated) is treated like a model-placed one.

Rules, first match wins:

1. **Explicit link.** The row has a `hotspot` field naming a `region` or `water` row (Hebron →
   West Bank, Donetsk → Donbas, El Fasher → Darfur). The story joins that row's bubble:
   key `region:<row name>` or `water:<row name>`, placed at that row.
2. **Region or water row.** The story matched a row of precision `region` or `water`. Same key
   shape, placed at the row.
3. **Country.** The story matched a `city`, `locality`, `site` or `country` row. It joins the
   bubble of that row's `country` label: key `country:<label>`, `label` as written (World's
   "Georgia (country)" row carries the label "Georgia"). The bubble sits at the `country`-precision
   row with that label (every World city has one; the review found none missing). If the theater
   has no such row (Iran · Israel · US: "Palestinian Territories", "United States", "Austria" and
   others), the bubble sits at the average position of its stories. A row with a null `country`
   falls through to rule 5.
4. **Model-placed story.** It takes the nearest gazetteer row of any precision within 100 km
   (great-circle) and applies rules 1 to 3 to that row.
5. **Otherwise** it gets a bubble of its own, kind `place`: key `place:<normalizePlaceName(name)>`
   and label the model's name, so two stories naming the same unknown place share one bubble;
   with no name, key `point:<lat>,<lon>` rounded to one decimal and the label "Unnamed place".
   Placed at the average position of its stories.

Stories without a location, and developments (no pin), stay list-only and belong to no bubble.
A bubble's position is part of the hotspot of every story in it, so the client needs no gazetteer.

## 3. Gazetteer additions (World theater)

Fewer model-placed stories means more accurate bubbles. In the owner's first live World Refresh
(2026-10-29), 10 of 34 located stories were model-placed (Toledo, Wonsan, El Obeid, Taizz,
Hebron, Cebu and others). None of those names is a row today.

- In `scripts/build-world-gazetteer.mjs`, lower `CITY_MIN_POPULATION` from 1,000,000 to 300,000.
  Measured in review with a dry run: the gazetteer grows from 876 rows to about 1,820 (209
  countries, 205 capitals, 1,354 cities, 49 hotspots); validation passes; 37 names get qualified
  and 318 aliases are dropped as ambiguous. Countries and capitals keep `prompt: true` and cities
  keep none, as the script already does, so the digest instructions do not grow. The theater file
  is server-side only (never sent to the browser), so its size costs nothing at runtime.
- **Namesakes.** A lower threshold adds cities that share a name with a better-known place that
  stays below it. The script qualifies a name only when both rows are present ("Tripoli, Lebanon"
  next to Tripoli; "Valencia, Spain" next to "Valencia, Venezuela"). In the dry run, Toledo,
  Ohio comes in as the bare row "Toledo" while Toledo, Spain stays out, so the live run's Toledo
  story would be pinned in the United States: worse than model-placed. Two guards:
  - `resolveLocation` in `server/providers/news/digest/stories.js`: when the model also gave
    coordinates and the gazetteer match lies more than 500 km from them, keep the model's
    coordinates (`method: "model"`, dashed pin, so it reads as model-placed) and count it in the
    run record as `farMatches`. The digest prompt already asks for coordinates for places not
    listed in it, and it lists countries and capitals only, so most city stories carry them.
  - The script's log of qualified names is read in the PR, and well-known foreign namesakes that
    would now win a bare name are added to `DROPPED` or qualified by hand.
- **Towns and links.** Add a hand-written map in the script, `CITY_HOTSPOTS`, from a city name to
  the region row it belongs to (Hebron → West Bank, Donetsk → Donbas, El Fasher → Darfur). It
  applies to whichever row carries the name, whether Natural Earth brought it in at 300,000 or a
  hand-written row added it. The dry run shows which is which: the threshold brings in Donetsk,
  Luhansk, Mariupol, Zaporizhzhia, Ramallah, Nyala, Wonsan and Cebu City, and also Al-Ubayyid
  (El Obeid), Ta'izz and Al Hudaydah (Hodeidah) under Natural Earth's spellings, which need the
  English press spellings as aliases through the script's `CITY_ALIASES`. Hand-written rows
  (`TOWNS`, each with its source noted like `HOTSPOTS`) are only for conflict-relevant towns the
  threshold does not reach, about 40 to 60; from the owner's list those are:
  - West Bank: Hebron, Jenin, Nablus, Tulkarm (Ramallah comes in);
  - Gaza Strip: Khan Younis, Rafah, Deir al-Balah;
  - Donbas: Bakhmut, Pokrovsk (Donetsk, Luhansk and Mariupol come in);
  - Darfur: El Fasher (Nyala comes in); Kordofan: Kadugli (El Obeid comes in);
  - Yemen: Marib (Taizz and Hodeidah come in);
  - plus Sumy and similar (Kharkiv and Zaporizhzhia are rows).

  The script logs a hand-written town that duplicates a Natural Earth row (same name within
  100 km) so the list can be pruned; `uniqueNames` already drops the later duplicate.
- `toEntry` writes `hotspot` on the rows that have one. Rerun the script and check that the
  ambiguity log stays reasonable.
- `iran-israel-us.json` gets `hotspot` links on its existing rows where a region row exists
  (Gaza City, Jabalia, Khan Younis → Gaza Strip; Hebron, Jenin → West Bank; and similar). Don't
  add rows to it.
- **Registry** (`server/providers/news/registry.js`, `validateGazetteer`): accept the optional
  `hotspot` field, check it names an existing row of precision `region` or `water` in the same
  theater, and keep it on the frozen row it returns (today the row is rebuilt from known fields,
  so an unlisted field is silently dropped).

## 4. Rendering

- **When:** bubbles show when the camera is higher than 3,500 km above the ellipsoid, pins below
  3,000 km; between the two the current mode stays, which stops flicker while zooming. Height is
  `viewer.camera.positionCartographic.height`, read in the `preRender` callback that already runs
  `cullBehindHorizon`, which returns early when the camera has not moved; the mode check sits
  before that early return. It is also evaluated on enable and on every snapshot apply. The
  thresholds are two constants, tuned in QA.
- **Frame theater lands in bubble mode.** `flyToWorldTarget` frames a theater at three times its
  radius, capped at a 3,000 km radius, pitched 65°: World ends about 8,000 km up, and
  Iran · Israel · US typically 4,000 to 5,500 km up, so both show bubbles after Frame theater at
  the defaults. QA records what each theater shows; raising the thresholds so a regional theater
  frames as pins is the owner's call.
- **What a bubble looks like:** one billboard entity per hotspot key, an SVG data URL like the
  existing markers (`newsMarkerImage` in `src/layers/news/model.js` draws SVG, not canvas),
  clamped to ground, no depth test, like pins.
  - Diameter grows with the square root of the story count: 22 px for 1 story, 54 px at 25 or
    more.
  - A ring split by category share, in the theater's category colours (`newsCategoryColor`), in
    the order the theater lists its categories.
  - The story count in the centre, drawn into the SVG. This is a billboard, not a Cesium label;
    `docs/CODE-BOUNDARIES.md` forbids Cesium text labels and wants world text in the overlay host.
    The CCTV layer already draws text into billboard images (`src/layers/cctv/frames.js`), and a
    count is the bubble's whole point, so it stays in the image.
  - A small dot when any of its stories is new since the viewer's last visit (`isNewSince`, the
    existing pin rule).
  - The selected story's bubble gets the pin's selected (white) outline.
- **Pins and bubbles never coexist.** The data source holds one or the other. In bubble mode no
  story cards are drawn (hover or selected), and no entity contexts are registered for voice
  (today they are tied to pin entities); analyst records and the HUD summary are unchanged.
- **Filters:** category chips and the actor filter apply. A bubble counts only visible pinned
  stories (`isPinnedStory` and the layer's `visibleStories()`), and a bubble with none disappears.
  The place filter of section 5 does not change bubbles or pins.
- **Horizon:** bubbles on the far side of the globe are hidden by the same `cullBehindHorizon`.
- **Hover card** through the overlay host, entry id `hotspot:<key>`, variant `card`, accent the
  largest category's colour:
  - title: the place name and story count, for example "Sudan · 4 stories";
  - details: up to three story titles, newest first, then the line "Counts stories in the
    latest digest, not severity. Quiet places may be under-reported."
- **Picking:** bubble entities carry `gevNewsHotspotKey`; the click and hover handlers check it
  before `gevNewsStoryId`. The hover card's `activate` and a click both call `focusHotspot`.

## 5. Clicking a bubble

- **Layer API:** `layer.focusHotspot(key)` flies the camera and sets the place filter. It does
  not select a story. `layer.setPlaceFilter(key | null)` sets or clears the filter alone.
- **Camera:** a new framing kind `hotspot` in `src/worldFocus.js`, requested through
  `requestWorldFocus` like Frame theater: `radiusM` 600 km, `rangeM` 1,800 km, pitch −65°,
  `fitToRequest: true`, and a per-kind cap of 1,000 km on the fitted radius (the global cap stays
  3,000 km for theaters). The request carries the radius enclosing the bubble's visible stories
  from the bubble's position. At three times the radius and −65°, the flight ends about 1,600 km
  up for a tight bubble and about 2,700 km up at the cap: below the 3,000 km pin threshold either
  way, so the bubble opens into its pins. Stories further than the cap from the bubble's position
  are off-screen but in the filtered list.
- **Place filter** on the Situation panel's Stories list:
  - The layer snapshot gains `placeFilter: {key, label} | null`, and its `visibleStories` (the
    list the panel and `tabCounts` read) applies it on top of the category and actor filters.
    The layer's own `visibleStories()` (pins, bubbles, HUD stats, analyst records) does not.
  - A chip such as "Sudan ✕" appears above the list (a button, accessible name "Clear place
    filter: Sudan"). The list and the Stories tab count show only that place's stories.
  - With a place filter and an empty list, the note reads "No stories in Sudan under these
    categories."; without one the existing texts stay. The brief's cited-stories hint ("hidden by
    the category or actor filter") also names the place filter.
  - Clicking ✕ clears it, as does switching theater, `disable()`, or clicking another bubble
    (which replaces it). Selecting a story, clicking empty globe and a new digest leave it alone.
  - Pins and bubbles stay unfiltered.
  - Not a share or durable parameter: `getParams` and `setParams` ignore it.
- **Voice and HUD:** the layer's analyst records and HUD summary are unchanged. No voice action.

## 6. Out of scope

- Country polygons or tints, heat maps, animation.
- Time scrubbing, auto-refresh.
- A world Brief.
- Voice actions for the place filter; entity contexts for bubbles.
- Changing what the digest prompt lists.

## 7. Tests and verification

Modules: `server/providers/news/hotspots.js` (grouping, pure) and `src/layers/news/hotspots.js`
(bubble aggregation and marker style, pure; register under `news-layer` in
`scripts/package-boundaries.json`), each with a `.test.mjs` beside it.

- **Grouping**, one test per rule in section 2, against a small hand gazetteer in the test (not
  `world.json`): an explicit link (Hebron → West Bank); a region row (Donbas); a water row;
  city → country placed at the country row (Caracas → Venezuela); city → country with no country
  row, placed at the stories' average; a model-placed story inheriting its nearest row within
  100 km (Toledo with Madrid 70 km away → Spain); a model-placed story with nothing near getting
  a `place:` bubble, and two such stories with one name sharing it; a gazetteer-matched story
  whose row no longer exists; no location → no hotspot; a development → no hotspot.
- **Snapshot:** `GET /api/news` stories carry `hotspot`; `normalizeStory` keeps it.
- **Far match:** "Toledo" with model coordinates in Spain and only Toledo, Ohio in the gazetteer
  → model-placed, counted as a far match; a match within 500 km is kept.
- **Registry:** `hotspot` must name a region or water row; an unknown one, or a city, fails
  validation; the field survives on the validated row.
- **Gazetteer script:** the counts before and after the threshold change; the new towns resolve;
  `CITY_HOTSPOTS` lands on the rows; a hand town duplicating a Natural Earth row is logged.
- **Bubble style:** diameter from story counts (1, 4, 25, 40), ring shares and order, the
  new-since dot, the selected outline, and the effect of category and actor filters on counts
  (an emptied bubble disappears).
- **Mode switch:** with a fake camera (`positionCartographic.height`, as the layer tests fake
  `positionWC`): 4,000 km → bubbles; 3,200 km → unchanged either way; 2,800 km → pins; the
  data source never holds both; no story cards and no entity contexts in bubble mode.
- **Click:** `focusHotspot` requests world focus with kind `hotspot` and the enclosing radius,
  and sets the place filter; the snapshot's `visibleStories` and `tabCounts` follow it; the
  layer's pins do not; theater switch and `disable()` clear it. `worldFocus.test.mjs` covers the
  per-kind radius cap.
- **Panel:** the chip renders, ✕ clears, the empty-list note and the cited hint name the place.
- **QA:** `scripts/qa-news.mjs --fixtures` gains steps. The fixture stories need `hotspot`
  fields: the script already loads both theater files, so it imports the server's grouping
  function and applies it to the fixture stories. Steps:
  - World zoomed out: bubbles, no pins, counts matching the fixture;
  - hovering a bubble shows its card;
  - clicking flies in: pins show, the list is filtered, the chip appears;
  - clearing the filter;
  - zooming back out: bubbles return;
  - Frame theater on World and on Iran · Israel · US: record which mode each ends in;
  - Cyber theme, 720 px and 390 px.

  Take screenshots.
- **Docs:** `docs/WAR-MONITOR.md` gains a short Hotspot view paragraph in the Map part and a
  "Hotspot" row in the Who owns what table (code-computed).
- `npm test`, `npm run build`, `npm run format:check`, `npm run check:boundaries`,
  `npm run layer-token:check -- --base-ref origin/main`.

## 8. Review notes (2026-10-29)

Checked against `main` after the World theater and feed-fix merges. Changes from the agreed draft:

- Grouping is server-side, decided: the browser never gets the gazetteer. The client must pass
  the new field through `normalizeStory`.
- Stories reach a gazetteer row by `location.name` (the canonical row name), which the draft left
  implicit. Keys are defined for every rule, including model-placed stories with no neighbour.
- The registry would silently drop `hotspot`; the spec now says to keep it on the validated row.
- Pins are SVG data URLs, not canvas. The count inside the bubble is text in a billboard image,
  with the CCTV layer as precedent; flagged against the overlay-host rule so the owner can object.
- The draft's "fly to the bubble's stories" could end above the pin threshold for a wide country
  (Russia, the US): a `hotspot` framing kind with a 1,000 km radius cap guarantees the flight
  ends in pin mode.
- Frame theater ends in bubble mode for both theaters at the draft's thresholds; made explicit as
  a QA checkpoint rather than changed.
- The 300,000 threshold was built in review (numbers and the town-by-town result in section 3,
  from a scratch build; nothing in the repository changed). New: the namesake risk, shown by
  Toledo, and the 500 km far-match guard in `resolveLocation`. The owner may strike the guard;
  the risk stays either way.
- New: `CITY_HOTSPOTS` as a name → region map, so links apply to Natural Earth rows as well as
  hand-written towns, and hand-written towns are limited to those the threshold misses.
- Bubble mode draws no story cards and registers no entity contexts; the draft did not say.
- Section 5 now names the layer API and which `visibleStories` the place filter touches: the
  snapshot's (list, tab count) and not the layer's (pins, HUD, analyst records).
