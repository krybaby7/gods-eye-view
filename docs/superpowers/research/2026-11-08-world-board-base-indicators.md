# World Board base-layer indicator dictionary (v1 candidates)

Research date: 2026-11-08. Track A.

## Summary

Almost every Strength area and Condition bar can be fed from three keyless, openly licensed APIs: the World Bank Indicators API (CC BY 4.0 by default), the IMF DataMapper API (free reuse with attribution; see caveats) and the UCDP API (CC BY 4.0). World Bank WGI (0-100 scores) covers about 205 economies and is the best single source for governance and stability. IMF DataMapper is the main nowcasting source: it returns current-year (2026) and forward estimates for about 210-214 economies for GDP, inflation, current account and government debt. The real problems are annual lag and stale series. Several WB series stopped or lag by 2-6 years (human capital index 2020, tourism arrivals 2020, LPI 2022/23, liner shipping 2021, renewable electricity share 2021). Condition ("HP") is the weakest side: almost nothing open and global measures "does it work now", so v1 Condition bars lean on slow annual proxies plus two fast feeds (UCDP monthly events, IMF current-year estimates). No open global data exists for military readiness, cyber capability, narrative influence or diplomatic standing (see Gaps). Nuclear warhead numbers exist only as FAS/SIPRI estimates with no explicit open licence; treat as cite-and-link, not bulk-redistribute.

Method notes. "Coverage" figures below for World Bank and IMF series were measured by calling the live APIs on 2026-11-08 (non-aggregate economies with a value in 2018 or later; "n in YYYY" = number of economies with a value for that year). That is firm. Items marked "(snippet)" were seen only in search-result text, not on the primary page. "licence not found" means I did not find a licence statement. Items marked "(not verified)" come from my background knowledge and were not checked this session.

## Access and licence shorthand used in the tables

- **WB-API**: `https://api.worldbank.org/v2/country/all/indicator/<CODE>?format=json&per_page=20000`. Keyless (tested). World Bank datasets are licensed CC BY 4.0 by default (read on datacatalog.worldbank.org/public-licenses). Exceptions: third-party series can carry other licences ("License Specified Externally", ODbL, custom); check the metadata of each series. The general World Bank terms page also says APIs may not be used for commercial purposes, so a public hosted app that earns money should get this checked. Redistribution inside an app with attribution: yes for CC BY series.
- **IMF-DM**: `https://www.imf.org/external/datamapper/api/v1/<CODE>`. Keyless (tested). IMF terms (read): data may be downloaded, copied, adapted and redistributed with attribution "Source: International Monetary Fund, <Database>"; commercial reuse needs permission; automated bulk downloads need explicit permission; using content to train LLMs needs explicit permission; do not alter data in a way that changes its nature, and state any transformation. Practical: fetch a few dozen indicator files a few times a year and cache them.
- **UCDP**: keyless API, all datasets CC BY 4.0 (read).
- Types: S = size, Q = quality/adequacy, E = exposure/vulnerability.

---

## STRENGTH (12 areas)

### S1 Productive economy

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| GDP, PPP (current intl $) | `NY.GDP.MKTP.PP.CD` | World Bank WDI | 200 economies; 186 have 2025 | 2025 partial (n=186), 2024 (n=196); lag 6-12 months | Annual | WB-API keyless | CC BY 4.0; yes | S | PPP basis hides FX power; some countries missing (e.g. no PPP for a few small or sanctioned states). |
| GDP, current US$ | `NY.GDP.MKTP.CD` | World Bank WDI | 213 economies; n=187 in 2025 | 2025 partial, 2024 n=201 | Annual | WB-API keyless | CC BY 4.0; yes | S | Moves with exchange rates, not real capacity. |
| GDP current prices / PPP, incl. 2026-31 estimates | `NGDPD`, `PPPGDP`, `NGDPDPC`, `PPPPC` | IMF WEO via DataMapper | ~218 economies; 2026 n=214 | 2026 current-year estimate, projections to 2031; WEO Apr and Oct | 2x/yr | IMF-DM keyless | IMF terms (attribution; bulk-download permission) | S | Estimates, revised every WEO. Best nowcast base. |
| Manufacturing value added (% GDP) | `NV.IND.MANF.ZS` | World Bank WDI (UN National Accounts) | 195 | 2025 n=132, 2024 n=179 | Annual | WB-API keyless | CC BY 4.0; yes | Q (structure) | Share, not size; high share is not strength per se. |

### S2 Fiscal & financial capacity

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| Total reserves incl. gold (US$) | `FI.RES.TOTL.CD` | World Bank WDI (IMF IFS) | 175; 2025 n=132 | 2025 partial, 2024 n=164 | Annual | WB-API keyless | CC BY 4.0; yes | S | Gold valued at market; ignores sovereign wealth funds (not in reserves). |
| Tax revenue (% GDP) | `GC.TAX.TOTL.GD.ZS` | World Bank WDI (IMF GFS) | 143; 2024 n=93 | 2024 thin, 2023 n=111; 1-2 yr lag | Annual | WB-API keyless | CC BY 4.0; yes | Q | Coverage drops to ~93 for latest year; many fragile states absent. |
| Domestic credit to private sector (% GDP) | `FS.AST.PRVT.GD.ZS` | World Bank WDI | 174; 2024 n=148 | 2024 | Annual | WB-API keyless | CC BY 4.0; yes | S/Q (financial depth) | Depth, not stability. |
| Government gross debt (% GDP) incl. 2026 est. | `GGXWDG_NGDP` | IMF WEO via DataMapper | ~217; 2026 n=210 | 2026 estimate | 2x/yr | IMF-DM keyless | IMF terms | E | Debt is a burden, not a strength: use as Condition input or inverse. |
| Interest payments (% of revenue) | `GC.XPN.INTP.RV.ZS` | World Bank WDI (IMF GFS) | 143; 2024 n=91 | 2024 thin | Annual | WB-API keyless | CC BY 4.0; yes | E | Good stress measure, thin coverage. |

