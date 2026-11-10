# World Board

Turn on **Events > World Board** to shade countries and open the board. Choose **Condition**, **Strength** (and a strength area), or **Data age**. Condition is the weakest known condition slot when at least half of condition slots are known. Strength shows the chosen slot. Data age uses the median year of available annual observations, excluding source forecasts. Its ramp runs from eight or more years old to this year. Unknown values remain unknown, including disputed territories.

Country shading appears at a camera height of 3,500 km and is removed below 3,000 km; the gap prevents flicker while zooming. Select a country to open its sheet, browse the 18 slots, and use **Why this number** for the raw value, period, source, formula and draft anchors. Flags identify unknown, weakest, stale, low-confidence and source-forecast readings. There is no overall total.

The first activation starts a background turn. Later updates are owner-initiated with **Refresh**. Data and turn history are local in `.gev-cache/world/state.json`. A share link uses layer token `5` to retain whether World Board is enabled. Data and country selections are local.

Scores use draft anchors: each indicator is transformed where specified, positioned between its two anchors, clipped to the 0–100 range and reversed when higher values are worse. Missing source data remains unknown. After a source failure, the board retains its last available readings. Check source period, retrieval date, coverage and flags before comparison.

On the four log10 slots, a measured zero uses the lower log anchor before score direction is applied. This floor is a draft scoring rule.

## Sources and limitations

