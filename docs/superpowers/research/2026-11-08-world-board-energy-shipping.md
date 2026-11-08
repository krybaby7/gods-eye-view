# World Board, track B: energy and shipping data sources

Research date: 2026-11-08. Method: primary pages read through WebFetch, plus plain GET requests to public PortWatch, World Bank, FRED and GIE endpoints. No accounts, no keys. Markers: **(verified)** means I fetched the primary page or endpoint myself. **(snippet)** means it came only from a search result summary. **(background)** means it is from my prior knowledge and was not re-checked today. No licence below is guessed; where I could not find the text it says "not confirmed".

## Summary

The chokepoint half of version 1 is well covered by one source. IMF PortWatch publishes daily transit calls for 28 chokepoints through a keyless ArcGIS endpoint. On 2026-11-08 its newest day was 2026-11-01, so the lag is 7 days, and the service was last edited on 2026-11-07. The data carries a live signal: Hormuz fell from about 64 transit calls a day in January and February 2026 to single digits from March 2026, and PortWatch lists an open RED event "HORMUZ-26" starting 2026-03-01. Brent is about $107 to $120 in the latest FRED readings. The board's "current disruption" layer can be built from this data alone.

The bilateral half is harder. The best open source for who sells energy to whom is BACI (CEPII), a reconciled version of UN Comtrade at HS6, with data through 2024, free download, Etalab 2.0 licence. UN Comtrade itself is the live API but has call limits. JODI and EIA do not give partner detail for most countries (JODI: not found on its pages; EIA: partner detail only for US imports). No open dataset I found assigns bilateral energy trade to chokepoints. The only published numbers are EIA's chokepoint totals (million barrels a day, US government, public domain). So a "country X depends on chokepoint Y for Z% of its oil imports" figure has to be computed by us: bilateral tonnes (BACI) routed by a sea-route library, calibrated against EIA totals and PortWatch traffic. That is achievable and defensible if it is labelled as a modelled estimate with its assumptions shown. It is not defensible as a "published fact".

PortWatch terms: data is under the IMF's special terms for statistical data (the ArcGIS item's licence field points to imf.org/external/terms.htm). Reuse with attribution is allowed, modified data must be labelled, commercial reuse needs written permission, and bulk automated download needs permission. A small daily pull of 28 rows for a personal app is within the spirit; a public hosted version should get a short email to copyright@imf.org first.

---

## 1. Chokepoint traffic: IMF PortWatch

### 1.1 Endpoints (all verified by direct GET)

Base: `https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/<name>/FeatureServer/0`

| Service name | Type | Rows | Use |
|---|---|---|---|
| `Daily_Chokepoints_Data` | Table | 80,136 | Daily transit calls and capacity per chokepoint |
| `PortWatch_chokepoints_database` | Feature layer | 28 | Chokepoint names, lat/lon, host country, 12-month vessel counts |
| `portwatch_disruptions_database` | Feature layer | 132 | Disruption events (storms, quakes, fires, "OT" other) with affected port or chokepoint IDs |
| `Daily_Ports_Data` | Table | 5,905,900 | Daily port calls and import/export estimates per port, with ISO3 |
| `PortWatch_ports_database` | Feature layer | 2,065 | Port list and metadata |
| `Monthly_TradeNow` | Table | 18,228 | Monthly country AIS trade estimates and trade value/volume |
| `Spillover_Simulator_Maritime_Connections` | Table | 155,521 | Port-to-port distance and transit days |
| `spillovers_trade`, `spillovers_supplychain`, `spillovers_port_level_impact`, `spillovers_country` | Tables | 1.6M, 3.4M, 227k, 1,120 | Spillover simulator outputs (see 1.5) |
| `Global_Shipping_Routes` | Feature service | not queried | Route lines used by the PortWatch map (layer 0 URL returned an error; layer index not found) |

Paging: `maxRecordCount` is 1000 per request. Use `resultOffset` and `resultRecordCount`, or filter by date. The service supports `outStatistics`, `orderByFields`, `returnCountOnly`. Output `f=json` works with a plain GET and no token. Cache hint: `cacheMaxAge` 1800 seconds.