### S3 Government & institutions

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| WGI Government Effectiveness (0-100) | `GOV_WGI_GE.SC` | World Bank WGI, 2025 revision | 205 | API shows 2025 (n=205); revision published Dec 2025 (check which reference year the 2025 label means) | Annual | WB-API keyless | A World Bank listing shows CC BY 4.0 for the 2025 revision (snippet); 2024 was CC BY 3.0 IGO (snippet). Confirm on govindicators.org | Q | Perception-based aggregate of 35 sources; has margins of error. |
| WGI Regulatory Quality (0-100) | `GOV_WGI_RQ.SC` | same | 205 | same | Annual | WB-API keyless | same | Q | Market-friendliness bias. |
| WGI Control of Corruption (0-100) | `GOV_WGI_CC.SC` | same | 207 | same | Annual | WB-API keyless | same | Q | Perceptions. |
| V-Dem Polyarchy / Rule-of-law indices | `v2x_polyarchy`, `v2x_rule` (not verified, check codebook) | V-Dem v16 (March 2026) | 179 countries, data year 2025 | ~3 months lag | Annual | Free download (CSV/R), no key | CC BY-SA 4.0 (read on v-dem.net): share-alike applies to derivatives | Q | ShareAlike may bind any published derived score; keep as optional layer. |

### S4 People & human capital

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| Population, total | `SP.POP.TOTL` | WB (UN WPP etc.) | 218; all have 2025 | 2025 | Annual | WB-API keyless | CC BY 4.0; yes | S | 2025 is an estimate. |
| Life expectancy at birth | `SP.DYN.LE00.IN` | WB (UN WPP, national) | 218 | 2024 | Annual | WB-API keyless | CC BY 4.0; yes | Q | Smooths conflict deaths; lags real shocks. |
| Human Capital Index | `HD.HCI.OVRL` | World Bank | 172 | 2020 only (older 2018) | Irregular | WB-API keyless | CC BY 4.0; yes | Q | Stale. Do not treat as current. |
| Population ages 15-64 (%) / age dependency | `SP.POP.1564.TO.ZS`, `SP.POP.DPND` | WB (UN WPP) | 218 | 2025 | Annual | WB-API keyless | CC BY 4.0; yes | S/Q | Demographic structure only. |
| Learning poverty | `SE.LPV.PRIM` | World Bank/UIS | 96 | 2021 | Irregular | WB-API keyless | CC BY 4.0; yes | Q | Half the world, old. |
| UN World Population Prospects (direct) | n/a | UN DESA | ~237 | WPP 2024 is latest I found; no 2026 revision seen (snippet) | Biennial | Portal; API may need emailed token (snippet) | CC BY 3.0 IGO (snippet; older edition) | S | Prefer WB copy. |

### S5 Society & legitimacy

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| WGI Rule of Law (0-100) | `GOV_WGI_RL.SC` | World Bank WGI | 207 | 2025 label | Annual | WB-API keyless | see S3 | Q | Perception. |
| WGI Voice & Accountability (0-100) | `GOV_WGI_VA.SC` | World Bank WGI | 205 | 2025 label (n=203) | Annual | WB-API keyless | see S3 | Q | Measures regime openness, not support. |
| V-Dem Liberal democracy / civil society indices | e.g. `v2x_libdem`, `v2xcs_ccsi` (not verified) | V-Dem v16 | 179 | 2025 | Annual | Download | CC BY-SA 4.0 | Q | Expert-coded. |
| Gini index | `SI.POV.GINI` | World Bank PIP | 134; 2024 n=26 | 2023 n=60 | Irregular | WB-API keyless | CC BY 4.0; yes | Q | Survey years differ widely; a country's "latest" may be 5+ years old. |

### S6 Military & security

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| Military expenditure (current US$) | `MS.MIL.XPND.CD` | SIPRI via World Bank | 160; 2025 n=151 | 2025 (SIPRI database 1949-2025, revised 27 Apr 2026); lag ~4-5 months | Annual (April) | WB-API keyless | Re-served by WB under CC BY 4.0 (WB listing); SIPRI's own terms: non-commercial with credit, reproduction beyond fair use needs authorisation, commercial licensed. Conflict between the two is unresolved: use SIPRI credit line and ask SIPRI before public hosting | S | Missing: North Korea, Cuba, Eritrea, Syria etc. (not in 151). |
| Military expenditure (% GDP) | `MS.MIL.XPND.GD.ZS` | same | 159; 2025 n=151 | 2025 | Annual | WB-API keyless | same | S/E | Burden, not capability. |
| Armed forces personnel, total | `MS.MIL.TOTL.P1` | WB (IISS Military Balance) | 171 | 2020 only | Stopped | WB-API keyless | CC BY 4.0 per WB; source is IISS (commercial) so redistribution is doubtful | S | Stale; underlying IISS data is paid. Do not rely. |
| SIPRI MILEX database file | n/a | SIPRI | ~170 | 2025 | Annual | Free .xlsx download | See SIPRI terms above | S | Constant-price and share-of-government-spending series live only here. |
| Nuclear warheads | see Nuclear section | FAS / SIPRI | 9 states | 2026 | Annual | web | no explicit licence | S | |

