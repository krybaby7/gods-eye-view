# World Board data sources: assets and relations (track C)

Date: 2026-11-08. Method: primary pages fetched where possible. "(snippet)" means seen only in a search result summary. "(not stated)" means the primary page did not state it. "(knowledge)" means from general knowledge, not checked this session. No accounts were registered and no data files were downloaded, so field lists below are partly unverified.

## Summary

- Open, keyless, redistributable data exists for: airports (OurAirports), ports (NGA World Port Index), power plants (WRI GPPD, stale), sanctions lists (OFAC, UN, UK; EU needs a token), UN voting alignment (Voeten, CC0), armed conflict dyads (UCDP, CC BY 4.0), and everything Wikidata (CC0) and OpenStreetMap (ODbL) can supply.
- Global Energy Monitor (GEM) is the best source for oil and gas, pipelines, LNG, coal and power, and is generally CC BY 4.0 (snippet, GEM site), but downloads go through an emailed link (snippet) and some trackers carry other licences. Check each download's "About" tab.
- Several sources the owner may expect are NOT freely reusable in a public app: SIPRI (commercial use needs a licence; reproduction beyond fair use needs permission), OpenSanctions (CC BY-NC 4.0), PeeringDB (no bulk passing-on), ACLED (account plus EULA), SEMI fab lists (paid), TeleGeography cable data (non-commercial or paid; licence text is inconsistent between old repo and current site).
- No open global database of semiconductor fabs, critical-mineral mines and refineries, data centres, foreign troop deployments, or arms transfers (at event level) was found that is both global and openly licensed. These need Wikidata/OSM hand-curation or must wait.
- Alliance data is old: ATOP 5.1 ends 2018, COW formal alliances ends 2012. Current treaties and bloc membership must come from Wikidata (P463) plus a small hand-maintained table.

## Assets

Columns: source; covers; latest and frequency; access; licence and in-app redistribution; owner/operator identification; caution.

