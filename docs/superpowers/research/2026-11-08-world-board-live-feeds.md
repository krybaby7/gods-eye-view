# World Board, track E: live and near-live feeds for the Condition bars

Date: 2026-11-08. Scope: feeds beyond energy and shipping. Method: primary docs pages fetched where possible, plus searches. Items seen only in search snippets are marked "(snippet)". Items I could not confirm are marked "UNVERIFIED". No keys were used, no accounts made.

## Summary

- Best keyless, truly live sources: GDACS (disasters, RSS, CC BY 4.0 notice in feed), GDELT (events every 15 min, free use), Frankfurter (FX, daily, keyless), UNHCR statistics API (keyless, but cadence unstated).
- Best near-live but gated: IODA (internet outages, likely keyless, licence unclear), Cloudflare Radar (free token, but CC BY-NC 4.0), UCDP Candidate (monthly, token by email), HDX HAPI (keyless app identifier, but licence per underlying dataset), ReliefWeb (pre-approved appname).
- ACLED is the best conflict and protest feed, but it needs a myACLED account, its tiers limit API access and detail, and its terms restrict AI/LLM use and scraping. A public hosted app should not depend on it without a written permission.
- Weakest areas: power outages (no open global feed; Electricity Maps free tier is single-zone, non-commercial; ENTSO-E is Europe only), governing continuity (only coup datasets and election calendars, no state-of-emergency feed), and sovereign debt distress (annual lists).
- Rule from the owner stays: each feed sets a sourced status flag with a date; none subtracts points on its own.

## Licence reading for a hobby app that may go public later

Personal, local, non-commercial use is permitted by most of these. The traps appear on public hosting: NC licences (Cloudflare, ElectionGuide, Electricity Maps free tier) are fine for a non-commercial public hobby site only if the site stays non-commercial, and "no redistribution" clauses (exchangerate-api, ACLED, FEWS NET third-party data) mean the app should show derived flags with attribution rather than re-serving raw data.

## Table 1: Conflict events

| Source | Measures | Countries | Latency | Access | Licence / display | Caution |
|---|---|---|---|---|---|---|
| UCDP Candidate Events | Georeferenced violent events with deaths, candidate version of GED | Global | Monthly release, "not more than a month's lag" | API token required since Feb 2026, sent as header `x-ucdp-access-token`; request by email to the API maintainer with a short use description (snippet). Bulk CSV on the download page, whether it needs a token is UNVERIFIED | Download page says all datasets CC BY 4.0, cite Hegre et al. 2020 and Hogbladh 2026 | Candidate events may not reach final GED; monthly is too slow for "last hours" |
| ACLED | Coded political violence, protests, riots, strategic developments | Global | Updated weekly (Mon/Tue) per FAQ (snippet); Open tier shows aggregated data, Research+ add API and event detail, possibly lagged (snippet, third party) | myACLED account; key access replaced by login/OAuth (snippet). Tiers: Open, Research, Partner, Enterprise | EULA, Content Usage Terms (updated 8 Jul 2025), Attribution Policy. EULA prohibits scraping. AI/ML/LLM use "subject to strict limitations" (snippet). Display/redistribution rules by tier UNVERIFIED | Weekly edits and deletions. Ask ACLED in writing before any public display |
| GDELT 2.0 Events/GKG | Machine-coded events and themes from news | Global | Every 15 minutes (snippet) | Keyless file feed and BigQuery | Reported as free for any use with citation (snippet; GDELT terms page not read) | Noisy, duplicated, coding errors. Use as a "signal count", never as a fact |

## Table 2: Internet connectivity and shutdowns

| Source | Measures | Countries | Latency | Access | Licence / display | Caution |
|---|---|---|---|---|---|---|
| IODA (Georgia Tech / CAIDA) | Outage signals from BGP, active probing, darknet; country, region, ASN | Global | Minutes to hours | HTTP API v2 exists; my two keyless test calls returned 404 and 400, so exact event paths are UNVERIFIED. No key is mentioned in sources (snippet) | No data licence found. Geolocation uses a commercial provider, which may limit redistribution (snippet). Email CAIDA before public hosting | Detects outages, cannot tell cause (shutdown vs cable cut vs power) |
| Cloudflare Radar | Traffic anomalies, Outage Center entries with location, ASN, cause, duration | Global | Hours | Free API, requires bearer token with Account > Radar read permission (first-request docs). Token creation needs a Cloudflare account | API data CC BY-NC 4.0; charts CC BY 4.0 (docs, About page snippet) | Account needed; NC clause blocks any commercial future |
| Internet Society Pulse shutdown tracker | Government-ordered shutdowns, built on Access Now KeepItOn data and others | Global | Days | Pulse API; raw access requested by emailing pulse@isoc.org (snippet) | No licence found for Pulse or KeepItOn | Listed only when artificial and confirmed by reputable sources, so it lags IODA |