### S7 Energy

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| Energy imports, net (% of energy use) | `EG.IMP.CONS.ZS` | WB (IEA, via WDI) | 143; 2024 n=139 | 2024 | Annual | WB-API keyless | Listed CC BY 4.0 by WB, but underlying IEA data is restricted; confirm in series metadata before shipping | E | Negative = net exporter. |
| Electric power consumption (kWh per capita) | `EG.USE.ELEC.KH.PC` | WB (IEA) | 150; 2025 n=40 | 2024 | Annual | WB-API keyless | as above | S/Q | Same IEA caution. |
| Access to electricity (% pop) | `EG.ELC.ACCS.ZS` | WB (SDG 7) | 216 | 2024 | Annual | WB-API keyless | CC BY 4.0 | Q | Saturated in rich countries. |
| Electricity from oil, gas, coal (% total) | `EG.ELC.FOSL.ZS` | WB (IEA) | 210; 2024 n=147 | 2024 | Annual | WB-API keyless | IEA caution | E | Mix, not security. |
| Renewable electricity share | `EG.ELC.RNEW.ZS` | WB (IEA) | 206 | 2021 | Annual | WB-API keyless | IEA caution | Q | Stale (2021). |
| Energy Institute Statistical Review | n/a | Energy Institute | ~80 countries main series | 2025 data, released 30 Jun 2026 (snippet) | Annual (June) | Free download (site returned 403 to my fetch) | Licence not found; only a "quote with credit" statement for older edition (snippet) | S | Production/reserves/consumption by fuel; best open fuel-level source but reuse terms unconfirmed. |
| EIA International Data | n/a | US EIA | ~220 | ~1-2 yr lag (not verified) | Annual | Free API key (register by email) | US government work, listed as public domain on data.gov (snippet); API terms apply | S | Not tested this session. Fuel-level production, consumption, reserves. |
| IEA data | n/a | IEA | all | n/a | Annual | Paid for most data | Restricted. Do not use beyond what WB re-publishes | S | Flagged as not openly licensed. |

### S8 Food, water & environment

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| Prevalence of undernourishment (%) | `SN.ITK.DEFC.ZS` | FAO SOFI via WB | 169; 2024 n=166 | 2024 (three-year averages) | Annual | WB-API keyless | CC BY 4.0 (FAO databases CC BY 4.0 since 1 Jul 2024, snippet) | Q/E | Three-year average smooths. Missing high-income countries (<2.5% shown as small values). |
| Moderate/severe food insecurity (FIES %) | `SN.ITK.MSFI.ZS` | FAO via WB | 155; 2024 n=135 | 2024 | Annual | WB-API keyless | as above | E | Survey-based. |
| Food production index | `AG.PRD.FOOD.XD` | FAO via WB | 196 | 2024 | Annual | WB-API keyless | as above | S | |
| Food imports (% merchandise imports) | `TM.VAL.FOOD.ZS.UN` | UN Comtrade via WB | 182; 2025 n=103 | 2024 n=138 | Annual | WB-API keyless | CC BY 4.0 | E | Import share is not dependency. |
| Safely managed drinking water | `SH.H2O.SMDW.ZS` | WHO/UNICEF JMP via WB | 150 | 2024 | Annual | WB-API keyless | CC BY 4.0 | Q | |
| Freshwater withdrawals (% internal resources) | `ER.H2O.FWTL.ZS` | FAO AQUASTAT via WB | 178 | 2022 | Annual | WB-API keyless | CC BY 4.0 | E | Ignores transboundary rivers. |
| Renewable internal freshwater per capita | `ER.H2O.INTR.PC` | FAO AQUASTAT via WB | 184 | 2022 | Annual | WB-API keyless | CC BY 4.0 | S | |
| PM2.5 exposure | `EN.ATM.PM25.MC.M3` | WB/State of Global Air | 201 | 2023 | Annual | WB-API keyless | CC BY 4.0 | E | |
| ND-GAIN Country Index | n/a | Univ. Notre Dame | ~182 | latest year not confirmed | Annual | Free download | CC BY per third-party catalogues (snippet); official licence not confirmed | E | Climate vulnerability + readiness. |

### S9 Infrastructure & logistics

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| Logistics Performance Index overall | `LP.LPI.OVRL.XQ` | World Bank | 165 | 2022 n=139 (2023 edition) | ~Biennial | WB-API keyless | CC BY 4.0 | Q | Survey of freight forwarders; 2-year-old. |
| Liner shipping connectivity | `IS.SHP.GCNW.XQ` | UNCTAD via WB | 167 | 2021 | Stopped in WB | WB-API keyless | CC BY 4.0 (check) | Q | Stale in WB; UNCTAD site may be newer (not checked). |
| Air passengers carried | `IS.AIR.PSGR` | ICAO via WB | 164 | 2023 n=150 | Annual | WB-API keyless | CC BY 4.0 (check; ICAO source) | S | Distorted by hubs and COVID. |
| Rail lines (route-km) | `IS.RRS.TOTL.KM` | WB | 79 | 2021 n=65 | Irregular | WB-API keyless | CC BY 4.0 | S | Poor coverage. |
| Paved roads | `IS.ROD.PAVE.ZS` | WB | 0 with data since 2018 | none | n/a | n/a | n/a | n/a | Dead. Do not use. |
| Submarine cables, ports, airports | n/a | existing app layers | n/a | live | n/a | app | OSM/TeleGeography terms (not checked) | S | Derive from the app's own map data. |