| Asset type | Source | Covers | Latest / frequency | Access | Licence / redistribution | Owner / operator | Caution |
|---|---|---|---|---|---|---|---|
| Oil and gas fields | GEM Global Oil and Gas Extraction Tracker | Fields, production, reserves, ownership | March 2026 release (fetched) | .xls file via download page; whether a form is required not stated | Page states no licence (fetched). GEM generally CC BY 4.0 (snippet). Confirm in file's About tab | "Ownership" mentioned; operator field not confirmed | Licence not on the tracker page; verify in the file |
| Pipelines (gas) | GEM Global Gas Infrastructure Tracker | Gas transmission pipelines | Nov 2025 (fetched) | Download button; emailed link (snippet) | Page shows "All Rights Reserved" copyright and no licence (fetched); CC BY 4.0 general statement (snippet) | Owner summary views and ownership chain supplement exist | Conflicting signals: copyright footer vs CC BY statement. Ask GEM or check file |
| Pipelines (oil, NGL) | GEM Oil and NGL Pipelines Tracker | 52 fields per API catalogue (fetched) | not stated | Public metadata endpoint exists at api.globalenergymonitor.org (fetched); data key requirement not stated | Not stated | Not stated | API is undocumented here; do not build on it yet |
| LNG terminals | GEM Global Gas Infrastructure Tracker | Import and export terminals | Oct 2026 (fetched) | As above | As above | As above | As above |
| Power plants (incl. coal, gas, oil) | GEM Global Integrated Power Tracker and per-fuel trackers | Eight power trackers combined | Coal tracker July 2026 (snippet) | Download page exists; emailed link (snippet) | CC BY 4.0 generally (snippet) | Owner/parent fields likely, not verified | Nuclear tracker: no release or download details found |
| Power plants (global, static) | WRI Global Power Plant Database v1.3.0 | Plants with fuel, capacity, coordinates, owner | Dataset page: updated 6 Oct 2025 (fetched); GitHub README says not maintained, no planned updates (snippet) | Zip and layer download | CC BY 4.0 (snippet; the dataset page itself states none) | Owner field exists (knowledge); not shown on page | Data is old (about 2021 content); use only as fallback for countries GEM covers worse |
| Nuclear power plants | OpenStreetMap (power=plant, plant:source=nuclear) or Wikidata; IAEA PRIS (not checked) | Reactors | continuous | Overpass API keyless; Wikidata SPARQL keyless | ODbL (OSM, fetched): attribution plus share-alike on derived database. Wikidata CC0 (fetched) | OSM operator tag; Wikidata P127/P137 | OSM tagging inconsistent. Wikidata is the cleaner licence |
| Nuclear weapons holdings | FAS Status of World Nuclear Forces | Warheads by 9 countries, early 2026 | Annual (fetched). Page byline date and text conflict | Web page only, no download | No licence or reuse terms stated (fetched) | Country level | Treat as facts with citation; do not copy tables wholesale. Page totals are internally inconsistent (about 12,187 vs 12,321) |
| Critical-mineral mines and plants | USGS | US facilities dataset (over 800 sites, 60+ commodities), 2026, CC0 (snippet); China geodatabase OFR 2026-1018 with 932 mines and 1,506 processing plants (snippet); global production maps FS 2025-3038 are country-level only (snippet) | 2026 | ScienceBase download, keyless | USGS data is US government; US facilities set marked CC0 (snippet) | Company names in attributes (not verified) | No global facility dataset found. Country production shares (Minerals Yearbook, USGS Mineral Commodity Summaries) are the realistic global layer |
| Semiconductor fabs | SEMI World Fab Watch (paid); Wikidata (hand-curated) | 1000+ fabs (SEMI, snippet) | n/a | Paid | Market Intelligence License Agreement; $2,600 to $6,250 (snippet) | n/a | No open fab database found. Hand-curate about 50 major fabs (TSMC, Samsung, Intel, SMIC, GlobalFoundries, etc.) from company filings |
| Major ports | NGA World Port Index (Pub 150) | Ports worldwide | Edition not confirmed; NGA page returned 503 | Download tool: CSV, JSON, Shapefile, GeoPackage (snippet) | US government work, public domain (snippet via Wikipedia) | Port level only; no owner/operator | Port operator (DP World, COSCO, etc.) must come from Wikidata or hand-curation |
| Airports | OurAirports | Airports, runways, navaids, countries | "Updated daily" (fetched) | CSV, keyless | Public domain, no guarantee, credit appreciated not required (snippet of official page; the data page fetch failed on a certificate error and the GitHub page did not state a licence) | None (no owner/operator) | Includes small strips; filter by type and scheduled service |
| Military bases (inside own country) | OpenStreetMap landuse=military / military=base | Already in the app via OpenFreeMap | continuous | Existing | ODbL | Operator tag sparse | Already available |
| Foreign bases / troop presence | US DMDC personnel by country (redirect only, not read); Wikipedia lists; Wikidata | US only from DMDC | Quarterly (knowledge) | Web reports | US government (knowledge) | Host and sending country | DMDC page could not be read; no open all-country dataset found. Hand-curate |
| Space launch sites | Wikidata (spaceport items); OSM | about 30 active sites | continuous | SPARQL | CC0 / ODbL | P127/P137 | Small list; hand-curate and use Wikidata for coordinates |
| Undersea cables and landing points | TeleGeography Submarine Cable Map | Cables, landing points, owners | continuous | Old GitHub repo (404 now); live site JSON (snippet) | Old repo CC BY-NC-SA 3.0 (snippet of mirrors); current licensing page mentions CC BY-SA 4.0 for map references (snippet); raw geocoded data sold commercially | Owners listed per cable (knowledge) | The app already uses it. NonCommercial plus ShareAlike conflicts with any future public/commercial hosting. Licence terms unclear; ask TeleGeography |
| Data centres, internet exchanges | PeeringDB | IXes, facilities, networks | continuous | API (key requirement not stated) | AUP: no bulk passing-on without approval; downloads only for "Internet operational issues" (fetched) | Facility/org records | Do not republish in a public app without written approval |
| Data centres (alternative) | OSM telecom=data_center; Wikidata | partial | continuous | keyless | ODbL / CC0 | Sparse | Patchy but licence-clean |

## Relations