Latest-day query used: `.../Daily_Chokepoints_Data/FeatureServer/0/query?where=date%3DDATE%20'2026-11-01'&outFields=*&f=json`
Max-date query: `outStatistics=[{"statisticType":"max","onStatisticField":"date","outStatisticFieldName":"maxd"}]` returned `2026-11-01`.

### 1.2 Fields in `Daily_Chokepoints_Data` (verified)

`date` (date only), `year`, `month`, `day`, `portid` (string, `chokepoint1` to `chokepoint28`), `portname`; transit counts `n_container`, `n_dry_bulk`, `n_general_cargo`, `n_roro`, `n_tanker`, `n_cargo`, `n_total`; and `capacity_container`, `capacity_dry_bulk`, `capacity_general_cargo`, `capacity_roro`, `capacity_tanker`, `capacity_cargo`, `capacity` (integers).

Important caution: the layer description says it holds "estimates of transit trade volumes (in metric tons)", and the methodology text says volume = estimated payload share times deadweight tonnage. But the field names are `capacity_*`, and there is no field called trade volume. I could not confirm whether `capacity` is deadweight tonnage or estimated payload. Example: Suez on 2026-11-01 had 46 calls and capacity 2,080,955, about 45,000 per ship, which is plausible for either reading. Treat it as an index of carrying size until PortWatch clarifies. Do not label it "tonnes of oil".

Transit call definition (verified, layer metadata): a call is counted when a ship crosses the chokepoint boundary; a multi-day transit counts once; a 48-hour threshold applies before the same ship is counted again. Source method: Arslanalp, Koepke and Verschuur, IMF Working Paper 2021/225 (AIS data via UN Global Platform).

### 1.3 The 28 chokepoints (verified)

| ID | Name | ID | Name |
|---|---|---|---|
| chokepoint1 | Suez Canal | chokepoint15 | Lombok Strait |
| chokepoint2 | Panama Canal | chokepoint16 | Ombai Strait |
| chokepoint3 | Bosporus Strait | chokepoint17 | Bohai Strait |
| chokepoint4 | Bab el-Mandeb Strait | chokepoint18 | Torres Strait |
| chokepoint5 | Malacca Strait | chokepoint19 | Sunda Strait |
| chokepoint6 | Strait of Hormuz | chokepoint20 | Makassar Strait |
| chokepoint7 | Cape of Good Hope | chokepoint21 | Magellan Strait |
| chokepoint8 | Gibraltar Strait | chokepoint22 | Yucatan Channel |
| chokepoint9 | Dover Strait | chokepoint23 | Windward Passage |
| chokepoint10 | Oresund Strait | chokepoint24 | Mona Passage |
| chokepoint11 | Taiwan Strait | chokepoint25 | Balabac Strait |
| chokepoint12 | Korea Strait | chokepoint26 | Bering Strait |
| chokepoint13 | Tsugaru Strait | chokepoint27 | Mindoro Strait |
| chokepoint14 | Luzon Strait | chokepoint28 | Kerch Strait |

Gaps against the board's list: PortWatch has Oresund but not the Great Belt or Little Belt (the other Danish straits), and no Dardanelles separately from the Bosporus (EIA's "Turkish Straits" combines both). Cape of Good Hope is a counted gate in the data, not a narrow strait. English Channel is covered as Dover Strait. Malacca, Singapore and Lombok/Sunda are separate IDs.

The ID format is lowercase `chokepointN` in the live data. One World Bank notebook uses uppercase `CHOKEPOINTN`; use the live format.

### 1.4 Lag, schedule, revisions

- Newest day on 2026-11-08: 2026-11-01. Lag: 7 days. All 28 chokepoints present for every day from 2026-10-25 to 2026-11-01 (verified).
- `editingInfo.dataLastEditDate` is 2026-11-07 15:00 UTC, so the service is refreshed in at least weekly batches (verified). The exact weekday and time is not stated on pages I could read; the PortWatch FAQ page returned only its title. Third-party text says weekly with a multi-day lag (snippet). Plan on one pull per day and take whatever is newest.
- Figures are revised after publication (snippet, forecasting-question note). Re-fetch the last 14 days each pull instead of appending only.
- Single-day counts are noisy (Hormuz ranges 1 to 8 in the last 12 days), so show 7-day and 28-day averages next to the daily value.