### S10 Technology & information

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| Individuals using the Internet (%) | `IT.NET.USER.ZS` | ITU via WB | 192; 2024 n=182 | 2024 (2025 n=10) | Annual | WB-API keyless | WB lists CC BY 4.0; ITU DataHub's own terms say non-commercial reuse with citation (snippet). Conflict unresolved | Q | ITU estimates where no survey. |
| Fixed broadband subs per 100 | `IT.NET.BBND.P2` | ITU via WB | 209 | 2024 n=151 | Annual | WB-API keyless | as above | Q | |
| R&D expenditure (% GDP) | `GB.XPD.RSDV.GD.ZS` | UNESCO UIS via WB | 120; 2024 n=30 | 2023 n=84 | Annual | WB-API keyless | CC BY 4.0 (WB) | S/Q | Many gaps. |
| Researchers per million | `SP.POP.SCIE.RD.P6` | UNESCO UIS via WB | 109 | 2023 n=76 | Annual | WB-API keyless | CC BY 4.0 (WB) | S | |
| Scientific articles | `IP.JRN.ARTC.SC` | NSF via WB | 198 | 2023 | Annual | WB-API keyless | CC BY 4.0 | S | |
| Patent applications, residents | `IP.PAT.RESD` | WIPO via WB | 143 | 2024 n=121 | Annual | WB-API keyless | CC BY 4.0 | S | |
| High-tech exports (% manuf. exports) | `TX.VAL.TECH.MF.ZS` | UN Comtrade via WB | 177 | 2023 n=160 | Annual | WB-API keyless | CC BY 4.0 | Q | |
| Global Innovation Index 2026 | n/a | WIPO | 139 economies | 2026 edition (data 2024-26) | Annual (autumn) | Free download | CC licence stated on report; excludes non-WIPO content (snippet). Dataset licence not found | Q | 139 economies only. |
| ITU Global Cybersecurity Index 2024 | n/a | ITU | 194 | 2024, five tiers (T1-T5), not scores (snippet) | ~Biennial | Free | licence not found | Q | Self-reported legal/organisational readiness; says nothing about real cyber capability. |
| IMF AI Preparedness Index | `AI_PI` | IMF DataMapper | 172 | 2023 only | Static | IMF-DM keyless | IMF terms | Q | One-off. |

### S11 Diplomacy & external access

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| Trade (% GDP) | `NE.TRD.GNFS.ZS` | WB national accounts | 186; 2024 n=172 | 2024 | Annual | WB-API keyless | CC BY 4.0 | S/E | Openness, not influence. Small states look "big". |
| FDI net inflows (% GDP) | `BX.KLT.DINV.WD.GD.ZS` | IMF BoP via WB | 200; 2025 n=185 | 2025 | Annual | WB-API keyless | CC BY 4.0 | Q | Volatile. |
| Applied tariff, weighted mean | `TM.TAX.MRCH.WM.AR.ZS` | WTO/UNCTAD via WB | 181; 2022 n=143 | 2022 | Annual | WB-API keyless | CC BY 4.0 | Q | Old. |
| Net ODA received (% GNI) | `DT.ODA.ODAT.GN.ZS` | OECD DAC via WB | 135 | 2023 | Annual | WB-API keyless | CC BY 4.0 | E | Dependence on donors; recipients only. |
| International migrant stock | `SM.POP.TOTL` | UN DESA via WB | 216 | 2024 | Irregular | WB-API keyless | CC BY 4.0 | S | |
| Alliance membership, UN voting, treaties, bilateral relations | n/a | not a single open dataset | n/a | n/a | n/a | n/a | n/a | n/a | See Gaps. The app's own news/relations data is the realistic source. |

### S12 Cultural & narrative influence

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| IP charges receipts (royalties, licences) | `BX.GSR.ROYL.CD` | IMF BoP via WB | 151; 2025 n=107 | 2024 n=127 | Annual | WB-API keyless | CC BY 4.0 | S | Weak proxy: mostly tech/brand licensing, includes film and music rights. |
| International tourism arrivals | `ST.INT.ARVL` | UN Tourism via WB | 187 | 2020 n=132 (series stalled in WB) | Stopped | WB-API keyless | CC BY 4.0 | S | Stale; use only as a fixed pre-2020 fact. |
| International migrant stock | `SM.POP.TOTL` | UN DESA | 216 | 2024 | Irregular | WB-API keyless | CC BY 4.0 | S | Attraction proxy. |
| Soft-power indices (Brand Finance etc.) | n/a | commercial | ~120 | annual | n/a | report PDFs | Commercial; do not redistribute | Q | Not open. |
| UNESCO World Heritage count, language, media reach | n/a | various | n/a | n/a | n/a | n/a | not checked | S | Possible v2 additions. |

---

## CONDITION (6 bars)

Reminder: none of these are real-time. Annual datasets say how a country looked last year. For "works now" use the app's own news pipeline, UCDP monthly events and IMF current-year estimates.

### C1 Governing continuity

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| WGI Political Stability & Absence of Violence (0-100) | `GOV_WGI_PV.SC` | World Bank WGI | 207 | 2025 label | Annual | WB-API keyless | see S3 | E | Perception of coup/violence risk. |
| WGI Government Effectiveness | `GOV_WGI_GE.SC` | World Bank WGI | 205 | 2025 label | Annual | WB-API keyless | see S3 | Q | Reuse from S3 is OK if bars are allowed to share inputs. |
| V-Dem regime / executive indices | e.g. `v2x_regime`, `v2x_jucon` (not verified) | V-Dem v16 | 179 | 2025 | Annual | Download | CC BY-SA 4.0 | Q | Captures coups at year granularity. |
| OECD States of Fragility (political dimension) | n/a | OECD | 177 contexts | data mostly 2023 (snippet) | Biennial | Request by email for full data (snippet) | licence not found | E | Not open for download. |

### C2 Security & control

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| UCDP Candidate Events (monthly, global) | dataset "Candidate Events" v26.0.9 | Uppsala UCDP | global, events | to Sept 2026, lag <= 1 month | Monthly | Keyless API (ucdp.uu.se/apidocs) | CC BY 4.0; yes | E | Preliminary, can be revised. Fatalities from reported events only. Best fast conflict feed. |
| UCDP GED / Armed Conflict (final) | GED 26.1 | UCDP | global | 1989-2025 | Annual (spring) | Keyless | CC BY 4.0 | E | Authoritative but about 5-9 month lag. |
| Battle-related deaths | `VC.BTL.DETH` | UCDP via WB | 62; 2024 n=42 | 2024 | Annual | WB-API keyless | CC BY 4.0 | E | Only listed countries; absence means zero, not missing. |
| Intentional homicides per 100k | `VC.IHR.PSRC.P5` | UNODC via WB | 149; 2023 n=83 | 2023 | Annual | WB-API keyless | CC BY 4.0 | E | Patchy; recording quality varies. |
| WGI Political Stability | `GOV_WGI_PV.SC` | WGI | 207 | 2025 | Annual | WB-API keyless | see S3 | E | |
| ACLED | n/a | ACLED | ~200 | weekly | Weekly | Account/key; restrictive terms (not verified) | Not open for redistribution (not verified) | E | Flagged: do not rely on it. |
| Global Peace Index | n/a | IEP | 163 | 2026 edition | Annual | Download | CC BY-NC-SA 4.0 per an IEP page; paid licence otherwise (snippet) | E | Non-commercial and share-alike. |