| Relation type | Source | Covers | Latest / frequency | Access | Licence / redistribution | Direction | Caution |
|---|---|---|---|---|---|---|---|
| Armed conflict dyads, armed groups | UCDP Dyadic Dataset, UCDP/PRIO Armed Conflict, Non-State | Dyads 1946 to 2025; non-state 1989 to 2025 (fetched) | Version 26.1, annual with candidate updates (fetched) | CSV/zip download; API needs token sent in header `x-ucdp-access-token`, 5,000 requests/day (fetched) | CC BY 4.0 (fetched); cite listed publications | Dyad has side A and side B, with government vs rebel coded | Use annual files, not the API, to avoid the token. Threshold of 25 battle deaths per year |
| Event-level conflict | ACLED | Events | weekly | Account plus API | EULA, Content Usage Terms and Attribution Policy apply (fetched, terms not read in detail) | Actor 1 vs Actor 2 | Needs account (not registered) and likely restricts redistribution. Do not use in v1 |
| Alliances (historical) | ATOP 5.1 | 1815 to 2018 (fetched) | Dormant | CSV, Stata | Licence not stated | Treaty members, obligation type (defence, offence, neutrality, non-aggression, consultation) | Ends 2018. Misses AUKUS, post-2018 pacts |
| Alliances (historical) | COW Formal Alliances v4.1 | 1816 to 2012 (fetched) | Dormant | CSV zip | Licence not stated; asks citation | Treaty members | Ends 2012 |
| Bloc membership | Wikidata P463 "member of" with start/end qualifiers; also P1344 | NATO, EU, AU, GCC, BRICS, SCO etc. | continuous | SPARQL keyless | CC0 (fetched) | Country to organisation | Quality varies for CSTO/Quad/AUKUS; verify against founding documents. Quad and AUKUS are not formal memberships |
| Sanctions regimes | OFAC SDN and consolidated | US designations | frequent | Sanctions List Service; flat-file formats mentioned; keyless not stated (fetched) | US government; licence not stated | Imposer = US; target in entry | Entries are persons and entities, not country-to-country. Need programme-to-country mapping |
| Sanctions | UN Security Council consolidated list | UN regimes | frequent | XML, keyless (the URL returned a signed download redirect without login, fetched) | Not stated | Imposer = UN | Same as above |
| Sanctions | UK Sanctions List (replaced OFSI list on 28 Jan 2026) | UK designations | several updates per month, latest 3 Nov 2026 (fetched) | ODS, XML, CSV, HTML, PDF; XSD schema | Open Government Licence v3.0 (fetched) | Imposer = UK | OFSI Consolidated List is closed |
| Sanctions | EU Financial Sanctions Files | EU designations | daily-ish | XML, CSV; URL has a token tied to a registered user (snippet); an unverified public token claim exists (snippet) | Not verified | Imposer = EU | Registration needed unless a mirror is used |
| Sanctions (aggregated) | OpenSanctions | All of the above, normalised | daily | Bulk download, no login (fetched) | CC BY-NC 4.0; commercial use needs paid licence (fetched) | Per dataset | NonCommercial: fine for personal local use, blocks public commercial hosting without licence |
| Arms transfers | SIPRI Arms Transfers Database | 1950 to 2025, updated 9 March 2026 (fetched) | Annual | Web query tool at armstransfers.sipri.org; no bulk download described (fetched) | Fair use only: non-commercial, under 10% of a data set; commercial use needs a licence; "ad-supported websites" and "internal business tools" count as commercial (fetched) | Supplier to recipient | Cannot store the whole supplier-recipient table in an app. Cite single facts only, or ask SIPRI for permission |
| Diplomatic alignment | Voeten UN General Assembly Ideal Points (Harvard Dataverse) | Ideal points to 2024 or 2025, calendar-year basis, dyad agreement scores to 2025 (fetched) | Version 39, 30 July 2026 (fetched) | Files download keyless | CC0 1.0 (fetched) | Symmetric (agreement score between two countries) | Best open alignment signal. Ideal points are one-dimensional and reflect UN votes only |
| Territorial disputes | ICOW Territorial Claims | World, 1816 to 2001, 843 claims (snippet) | Dormant, "provisional version 1.01" (snippet) | zip at paulhensel.org (not fetched; connection refused) | Not verified | Claimant vs target | Ends 2001. Current disputes need Wikidata (P1336 territory claimed by) or hand-curation |
| Diplomatic relations / ruptures | Wikidata P530 "diplomatic relation" | Pairs of states | continuous | SPARQL keyless | CC0 | Symmetric | Qualifiers for ruptures and restorations are inconsistent. Treat as seed; hand-curate ruptures |
| Foreign troop presence | See foreign bases above | | | | | Sender to host | Hand-curated |

## Proposed schemas

Principle: separate the five questions about an asset. They are different facts, held in different fields, with different evidence.

### Asset record