## Table 3: Power outages

| Source | Measures | Countries | Latency | Access | Licence / display | Caution |
|---|---|---|---|---|---|---|
| Electricity Maps | Grid carbon, mix, load | ~global zones | Hourly (snippet) | Free tier: personal key, one zone, ~50 requests/hour, 24h history (snippet, possibly dated) | Free for personal/academic non-commercial, even if hosted, not for use by or for a business (snippet of terms). Commercial from about 4,500 EUR/year per signal (snippet) | Measures mix, not outages. Not a blackout feed |
| ENTSO-E Transparency | Generation, load, unavailability of units/lines | Europe | Minutes to hours | Free token: register, email transparency@entsoe.eu "RESTful API access", approved within ~3 working days; XML; ~400 requests/min (snippet) | Reuse terms not found. UNVERIFIED | Europe only, shows generation unavailability, not household outages |
| NASA Black Marble (VNP46A2/A1) | Night-light radiance, used for blackout mapping | Global | NASA lists daily, under 1 day (snippet, conflicts with a 2021 paper); NASA site notes it is not being updated due to a funding lapse | Free Earthdata account and LAADS download; raster processing | NASA open data, terms not read | Cloud cover, moonlight, heavy processing. Good for validating big blackouts, too heavy for v1 |
| Open national outage maps | Utility outage counts | Few countries (US via utilities, Ukraine via news) | Minutes | Mostly scraped, no standard API | Not assessed | No global source. Treat as gap |

## Table 4: Disasters and humanitarian

| Source | Measures | Countries | Latency | Access | Licence / display | Caution |
|---|---|---|---|---|---|---|
| GDACS | Earthquake, cyclone, flood, volcano, drought alerts with Green/Orange/Red level, population exposed | Global | Minutes to hours | Keyless RSS at gdacs.org/xml/rss.xml. I fetched it: 272 records, generated 8 Nov 2026, with ISO3 and alert fields | Feed channel says "public domain"; each item says European Union CC BY 4.0, credit GDACS. The two statements differ, so credit GDACS to be safe | Alert level is about hazard, not damage |
| ReliefWeb API v2 | Disasters, reports, updates | Global | Hours | `appname` must be pre-approved via a form, reviewed by email | "Anyone may use the ReliefWeb API". Reports may carry third-party rights, respect them | Approval wait; do not republish report text |
| OCHA HDX HAPI | Harmonised conflict events (from ACLED), IPC food security, food prices, refugees, funding, returnees | Many | Varies by theme | No account; generate `app_identifier` with `GET /api/v2/encode_app_identifier` (name + email, base64). I got 403 on docs page via fetch | Not stated; "numerical values unchanged from source", so each underlying dataset licence applies. UNVERIFIED | Beta. HAPI conflict data is ACLED-derived, so ACLED terms may follow it |
| WFP HungerMap LIVE | Near-real-time acute hunger estimates | ~90 countries | Daily (snippet) | Website; no API or terms found | Unknown | Do not scrape. Ask WFP |
| FEWS NET | Food insecurity outlooks and prices | ~30 countries | Monthly | Data Warehouse REST API per user permissions; some data restricted (snippet). Service status in 2026 unconfirmed | Attribution required; no implying endorsement; third-party data may not be redistributed (snippet) | Check the API is still funded and open |
| IPC / IPC-CH | Phase 1-5 food insecurity classification per area | ~30-40 countries | Weeks to months, per analysis | Public API needing a key, docs at docs.api.ipcinfo.org (snippet); also on HDX and HAPI | Terms not found | Use via HAPI to avoid a key |
| UNHCR refugee statistics | Refugee, asylum, IDP, stateless counts | Global | Not stated; historically mid-year and annual updates | Keyless, "no user authentication" (docs page), base `api.unhcr.org/rsq/v1` | Licence not stated on the page | Stocks, not live flows |
| IOM DTM | IDP numbers and displacement events | ~80 countries | Weeks | Personal API subscription key from the DTM portal (snippet); admin-1 level via API | Licence not found; sensitive data needs a data-sharing agreement (snippet) | Key is an account. Prefer HAPI for IDP counts |