### C3 Essential services

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| Immunization, DPT (% children 12-23 mo) | `SH.IMM.IDPT` | WHO/UNICEF WUENIC via WB | 194 | 2024 | Annual | WB-API keyless | CC BY 4.0 (WB). WHO GHO own licence not found | Q | Good canary: falls quickly when health systems break. |
| Safely managed sanitation | `SH.STA.SMSS.ZS` | JMP via WB | 145 | 2024 | Annual | WB-API keyless | CC BY 4.0 | Q | |
| Safely managed drinking water | `SH.H2O.SMDW.ZS` | JMP via WB | 150 | 2024 | Annual | WB-API keyless | CC BY 4.0 | Q | |
| Access to electricity | `EG.ELC.ACCS.ZS` | WB | 216 | 2024 | Annual | WB-API keyless | CC BY 4.0 | Q | Access, not reliability. No open global outage dataset. |
| Physicians per 1,000 | `SH.MED.PHYS.ZS` | WHO via WB | 181; 2023 n=58 | 2022 n=126 | Annual | WB-API keyless | CC BY 4.0 | S | Patchy latest year. |
| Infant mortality | `SP.DYN.IMRT.IN` | UN IGME via WB | 197 | 2024 | Annual | WB-API keyless | CC BY 4.0 | Q | Modelled. |

### C4 Household security

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| Inflation, average consumer prices (incl. 2026 estimate) | `PCPIPCH` | IMF WEO via DataMapper | 219; 2026 n=213 | 2026 estimate | 2x/yr | IMF-DM keyless | IMF terms | E | Estimate; hyperinflation countries' figures are rough. |
| Inflation, consumer prices (actual) | `FP.CPI.TOTL.ZG` | WB (IMF IFS) | 186; 2025 n=170 | 2025 | Annual | WB-API keyless | CC BY 4.0 | E | Lags a year. |
| Food insecurity (FIES) | `SN.ITK.MSFI.ZS` | FAO via WB | 155 | 2024 | Annual | WB-API keyless | CC BY 4.0 | E | |
| Poverty at $3.00/day (2021 PPP) | `SI.POV.DDAY` | WB PIP | 135; 2024 n=27 | 2023 n=61 | Irregular | WB-API keyless | CC BY 4.0 | E | Survey years sparse; latest often 3+ years old. |
| Youth unemployment | `SL.UEM.1524.ZS` | ILO modelled via WB | 188; 2025 n=183 | 2025 | Annual | WB-API keyless | CC BY 4.0 (WB); ILOSTAT licence not confirmed (snippet claims CC BY 4.0) | E | Modelled estimates, not surveys. |
| Unemployment rate (incl. 2026 est.) | `LUR` | IMF DataMapper | 120; 2026 n=104 | 2026 estimate | 2x/yr | IMF-DM keyless | IMF terms | E | Only 120 economies. |
| WFP HungerMap LIVE, FEWS NET, IPC | n/a | WFP, FEWS NET, IPC | partial | near real time for covered countries | Daily-monthly | not checked | licence not found | E | Possible fast feed for food crises; not evaluated. |

### C5 Fiscal & payment continuity

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| General government gross debt (% GDP) incl. 2026 est. | `GGXWDG_NGDP` | IMF DataMapper | ~217; 2026 n=210 | 2026 estimate | 2x/yr | IMF-DM keyless | IMF terms | E | Debt level does not show liquidity stress. |
| General government net lending/borrowing (% GDP) | `GGXCNL_NGDP` | IMF DataMapper | ~217 (same family) | 2026 estimate | 2x/yr | IMF-DM keyless | IMF terms | E | |
| Current account balance (% GDP) | `BCA_NGDPD` | IMF DataMapper | 219; 2026 n=213 | 2026 estimate | 2x/yr | IMF-DM keyless | IMF terms | E | External financing gap proxy. |
| Reserves in months of imports | `FI.RES.TOTL.MO` | WB (IMF) | 168; 2025 n=113, 2024 n=151 | 2024 | Annual | WB-API keyless | CC BY 4.0 | E | Direct payment-buffer measure; coverage drops in latest year. |
| Total debt service (% exports) | `DT.TDS.DECT.EX.ZS` | WB International Debt Statistics | 117; 2024 n=109 | 2024 | Annual | WB-API keyless | CC BY 4.0 | E | Low- and middle-income only. |
| Short-term debt (% reserves) | `DT.DOD.DSTC.IR.ZS` | WB IDS | 109 | 2024 | Annual | WB-API keyless | CC BY 4.0 | E | LMICs only. |
| IMF Reserve Adequacy (ARA) | `Reserves_STD` etc. | IMF DataMapper | 65 | 2025 | Annual | IMF-DM keyless | IMF terms | E | Only 65. |
| Official exchange rate (LCU/US$) | `PA.NUS.FCRF` | WB (IMF) | 210; 2025 n=194 | 2025 | Annual | WB-API keyless | CC BY 4.0 | E | Use as input to a monthly FX change (see Nowcasting). |

### C6 Societal cooperation