```
asset {
  id            string   stable, e.g. "ast:gem-oil-field-1234" or "ast:wd-Q12345"
  type          enum     oil_gas_field | refinery | lng_terminal | pipeline | power_plant | nuclear_plant |
                         mine | mineral_processing | fab | port | airport | military_base | spaceport |
                         cable | cable_landing | data_centre | ixp
  name          string
  geometry      point | line | polygon   (lon/lat, WGS84)
  capacity      { value:number, unit:string, commodity:string, as_of:date }   optional
  status        enum     operating | construction | proposed | retired | unknown
  located_in    countryCode (ISO 3166-1 alpha-2)   -- jurisdiction the asset physically sits in; pipelines/cables: list
  owned_by      [ { entity_id, share_pct?, from?, to? } ]     -- who holds title or equity
  operated_by   [ { entity_id, from?, to? } ]                 -- who runs it day to day
  regulated_by  [ { entity_id } ]                              -- permitting/licensing authority (usually the host state)
  can_interrupt [ { actor_id, mechanism, note } ]              -- who could shut or block it:
                                                               --  host_state_licence | owner_state | export_control |
                                                               --  sanctions | chokepoint_control | military_force
  evidence      [ { source_id, url, retrieved, licence, field_confidence } ]
  updated       date
}
entity { id, name, kind: state|company|state_owned_company|armed_group|org, home_country, wikidata_qid? }
```

Notes: "located in" is geography; "owned by" is title; "operated by" is management; "regulated by" is the legal authority; "can interrupt" is a judgement, so it needs its own mechanism and evidence and should be marked as editorial. A state-owned company with home country X in country Y is the usual source of dependency lines.

For military bases add `host_country`, `sending_country`, `basis` (treaty, lease, occupation) and `troops` (count and as_of).

### Relation record

```
relation {
  id            string
  type          enum   alliance | defence_pact | bloc_membership | armed_conflict | sanctions |
                       arms_transfer | alignment | territorial_dispute | diplomatic_rupture | troop_presence
  subject       entity_id      -- the actor that does the thing (imposer, supplier, sender, claimant, side A)
  object        entity_id      -- the actor it is done to (target, recipient, host, target, side B)
  directed      boolean        -- false for alliance, alignment, dispute pairs
  start         date  (precision: year|month|day)
  end           date | null    (null = ongoing)
  intensity     { value, unit }   optional: treaty obligation, battle deaths, TIV, agreement score, troop count
  detail        { programme?, instrument?, treaty_name? }
  evidence      [ { source_id, url, retrieved, licence, quote_or_id } ]
  confidence    enum   high | medium | low
}
```

Bloc membership is modelled as `bloc_membership` where subject is a country and object is the bloc entity (bloc is an `entity` of kind org).

## Realistic for v1 / later

### Realistic for v1 with open data

Assets:
- Airports: OurAirports (public domain), filtered to large and medium with scheduled service.
- Ports: NGA World Port Index (public domain, snippet), large harbours only. Operators added from Wikidata.
- Power plants including nuclear: GEM Integrated Power Tracker (CC BY 4.0, snippet) as primary, WRI GPPD as fallback. If GEM's emailed-link download is a problem, use OSM/Wikidata for nuclear only.
- Oil and gas fields, pipelines, LNG terminals: GEM, subject to confirming the licence in the downloaded file.
- Military bases: already in the app from OSM; add a small hand-curated foreign-bases table (about 100 rows).
- Nuclear weapons: FAS numbers for 9 countries, hand-entered with citation (a handful of facts).
- Cables: keep the current layer, but flag the licence before any public hosting.
- Mines/processing: country-level production shares from USGS Mineral Commodity Summaries (not facility level); optionally the US and China USGS facility sets.

Relations:
- Armed conflicts: UCDP annual files (CC BY 4.0), include non-state actors.
- Diplomatic alignment: Voeten agreement scores (CC0).
- Bloc membership: Wikidata P463 plus hand check for about 15 blocs.
- Sanctions: UN, UK, OFAC lists reduced to "regime = imposer to target country" counts; EU only via token or later.
- Diplomatic relations: Wikidata P530 as a seed.

### Later or hand-curated