Observed Hormuz series (verified): about 56 to 94 calls per day (tankers 29 to 55) in January to mid-February 2026; collapsing to 4, then 1 to 7 per day from early March 2026; a brief rise to 25 on about 2026-06-20; 3 to 8 per day through October 2026; 1 on 2026-11-01. PortWatch's disruption table has event 10000004 "HORMUZ-26", type OT, alert RED, from 2026-03-01 with no end date, affecting `chokepoint6` (verified).

### 1.5 Chokepoint metadata, disruptions, spillover and exposure datasets

- `PortWatch_chokepoints_database`: `portid`, `portname`, `country`, `ISO3`, `lat`, `lon`, `vessel_count_total` and by type (12-month totals, e.g. Hormuz 32,496 total, 19,540 tankers), `industry_top1/2/3`, `share_country_maritime_import`, `share_country_maritime_export` (verified). The two share fields are empty for the chokepoints I printed, so there is no ready-made "country share" here. Also `industry_top1` is "Mineral Products" for all of the first 24, which includes fuels but is too coarse to use.
- `portwatch_disruptions_database`: fields `eventid, eventtype, eventname, alertlevel, country, fromdate, todate, severitytext, lat, long, affectedports, n_affectedports`. Dates are epoch milliseconds. Most rows are weather and disaster feeds (GDACS-style). The Hormuz event is a manual "OT" row. Use it as the "current disruption" feed, but expect few manual rows.
- `spillovers_trade` (port to country, by HS section, `daily_export_value_at_risk` and `daily_import_value_at_risk`, US dollars), `spillovers_supplychain` (consumption and industry output at risk), `spillovers_port_level_impact`, `spillovers_country` (value as percent of GDP and percent of maritime trade, by event ID). These model what happens if a **port** is knocked out. I found no table keyed by chokepoint that gives country dependence (not confirmed to be absent from the IMF site; absent from the ArcGIS service list I enumerated). The `Spillover_Simulator_Maritime_Connections` table (port-to-port distance and transit days) is useful for route timing, not for chokepoint assignment.
- `Daily_Ports_Data`: per-port daily `portcalls_*`, `import_*`, `export_*` by ship type with ISO3. Port-level import estimates by tanker (`import_tanker`) can proxy national seaborne oil import intensity, with the same caution as the chokepoint volume field.

### 1.6 Terms (verified on imf.org)

Licence field on the ArcGIS item: `https://www.imf.org/external/terms.htm`. Reading the current IMF copyright and terms page (imf.org/en/About/copyright-and-terms):

- Data may be downloaded, extracted, copied, used for derivative works, published and distributed, with attribution to the IMF as source and a link to the dataset. Altered data must say so ("If material transformation occurs, it must be stated explicitly").
- "For any potential commercial reuse of IMF Data", get written permission (copyright@imf.org).
- Copying or downloading "in any systematic way" and "bulk download of information by automated technology" need written permission; the IMF may terminate access.
- Use for training large language models is not permitted without permission. Feeding the numbers into prompts as context is not training, but keep the AI role to labelled estimates as planned.
- A third-party aggregator tags PortWatch data with the licence id "imf-special-terms-viii" (snippet); I did not find a PortWatch-specific terms page.

Verdict: usable for a personal, non-commercial app with attribution ("Source: IMF PortWatch, portwatch.imf.org"). A scheduled pull of 28 daily rows plus small lookup tables is a light use, but it is still automated. Before hosting publicly, email the IMF to ask for written confirmation. Do not mirror the 5.9 million row port table.

---

## 2. Who imports energy from whom (bilateral flows)