| Indicator | Code | Source | Coverage | Latest year / lag | Freq | Access | Licence / redistribute | Type | Caution |
|---|---|---|---|---|---|---|---|---|---|
| V-Dem political polarization / civil-society indices | e.g. `v2cacamps`, `v2xcs_ccsi` (codes not verified) | V-Dem v16 | 179 | 2025 | Annual | Download | CC BY-SA 4.0 | Q | Expert-coded; best open proxy for social cohesion. |
| UCDP one-sided violence / non-state conflict | datasets 26.1 | UCDP | global | 1989-2025 | Annual | Keyless API | CC BY 4.0 | E | Violence between groups, not cooperation. |
| Intentional homicides | `VC.IHR.PSRC.P5` | UNODC via WB | 149 | 2023 | Annual | WB-API keyless | CC BY 4.0 | E | |
| New internal displacement from conflict | `VC.IDP.NWCV` | IDMC via WB | 65; 2023 n=45 | 2023 | Annual | WB-API keyless | CC BY 4.0 (check IDMC terms) | E | |
| UNHCR refugee/IDP/asylum statistics | `api.unhcr.org/population/v1/` | UNHCR | origin and asylum countries, all | 2024 data (tested; 104 pages of rows) | Annual, mid-year updates | Keyless (tested) | licence not found on the docs page I read | E | Good for displacement stress by country of origin. |
| Gini | `SI.POV.GINI` | World Bank PIP | 134 | 2023 n=60 | Irregular | WB-API keyless | CC BY 4.0 | Q | |
| Fragile States Index | n/a | Fund for Peace | 179 | annual | Annual | Download | "encourages republishing" but no formal licence found (snippet) | E | |

---

## Nowcasting sources

Goal: use published current-year numbers so the app needs Claude less.

1. **IMF WEO current-year estimates via DataMapper** (keyless, tested 2026-11-08). Returned year-by-year values to 2031. For 2026 the number of economies with a value was: GDP current prices (`NGDPD`) 214, real GDP growth (`NGDP_RPCH`) 214, inflation avg (`PCPIPCH`) 213, current account % GDP (`BCA_NGDPD`) 213, gross debt % GDP (`GGXWDG_NGDP`) 210, unemployment (`LUR`) 104. Other WEO codes in the same dataset: `NGDPDPC`, `PPPGDP`, `PPPPC`, `PPPSH`, `PPPEX`, `PCPIEPCH` (end-period inflation), `LP` (population), `BCA`, `GGXCNL_NGDP`. WEO is published April and October (the October 2026 edition was scheduled for 13 Oct 2026 per IMF page, "coming soon" notice (snippet); an October 2026 database appendix PDF exists (snippet)). The DataMapper API does not say which vintage it is serving: record the fetch date, and check the WEO vintage from the IMF page before labelling. January and July WEO updates cover only aggregate/major economies (not verified).
2. **IMF DataMapper other datasets**: Fiscal Monitor (`FM`), Global Debt Database (`GDD`: `GG_DEBT_GDP`, `PS_DEBT_GDP`), Reserve Adequacy (`ARA`), Public Finances in Modern History (`FPP`), Fiscal rules (`FR_FC`), AI Preparedness (`AIPI`). 132 indicators in 13 datasets.
3. **IMF new data portal SDMX API** (`https://api.imf.org/external/sdmx/3.0/structure/dataflow`, keyless dataflow list returned in test). The old IFS is split into topic dataflows: Consumer Price Index (e.g. `CPI_2026_APR_VINTAGE`), Exchange Rates (`ER`), International Liquidity (`IL`), International Reserves and Foreign Currency Liquidity (`IRFCL`), Monetary and Financial Statistics, Production Indexes (`PI_..._MAY_VINTAGE`), Labor Statistics (`LS_...`), International Trade in Goods (`ITG_...`). Monthly series for CPI, FX and reserves live here. I did not work out dimension keys, so this needs a spike. The legacy dataservices.imf.org endpoint was retired effective 5 Nov 2025 (snippet). Some flows may need a key (snippet).
4. **UCDP Candidate Events**: monthly, global, lag <= 1 month, CC BY 4.0, keyless (version 26.0.9 = through Sept 2026). The best nowcast for conflict deaths.
5. **Exchange rates**: Frankfurter (`api.frankfurter.dev`) is keyless, open source, serves ECB reference rates daily; its site claims 239 currencies from 108 central banks and the ECB provider lists 47 (snippet). Gives fast FX moves for most major and many mid-size currencies; not for frontier markets. Licence of the underlying ECB rates not checked.
6. **World Bank Commodity "Pink Sheet"**: monthly prices of 70+ commodities, 1960 to present, published at start of each month (snippet). Useful for energy/food import exposure. Licence not checked.
7. **UNHCR API**: keyless, mid-year and annual refugee/IDP data.
8. **Not found / not usable**: PMI-type surveys (S&P Global PMI is commercial; not verified), central-bank policy rates (no single open API checked), real-time food prices (WFP, not checked). Treat these as Claude-nowcast territory, labelled as estimates.
9. **Rule of thumb**: where WB series for 2025 are already partial (e.g. GDP n=187 of ~215), fill the rest from IMF DataMapper 2025/2026 values and label the source per cell.

## Nuclear

