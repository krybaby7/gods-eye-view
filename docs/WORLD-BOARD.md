# World Board

Turn on **Events > World Board** to shade countries and open the board. Choose **Condition**, **Strength** (and a strength area), or **Data age**. Condition is the weakest known condition slot when at least half of condition slots are known. Strength shows the chosen slot. Data age uses the median year of available annual observations, excluding source forecasts. Its ramp runs from eight or more years old to this year. Unknown values remain unknown, including disputed territories.

Country shading appears at a camera height of 3,500 km and is removed below 3,000 km; the gap prevents flicker while zooming. Select a country to open its sheet, browse the 18 slots, and use **Why this number** for the raw value, period, source, formula and draft anchors. Flags identify unknown, weakest, stale, low-confidence and source-forecast readings. There is no overall total.

The first activation starts a background turn. Use **Refresh** to update base datasets and eligible feeds. Live feeds also run their own timed checks while the board is enabled. Data and turn history are local in `.gev-cache/world/state.json`. A share link uses layer token `5` to retain whether World Board is enabled. Data and country selections are local.

Scores use draft anchors: each indicator is transformed where specified, positioned between its two anchors, clipped to the 0–100 range and reversed when higher values are worse. Missing source data remains unknown. After a source failure, the board retains its last available readings. Check source period, retrieval date, coverage and flags before comparison.

On the four log10 slots, a measured zero uses the lower log anchor before score direction is applied. This floor is a draft scoring rule.

## Sources and limitations