| Source | Provides | Partner detail | Latest data and lag | Frequency | Access | Licence and redistribution | URL | Caution |
|---|---|---|---|---|---|---|---|---|
| **BACI (CEPII)** | Reconciled UN Comtrade at HS6, about 200 countries, value and quantity (verified: HS6, ~5,000 products) | Yes, exporter to importer | Version 202601 (released 2026-01-30), data through 2024 (verified). Lag about 13 months | Annual release | Keyless direct zip download, no registration seen (verified) | Etalab 2.0 (verified named on page). Etalab is an open licence requiring attribution; commercial terms are in the linked text, not re-read | cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37 | Annual only; big files (HS-wide); crude HS 2709 quantities can be missing or in value only for some pairs |
| **UN Comtrade** | Official reported trade by HS code (2701 coal, 2709 crude, 2710 products, 2711 LNG/LPG and gas) | Yes, reporter and partner | Many countries about 6 to 18 months behind; some monthly (background) | Annual and monthly | Free key (registration); free tier about 500 calls a day, 100,000 records per call, preview 500 records (snippet from Comtrade wiki; per-tier figures not re-verified) | Re-dissemination: free for public use up to 100,000 records, fee beyond that and for subscribers-only redistribution (snippet, Comtrade wiki and UN shop). The current Policy text was not read | comtradedeveloper.un.org; comtradeplus.un.org | Several big Gulf and African exporters report late or not at all; mirror data (importer-reported) needed. Terms need a proper read before public hosting |
| **JODI Oil** | Monthly production, trade, stocks, refinery intake, demand for 13 product groups, 90+ countries, since 2002 (verified) | Not on its pages. Trade appears as a single "trade" flow (verified page lists no origin/destination); partner split is not offered (background agrees) | Update on or about the 20th; 21 Oct 2026 update carried August 2026, so about 2 months (verified) | Monthly | Keyless download via jodidb.org | **Not confirmed.** Pages say "freely available" and show a copyright notice; no licence text found | jodidata.org/oil | No partner detail. Use for stocks, refinery intake and monthly trade totals only. Redistribution terms need asking |
| **JODI Gas** | Monthly gas production, trade, stocks | Not confirmed | Similar to Oil (not read) | Monthly | Keyless | Not confirmed | jodidata.org/gas | Not read beyond the menu |
| **Energy Institute Statistical Review** | 2026 edition (75th), data through 2025 (snippet). Annual oil trade by region movements, LNG and pipeline gas country-pair movements, coal (background) | Oil: regional pairs; gas: country pairs (background, not re-verified) | Published June/July each year, so lag about 6 months | Annual | Download page returned HTTP 403 to my fetch; Excel files are normally keyless (background) | **Not confirmed.** Our World in Data reuses it with attribution (snippet), but that is not the EI licence | energyinst.org/statistical-review | Check the licence before redistributing; likely the best annual cross-check for LNG country pairs |
| **EIA International** | Country totals for production, consumption, imports, exports, refinery capacity | **No partner detail** except for US imports by origin (the "Crude Oil Imports: By Origin" API, snippet) | Varies by series; the chokepoint tables are to 1H25 | Mostly annual, some monthly | Free API key | Public domain per EIA (verified) | eia.gov/opendata | Good for totals, not for pairs |
| **World Bank WITS** | Front end over Comtrade/TRAINS with HS partner data | Yes | Follows Comtrade | Annual | Free, registration for some downloads | WITS terms page exists (snippet), not read | wits.worldbank.org | A convenience layer, adds no new data over Comtrade or BACI |

Recommendation: use BACI for the annual bilateral weights (HS 2709, 2710, 2711, 2701), use UN Comtrade only to patch the most recent year for the top 30 importers if needed, and use Energy Institute (once its licence is read) for LNG and pipeline gas country pairs and as a cross-check. Pipeline-borne volumes appear in HS 2711 but do not use sea routes, so they must be split out.

---

## 3. Mapping flows to chokepoints

No open dataset found that assigns bilateral energy trade to chokepoints. What exists:

