# World Board

Turn on **Events > World Board** to shade countries and open the board. Choose **Condition**, **Strength** (and a strength area), or **Data age**. Condition is the weakest known condition slot when at least half of condition slots are known. Strength shows the chosen slot. Data age uses the median year of available annual observations, excluding source forecasts. Its ramp runs from eight or more years old to this year. Unknown values remain unknown, including disputed territories.

Country shading appears at a camera height of 3,500 km and is removed below 3,000 km; the gap prevents flicker while zooming. Select a country to open its sheet, browse the 18 slots, and use **Why this number** for the raw value, period, source, formula and draft anchors. Flags identify unknown, weakest, stale, low-confidence and source-forecast readings. There is no overall total.

The first activation starts a background turn. Later updates are owner-initiated with **Refresh**. Data and turn history are local in `.gev-cache/world/state.json`. A share link uses layer token `5` to retain whether World Board is enabled. Data and country selections are local.

Scores use draft anchors: each indicator is transformed where specified, positioned between its two anchors, clipped to the 0–100 range and reversed when higher values are worse. Missing source data remains unknown. After a source failure, the board retains its last available readings. Check source period, retrieval date, coverage and flags before comparison.

## Sources and limitations

The keyless [World Bank API](https://data.worldbank.org/) supplies 14 series plus population. World Bank data is generally CC BY 4.0, but third-party terms apply. SIPRI military expenditure and ITU internet use carry NonCommercial marks. IEA energy redistribution terms remain unconfirmed. [IMF DataMapper](https://www.imf.org/external/datamapper/) is keyless and follows April/October WEO releases. The sheet flags source forecasts. DataMapper does not provide a WEO vintage. IMF attribution and terms apply, including permission for commercial use.

For C2, official keyless [UCDP Candidate Events CSV releases](https://ucdp.uu.se/downloads/) supply the latest 12 complete released months. Best deaths are summed over unique event IDs and divided by the latest World Bank population at or before the period, with the period ending at the last released month. No token is required. UCDP data is CC BY 4.0.

For C6, the exact `v2cacamps` variable in the V-Dem v16 codebook §3.15.1.1 has interval endpoints −3.81 to 3.94. Refresh streams the CSV inside the official Full+Others archive and retains the latest usable reading per mapped country. The v16 compressed download is 26.9 MB. [V-Dem](https://www.v-dem.net/data/the-v-dem-dataset/) data is CC BY-SA 4.0.

## Adding a phase

- Add `src/layers/world/phase-N.js` with a default descriptor. Its optional arrays are `lenses` (id, label, order, color and legend), `overlays` (factories), `tabs` (id, render and optional label/order), `cards` (type, label and render), `header`, `rowFlags` and `hoverFlags`. Vite loads it and `src/ui/styles/world-phase-N.css` automatically.
- A lens color receives a country and snapshot and returns RGB bytes or null for hatching. A legend receives the snapshot and returns name, stops and note. Lens orders are 10, 20, 30, 40, 50 and 60 for Condition, Strength, Energy, Data age, Diplomacy and Ownership.
- Overlay factories receive viewer, lifecycle signal, requestRender, labelPoint, fixtures and refresh. Instances implement update(snapshot), destroy and optional frame(camera). Use snapshot.visible for board zoom, and IDs of the form `world-card:<type>:<id>` on pickable primitives.
- Tab and card renderers return a DOM node and receive document, snapshot, sheetModel and openCard(type, id). A card also receives id. Header renderers receive the tab context. Row and hover hooks return arrays of short flag labels.
- Register source adapters from a phase module with registerWorldSources(adapters, after) from refreshRegistry.js, and import that module once in index.js. Each source still needs a sources.json row. Adapters can return observations, data, count, unit, changes, detail and error. Extra data persists by source ID in snapshot.features. Adapter errors keep the previous data unless the adapter supplies a replacement. The optional after map names prerequisite source IDs.
- Add `scripts/qa-world.phase-N.mjs` with a default async check function and optional fixtureAdapters map. The runner uses the same server contract with all live fetches blocked.

[Natural Earth](https://www.naturalearthdata.com/) supplies the geometry. The UK uses full GBR geometry to avoid duplicate shading and is grouped with its four constituent IDs. Åland (`ALD`) uses Finland data. Capital is unset because the pack does not contain it.

## Assets and ownership

The Assets tab lists facilities by host country, verified foreign holdings and separately documented military presence. Exact markers use source coordinates and cluster by host and type at globe zoom. A `?` marker at the host-country label indicates an unknown site. Dotted lines also indicate an unknown site. The Ownership lens uses grey dashes for documented military presence and colours hosts with verified foreign holdings. Asset cards link coordinate evidence and identify owners, operators and legal jurisdiction separately.

Power-plant markers use the historical WRI v1.3.0 inventory for non-nuclear plants of at least 100 MW. The age of the inventory and unknown current status appear in the cards. Wikidata supplies nuclear and launch facilities and candidate operator claims. An NGA port gets an operator only when a single candidate agrees by normalized name, country and position. Ports and scheduled large airports carry no inferred ownership. No asset source changes a score.

The 101 military sites, 50 fabs and nine FAS possession badges remain draft. Separate coordinate citations cover 58 bases and 20 fabs. A military sending country describes presence. Fab cards show company group affiliation separately from title. The FAS badge displays separately from scores. GEM sources wait for the owner-supplied download and verified per-file licence.

## Fixture acceptance

Run the fixture harness against the World Board development server on port 5183.

```sh
node scripts/qa-world.mjs --fixtures --url http://127.0.0.1:5183
```

This fixture-only harness uses offline provider fixtures and temporary persisted state. It saves the browser screenshots and results in `qa-artifacts/world/`.
