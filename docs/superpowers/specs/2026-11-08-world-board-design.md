# World Board: the globe as a strategy board

Date: 2026-11-08. Status: design draft, direction agreed with the owner, not built. Data sources
in section 8 come from research tracks A–E (`docs/superpowers/research/2026-11-08-world-board-*.md`).
Grounding: `docs/superpowers/research/2026-11-08-national-power-research.md`.

## 0. Shape in one paragraph

Opening the app shows a **World Board**. It is not a tile or hex board. It is drawn on the app's
existing globe, over its real imagery, with real country borders, coastlines and chokepoint
locations. Every country is coloured by the lens the owner picks.
Strategic assets sit on the globe as icons, relations and dependencies are drawn as lines, and
maritime chokepoints show their live traffic. Clicking a country opens its **character sheet**,
with these sections:

- **Strength:** 12 areas.
- **Condition:** 6 bars, the country's "HP".
- **Exposure**
- **Leverage**
- **Relations**
- **Assets**
- **Stakes**
- **People:** leader and official profiles with their public accounts.

Code computes every number from published datasets and shows its data period. When the latest
published figure is stale, Claude researches and adds a labelled **estimate** beside it, never in
its place. **Refresh** is one turn: it pulls new dataset releases and live feeds, records events,
recomputes, and shows a turn summary of what changed. News joins later as an event input.

## 1. Decisions (owner)

2026-11-08:

- **Goal.** A globe that reads like a strategy game (Civilization was the example). It should show
  who is against whom, what is at stake and where, why each actor acts as it does, who needs what
  from whom, logistics, economy, technology, and who possesses what.
- **Real map, no tiles.** The system is applied to the app's world globe and its real geography.
  The hex board on the blueprint page was only a diagram to explain the ideas.
- **Stable.** Opening the app shows the world as last refreshed. Refresh updates it.
- **No single HP bar.** Each country has separate sheet parts, following the research.
- **Numbers come from published data, computed by code.** Sources are reached through their APIs,
  downloads or MCP connectors, chosen in section 8.
- **Claude researches only to estimate where a stale value is now.** It works relative to the
  latest published value, with sources. Estimates are labelled and shown beside measured values.
- **Version 1 covers:**
  - every country;
  - energy and shipping chokepoints in depth;
  - anything else that gives a clearer view (section 8 lists what research found).
- **No total power score in v1.** It will be added later.
- **Who owns what and who is against whom.** Both appear on the globe and in the panels (sections 6
  and 7).
- **Connect to X.** Every actor concerned gets a profile with their X account and recent posts.
  Actors without an X account get another public profile instead. The interface should feel like a
  video game.
- **News stays separate for now.** The war monitor and Search Layers are integrated later, as event
  inputs.
- **Open points answered.** X starts free; marked NonCommercial sources are allowed while the app
  is personal; the map shows measured values by default, with an estimates toggle; a HUD design
  mock comes before phase 1's interface (section 13).

## 2. Words used here

- **Board:** the World Board layer and its panels, drawn on the real globe. The word is only a
  name; there are no tiles.
- **Area:** one of the 12 Strength areas.
- **Bar:** one of the 6 Condition bars.
- **Indicator:** a defined measure, such as "energy imports, net % of energy use".
- **Observation:** one published value of an indicator for one country and period, with its
  source and vintage.
- **Estimate:** Claude's labelled nowcast of a stale indicator, kept beside the observation it
  starts from.
- **Asset:** a strategic facility or holding at a place, such as a refinery, mine, port, base, fab
  or arsenal.
- **Relation:** a typed, dated link between two actors, such as an alliance, a war, sanctions or
  arms supply.
- **Dependency:** a directed need, of the form "A depends on B for X". It carries a share and its
  denominator.
- **Event:** a sourced change in the world that sets or clears a status. For example, "Strait of
  Hormuz: disrupted".
- **Status flag:** a current-condition marker set by an event or a live feed.
- **Lens:** what the country colours mean right now.
- **Turn:** one Refresh, with its change list.
- **Actor:** a person or organisation with a public role, such as a head of state, ministry,
  military, central bank, armed group or international organisation.

## 3. Rules

These are fixed for every phase. They come from the research and from this project's existing
rules.

1. **Code owns the numbers.** Every number shown can be reproduced from stored observations and a
   versioned formula. "Why this number" shows both.
2. **Unknown is a state, not zero.** Missing data is drawn hatched and labelled "unknown". It
   never counts as low.
3. **Every value shows its period and source.** Retrieval date is not measurement date. The
   period ("2024", "Sep 2026") is always visible.
4. **Estimates look different.** Measured values are solid. Estimates are a dashed ghost with the
   word "estimate", a date, a range and their sources. An estimate never overwrites an
   observation.