The keyless [World Bank API](https://data.worldbank.org/) supplies 14 series plus population. World Bank data is generally CC BY 4.0, but third-party terms apply. SIPRI military expenditure and ITU internet use carry NonCommercial marks. IEA energy redistribution terms remain unconfirmed. [IMF DataMapper](https://www.imf.org/external/datamapper/) is keyless and follows April/October WEO releases. The sheet flags source forecasts. DataMapper does not provide a WEO vintage. IMF attribution and terms apply, including permission for commercial use.

For C2, official keyless [UCDP Candidate Events CSV releases](https://ucdp.uu.se/downloads/) supply the latest 12 complete released months. Best deaths are summed over unique event IDs and divided by the latest World Bank population at or before the period, with the period ending at the last released month. No token is required. UCDP data is CC BY 4.0.

The Candidate files list reported events and carry no separate country coverage roster. A country record in any selected release establishes coverage for the calculation, even if its event falls outside the 12-month score window. A covered country with no reported deaths in the window can receive zero. Countries absent across the selected releases remain unknown.

For C6, the exact `v2cacamps` variable in the V-Dem v16 codebook §3.15.1.1 has interval endpoints −3.81 to 3.94. Refresh streams the CSV inside the official Full+Others archive and retains the latest usable reading per mapped country. The v16 compressed download is 26.9 MB. [V-Dem](https://www.v-dem.net/data/the-v-dem-dataset/) data is CC BY-SA 4.0.


## Diplomacy
Select a country and choose **Diplomacy** to see its documented relations. The order is at war, sanctions, ally, rival, partner, neutral. Rival requires a documented diplomatic rupture or a cited rivalry in the hand table. Partner requires a documented partnership. A diplomatic link supports neutral. Unknown and disputed areas hatch.
The Relations tab groups treaty commitments, bloc memberships, rivals, wars, directed sanctions, partnerships and territorial disputes. Click a row or a globe line to open its evidence card. War lines are dotted red and alliances are dashed. If several lines share endpoints, the globe shows the highest-priority line and the tab retains every record.
The latest UCDP annual release used here covers 2025 and includes state-based dyads that meet the 25 battle-death threshold. All annual dyads appear in the tab as historical evidence. The lens reserves red for reported fighting between the exact two states within the past 90 days from the live UCDP Candidate snapshot. A missing live source leaves the annual records available in the tab. The Houthis keep their non-state identity, and reported secondary participants are listed under the side they support. The Voeten agreement file available in Dataverse v39 covers session 79 (2024). The Relations tab shows agreement for each pair, with no effect on map classes. Quad and AUKUS appear as diplomatic and defence cooperation respectively. Curated evidence carries a draft review badge.
The sanctions adapters count designation records by programme from the UN consolidated XML, the UK Sanctions List ODT and the OFAC primary SDN CSV. A country link requires an official programme description. Only measures aimed at a government or economic sector colour the lens. Targeted regimes appear in the tab as sanctions on persons in the named country. Refresh reports mapped, thematic and unmapped programme counts. The source check date comes from the publication's Last-Modified header or its local download date. If the UN list fails on the first turn, the board displays four cited committee programmes with unavailable designation counts.
## People
The sheet header identifies the head of state and head of government when the Wikidata directory has a current claim. The People tab adds foreign and defence ministers, draft organization entries, public account links, and recent posts where available. The leader portrait beside a country code on the globe opens the actor card. A head of government with an attributed portrait takes precedence, followed by the head of state. Commons portraits show the creator, licence and file link in the sheet and actor card.
Wikidata officeholder claims are checked weekly on Refresh. Ambiguous or unavailable officeholders remain blank. Minister coverage depends on Wikidata offices with a matching jurisdiction and a current officeholder. The draft organization directory uses geographic association for armed groups. Bluesky, YouTube and the Federal Reserve’s official RSS feed provide inline posts or linked headlines on Refresh. **Show X timeline** loads the official widget for the open actor. The widget may require sign-in.

## Adding a phase

- Add `src/layers/world/phase-N.js` with a default descriptor. Its optional arrays are `lenses` (id, label, order, color and legend, plus optional hover), `overlays` (factories), `tabs` (id, render and optional label/order), `cards` (type, label and render), `header`, `rowFlags` and `hoverFlags`. Vite loads it and `src/ui/styles/world-phase-N.css` automatically.
- A lens color receives a country and snapshot and returns RGB bytes or null for hatching. A legend receives the snapshot and returns name, stops and note. A lens may describe a country value in its hover text. Lens orders are 10, 20, 30, 40, 50 and 60 for Condition, Strength, Energy, Data age, Diplomacy and Ownership.
- Overlay factories receive viewer, lifecycle signal, requestRender, labelPoint, fixtures and refresh. Instances implement update(snapshot), destroy and optional frame(camera). Use snapshot.visible for board zoom, and IDs of the form `world-card:<type>:<id>` on pickable primitives.
- Tab and card renderers return a DOM node and receive document, snapshot, sheetModel and openCard(type, id). A card also receives id. Header renderers receive the tab context. Row and hover hooks return arrays of short flag labels.
- Register source adapters from a phase module with registerWorldSources(adapters, after) from refreshRegistry.js, and import that module once in index.js. Each source still needs a sources.json row. Adapters can return observations, data, count, unit, changes, detail and error. Extra data persists by source ID in snapshot.features. Adapter errors keep the previous data unless the adapter supplies a replacement. The optional after map names prerequisite source IDs.
- Give each adapter a numeric `version`, starting at 1. Increment it when the derivation changes. On a version mismatch Refresh passes `rederive: true` and resets the release check date for that adapter. Adapters with their own data-version check must also honor `rederive`. Reuse the downloaded inputs where available.
- Register heavy features with `registerWorldFeatureView(lens, { summary, detail })` from `refreshRegistry.js`. `summary` maps source IDs to functions that project a compact version for `/api/world`. `detail({ country, features, board, registry })` selects rows from the full snapshot. The browser requests `/api/world/detail` with the lens and optional country and caches the result until the board changes. Tab, header and card renderers get `getDetail(country, lens, options)`.
- Add `scripts/qa-world.phase-N.mjs` with a default async check function and optional fixtureAdapters map. The runner uses the same server contract with all live fetches blocked.

[Natural Earth](https://www.naturalearthdata.com/) supplies the geometry. The UK uses full GBR geometry to avoid duplicate shading and is grouped with its four constituent IDs. Åland (`ALD`) uses Finland data. Capital is unset because the pack does not contain it.

## Energy and shipping

The Energy lens shows the largest modelled share of all imports through a chokepoint. Hatching marks unknown model data or disputed territory. Exposure and Leverage show the 2024 BACI model, its assumptions and the seaborne and all-imports denominators. The World Bank net energy import share includes its observation year where available. Stock cover stays unknown.

Chokepoint cards show draft EIA oil and LNG transit estimates with their reporting periods and EIA descriptions of alternate routes where available. Panama uses a fiscal year. The static reference markers remain available without traffic permission. Marine geometry uses the bundled Natural Earth features where they exist. The other static markers are approximate reference locations. PortWatch observes Øresund as a proxy for the Danish Straits and has no separate Dardanelles gauge.

After securing written IMF permission for automated extraction, set `GEV_WORLD_PORTWATCH_BULK_OK=1` for the local server. The adapter fetches gate metadata once, loads 400 transit days, and revisits the most recent 14 stored days plus new dates on Refresh. The card shows the latest available date and transit calls by vessel type. The gauge compares the latest day’s count with the matched prior 7-day mean. The rolling means use matched windows 52 weeks earlier. Seven consecutive complete 7-day ratios below 0.5 produce reduced status. An overlapping open disruption record corroborates disrupted status. Missing data are shown as unknown.

Exposure shows monthly Brent, WTI and European natural gas from FRED in their source units. The structural route model uses representative ports and shortest maritime paths. Chokepoint cards show modelled volumes alongside the same-year EIA benchmarks and signed gaps. The source guide documents the route data’s ShareAlike licence and build inputs. [Data sources](../DATA_SOURCES.md)

## Fixture acceptance

Run the fixture harness against the World Board development server on port 5183.

```sh
node scripts/qa-world.mjs --fixtures --url http://127.0.0.1:5183
```

This fixture-only harness uses offline provider fixtures and temporary persisted state. It saves the browser screenshots and results in `qa-artifacts/world/`.

## Live fact checks

Run `node scripts/world-fact-check.mjs --url http://127.0.0.1:5190 --out <evidence>/fact-checks` against a seeded local server. It reads the board and country details and records expected values, findings and sources in JSON and Markdown. It exits non-zero for a failed check. Each phase supplies a module under `scripts/world-fact-checks/`. The optional `--trace` path defaults to `refresh-requests.json` beside the output directory and supplies browser timing and request evidence for the warm Refresh.