The keyless [World Bank API](https://data.worldbank.org/) supplies 14 series plus population. World Bank data is generally CC BY 4.0, but third-party terms apply. SIPRI military expenditure and ITU internet use carry NonCommercial marks. IEA energy redistribution terms remain unconfirmed. [IMF DataMapper](https://www.imf.org/external/datamapper/) is keyless and follows April/October WEO releases. The sheet flags source forecasts. DataMapper does not provide a WEO vintage. IMF attribution and terms apply, including permission for commercial use.

For C2, official keyless [UCDP Candidate Events CSV releases](https://ucdp.uu.se/downloads/) supply the latest 12 complete released months. Best deaths are summed over unique event IDs and divided by the latest World Bank population at or before the period, with the period ending at the last released month. No token is required. UCDP data is CC BY 4.0.

The Candidate files list reported events and carry no separate country coverage roster. A country record in any selected release establishes coverage for the calculation, even if its event falls outside the 12-month score window. A covered country with no reported deaths in the window can receive zero. Countries absent across the selected releases remain unknown.

For C6, the exact `v2cacamps` variable in the V-Dem v16 codebook §3.15.1.1 has interval endpoints −3.81 to 3.94. Refresh streams the CSV inside the official Full+Others archive and retains the latest usable reading per mapped country. The v16 compressed download is 26.9 MB. [V-Dem](https://www.v-dem.net/data/the-v-dem-dataset/) data is CC BY-SA 4.0.

## Live condition flags

A dated flag records what a source reported or what the board detected in that source. The sheet’s **Condition flags** section links to the evidence and shows the draft rule. Scheduled ticks write `world/live.json` and update the live overlay. First launch and manual Refresh create turns. A manual Refresh queued during a tick runs after that tick. The next turn summary includes live flag changes since the previous turn. A failed pull retains the last good flag as stale. Expired evidence reads “No recent data.” A clear requires fresh evidence that the condition ended.

- GDELT requires three distinct coded event identities and articles from three source domains in a rolling 72-hour sample of completed 15-minute files. Subdomains are grouped by their final two labels, or three for common country suffixes such as `co.uk`. Within each country, the identity combines event date, CAMEO root and first-level administrative region. Distinct incidents in the same region with the same date and root share a key. The security slot requires a fight or mass-destruction action and at least one actor coded as military, rebel, insurgent, separatist rebel or other armed forces. Unclassified actors reduce coverage. It displays three source links and labels the draft flag “news-derived, low confidence.” GDACS red alerts describe hazards and potential exposure. [GDELT Event Codebook](https://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf) · [CAMEO actor codebook](https://eventdata.parusanalytics.com/cameo.dir/Cameo.0.10b2.pdf)
- Frankfurter flags a currency that lost at least 20% of its value against USD over a near-30-day window with two dated readings. IMF CPI uses the published national all-items year-on-year rate when available for the latest month, then falls back to the same calendar month one year apart in the index. The draft rule compares the unrounded rate with 20%. In the checked release, the index-derived rates for Malawi in August 2026 and Rwanda in September 2026 were 20.021% and 20.048%, respectively. Both round to 20.0% for display.
- UNHCR checks the latest completed year and steps back until an annual release is available. Only stock rows from that release can flag, and releases older than the last two completed years show no recent data. The saved UCDP Candidate flag uses a draft threshold of 25 recorded deaths per country in the latest rolling 12-month release. A separate 90-day evidence list requires explicitly identified opposing governments and a precise event date. Country fatality totals do not establish bilateral hostilities. The FAO index appears as a world banner.
- Ten draft flags record the external debt distress classification in the published LIC DSA list as of 31 October 2026. The evidence shows the assessment month and source locator.

The optional feeds are disabled by default. Set the following in the server process only after obtaining the appropriate access. These feeds use the manual Refresh control and their source cadence. For the optional UCDP Candidate feed, a published month can clear a flag for a country with no events in that month.

| Source             | Server variables                                                         |
| ------------------ | ------------------------------------------------------------------------ |
| IFES ElectionGuide | `GEV_WORLD_ELECTIONGUIDE_ENDPOINT` and `GEV_WORLD_ELECTIONGUIDE_TOKEN`   |
| HDX HAPI           | `GEV_WORLD_HDX_APP_IDENTIFIER`                                           |
| IODA               | `GEV_WORLD_IODA_LICENCE_APPROVED=1`                                      |
| UCDP Candidate     | `GEV_WORLD_UCDP_CANDIDATE_ENDPOINT` and `GEV_WORLD_UCDP_CANDIDATE_TOKEN` |

## Adding a phase

- Add `src/layers/world/phase-N.js` with a default descriptor. Its optional arrays are `lenses` (id, label, order, color and legend), `overlays` (factories), `tabs` (id, render and optional label/order), `cards` (type, label and render), `header`, `rowFlags` and `hoverFlags`. Vite loads it and `src/ui/styles/world-phase-N.css` automatically.
- A lens color receives a country and snapshot and returns RGB bytes or null for hatching. A legend receives the snapshot and returns name, stops and note. Lens orders are 10, 20, 30, 40, 50 and 60 for Condition, Strength, Energy, Data age, Diplomacy and Ownership.
- Overlay factories receive viewer, lifecycle signal, requestRender, labelPoint, fixtures and refresh. Instances implement update(snapshot), destroy and optional frame(camera). Use snapshot.visible for board zoom, and IDs of the form `world-card:<type>:<id>` on pickable primitives.
- Tab and card renderers return a DOM node and receive document, snapshot, sheetModel and openCard(type, id). A card also receives id. Header renderers receive the tab context. Row and hover hooks return arrays of short flag labels.
- Register source adapters from a phase module with registerWorldSources(adapters, after) from refreshRegistry.js, and import that module once in index.js. Each source still needs a sources.json row. Adapters can return observations, data, count, unit, changes, detail and error. Extra data persists by source ID in snapshot.features. Adapter errors keep the previous data unless the adapter supplies a replacement. The optional after map names prerequisite source IDs.
- Give each adapter a numeric `version`, starting at 1. Increment it when the derivation changes. On a version mismatch Refresh passes `rederive: true` and resets the release check date for that adapter. Adapters with their own data-version check must also honor `rederive`. Reuse the downloaded inputs where available.
- Register heavy features with `registerWorldFeatureView(lens, { summary, detail })` from `refreshRegistry.js`. `summary` maps source IDs to functions that project a compact version for `/api/world`. `detail({ country, features, board, registry })` selects rows from the full snapshot. The browser requests `/api/world/detail` with the lens and optional country and caches the result until the board changes. Tab, header and card renderers get `getDetail(country, lens, options)`.
- Add `scripts/qa-world.phase-N.mjs` with a default async check function and optional fixtureAdapters map. The runner uses the same server contract with all live fetches blocked.

[Natural Earth](https://www.naturalearthdata.com/) supplies the geometry. The UK uses full GBR geometry to avoid duplicate shading and is grouped with its four constituent IDs. Åland (`ALD`) uses Finland data. Capital is unset because the pack does not contain it.

## Fixture acceptance

Run the fixture harness against the World Board development server on port 5183.

```sh
node scripts/qa-world.mjs --fixtures --url http://127.0.0.1:5183
```

This fixture-only harness uses offline provider fixtures and temporary persisted state. It saves the browser screenshots and results in `qa-artifacts/world/`.

## Live fact checks

Run `node scripts/world-fact-check.mjs --url http://127.0.0.1:5190 --out <evidence>/fact-checks` against a seeded local server. It reads the board and country details and records expected values, findings and sources in JSON and Markdown. It exits non-zero for a failed check. Each phase supplies a module under `scripts/world-fact-checks/`. The optional `--trace` path defaults to `refresh-requests.json` beside the output directory and supplies browser timing and request evidence for the warm Refresh.