- Semiconductor fabs: no open source; hand-curate about 50 sites.
- Facility-level critical minerals outside US and China: no open global source found.
- Data centres and IXPs: PeeringDB barred from redistribution; OSM is sparse.
- Arms transfers: SIPRI terms bar storing the table in an app; wait for permission or use only cited headline facts.
- Current alliances/defence pacts: ATOP stops 2018 and COW 2012; use a hand table (NATO, CSTO, AUKUS, bilateral pacts) with treaty citations.
- Territorial disputes: ICOW stops 2001; hand-curate about 40 active disputes with Wikidata P1336.
- Foreign troop presence: DMDC page unread; no all-country open dataset.
- Event-level conflict (ACLED), OpenSanctions entities, and the "can interrupt" field: editorial work.

## Licence traps

1. NonCommercial: OpenSanctions (CC BY-NC 4.0), TeleGeography cables (CC BY-NC-SA 3.0 on the old repo, snippet). These are fine locally, not for public hosting with any commercial angle.
2. ShareAlike: OSM / OpenFreeMap (ODbL) requires that a derived database be released under ODbL; TeleGeography BY-NC-SA / BY-SA. Mixing ODbL data into the asset catalogue can force the whole combined database to be shared under ODbL.
3. SIPRI: commercial use needs a licence, and ad-supported sites count as commercial. Reproduction beyond fair use (under 10% of a data set) needs permission.
4. PeeringDB: bulk passing-on of data barred without approval.
5. ACLED: account plus EULA (not read in full). Assume redistribution is restricted.
6. GEM: "CC BY 4.0 unless otherwise noted" is from a search summary; the tracker pages fetched show either no licence or a copyright footer. Some data (methane plumes) is CC BY-NC-SA 4.0. Confirm per download.
7. No licence stated: ATOP, COW alliances, FAS, OFAC and UN lists, OurAirports GitHub page. "No stated licence" is not permission; for OurAirports, the official page reportedly says public domain (snippet).
8. UCDP API token requirement: use bulk downloads.
9. EU sanctions download requires a registered token (snippet).
10. SEMI fab lists are paid and restrictive.
11. Wikidata CC0 is safe, but Wikipedia text and lists are CC BY-SA 4.0 (Wikidata licensing page, fetched, for non-data namespaces).

## Sources (URLs)

- GEM data statement search results: https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/download-data/
- GEM oil and gas extraction: https://globalenergymonitor.org/projects/global-oil-gas-extraction-tracker/download-data/
- GEM API catalogue: https://api.globalenergymonitor.org/catalog/metadata
- GEM integrated power: https://globalenergymonitor.org/projects/global-integrated-power-tracker/download-data/
- WRI GPPD: https://datasets.wri.org/dataset/globalpowerplantdatabase and https://www.github.com/wri/global-power-plant-database
- OurAirports: https://ourairports.com/data/ and https://davidmegginson.github.io/ourairports-data/
- NGA World Port Index: https://msi.nga.mil/Publications/WPI
- USGS: https://www.usgs.gov/data/mines-smelters-refineries-and-recycling-facilities-united-states and https://pubs.usgs.gov/publication/ofr20261018/full
- FAS: https://fas.org/initiative/status-world-nuclear-forces/
- SIPRI: https://www.sipri.org/databases/armstransfers and https://www.sipri.org/about/terms-and-conditions
- UCDP: https://ucdp.uu.se/downloads/ and https://ucdp.uu.se/apidocs/
- ACLED: https://acleddata.com/terms-of-use/
- ATOP: https://www.atopdata.org/
- COW alliances: https://correlatesofwar.org/data-sets/formal-alliances/
- ICOW: https://paulhensel.org/icowterr.html
- Voeten: https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/LEJUQZ
- OpenSanctions: https://www.opensanctions.org/licensing/ and https://www.opensanctions.org/docs/bulk/
- OFAC: https://ofac.treasury.gov/sanctions-list-service
- UN list: https://scsanctions.un.org/resources/xml/en/consolidated.xml
- UK Sanctions List: https://www.gov.uk/government/publications/the-uk-sanctions-list
- EU FSF: https://webgate.ec.europa.eu/fsd/fsf (see search results)
- PeeringDB AUP: https://www.peeringdb.com/aup
- TeleGeography: https://www2.telegeography.com/license-telegeography-map
- OSM copyright: https://www.openstreetmap.org/copyright
- Wikidata licensing: https://www.wikidata.org/wiki/Wikidata:Licensing
- SEMI World Fab Watch: https://www.semi.org/en/products-services/market-data/world-fab-watch
