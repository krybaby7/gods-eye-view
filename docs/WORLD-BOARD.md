# World Board

Turn on **Events > World Board** to shade countries and open the board. Choose **Condition**, **Strength** (and a strength area), or **Data age**. Condition is the weakest known condition slot when at least half of condition slots are known. Strength shows the chosen slot. Data age uses the median year of available annual observations, excluding source forecasts. Its ramp runs from eight or more years old to this year. Unknown values remain unknown, including disputed territories.

Country shading appears at a camera height of 3,500 km and is removed below 3,000 km; the gap prevents flicker while zooming. Select a country to open its sheet, browse the 18 slots, and use **Why this number** for the raw value, period, source, formula and draft anchors. Flags identify unknown, weakest, stale, low-confidence and source-forecast readings. There is no overall total.

The first activation starts a background turn. Later updates are owner-initiated with **Refresh**. Data and turn history are local in `.gev-cache/world/state.json`. A share link uses layer token `5` to retain whether World Board is enabled. Data and country selections are local.

Scores use draft anchors: each indicator is transformed where specified, positioned between its two anchors, clipped to the 0–100 range and reversed when higher values are worse. Missing source data remains unknown. After a source failure, the board retains its last available readings. Check source period, retrieval date, coverage and flags before comparison.

## Sources and limitations

The keyless [World Bank API](https://data.worldbank.org/) supplies 14 series plus population. World Bank data is generally CC BY 4.0, but third-party terms apply. SIPRI military expenditure and ITU internet use carry NonCommercial marks. IEA energy redistribution terms remain unconfirmed. [IMF DataMapper](https://www.imf.org/external/datamapper/) is keyless and follows April/October WEO releases. The sheet flags source forecasts. DataMapper does not provide a WEO vintage. IMF attribution and terms apply, including permission for commercial use.

For C2, official keyless [UCDP Candidate Events CSV releases](https://ucdp.uu.se/downloads/) supply the latest 12 complete released months. Best deaths are summed over unique event IDs and divided by the latest World Bank population at or before the period, with the period ending at the last released month. No token is required. UCDP data is CC BY 4.0.

For C6, the exact `v2cacamps` variable in the V-Dem v16 codebook §3.15.1.1 has interval endpoints −3.81 to 3.94. The official Core v16 file does not include that variable, so C6 displays as unknown. [V-Dem](https://www.v-dem.net/data/the-v-dem-dataset/) data is CC BY-SA 4.0.

[Natural Earth](https://www.naturalearthdata.com/) supplies the geometry. The UK uses full GBR geometry to avoid duplicate shading and is grouped with its four constituent IDs. Åland (`ALD`) uses Finland data. Capital is unset because the pack does not contain it.

## Fixture acceptance

Run the fixture harness against the World Board development server on port 5183.

```sh
node scripts/qa-world.mjs --fixtures --url http://127.0.0.1:5183
```

This fixture-only harness uses offline provider fixtures and temporary persisted state. It saves the browser screenshots and results in `qa-artifacts/world/`.