| Source | What it gives | Latest and licence | Access | Caution |
|---|---|---|---|---|
| **EIA World Oil Transit Chokepoints** (verified) | Oil flows, million barrels a day: Malacca 22.5 (2024) and 23.2 (1H25); Hormuz 20.7 and 20.9; Suez and SUMED 4.8 and 4.9; Bab el-Mandeb 4.1 and 4.2; Danish Straits 4.9 and 4.9; Turkish Straits 3.6 and 3.7; Panama 2.0 and 2.3 (fiscal year); Cape of Good Hope 9.3 and 9.1. World maritime oil trade 79.7 and 79.8. 2020 to 2024 history on the page. LNG in billion cubic feet a day: Hormuz 10.5 and 11.4; Malacca 10.1 and 9.2; Cape 7.8 and 5.7; Suez 0.5 and 0.9; Bab el-Mandeb 0.0; Danish 1.4 and 1.6; Dardanelles 0.5 and 0.6. Hormuz article: about 83% of Hormuz LNG went to Asia in 2024; over 20% of global LNG trade (verified) | Page "last updated March 3, 2026"; source EIA Short-Term Energy Outlook (Feb 2026) plus EIA analysis based on Vortexa tanker tracking and Panama Canal Authority data. EIA copyright page: US government publications are public domain; acknowledgement requested; third-party items may be protected (verified) | Web page; Excel only for Figures 3, 5, 7, 9, 11, 14 (Malacca, Hormuz, Suez/SUMED, Danish, Dardanelles, Cape). Table 1 has no download link | Last period is 1H25, before the 2026 Hormuz event, so it is structural baseline not current. Vortexa underlying data may be third-party; EIA publishes the aggregates only. Bab el-Mandeb LNG zero, Cape LNG up: rerouting since 2024 |
| **EIA Hormuz article** (verified) | 20 million barrels a day in 2024, about 20% of global petroleum liquids use | 2025-06-16 | Web | Single strait only |
| **PortWatch route lines** `Global_Shipping_Routes` | Route lines behind the PortWatch map | Terms as in 1.6 | ArcGIS service (layer 0 URL failed in my test) | Not confirmed as chokepoint-tagged |
| **searoute** (Python, Apache-2.0 per PyPI/repo; one conda page says MIT, so check the release's LICENSE file) | Shortest sea route between points on a Marnet-style network, with a restrictions list to avoid passages (snippet) | Open source | pip | Does not report which chokepoints a route crosses; you intersect the route line with chokepoint polygons or gates yourself. Built for plausible-looking routes, not navigation |
| **PortWatch Spillover Simulator connections** (verified) | Port-to-port distance and transit days | IMF terms | ArcGIS | Gives distance, not route path |

Conclusion: assignment of flows to chokepoints is something we must model. See the recommended pipeline.

---

## 4. Self-sufficiency and buffers

| Source | Provides | Coverage | Latest, lag | Frequency | Access | Licence and redistribution | URL | Caution |
|---|---|---|---|---|---|---|---|---|
| **World Bank WDI EG.IMP.CONS.ZS** "Energy imports, net (% of energy use)" | Net energy imports share; negative means net exporter | Countries and regional aggregates; 192 rows in the "most recent non-empty value" query | Aggregates show year 2022 values in the sample I fetched (verified); API `lastupdated` 2026-10-08. Lag about 3 years. Original source is the IEA energy balances (accessed 2025-03-25 per metadata) | Annual | Keyless JSON `api.worldbank.org/v2/country/all/indicator/EG.IMP.CONS.ZS?format=json&mrnev=1` (verified) | World Bank open data terms (CC BY 4.0 for most WDI) **not re-read here**; indicator comes from IEA, so check the series licence tag before redistributing | data.worldbank.org/indicator/EG.IMP.CONS.ZS | Covers all fuels together, not oil-only; three-year lag; the IEA-sourced series may carry IEA conditions |
| **IEA Oil Stocks of IEA Countries** | Days of net import cover, with stocks held abroad column (verified) | IEA members only (verified) | Page updated 2026-08-12, updated monthly with the Oil Market Report; reference month not stated | Monthly | Web tool; no download option seen on the page | Page lists CC BY 4.0 (verified) | iea.org/data-and-statistics/data-tools/oil-stocks-of-iea-countries | Members only; net exporters are not obliged to hold stocks. Confirm a machine-readable download exists |
| **JODI Oil closing stocks** | Closing stocks by product, 90+ countries (verified: "closing stocks" is a JODI flow) | Includes non-IEA countries, many incomplete | About 2 months | Monthly | Keyless | Not confirmed | jodidata.org/oil | Stocks are total stocks, not government reserves. Many countries report blanks. Days-of-cover must be computed (stocks divided by imports or demand) |
| **China, India, strategic reserves** | No open global source found | | | | | | | China does not publish official reserve numbers; any figure would be a labelled AI or commercial-estimate input |
| **AGSI+ (Gas Infrastructure Europe)** | EU and country gas storage fill, injections, withdrawals, working gas volume | EU, UK, Ukraine and others | Daily, small lag (background) | Daily | **Free API key by registration** (snippet, GIE API docs). Site responded HTTP 200 to my GET | Reuse allowed with clear GIE/AGSI credit; keys can be disabled without credit (snippet, API docs v007 and the ALSI account page) | agsi.gie.eu/api | Needs a key so cannot be used without registration; owner decides. Europe only |
| **ALSI+ (GIE)** | LNG terminal send-out, inventory | EU LNG terminals | Daily | Daily | Same key as AGSI | Same | alsi.gie.eu | Same |
| **Refining capacity** | EIA International (country refinery capacity, public domain, background); Energy Institute Statistical Review (refining capacity by country, annual, background); OPEC Annual Statistical Bulletin (background); Global Energy Monitor has an oil refinery layer in newer releases (not confirmed) | | | Annual | EIA keyed | EIA public domain | | Not verified in this session beyond EIA licence; confirm the specific series |

---

## 5. Prices

| Source | Provides | Latest seen (verified) | Frequency | Access | Licence and redistribution | URL | Caution |
|---|---|---|---|---|---|---|---|
| **FRED CSV** `DCOILBRENTEU` (Brent, Europe spot, USD per barrel) | Daily Brent spot, EIA-sourced | 2026-11-03: 107.03 (2026-10-30: 120.15) | Daily, a few days late | **Keyless** `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU` | FRED terms; EIA-origin series are public domain at source. FRED site terms were not read | fred.stlouisfed.org | Keyless CSV is not a documented API and could be limited or changed. A formal FRED API needs a free key |
| **FRED CSV** `DCOILWTICO` (WTI, Cushing) | Daily WTI spot | 2026-11-03: 99.64 | Daily | Keyless CSV | Same | | Same |
| **FRED CSV** `PNGASEUUSDM` (EU gas, USD per MMBtu, IMF monthly) | Monthly European gas benchmark | 2026-09-01: 25.494 (Jul 17.93, Aug 20.92) | Monthly, about 1 to 2 months late | Keyless CSV | IMF-sourced series: IMF terms may apply. Not confirmed | | Monthly; for daily gas price there is no free keyless source found |
| **EIA API v2 spot prices** | Brent and WTI daily | Not tested (needs key) | Daily | Free key | Public domain (verified) | eia.gov/opendata | Same data as FRED; use only if a key is acceptable |
| **World Bank Pink Sheet** | Monthly commodity prices including crude (average and by grade), LNG Japan, EU, US gas, coal | File URL answered HTTP 200 (xlsx) (verified for the 2025-vintage path; the current path changes each release) | Monthly | Keyless Excel | World Bank terms, CC BY 4.0 normally (background, not read) | worldbank.org/en/research/commodity-markets | The download URL contains a hash and changes each release; scrape the landing page for it |

An LNG benchmark with a free, keyless daily feed was not found. Monthly Pink Sheet or the FRED IMF series is the realistic baseline.

---

## 6. Alternative routes: pipelines and LNG terminals

| Source | Provides | Coverage, latest | Access | Licence and redistribution | URL | Caution |
|---|---|---|---|---|---|---|
| **Global Energy Monitor, Global Oil Infrastructure Tracker (GOIT)** | Oil and NGL pipelines (1,634 oil pipeline projects, 487,000 km; 292 NGL projects, 11,100 km) (verified), also terminals and more in other releases | Global. Page says latest release March 2025 yet cites a "June 2026 release" in its citation line (contradiction in the page; ask GEM) | Download section on page; form not confirmed | **Page does not state a licence.** GEM's general statement, seen in search results: tracker data are CC BY 4.0 unless otherwise noted (snippet). Not confirmed for GOIT | globalenergymonitor.org/projects/global-oil-infrastructure-tracker/download-data/ | Confirm licence text and release date before bundling the file |
| **GEM Global Gas Infrastructure Tracker (GGIT)** | Gas transmission pipelines and LNG import and export terminals (snippet) | Global; release date uncertain (Dec 2023/Jan 2024 or later, snippet) | **Form required** (name and email, reCAPTCHA) (snippet) | CC BY 4.0 per snippet on the download page | globalenergymonitor.org/projects/global-gas-infrastructure-tracker/download-data/ | The form is a gate; I did not submit it. Capacity fields exist for most pipelines and terminals (background) |
| **PortWatch routes and ports** | Shipping routes and port catalogue | See section 1 | ArcGIS | IMF terms | | Not an energy pipeline source |
| **EIA chokepoint pages** | Notes on bypass pipelines (East-West Saudi pipeline, Abqaiq to Yanbu; Habshan to Fujairah UAE; SUMED) as text only | Page | Web | Public domain | | No structured pipeline data found. Capacities for the bypasses are in the EIA Hormuz and Suez texts but should be hand-entered with source notes |

For version 1 the "alternatives" column is best built as a small hand-curated table: for each chokepoint, the bypass pipelines (name, capacity, source link), the main alternative sea route (Cape of Good Hope for Suez/Bab el-Mandeb), and the added days. GEM data can then be used to draw the geometry.

---

## Recommended v1 pipeline

Order of work:

1. **Chokepoint layer (PortWatch).** Pull `PortWatch_chokepoints_database` once (28 points) and `Daily_Chokepoints_Data` daily for the last 400 days, re-fetching the last 14 days each run to catch revisions. Compute 7-day and 28-day means and a ratio to the same chokepoint's trailing 12-month baseline (for example median of the same weeks of the previous year, or Jan to Feb 2026 as the pre-event baseline). Disruption flag: ratio below 0.5 for 7 days, or a row in `portwatch_disruptions_database` naming the chokepoint. Display lag: "data to 2026-11-01".
2. **Structural flows (EIA).** Hand-load EIA Table 1 and the LNG table as a static JSON with year and source. This is the baseline for what normally passes through each strait, and the calibration target.
3. **Bilateral weights (BACI).** Load HS 2709 (crude), 2710 (refined products), 2711 (LNG: 271111; pipeline gas 271121 cannot be split by sea route, drop or tag as land), 2701 (coal), for the latest year (2024). Prefer quantity in tonnes; where a pair has value but no quantity, use value ratio and label it.
4. **Route assignment.** For each exporter-importer pair, pick representative ports (the largest oil/LNG export port of the exporter and import port of the importer; GEM terminals can supply LNG ports, the PortWatch ports table can supply the rest). Run a sea-route library (searoute or the PortWatch route network), then tag each route with the chokepoint gates it crosses by line-polygon intersection with 28 chokepoint areas. Only allow paths that cross a chokepoint when the geography requires it (e.g. Gulf origin always crosses Hormuz).
5. **Calibration.** Sum modeled barrels through each chokepoint and compare with the EIA table. Report the mismatch openly. If Hormuz modeled flow is within about 15% of 20.7 million barrels a day, accept; otherwise tune representative ports or add a land-bypass share (East-West pipeline, Fujairah).
6. **Dependency figure.** For importer X, chokepoint Y, product P:
   `share(X,Y,P) = tonnes of P imported by X by sea on routes crossing Y / total tonnes of P imported by X`
   Present three denominators clearly: share of seaborne imports, share of all imports (including pipelines, from Energy Institute / EIA totals), and share of national energy use (multiply by `EG.IMP.CONS.ZS` and a fuel-mix share from the Energy Institute). Show only the first two at launch.
7. **Buffers.** Show net energy import share (World Bank, with year), IEA stock cover days for IEA members only, JODI-derived stock cover marked "estimate" for others, and AGSI+ gas storage fill for Europe only if a GIE key is acceptable. "Not available" is the honest value elsewhere.
8. **Prices.** FRED keyless CSV for Brent, WTI, and EU gas (monthly). Fallback to EIA key if the CSV disappears.
9. **Alternatives.** Hand-curated bypass table with GEM geometry once the licence line is confirmed.

Assumptions that must be shown with the number:
- Trade year is 2024 (BACI), earlier than the 2026 disruption. The number is structural dependence, not current exposure.
- Representative-port and shortest-path routing; some pairs have two plausible routes (Suez or Cape; Panama or Cape).
- Re-exports and transshipment (Singapore, Rotterdam, Fujairah) are attributed to the declared partner, not the origin.
- Importer-reported tonnes are used where exporter data is missing; mixed mirrors can double count.
- Product mix by HS code is coarse (2710 spans many refined products).
- Routes after 2024 (Red Sea diversion) are taken from PortWatch changes, not the baseline year; a "rerouting scenario" toggle is a separate step.
- Label as "modelled from 2024 UN Comtrade (BACI) trade, EIA and IMF PortWatch; not a published statistic".

---

## Risks and unknowns

- **IMF terms.** Bulk or systematic automated download needs permission. The app's load is small, but a hosted version should have written permission. Attribution and the "transformed data must be stated" rule apply to every derived figure.
- **PortWatch volume field.** `capacity` may be deadweight tonnage rather than payload. Not confirmed. Do not present it as tonnes carried.
- **Update schedule.** Day and time not found; lag measured at 7 days on one date only. Measure again over several weeks.
- **Single-day noise and revisions.** Use rolling means.
- **Chokepoint list mismatch.** PortWatch lacks Great Belt and Little Belt and splits Turkish Straits only as Bosporus. The board's "Danish straits" will use Oresund as a proxy plus the EIA Danish Straits total.
- **Hormuz anomaly.** The collapse since March 2026 is large and real in the feed. It should be checked against a second signal (EIA/IEA text, news collector) before the board calls it a closure. AIS gaps, jamming or spoofing near Hormuz could depress counts without the strait being shut. Not investigated.
- **Licences not confirmed:** JODI Oil and Gas, Energy Institute Statistical Review, GEM GOIT (GGIT only seen in snippet), UN Comtrade current redistribution policy, WDI licence for this IEA-derived series, FRED terms.
- **Keyless FRED CSV** is undocumented and may change.
- **No bilateral coverage for pipeline gas by route** and no open global strategic reserve data for China, India and others.
- **BACI lag.** Latest data year is 2024; 2025 trade will not appear until about early 2027.
- **EIA chokepoint numbers** end at 1H25 and rely partly on commercial tracking data; the aggregates are published, the underlying data is not.
- **Comtrade free key limits** from a wiki snippet, not the portal; check before building.

---

## Sources

Verified by fetch or direct GET:
- PortWatch Daily_Chokepoints_Data layer and metadata: https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0
- PortWatch chokepoints database: https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/PortWatch_chokepoints_database/FeatureServer/0
- PortWatch disruptions database: https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/portwatch_disruptions_database/FeatureServer/0
- PortWatch service list: https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services?f=json
- IMF copyright and terms: https://www.imf.org/en/About/copyright-and-terms
- EIA World Oil Transit Chokepoints: https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/
- EIA Hormuz article: https://www.eia.gov/todayinenergy/detail.php?id=65504
- EIA copyright and reuse: https://www.eia.gov/about/copyrights_reuse.php
- CEPII BACI: http://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37
- JODI Oil home and database overview: https://www.jodidata.org/oil/ and https://www.jodidata.org/oil/database/overview.aspx
- IEA Oil Stocks of IEA Countries: https://www.iea.org/data-and-statistics/data-tools/oil-stocks-of-iea-countries
- World Bank API, EG.IMP.CONS.ZS: https://api.worldbank.org/v2/country/all/indicator/EG.IMP.CONS.ZS?format=json&mrnev=1
- FRED CSV endpoints: https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU, ...id=DCOILWTICO, ...id=PNGASEUUSDM
- GEM Global Oil Infrastructure Tracker download page: https://globalenergymonitor.org/projects/global-oil-infrastructure-tracker/download-data/
- UN Comtrade developer portal notice: https://comtradedeveloper.un.org/

Seen only in search snippets:
- World Bank chokepoints monitor notebook (1,000 record paging, `portid` filter): https://worldbank.github.io/alternative-data-for-crisis/notebooks/disruptions-business-trade/chokepoints-monitor.html
- UN Comtrade wiki, subscriptions and re-dissemination: https://comtradewiki.azurewebsites.net/?p=78 and https://comtradewiki.azurewebsites.net/?p=893
- GEM Global Gas Infrastructure Tracker download page: https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/download-data/
- GIE API documentation: https://www.gie.eu/transparency-platform/GIE_API_documentation_v013.pdf and https://alsi.gie.eu/account ; AGSI+ site: https://agsi.gie.eu
- Energy Institute Statistical Review 2026 summary: https://www.energyinst.org/__data/assets/pdf_file/0004/1822009/Statistical-Review-of-World-Energy-2026-Summary-version.pdf
- searoute on PyPI: https://pypi.org/project/searoute/1.4.0
- EIA crude imports by origin API (data.gov catalog): https://catalog.data.gov/dataset/crude-oil-imports-by-origin-application-programming-interface-api
- World Bank Pink Sheet landing: https://www.worldbank.org/en/research/commodity-markets
- WITS terms: https://wits.worldbank.org/WITS/wits/registration/TermsAndCondtions.aspx