| Source | What it gives | Coverage | Latest | Access | Licence / reuse |
|---|---|---|---|---|---|
| FAS "Status of World Nuclear Forces" (Nuclear Notebook estimates) | Per country: military stockpile and total inventory. Page table (2026): Russia 4,400 / 5,420; US 3,700 / 5,042; France 290 / 370; China 620 / 620; UK 225 / 225; Israel 90 / 90; Pakistan 170 / 170; India 190 / 190; North Korea 60 / 60; global about 9,745 stockpile, 12,187 inventory (page text elsewhere says about 12,321, so the page is internally inconsistent) | 9 states | Early 2026 | Free web page, no API | No Creative Commons or reuse terms found on the page; only "© 2026 Federation of American Scientists". Licence not found. Contact fas@fas.org. |
| SIPRI Yearbook 2026, nuclear forces chapter | Same type of estimate; reported 12,187 total, 9,745 stockpile as of January 2026 (snippet); China 620, India 190, Pakistan 170, North Korea up to 60 (snippet). Includes deployed warheads and delivery systems in the chapter text | 9 states | June 2026 | Yearbook summary free; full chapter and data sold or limited (not verified) | SIPRI general terms (read): non-commercial citation with credit and URL is fine; reproducing data beyond fair use (under 10% of a dataset, non-commercial) needs authorisation; commercial use needs a licence. No nuclear-specific terms. |
| Delivery systems (ICBMs, SLBMs, bombers, launchers) | In FAS Nuclear Notebook articles by country and SIPRI Yearbook tables | 9 states | 2026 | Articles online (Bulletin of the Atomic Scientists); not checked | Licence not found; per-country articles are copyrighted |

Practical rule for v1: store about 9 numbers as hand-curated facts with a visible source and date ("FAS/SIPRI estimate, early 2026"), link to the source page, and do not copy tables wholesale. Ask FAS and SIPRI for permission before public hosting. The two sources differ for Russia and the US (SIPRI reports about 5,450 and about 5,200 in snippets); show both or choose one and say so. Not checked: Arms Control Association, CSIS Missile Threat, IISS (paid), Wikipedia/SIPRI-derived tables.

## Gaps: no open global data

- **Military readiness, order of battle, equipment serviceability, logistics, training**: no open global dataset. IISS Military Balance is paid. Global Firepower is a commercial ranking with undisclosed method. WB `MS.MIL.TOTL.P1` stops at 2020 and is IISS-derived.
- **Cyber capability**: only ITU GCI (tiers, self-reported legal/organisational readiness). No open measure of offensive or defensive capability.
- **Nuclear**: estimates only, nine states, no explicit open licence.
- **Diplomacy**: no single open index of alliances, treaties, UN voting alignment, diplomatic network size or visa-free access (some exist, e.g. Lowy Global Diplomacy Index covers about 66 countries, not verified). Derive from the app's own relations data.
- **Cultural and narrative influence**: soft-power indices are commercial. Open proxies are weak (IP royalties, migrants). UNESCO heritage, media reach and language data not evaluated.
- **Real-time household and service stress**: no global open feed for power outages, bank runs, queues, strikes, price controls. Food crises have partial feeds (FEWS NET, WFP, IPC; licences not checked).
- **Governing continuity as an event**: coups, leader health, cabinet collapse are only in news. Use the news collector.
- **Payment continuity**: arrears, missed coupons and capital controls are not in open datasets; use reserves, debt service and news.
- **Sovereign wealth funds, gold holdings by country, and commodity stockpiles**: gold in WB reserves is aggregated; SWF holdings are commercial (not verified).
- **Licensed-but-not-open**: IEA (mostly paid), IISS, ACLED (restricted terms, not verified), OECD States of Fragility (data on request), Brand Finance.
- **Stale in World Bank API right now**: HCI (2020), tourism arrivals (2020), liner shipping (2021), renewable electricity (2021), military personnel (2020), paved roads (none), learning poverty (mostly 2021).

## Recommended v1 set (one per area or bar)

Rule: keyless or free-key, openly licensed where possible, widest coverage, fewest stale cells.

| # | Area / bar | Pick | Code | Source / access | Coverage | Licence | Why / flag |
|---|---|---|---|---|---|---|---|
| S1 | Productive economy | GDP, PPP (current intl $) | `NY.GDP.MKTP.PP.CD` | WB-API | 200 (186 for 2025) | CC BY 4.0 | Fill current-year gap from IMF `PPPGDP` 2026 estimate. |
| S2 | Fiscal & financial capacity | Total reserves incl. gold (US$) | `FI.RES.TOTL.CD` | WB-API | 175 | CC BY 4.0 | Buffer size. Tax revenue (143) too thin. |
| S3 | Government & institutions | WGI Government Effectiveness 0-100 | `GOV_WGI_GE.SC` | WB-API | 205 | CC BY 4.0 per WB listing (confirm) | Perception-based. |
| S4 | People & human capital | Life expectancy at birth | `SP.DYN.LE00.IN` | WB-API | 218 | CC BY 4.0 | HCI is stale (2020). Show population (`SP.POP.TOTL`) as the size stat. |
| S5 | Society & legitimacy | WGI Rule of Law 0-100 | `GOV_WGI_RL.SC` | WB-API | 207 | as S3 | Avoids V-Dem CC BY-SA. |
| S6 | Military & security | Military expenditure (US$) | `MS.MIL.XPND.CD` | SIPRI via WB-API | 160 (151 for 2025) | CC BY 4.0 via WB; SIPRI terms stricter | Spending is not capability. Ask SIPRI before public hosting. |
| S7 | Energy | Energy imports, net (% of use), inverted | `EG.IMP.CONS.ZS` | IEA-sourced via WB-API | 143 | WB lists CC BY 4.0; IEA origin is a risk | Alternative: EIA production (free key) after a spike; neither tested for redistribution. |
| S8 | Food, water & environment | Prevalence of undernourishment | `SN.ITK.DEFC.ZS` | FAO via WB-API | 169 | CC BY 4.0 | 3-year average. |
| S9 | Infrastructure & logistics | Logistics Performance Index | `LP.LPI.OVRL.XQ` | WB-API | 165 | CC BY 4.0 | 2023 edition; 2-year-old; no better open all-country series. |
| S10 | Technology & information | Internet users (% pop) | `IT.NET.USER.ZS` | ITU via WB-API | 192 | CC BY 4.0 via WB; ITU says non-commercial | Saturates in rich countries; add R&D/patents later. |
| S11 | Diplomacy & external access | Trade (% GDP) | `NE.TRD.GNFS.ZS` | WB-API | 186 | CC BY 4.0 | Weak proxy. Plan to replace with app's relations data. |
| S12 | Cultural & narrative influence | IP charges receipts | `BX.GSR.ROYL.CD` | WB-API | 151 | CC BY 4.0 | Very weak proxy; mark "no open data" on the card. |
| C1 | Governing continuity | WGI Political Stability 0-100 | `GOV_WGI_PV.SC` | WB-API | 207 | as S3 | Annual perception; overlay news-based events. |
| C2 | Security & control | UCDP Candidate Events, last 12 months fatalities | UCDP Candidate Events 26.0.9 | UCDP API, keyless | global | CC BY 4.0 | Monthly, <=1 month lag; the only fast open feed. Preliminary. |
| C3 | Essential services | DTP3 immunization | `SH.IMM.IDPT` | WB-API | 194 | CC BY 4.0 | Annual (2024); a canary, not a live gauge. |
| C4 | Household security | Inflation, avg consumer prices incl. 2026 estimate | `PCPIPCH` | IMF-DM keyless | 219 (213 for 2026) | IMF terms (attribution; bulk-download permission) | Only current-year figure; food insecurity `SN.ITK.MSFI.ZS` as second. |
| C5 | Fiscal & payment continuity | Gross government debt % GDP, 2026 estimate | `GGXWDG_NGDP` | IMF-DM keyless | 217 (210 for 2026) | IMF terms | Add reserves-in-months (`FI.RES.TOTL.MO`, 168) as stress overlay. |
| C6 | Societal cooperation | V-Dem political polarization | `v2cacamps` (verify code) | V-Dem download (no key) | 179 | CC BY-SA 4.0 | Share-alike may apply to derived scores. Fallback with clean licence: `GOV_WGI_VA.SC`. |