## Table 5: Prices and money

| Source | Measures | Countries | Latency | Access | Licence / display | Caution |
|---|---|---|---|---|---|---|
| Frankfurter (frankfurter.dev) | FX rates from 108 central banks and official sources, 219 currencies, history to 1948 | Global | Daily | Keyless, open source, self-hostable; `/v2/rates` with `from`, `to`, `quotes` | Blended rates free incl. commercial; provider endpoints follow each provider's terms | Many frontier currencies missing or official-rate only; black-market gaps hide real stress |
| open.er-api.com | FX | ~160 | Daily | Keyless | Attribution link required; cache allowed; no redistribution; rate-limit ban 20 min | Redistribution ban conflicts with serving rates to other users |
| ECB reference rates | EUR vs ~30 currencies | ~30 | Daily | Keyless | Not read | Too few currencies for this use; Frankfurter covers it |
| IMF CPI (new SDMX 3.0 portal, data.imf.org) | Monthly CPI | ~190 | Monthly, 1-3 month lag | Old dataservices endpoint reportedly retired in 2025 (snippet, secondary); some dataflows need optional key (snippet) | Terms not found | Verify endpoint before building |
| World Bank API | Annual/ monthly indicators | Global | Annual mostly | Keyless (not re-verified this session) | CC BY 4.0 normally (not re-verified) | Too slow for live |
| BIS data portal | Central bank policy rates, credit, FX | ~40-60 economies | Monthly to daily | SDMX REST, reported keyless (snippet, third party); policy rate dataset not confirmed | BIS "Terms of permitted use of BIS statistics" apply; full clauses unread | Limited coverage; read terms before public use |
| FAO Food Price Index | World food commodity price index | Global (not per country) | Monthly: 2 Oct, 6 Nov released, next 4 Dec 2026 (snippet) | Public page and download | Terms not found | Global index, so it informs a world banner, not a country bar |
| WFP market prices (VAM) on HDX | Retail food prices, ~1,500 markets | ~76-78 countries | Monthly (snippet) | HDX CSV; also HAPI | Licence field not read | Coverage only in aid-monitored countries |
| IMF/World Bank DSA lists | Debt distress rating: low, moderate, high, in distress | 69 low-income countries plus Guyana | Annual per country (snippet) | Documents, no feed | Not read | No default tracker found. Treat as annual status |
| Fuel price trackers | Pump prices | Mixed | Weekly | No open global API found | n/a | Gap |

## Table 6: Governing continuity