5. **Events change facts, never points.** An event can set a status ("port closed", "internet
   shutdown"). Bars move only when their observations change.
6. **A country is not one actor.** Country, government, population and armed groups are distinct.
   An event that helps a government is not shown as helping the country.
7. **Dependencies carry a denominator.** A dependency also needs a period and alternatives.
   "Share of imports" and "share of use" are different fields.
8. **Owning, operating, hosting and controlling are different.** An asset records each separately.
9. **Facts, interpretations and forecasts look different.** Every claim is labelled measured,
   estimate, declared, documented, observed, hypothesis or disputed.
10. **No total score in v1.**
11. **Every source has a recorded licence.** NonCommercial or ShareAlike sources are marked and
    isolated, as the submarine cables already are in `DATA_SOURCES.md`.
12. **Profiles cover public officials and organisations only.** Never private individuals.
13. **Links are real.** Inherited from Search Layers: an estimate or stake can cite only pages its
    research step actually retrieved.

## 4. Data model

The server keeps state in `.gev-cache/world/`. The repo holds reference data in `public/world/`:
the indicator registry, the source list, the chokepoint list, the relation types and the asset
types. Every write is atomic, as in the digest and search stores.

### 4.1 Country

The record has:

- `iso3`;
- `name`;
- `shapeId`, pointing at the bundled Natural Earth admin-0 pack
  (`src/data/local_data/natural_earth/countries.json`, 260 features, read through
  `src/data/adminBoundaries.js`);
- `kind`: `state`, `territory` or `disputed`;
- `capital`, with its point.

The board lists every state and every territory with data. A disputed area is drawn hatched, and
its claims are recorded as relations (section 4.7).

### 4.2 Indicator (registry, `public/world/indicators.json`)

```json
{
  "id": "energy.net_imports_pct",
  "label": "Energy imports, net (% of energy use)",
  "section": "exposure",
  "area": "energy",
  "source": "worldbank",
  "sourceCode": "EG.IMP.CONS.ZS",
  "unit": "%",
  "direction": "higher-is-worse",
  "role": "exposure",
  "transform": "none",
  "anchors": { "a": 0, "b": 100, "version": 1 },
  "criticalBelow": null,
  "staleAfterMonths": 18,
  "maxPlausibleYearlyChange": 25,
  "licence": "CC BY 4.0"
}
```

- `role` is one of `size`, `adequacy`, `exposure` or `buffer`. It stops the same advantage being
  counted twice.
- `anchors` are fixed and versioned. The display score is
  `z = 100 · clip((f(x) − a) / (b − a), 0, 1)`, reversed when `direction` is `higher-is-worse`.
  Stored history is never silently rescaled.
- `staleAfterMonths` decides when an observation is old enough to offer an estimate.
- `maxPlausibleYearlyChange` lets code flag an estimate for review.

### 4.3 Observation

```json
{ "iso3": "IRN", "indicator": "energy.net_imports_pct", "value": -54.2, "period": "2023",
  "publishedAt": "2025-07-01", "retrievedAt": "2026-11-08T10:00:00Z", "sourceVersion": "WDI 2025-07",
  "method": "observed" }
```

`method` is `observed`, `source-estimate` or `source-forecast`. Use `source-estimate` when the
publisher marks the value as estimated, and `source-forecast` for a publisher's own current-year
projection, such as the IMF World Economic Outlook. Every vintage is kept. A revised value adds a
row; it never edits the old one.

### 4.4 Estimate (Claude)

```json
{ "id": "est_…", "iso3": "IRN", "indicator": "economy.gdp_real_growth", "from": { "period": "2025", "value": 1.1 },
  "asOf": "2026-11-08", "range": { "low": -4.0, "high": -1.0 }, "direction": "down",
  "summary": "Two sentences on why, each citing source ids.", "sourceIds": ["s2", "s5"],
  "agentModel": "…", "runId": "…", "review": "ok | flagged" }
```

- The output is a range, not one number.
- Code checks four things. Sources must be real (rule 13). The range must be ordered. The value
  must have the indicator's unit. A change beyond `maxPlausibleYearlyChange` sets
  `review: "flagged"`.
- Estimates expire after 30 days, or as soon as a new observation arrives. Claude runs only when
  the owner asks (section 9).

### 4.5 Area and bar scores (computed, pure)

- **Area or bar score:** the mean of its available indicator scores. Weights are equal unless the
  registry says otherwise, and the registry records where any weight comes from. The score also
  carries its `coverage` (indicators present out of indicators defined) and its oldest period.
- **Too little coverage:** if fewer than half of the indicators are present, the score is
  `unknown`.
- **Critical flag:** a Condition bar is flagged when any of its indicators is below
  `criticalBelow`, or when a live status flag for it is active.
- **No smoothing across bars:** the Condition lens colours a country by its weakest bar, not an
  average.

### 4.6 Asset

```json
{ "id": "asset_…", "type": "refinery", "name": "…", "geometry": { "type": "Point", "coordinates": [lon, lat] },
  "locatedIn": "SAU", "capacity": { "value": 550000, "unit": "bbl/d" },
  "owners": [{ "actor": "…", "country": "SAU", "share": 1.0 }], "operator": "…",
  "jurisdiction": "SAU", "canInterrupt": [], "status": "operating",
  "source": "…", "licence": "…", "lastVerified": "2026-…" }
```

`status` is `operating`, `disrupted`, `closed`, `planned` or `unknown`. Only events and live feeds
change it.

### 4.7 Relation

```json
{ "id": "rel_…", "type": "sanctions", "from": "USA", "to": "IRN", "directed": true,
  "start": "1979-11-14", "end": null, "detail": "Comprehensive embargo; secondary sanctions",
  "conditions": null, "sources": ["…"], "evidence": "documented" }
```

Types:

- alliance or defence pact, with its conditions;
- bloc membership;
- armed conflict, with the two sides;
- support to a party in a conflict;
- sanctions;
- arms supply;
- territorial dispute;
- foreign troop presence;
- diplomatic rupture;
- UN voting alignment, with its score and session.

Alliances record what is promised and under what conditions. An ally's strength is never added to
a country's own.

### 4.8 Dependency

```json
{ "id": "dep_…", "dependent": "JPN", "provider": "SAU", "kind": "supply", "item": "crude oil",
  "volume": { "value": 1.1, "unit": "mb/d" }, "share": 0.39, "denominator": "crude imports",
  "route": ["hormuz"], "alternatives": "…", "bufferDays": null, "period": "2025",
  "sources": ["…"], "method": "computed", "uncertainty": "…" }
```

`kind` is `supply`, `demand`, `transit` or `system`. `bufferDays` stays `null` (shown as
"unknown") unless every input for the buffer formula is known.

### 4.9 Chokepoint

Each chokepoint record has:

- an id, matching the live source's id;
- its name and geometry, taken from the bundled Natural Earth marine pack where it exists;
- a daily traffic series;
- a baseline (the same weeks of the last 12 months);
- a status (`normal`, `reduced`, `disrupted`), set by code from traffic against the baseline and by
  events;
- the dependencies routed through it.

### 4.10 Event

```json
{ "id": "ev_…", "type": "route-disruption", "actors": ["…"], "places": ["hormuz"], "affects": { "assets": [], "chokepoints": ["hormuz"], "relations": [] },
  "eventTime": "…", "reportTime": "…", "stage": "reported", "sources": ["…"], "corroboration": "corroborated",
  "sets": [{ "target": "chokepoint:hormuz", "status": "disrupted" }], "review": "ok" }
```

`stage` is one of:

- `announced`
- `authorised`
- `implemented`
- `observed`
- `reported`
- `confirmed`
- `reversed`

In v1, events come from live feeds and from code-detected anomalies, such as a sharp fall in
traffic. News extraction comes later.

### 4.11 Actor

```json
{ "id": "Q…", "kind": "person", "role": "head-of-government", "country": "…", "office": "…", "since": "…",
  "image": { "file": "…", "licence": "…", "author": "…" },
  "accounts": { "x": "…", "telegram": "…", "bluesky": "…", "youtube": "…", "website": "…" },
  "source": "wikidata", "lastChecked": "…" }
```

### 4.12 Turn

A turn record holds its start and end times, then for each source: whether it was checked, what
was new and whether it failed. It also holds counts of new observations, events, status changes
and estimates, plus the **change list** (code-generated). Turns are kept, so the board can show
"since last turn" and, later, a past day.

## 5. Refresh (one turn)

1. **Datasets.** Each source adapter knows its release rhythm. Code asks only the sources that may
   have something new and stores new observations.
2. **Live feeds.** Code pulls chokepoint traffic and the live condition feeds (section 8).
3. **Events.** Code detects anomalies and reads feed events, then sets or clears statuses.
4. **Recompute.** Code recomputes the affected scores, dependencies and lenses.
5. **Turn summary.** Code writes the change list. If the owner has asked for it, Claude writes a
   three-sentence narrative from that list; it adds no new facts.

- Opening the app loads the last saved board immediately.
- The first launch downloads the base data, with a progress line.
- Live feeds also update on their own timers while the board is on, like the existing live
  layers.
- Datasets update only on Refresh.
- Claude runs only when the owner asks.

## 6. Globe

- **Layer.** A new **World Board** layer, which turns the board on. It needs its own share token
  and the same registrations as Searches (see the Searches spec, §6.2).
- **Country fills.** Semi-transparent fills drawn from the bundled admin-0 pack over the imagery.
  A lens bar sits at the top of the board. Disputed areas are hatched.
- **Lenses.** Each lens has its own legend, and "unknown" is always its own colour.
  - Condition (weakest bar).
  - Any one Strength area.
  - Energy exposure.
  - Data age.
  - **Diplomacy:** pick a country, and the world recolours by its relations to that country
    (ally, partner, neutral, rival, sanctions, at war). This is the main "who is against whom"
    view.
  - **Ownership:** pick a country, and its assets abroad light up with lines back to it. This is
    the main "who owns what" view.
- **Assets.** Icons by type, clustered when zoomed out using the hotspot aggregation. With the
  Ownership lens on, each icon carries an owner-colour ring.
- **Lines.**
  - With a country selected: its dependencies, coloured by item (oil, gas, grain, chips, money,
    arms), and its relations (war dotted red, alliance dashed).
  - With no country selected: only the largest flows through chokepoints, so the globe never turns
    into spaghetti.
- **Chokepoints.** A gauge marker shows today's traffic against its baseline. It turns red when
  disrupted.
- **People.** A leader portrait sits beside the country label at board zoom, like the leaders in
  Civilization. Clicking it opens the actor card.
- **Zoom.** The board is the zoomed-out view. Below about 3,500 km the fills fade and the app's
  normal layers carry on, reusing the hysteresis of the hotspot view.

## 7. Panels

### 7.1 Character sheet (right rail)

- **Header:** name, government type, head of state and head of government with portraits, and
  data coverage.
- **Strength:** 12 bars. Each shows its coverage and its data period, and an estimate ghost where
  one exists.
- **Condition:** 6 bars, with critical flags and active status flags.
- **Exposure:** the top dependencies, each with share, denominator, route and buffer.
- **Leverage:** who depends on this country, for what.
- **Relations:** allies, blocs, rivals, wars, sanctions given and received, arms in and out.
- **Assets:** key assets at home, and assets it owns abroad.
- **Stakes:** declared objectives and commitments with evidence labels. Filled by Claude on
  request, and dated.
- **People:** the actors, their accounts and their recent posts (section 8, track D).
- **Since last turn.**
- **Why this number:** every bar opens its indicators, raw values, periods, formula and source
  links.

### 7.2 Other cards

- **Relation:** opened by clicking a line.
- **Asset:** opened by clicking an asset icon.
- **Chokepoint:** a traffic chart, its status history, and the countries that depend on it,
  ranked by exposure share.
- **Actor:** portrait with attribution, office, accounts, recent posts and links out.

## 8. Sources

Details, licences and caveats are in the research files. This section records what v1 uses. Every
source gets a row in `public/world/sources.json`, with its id, licence, attribution text, access
mode (keyless, free key, or download) and release rhythm. Provider Settings shows the sources
that need a key.

### 8.1 Base indicators (track A, `2026-11-08-world-board-base-indicators.md`)

**Seed registry.** Phase 1 starts with one indicator per area and bar, all keyless. The research
file lists 2–4 candidates for each. A second indicator joins an area once its licence and coverage
are checked.

| Slot | Indicator | Code | Source | Note |
|---|---|---|---|---|
| S1 Productive economy | GDP, PPP (current intl $) | `NY.GDP.MKTP.PP.CD` | World Bank | Size. IMF `PPPGDP` gives the current year. |
| S2 Fiscal and financial | Total reserves | `FI.RES.TOTL.CD` | World Bank | Size. Add reserves in months of imports for adequacy. |
| S3 Government and institutions | Government effectiveness (0–100) | `GOV_WGI_GE.SC` | World Bank WGI | Dec 2025 revision, CC BY 4.0. |
| S4 People and human capital | Life expectancy at birth | `SP.DYN.LE00.IN` | World Bank | |
| S5 Society and legitimacy | Rule of law (0–100) | `GOV_WGI_RL.SC` | World Bank WGI | Weak fit. Replace with voice and accountability, or V-Dem, after review. |
| S6 Military and security | Military expenditure (current $) | `MS.MIL.XPND.CD` | World Bank (SIPRI data) | Spending, not effectiveness, and labelled that way. SIPRI's own terms are non-commercial. |
| S7 Energy | Energy imports, net (% of use) | `EG.IMP.CONS.ZS` | World Bank (IEA-derived) | Exposure. The redistribution terms for this IEA-derived series are unconfirmed. |
| S8 Food, water and environment | Prevalence of undernourishment | `SN.ITK.DEFC.ZS` | World Bank (FAO) | Adequacy. |
| S9 Infrastructure and logistics | Logistics performance (overall) | `LP.LPI.OVRL.XQ` | World Bank LPI | Last survey edition. LPI 2.0 has no overall score, so it is a later swap. |
| S10 Technology and information | Individuals using the internet (%) | `IT.NET.USER.ZS` | World Bank (ITU data) | Weak for "strategic technology". ITU's own terms are non-commercial. |
| S11 Diplomacy and external access | Trade (% of GDP) | `NE.TRD.GNFS.ZS` | World Bank | **Placeholder, low confidence.** No open global diplomacy measure exists. Phase 3's relations will feed this area instead. |
| S12 Cultural and narrative influence | Charges for the use of IP, receipts | `BX.GSR.ROYL.CD` | World Bank | **Placeholder, very weak.** Shown as low confidence. |
| C1 Governing continuity | Political stability and absence of violence (0–100) | `GOV_WGI_PV.SC` | World Bank WGI | Annual. Live flags come from 8.3. |
| C2 Security and control | Conflict events and fatalities, last 12 months | — | UCDP Candidate (monthly, CC BY 4.0) | Bulk files. |
| C3 Essential services | DTP3 immunisation (%) | `SH.IMM.IDPT` | World Bank (WHO) | Health-system proxy. Add access to electricity (`EG.ELC.ACCS.ZS`). |
| C4 Household security | Inflation, average (%) | `PCPIPCH` | IMF DataMapper | Current year, `source-forecast`. |
| C5 Fiscal and payment continuity | General government gross debt (% GDP) | `GGXWDG_NGDP` | IMF DataMapper | Current year, `source-forecast`. |
| C6 Societal cooperation | Political polarisation | `v2cacamps` (code to verify) | V-Dem | CC BY-SA, so it is marked ShareAlike. |

**No open global data for:**

- military readiness and effectiveness;
- cyber capability;
- diplomatic reach;
- cultural influence.

Those areas show their placeholder at low confidence, or `unknown`. They are never filled by
Claude guesses.

**Current year first, then Claude.** IMF DataMapper is keyless and gives current-year estimates and
projections for about 210 economies, for GDP, growth, inflation, debt, the current account and
more. Code stores these as `source-forecast` observations and records the WEO vintage (April and
October editions).

An indicator is stale only when neither a recent observation nor a published current-year estimate
exists. Only then does the sheet offer a Claude estimate (section 9). This keeps Claude to the
gaps, as the owner decided.

**Stale World Bank series to avoid:** the human capital index (2020), tourism (2020), the liner
shipping index (2021) and paved roads (empty).

**Licence notes.** The World Bank re-serves SIPRI and ITU data as CC BY 4.0, while SIPRI and ITU
state non-commercial terms. Both are marked in `sources.json` for the public-hosting check.

**Nuclear.** FAS and SIPRI warhead estimates for the 9 nuclear states are entered by hand as cited
facts, as a separate badge (see 8.5).

### 8.2 Energy and shipping (track B, `2026-11-08-world-board-energy-shipping.md`)

**Chokepoints, live: IMF PortWatch.**

- **Coverage:** 28 chokepoints (`chokepoint1`–`chokepoint28`), served by a keyless ArcGIS
  FeatureServer that returns up to 1,000 rows per request.
- **Fetching:** pull the chokepoint list once. Pull daily transit calls by vessel type for the
  last 400 days, and re-fetch the last 14 days on every turn to pick up revisions.
- **Lag:** measured at about 7 days on 2026-11-08, when the newest day was 2026-11-01. The board
  shows "data to <date>".
- **Status:** computed from the 7- and 28-day means divided by the same chokepoint's baseline.
  The ratio staying below 0.5 for 7 days gives `disrupted`. So does an open row for that
  chokepoint in PortWatch's disruptions database.
- **Second signal.** A drop in traffic alone makes the status `reduced`. It becomes `disrupted` only
  when a disruption record or, later, a corroborated event agrees. AIS gaps or jamming can lower
  the counts while a strait is still open. Hormuz is the live example: transits fell from about 64
  a day to single digits from March 2026, and an open "HORMUZ-26" event exists.
- **`capacity` field:** this may be deadweight tonnage rather than cargo carried. It is never
  labelled as tonnes of oil.
- **Terms:** a personal app with attribution is fine. Every derived figure states that it was
  transformed. Bulk automated download and public hosting need written IMF permission
  (copyright@imf.org) first.
- **Coverage gaps:** Great Belt and Little Belt are missing, so the board's "Danish straits" uses
  Øresund as a proxy.

**Structural flows.** The board hand-loads the EIA chokepoint volumes into
`public/world/curated/eia-chokepoints.json`, with year and source. These cover oil in million
barrels a day and LNG in billion cubic feet a day, through the first half of 2025. They are US
government work, in the public domain. They give what normally passes each strait, and serve as
the target for calibration.

**Who imports from whom: BACI (CEPII).**

- Bilateral trade for 2024 under Etalab 2.0, free.
- HS codes used:
  - 2709, crude oil;
  - 2710, refined products;
  - 271111, LNG;
  - 2701, coal.
- Pipeline gas (271121) cannot be routed by sea, so it is tagged as land.
- Quantities are in tonnes where reported. Pairs with a value but no quantity use the value ratio,
  labelled as such.
- UN Comtrade is the fallback; its redistribution terms are unconfirmed.

**Country → chokepoint dependency, modelled.** No open dataset publishes this, so code models it:

1. Pick representative ports for each exporter–importer pair.
2. Route each pair by sea with a sea-route library.
3. Tag the chokepoint areas each route crosses.
4. Calibrate against the EIA totals, accepting a gap of about 15% for Hormuz and reporting the gap
   openly.

The figure is `share(X, Y, P)`: the tonnes of product P that importer X brings in by sea on routes
crossing Y, divided by X's total imports of P. Two denominators are shown at launch: share of
seaborne imports, and share of all imports. Every such figure is labelled "modelled from 2024 BACI
trade, EIA and IMF PortWatch; not a published statistic". Its assumptions are listed in "why this
number":

- representative ports and shortest-path routing;
- re-exports counted under the declared partner;
- product groups are coarse;
- 2024 routes come before the Red Sea diversion.

**Buffers.**

- World Bank `EG.IMP.CONS.ZS` gives net energy imports as a share of energy use, with its year.
- IEA stock cover gives days of supply, but for IEA members only.
- Stock cover derived from JODI is labelled "estimate". Its licence is unconfirmed, so it waits
  for a check.
- The European gas storage fill (AGSI+) needs a GIE key, so it waits.
- Everywhere else the buffer is `unknown`.

**Prices.** Brent, WTI and EU gas come from FRED keyless CSVs, monthly, with an EIA key as the
fallback. The keyless CSV is undocumented and may change.

**Alternatives.** A hand table of bypass routes (East-West pipeline, Habshan–Fujairah, SUMED, …),
with geometry from Global Energy Monitor once its licence line is confirmed.

### 8.3 Live condition flags (track E, `2026-11-08-world-board-live-feeds.md`)

Each feed sets a dated, sourced status flag on a Condition bar. None of them moves a bar's score.

| Bar | v1 feeds | Example flags | Latency |
|---|---|---|---|
| Governing continuity | Powell and Thyne coups (CSV, weekly check). ElectionGuide calendar (free token, non-commercial). | "Coup attempt reported", "Election within 30 days", "Irregular leader change in last 90 days" | days |
| Security and control | GDELT conflict-coded events (live, noisy, shown as "reported"). UCDP Candidate (monthly, token by email) or the UCDP annual files. | "Armed-conflict events reported, last 7 days: N", "UCDP fatalities last month: N" | 15 min / monthly |
| Essential services | GDACS alerts (keyless, CC BY 4.0, credit GDACS). IODA internet outages (licence to confirm). | "Red disaster alert, N people exposed", "Nationwide internet outage since …" | minutes to hours |
| Household security | IPC phases and WFP market prices via HDX HAPI (monthly). FAO Food Price Index (world banner). IMF CPI monthly. | "IPC Phase 4+ areas", "Food price up N% in 3 months", "Inflation above 20%" | monthly |
| Fiscal and payment continuity | Frankfurter FX (ECB rates, keyless, daily). IMF/World Bank debt-distress list (annual). | "Currency down 20% against USD in 30 days", "In debt distress (year)" | daily / annual |
| Societal cooperation | GDELT protest codes (noisy). UNHCR and HAPI displacement stocks. | "Protest events reported, last 7 days: N", "New large displacement" | 15 min / monthly |

Some things have no open feed: power outages outside Europe, states of emergency, capital
controls, missed bond payments and income. They stay unknown until a reviewed news event sets
them, once news is integrated.

Not in v1:

- ACLED: account and EULA, restricts AI use.
- Cloudflare Radar: CC BY-NC.
- Electricity Maps: personal use only, one zone.
- open.er-api.com: no redistribution.

### 8.4 Relations (track C, `2026-11-08-world-board-assets-relations.md`)

| Relation | v1 source | Licence | Note |
|---|---|---|---|
| Armed conflict (dyads, incl. non-state) | UCDP/PRIO and Dyadic annual files, v26.1, to 2025 | CC BY 4.0 | Bulk download, no token. The 25 battle-deaths-a-year threshold. The current year comes from the live layer. |
| Bloc membership | Wikidata P463 with start and end qualifiers. About 15 blocs checked by hand (NATO, EU, AU, GCC, BRICS, SCO, CSTO, ASEAN, OPEC+…). | CC0 | Quad and AUKUS are not memberships, so they go in the hand table. |
| Alliances and defence pacts | Hand table with treaty citations: what is promised and under what conditions | Own work, CC0 sources | ATOP ends in 2018 and COW in 2012, so they serve as history only. |
| UN voting alignment | Voeten agreement scores and ideal points, v39 (to 2025) | CC0 | Symmetric. The base for the Diplomacy lens's "aligned / opposed". |
| Sanctions | UN Security Council list, UK Sanctions List (OGL v3) and OFAC lists, reduced to imposer → target country per programme | Public / OGL | The EU list needs a registered token, so it comes later. OpenSanctions is CC BY-NC, so it is not used. |
| Diplomatic relations and ruptures | Wikidata P530 as a seed, with ruptures checked by hand | CC0 | Its qualifiers are inconsistent. |
| Territorial disputes | Hand table of about 40 active disputes, using Wikidata P1336 | CC0 | ICOW ends in 2001. |
| Arms supply | Later | — | SIPRI terms bar storing its table in an app. Only cited headline facts until SIPRI gives permission. |
| Foreign troop presence | Hand table of about 100 rows, with sources | Own work | No open all-country dataset exists. |

### 8.5 Assets (track C)

| Asset | v1 source | Licence | Note |
|---|---|---|---|
| Oil and gas fields, pipelines, LNG terminals, power plants | Global Energy Monitor trackers | CC BY 4.0 "unless noted", so each file's About tab must be checked first | Downloads come by emailed link. If any file's licence fails, that type waits. |
| Power plants (fallback) | WRI Global Power Plant Database v1.3 | CC BY 4.0 | Unmaintained, content from about 2021. |
| Nuclear power plants | Wikidata | CC0 | Cleaner than OSM's ODbL. |
| Ports | NGA World Port Index, large harbours | Public domain | Has no owner field. Operators come from Wikidata. |
| Airports | OurAirports, large airports with scheduled service | Public domain | |
| Space launch sites | Wikidata, about 30 sites | CC0 | |
| Military bases | Existing OSM layer for bases at home, plus the foreign-bases hand table | ODbL (existing) / own | |
| Nuclear weapons | FAS Status of World Nuclear Forces: 9 country facts, hand-entered with citation | No stated terms, so only cited facts are entered | Shown as a separate badge, never added into any score. |
| Critical minerals | USGS country production shares (Mineral Commodity Summaries) | US government | No open facility-level dataset exists outside the US and China. |
| Semiconductor fabs | Hand table of about 50 major fabs from company filings | Own work | SEMI's list is paid. |
| Submarine cables | Existing layer | CC BY-NC-SA | Already marked NonCommercial. |

Not in v1:

- data centres and internet exchanges (PeeringDB bars redistribution, and OSM is sparse);
- facility-level mines outside the US and China.

The `canInterrupt` field is editorial. Each entry needs a mechanism, evidence and the label
"hypothesis" or "documented".

### 8.6 People (track D, `2026-11-08-world-board-actors-x.md`)

- **Directory.** A weekly Wikidata SPARQL job collects these roles per country: head of state,
  head of government, foreign minister and defence minister. Militaries, central banks and armed
  groups come from a hand list keyed by Wikidata id.
- **Coverage measured on 2026-11-08.** Of the 191 current heads of government, 53% have an X
  handle (P2002), 98% a portrait (P18), 23% an official website, 6% Telegram and 6% Bluesky
  (P12361). Coverage for foreign and defence ministers is thin.
- **Portraits.** Commons images are shown with their author and licence.
- **Recent posts, v1 (no cost):**
  - inline posts from Bluesky (public API, keyless);
  - YouTube channel RSS and official government RSS;
  - link-out buttons for every account;
  - a "Show X timeline" button that inserts X's official embed for one actor. Sources report it
    may need the viewer to be signed in to X.
- **Paid X reads, later and only if the owner chooses.** X's API is pay-per-use since February
  2026: about $0.005 per post read, with no free read tier. A shortlist of 20–40 actors tied to the
  current situation would cost about $15–90 a month. That needs a spend cap, a 24-hour
  deletion-sync job, and X text kept out of any model prompt.
- **Not used:** scraping x.com, or any Nitter-style mirror.

### 8.7 Licence posture

- v1 is for personal, local, non-commercial use.
- Sources that are NonCommercial, ShareAlike or "no stated licence" are allowed only when marked
  in `sources.json`. They are then listed in `DATA_SOURCES.md` with the same warning the cables
  carry.
- A later "public hosting" check lists every marked source before anything goes public.
- ODbL data (OSM) is kept in its own layer and never merged into the asset catalogue file.

## 9. Claude's jobs

All Claude jobs run headless on the owner's subscription, through the shared Claude adapter and the
one-run slot from PR #15.

- **Estimates.** Per country and indicator, on request. They apply only to indicators that are
  still stale after published current-year estimates (8.1). Two steps, as in Search Layers:
  research with web tools, then a schema-bound map step. Batch "estimate all stale values for this
  country" is allowed, but never across the whole world in one go.
- **Stakes.** Per country, on request. Declared objectives and commitments with labels and
  sources.
- **Turn narrative.** Optional. A short text written from the code's change list.
- **Later: news to events.** This extends the war monitor digest.

## 10. Code layout

- `server/providers/world/`:
  - `sources/<id>.js`: one adapter per dataset;
  - `registry.js`;
  - `scores.js` (pure);
  - `dependencies.js`;
  - `relations.js`;
  - `assets.js`;
  - `events.js`;
  - `actors.js`;
  - `estimates.js`;
  - `turn.js`;
  - `store.js`;
  - `index.js`: routes and the Refresh queue;
  - registration as a new `world-provider` package in `scripts/package-boundaries.json`.
- `src/layers/world/`:
  - lifecycle;
  - country fills;
  - lenses;
  - assets;
  - lines;
  - chokepoints;
  - portraits.
- `src/ui/worldPanel.js`: the character sheet and cards.
- **Voice:** "show Japan's sheet", "colour by energy exposure", "who depends on Hormuz".
- **MCP tools:** later.

## 11. Phases

PR #15 merges first, because the board's Claude jobs share its adapter and slot.

Each phase below is one Codex pull request. Every one is tested by the owner before it merges.

1. **Board foundation:**
   - the world store and indicator registry;
   - adapters for the base sources (8.1);
   - pure scores, Refresh and the turn record;
   - country fills with the Condition, Strength-area and Data age lenses;
   - the character sheet's Strength and Condition sections, with "why this number".

   This phase alone gives the strategy-board look.
2. **Energy and shipping:**
   - chokepoints with live traffic and status;
   - energy dependencies and their lines;
   - the Exposure and Leverage sections, the Energy exposure lens and the chokepoint card.
3. **Relations:**
   - UCDP conflicts, blocs, the alliance table, UN alignment and sanctions;
   - the Diplomacy lens, relation lines and the relation card.
4. **Assets:**
   - asset types that pass their licence check, and the hand tables (fabs, foreign bases, nuclear
     badge);
   - the Ownership lens and the asset card.
5. **People:**
   - the Wikidata directory and portraits on the board;
   - the actor card with free inline posts and the X embed button.
6. **Live condition flags:** the feeds in 8.3.
7. **Claude estimates and stakes:** section 9.

After phase 1, phases 2, 3 and 5 touch mostly separate files and may run in parallel. They meet in
the character sheet, which phase 1 builds with one slot per section.

Hand tables (alliances, disputes, foreign bases, fabs, nuclear) are a research task, not a build
task. Claude or a research sub-agent compiles each one with a source per row. The owner reviews it
before it lands in `public/world/curated/`.

Later: news as an event input (war monitor), an experimental total score, scenario lenses such as
"shipping disruption", a past-day view of the board, and paid X reads.

## 12. Testing

- Pure unit tests for scores, registry validation, dependency arithmetic, the estimate checks and
  the turn diff.
- Adapters are tested with recorded fixtures and never make live calls.
- `scripts/qa-world.mjs --fixtures` covers lenses, the sheet, cards, Refresh, chokepoint status
  and the Diplomacy and Ownership lenses.
- Live checks run on the owner's PC.

## 13. Open points (answered by the owner on 2026-11-08)

The owner accepted all five recommendations.

1. **X.** Start with the free option (8.6). Paid reads are decided later.
2. **Licence posture.** Marked NonCommercial sources are allowed while the app stays personal
   (8.7).
3. **Estimates on the map.** Lenses colour by measured values by default. A toggle adds estimates
   to the map, drawn in their estimate style. The sheet always shows both.
4. **Look.** A design mock in the app's own HUD style comes before phase 1 builds the interface.
   It shows the real globe, taken from the running app, with country colours, lines, chokepoint
   gauges and the character sheet drawn over it. The owner reviews it as an artifact.
5. **Telegram.** Not part of this spec. Telegram's 2026 terms prohibit collecting data for AI
   use, and that affects the war monitor's existing `t.me/s/` collector. It is a separate decision,
   for later.