Cross-cutting cautions: (1) WB 2025 values are partial (often 100-190 economies); build a "latest available" rule with a year stamp per cell, and mark values older than 2 years as stale. (2) Three picks (S3, S5, C1) come from the same WGI revision; their correlation is high, so avoid presenting them as independent evidence. (3) Confirm the WGI 2025-revision licence on govindicators.org and the SIPRI redistribution terms before any public hosting. (4) IMF terms require permission for automated bulk downloads and for commercial reuse; fine for a personal cached pull.

## Sources

Read (primary page):
- IMF DataMapper indicator list: https://www.imf.org/external/datamapper/api/v1/indicators
- IMF DataMapper API (tested): https://www.imf.org/external/datamapper/api/v1/
- IMF copyright and terms: https://www.imf.org/en/About/copyright-and-terms
- IMF SDMX dataflows (tested): https://api.imf.org/external/sdmx/3.0/structure/dataflow
- World Bank Indicators API (tested): https://api.worldbank.org/v2/
- World Bank dataset licences: https://datacatalog.worldbank.org/public-licenses
- World Bank site terms: https://www.worldbank.org/en/about/legal/terms-of-use-for-datasets
- SIPRI military expenditure database: https://www.sipri.org/databases/milex
- SIPRI terms and conditions: https://www.sipri.org/about/terms-and-conditions
- FAS Status of World Nuclear Forces: https://fas.org/initiative/status-world-nuclear-forces/
- V-Dem dataset page: https://www.v-dem.net/data/the-v-dem-dataset/
- UCDP downloads: https://ucdp.uu.se/downloads/ (API docs: https://ucdp.uu.se/apidocs/)
- UNHCR refugee statistics API (partly read; also queried): https://api.unhcr.org/docs/refugee-statistics.html
- WHO copyright (general, not GHO-specific): https://www.who.int/about/policies/publishing/copyright

Search snippets only:
- IMF WEO October 2026: https://www.imf.org/en/publications/weo/issues/2026/10/13/world-economic-outlook-october-2026 ; https://data.imf.org/datasets/WEO
- WGI 2025 revision: https://datacatalog.worldbank.org/search/dataset/0038026 ; https://www.worldbank.org/en/publication/worldwide-governance-indicators
- V-Dem v16 release: https://v-dem.net/release-statement-for-v16-of-the-v-dem-dataset/
- Energy Institute Statistical Review: https://energyinst.org/exploring-energy/statistical-review (fetch returned 403)
- FAO database terms: https://www.fao.org/contact-us/terms/db-terms-of-use
- ILOSTAT bulk download: https://ilostat.ilo.org/data/bulk/
- UN WPP: https://www.un.org/development/desa/pd/world-population-prospects-2024
- ITU DataHub terms: https://datahub.itu.int/about
- EIA API registration: https://www.eia.gov/opendata/register.php
- WIPO GII 2026: https://www.wipo.int/web-publications/global-innovation-index-2026/en/index.html
- ND-GAIN downloads: https://gain.nd.edu/our-work/country-index/download-data/
- Frankfurter: https://frankfurter.dev
- IMF data and API resource page: https://data.imf.org/en/Resource-Pages/IMF-API
- World Bank Pink Sheet (blog): https://blogs.worldbank.org/opendata/commodity-prices-stabilized-december-pink-sheet
- OECD States of Fragility 2025: https://www.oecd.org/en/publications/states-of-fragility-2025_81982370-en/full-report
- ITU Global Cybersecurity Index 2024: https://www.itu.int/dms_pub/itu-d/opb/hdb/D-HDB-GCI.01-2024-TOC-HTM-E.htm
- IEP data licensing: https://www.economicsandpeace.org/consulting/data-licensing/
- Fragile States Index: https://fragilestatesindex.org/
- SIPRI Yearbook 2026 news coverage: https://brusselssignal.eu/2026/06/states-increasingly-rely-on-nuclear-weapons-as-instruments-of-national-power-sipri-warns/