| Source | Measures | Countries | Latency | Access | Licence / display | Caution |
|---|---|---|---|---|---|---|
| Powell and Thyne coups | Coup attempts and outcomes | Global | Updated continuously; a Niger attempt was added 29 Aug 2026 (snippet from Powell's site) | Web CSV on author sites | Not stated | Manual maintenance by two academics, bus factor |
| Cline Center Coup d'Etat project | Coups and attempts | Global | Revised Feb 2026 (snippet) | Illinois Data Bank | Not read | Slower, annual-ish |
| REIGN | Leaders and irregular changes | Global | Unknown | Not found | Not found | Could not confirm it is maintained. Do not rely on it |
| IFES ElectionGuide | Election calendar and results | Global | Daily-ish | API token via Data Access Request Form | Non-commercial free with attribution; commercial needs a licence; surveillance, targeted influence and predictive markets banned (snippet of use policy); modified data must be labelled | Token request needed; also shows what NOT to build (no prediction market features) |
| State-of-emergency trackers | Declared emergencies | n/a | n/a | No open global feed found | n/a | Gap. Use GDELT and ReliefWeb text with sourcing |

## Table 7: Unrest

| Source | Measures | Countries | Latency | Access | Licence / display | Caution |
|---|---|---|---|---|---|---|
| ACLED protests/riots | Protest and riot events | Global | Weekly | See Table 1 | See Table 1 | Best coverage, strictest terms |
| Carnegie Global Protest Tracker | Major anti-government protests since 2017 | Global | Page last updated 9 Dec 2025 (snippet), so it looks stale | Web page; download and licence not found | Unknown | Do not use for live; stale |
| Mass Mobilization | Protest dataset | Global | Annual, historical | Download | Not checked | Historical only |
| GDELT protest codes (CAMEO 14) | News-coded protests | Global | 15 min | Keyless | See Table 1 | Noisy |

## Table 8: Sanctions

| Source | Measures | Latency | Access | Caution |
|---|---|---|---|---|
| OFAC recent actions | US designations | Same day | The RSS feed was retired on 31 Jan 2025; updates go by email subscription only (snippet). Machine-readable SDN files exist but were not checked | Do not plan on an RSS feed |
| EU sanctions, UK OFSI | Designations | Same day | No feed confirmed. UNVERIFIED | Sanctions are a status flag for governing/fiscal bars, low priority |

## Per-bar proposal

### 1. Governing continuity
- (a) v1: ElectionGuide calendar (token, free non-commercial) for scheduled events; Powell and Thyne coup CSV for coup attempts (check weekly); GDELT keyword counts as a "watch" signal only.
- (b) Flags: "Coup attempt reported, date, outcome pending" (Powell and Thyne); "Election within 30 days" (ElectionGuide); "Irregular leader change in last 90 days" (coup data); optional "Sanctions action on government, date".
- (c) Gap: no feed for state of emergency, martial law, leader death or incapacity, or government collapse. Those need a human-reviewed news item with a link.

### 2. Security and control
- (a) v1: GDELT conflict-coded events (live), UCDP Candidate (monthly, depth); ACLED only after written clearance for display.
- (b) Flags: "Armed conflict events in last 7 days: N (GDELT, low confidence)"; "UCDP-recorded fatalities, last month: N"; "Active war per UCDP list". Show GDELT counts as "reported", never as fatalities.
- (c) Gap: territorial control and state capacity have no feed.

### 3. Essential services
- (a) v1: IODA or Cloudflare Radar for internet; GDACS for disaster damage; ENTSO-E for Europe grid unavailability only.
- (b) Flags: "Nationwide internet outage in progress (IODA, started time)"; "Government-ordered shutdown (Pulse/KeepItOn, date)"; "Red GDACS alert, population exposed N"; "Major generation unit outage, Europe (ENTSO-E)".
- (c) Gap: electricity, water, health, and transport outages outside Europe have no open global feed. Black Marble can validate blackouts after the fact but is heavy.

### 4. Household security
- (a) v1: IPC phase through HAPI; WFP market prices through HAPI/HDX (monthly); FAO Food Price Index as a world banner; IMF CPI monthly if the new endpoint works; HungerMap if WFP allows.
- (b) Flags: "IPC Phase 4+ areas (analysis date)"; "Food price rise N percent over 3 months in a monitored market"; "Inflation above 20 percent year over year (IMF CPI, month)"; "World food price index up/down".
- (c) Gap: incomes and fuel prices have no open feed.

### 5. Fiscal and payment continuity
- (a) v1: Frankfurter FX (daily); IMF/World Bank DSA list as annual status; BIS policy rates if terms allow.
- (b) Flags: "Currency down 20 percent vs USD in 30 days (Frankfurter, dates)"; "IMF DSA: in debt distress (year)"; "Policy rate change (BIS)".
- (c) Gap: capital controls, payment restrictions, reserves, and missed bond payments have no feed. Parallel-market rates are invisible. A sovereign default tracker was not found.

### 6. Societal cooperation
- (a) v1: GDELT protest and violence codes (live, noisy); ACLED if cleared; UNHCR/HAPI for displacement stocks; IODA for shutdowns as a protest correlate.
- (b) Flags: "Protest events reported in last 7 days: N (GDELT)"; "Government-ordered internet shutdown (Pulse, date)"; "New large displacement (HAPI/DTM)".
- (c) Gap: Carnegie tracker looks stale; no open real-time protest count with a clear display licence.

## Licence traps

1. ACLED: account required, tiers decide API and detail, EULA bans scraping, AI/LLM use limited (snippet). Display rules unread. HAPI conflict data derives from ACLED, so the same terms may apply downstream. Get written clearance first.
2. Cloudflare Radar: CC BY-NC 4.0 for API data. A public hobby site must stay non-commercial, with no ads or paid tier.
3. exchangerate-api (open.er-api.com): attribution link required and no redistribution of the data.
4. Electricity Maps free tier: personal or academic non-commercial only, one zone; commercial price is thousands of euros per year.
5. ElectionGuide: non-commercial free, commercial needs a licence, and some uses (surveillance, targeted influence, predictive markets) are banned outright.
6. UCDP: CC BY 4.0 is permissive, but the API token is by email request and revocable.
7. FEWS NET: third-party data may not be redistributed; attribution required; no implied endorsement.
8. IODA and Pulse/KeepItOn: no stated data licence found, so "free to call" does not mean "free to republish". Ask.
9. GDACS: feed header says public domain but items say CC BY 4.0. Credit GDACS.
10. IOM DTM and IPC: keys come with accounts and unread terms. Use HAPI where possible, but HAPI states no licence of its own.
11. OFAC: RSS retired. Any older guide pointing to it is wrong.

## Sources

- UCDP downloads: https://ucdp.uu.se/downloads/
- UCDP API docs: https://ucdp.uu.se/apidocs/
- ACLED terms: https://acleddata.com/terms-of-use/
- ACLED content usage: https://acleddata.com/contentusage
- myACLED FAQ: https://acleddata.com/myacled-faqs
- ACLED API getting started: https://acleddata.com/api-documentation/getting-started
- ACLED keeping data updated: https://acleddata.com/methodology/keeping-acled-data-updated
- IODA API v2: https://api.ioda.inetintel.cc.gatech.edu/v2/
- IODA API code: https://github.com/InetIntel/ioda-api
- IODA project summary: https://www.caida.org/funding/ioda/summary/
- Cloudflare Radar: https://developers.cloudflare.com/radar/
- Radar first request: https://developers.cloudflare.com/radar/get-started/first-request/
- Radar outages: https://developers.cloudflare.com/radar/investigate/outages/
- Radar About: https://radar.cloudflare.com/about
- ISOC Pulse methodology: https://pulse.internetsociety.org/pulse-shutdown-tracker-methodology/
- Electricity Maps free tier: https://electricitymaps.com/free-tier
- Electricity Maps terms: https://help.electricitymaps.com/en/articles/11750446-terms-of-service
- ENTSO-E token help: https://transparencyplatform.zendesk.com/hc/en-us/articles/12845911031188
- NASA Black Marble access tools: https://www.earthdata.nasa.gov/data/projects/black-marble/data-access-tools
- GDACS RSS: https://www.gdacs.org/xml/rss.xml
- ReliefWeb API: https://apidoc.reliefweb.int/
- HAPI intro: https://docs.humdata.org/build/hdx-apis/hapi
- HAPI app identifier: https://docs.humdata.org/build/hdx-apis/hapi/api-reference/generate-app-identifier
- HungerMap LIVE: https://www.wfp.org/news/wfp-releases-hungermap-live-modernized-intelligence-platform-turns-data-global-hunger-early
- FEWS NET API: https://help.fews.net/fdw/fews-net-api
- FEWS NET data policy: https://help.fews.net/fdp/data-and-information-use-and-attribution-policy
- IPC via HDX docs: https://docs.humdata.org/about/hdx-signals/datasets/food-insecurity
- UNHCR API: https://api.unhcr.org/docs/
- DTM API docs: https://dtmapi.readthedocs.io/en/latest/
- Frankfurter: https://frankfurter.dev/docs/
- ExchangeRate-API free: https://www.exchangerate-api.com/docs/free
- BIS terms: https://www.bis.org/terms_statistics.htm
- BIS data portal legal: https://data.bis.org/help/legal
- FAO Food Price Index: https://www.fao.org/worldfoodsituation/FoodPricesIndex/en
- FAO upcoming releases: https://www.fao.org/statistics/data-releases/upcoming-data-releases/
- WFP food prices on HDX: https://data.humdata.org/dataset/global-wfp-food-prices
- IMF DSF factsheet: https://www.imf.org/en/About/Factsheets/Sheets/2023/IMF-World-Bank-debt-sustainability-framework-for-low-income-countries
- IMF data (SDMX 3.0 portal) usage via R vignette: https://cran.ms.unimelb.edu.au/web/packages/imf.data/vignettes/getting-started.html
- Carnegie Global Protest Tracker: https://carnegieendowment.org/features/global-protest-tracker
- Powell coups: https://jonathanmpowell.com/coups
- Thyne coup data: https://www.uky.edu/~clthyn2/coup_data/home.htm
- ElectionGuide use policy: https://electionguide.org/p/use
- ElectionGuide access: https://electionguide.org/p/access/
- OFAC RSS retirement notice: https://content.govdelivery.com/accounts/USTREAS/bulletins/3d0ca66
- GDELT terms (not read directly): https://www.gdeltproject.org/about.html#termsofuse
