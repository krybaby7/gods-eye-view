# Global news on the globe: integration options

Date: 2026-10-25. Status: exploration, nothing decided or built.

Goal: surface what is happening now, especially in active wars, on the God's Eye View globe,
and reuse whatever is salvageable from the closed THEATER WATCH / OSINT MAP project.

## 1. What already exists

### In this repo
- A cockpit-only news feed: `server/providers/regional/news.js` queries Google News RSS for the
  locality under the aircraft and falls back to GDELT DOC 2.0 `artlist`. Served by
  `/api/regional-brief` (5-minute cache, 0.1 degree cells). Consumed by the cockpit "Regional News"
  page. Articles carry no coordinates. Credits for both sources already exist in
  `src/data/dataCredits.js` and `DATA_SOURCES.md`.
- An "Events" group in the layer panel (`src/ui/layerPanel.js` PANEL_GROUPS) holding
  rocket-launches, earthquakes, local-firms, fire-perimeters. A news layer belongs there.
- Templates for every piece a new layer needs:
  - smallest end-to-end layer: `src/layers/earthquakes` (CustomDataSource entities, overlay host labels)
  - keyed layer through the Node proxy with disk cache and serve-stale: `src/layers/firms` + `server/providers/firms.js`
  - click-to-detail and context registration: `src/layers/firms/selection.js`
  - right-rail list panel driven by `getSnapshot()` / `subscribe()`: `src/layers/recentImagery` + `src/ui/recentImagery.js`
  - voice and analyst_query exposure: one entry in `src/voice/layerManifest.js`
  - share-state token: `npm run layer-token:next -- <id>`
  - boundaries: `scripts/package-boundaries.json` export group + `package.json` exports entry

### In OSINT MAP (reusable)
- `python_backend/gdelt_fetch.py`: working GDELT DOC 2.0 client plus a GDELT 2.0 Events CSV
  fallback (reads ActionGeo lat/lon, Goldstein, Actor1/Actor2). The logic ports to JS easily.
- `python_backend/services/clustering.py` and `claims.py`: pure-Python headline normalization,
  actor aliases, region/theme keyword tables, Jaccard clustering with oversize splitting, and
  source-quality scoring (wire services and .gov/.mil up, aggregators down). Portable to JS.
- `python_backend/services/perplexity_research_client.py` + `schemas/*.py`: Perplexity Agent API
  tool loop with the strict `incidentResearchV1` schema (what_happened, why_it_matters, sources,
  western/iranian/regional frames, unresolved questions, contradictions).
- Data: `Media research/outlets.json` (178 outlets with country, ownership chain, bias ratings,
  and a lens label: western / regional_arab / global_south / russian / chinese / neutral / iranian),
  `media_owners.json` (180), `ownership_edges.json` (333), `outlet_israel_coverage.json`.
- Curated lists: ~30 tiered X handles, ~22 Middle East airports, FIR list, ~24 strategic sites,
  callsign regexes, keyword tables.
- Dead: v1 agents, the Grok social agent (no live search), Leaflet MapView, the HTML prototypes.
- Security: an xAI key and a Perplexity key were caught by GitHub push protection and also sit in
  untracked scripts. Rotate both.

## 2. Data sources, ranked for "what is happening in the wars right now"

| Source | What you get | Latency | Cost / access | Coordinates | Verdict |
|---|---|---|---|---|---|
| GDELT 2.0 Events CSV (15-min files) | Coded events: CAMEO code, Goldstein, actors, ActionGeo lat/lon, source URL | 15 min | Free, keyless | Yes | Best free geocoded live feed. Protest/coerce/assault/fight root codes 14, 17, 18, 19, 20 isolate conflict. |
| GDELT DOC 2.0 API | Article list for any query, 3-month window, sourcecountry, tone | 15 min | Free, keyless, 1 request / 5 s | No | Headlines for a place or theater. Already used in the cockpit. |
| GDELT GKG 15-min file | Per-article themes, locations, tone | 15 min | Free, 6.5 MB zipped per file | Yes (per mention) | Heavier; use if DOC headlines plus Events points are not enough. |
| GDELT GEO 2.0 API | Location mentions as GeoJSON | - | Dead (HTTP 404 since spring 2026) | - | Do not plan on it. |
| Tiered RSS (wires, Al Jazeera, Kyiv Independent, Times of Israel, ISW, ReliefWeb) | Clean headlines from named newsrooms | Minutes | Free | No | Needs a gazetteer or LLM to geocode. Best quality per headline. |
| Google News RSS | Locality headlines | Minutes | Free but personal/noncommercial terms | No | Keep as the cockpit fallback only. |
| Ukraine air-raid alerts (alerts.in.ua, ukrainealarm.com) | Live oblast/raion alert polygons | Seconds | Free key on request | Yes (polygons) | True real-time for Ukraine. Small, well-defined layer. |
| Israel OREF sirens | Rocket/missile/drone alerts by city | Seconds | Free but behind Akamai; needs Israeli exit IP | Yes (city dictionary) | Hard to fetch reliably from a hobby server. Optional. |
| Telegram OSINT channels (MTProto) | Raw leads, lowest latency | Seconds | Free; needs a Telegram account session | No | Highest signal, most noise. Needs keyword filter + classifier. Phase 3 at earliest. |
| ACLED | Coded political violence with lat/lon, actors, fatalities | Weekly on Partner tier; Open tier is aggregates only | myACLED account; gmail = Open tier, no API | Yes | Not live. Good for a "last 30 days" context layer if API access is granted. |
| UCDP GED Candidate | Hand-coded lethal events, monthly CSV | ~1 month | Free CSV, no token; API needs emailed token | Yes | Historical baseline, not live. |
| Event Registry / NewsAPI.ai | Clustered events, entities incl. locations | Real-time | 2,000 free searches then paid | Yes | Good quality, finite free pool. |
| NewsData.io, GNews, NewsAPI.org, Mediastack | Headlines | 12 to 24 h delay on free tiers | Free tiers are dev-only or delayed | No | Not worth it for live war tracking. |
| Liveuamap API | Curated conflict pins | Live | USD 150 / month | Yes | Too expensive for a hobby project. |
| X API | Posts from the curated 30 handles | Live | Paid tiers, pricing unstable | No | Skip unless a budget appears. |
| LLM web search (OpenAI Responses `web_search`, Perplexity Agent API) | Structured situation brief on demand | Seconds | Per call; app already has OpenAI infra; Perplexity key exists in old repo | Via schema | Complements a feed, does not replace one. |

Reference point: World Monitor (AGPL, github.com/koala73/worldmonitor) builds its conflict view from
UCDP + ACLED (optional) + GDELT 7-day protest keyword feed, tiered RSS with propaganda flags, Telegram
tiers, OREF and ADS-B. Its code cannot be copied into this MIT repo, but its source choices are a good map.

## 3. Ways to put news on the globe

A. **News hotspots layer (points).** GDELT Events CSV, conflict CAMEO roots only, aggregated by
   location on a 0.1 degree grid. Sized/colored dots (Goldstein as color), overlay-host card with
   the top headlines on hover/click. Sits in the Events panel group next to earthquakes and FIRMS.
   Effort: small. Fully free. Honest caveat in the UI: media mentions, not verified incidents.

B. **Right-rail news feed panel.** A list of the latest items (GDELT DOC or RSS), filterable by
   theater preset (Ukraine, Israel/Iran/Lebanon, Sudan, Myanmar, Sahel, Taiwan Strait...), click
   flies the camera to the item location. Built like the Recent Imagery panel. Pairs with A.

C. **Live alert overlays.** Ukraine air-raid alert polygons (and optionally OREF). Real-time, small
   payload, very visible on a globe. Separate layer with its own toggle.

D. **Theater context overlays.** Front lines and assessed control (ISW ArcGIS services, DeepState
   unofficial GeoJSON) as a live or snapshot layer. Snapshots fit the Director data-pack rules
   (`docs/DIRECTOR-DATA-PACKS.md`, static GeoJSON under `public/scene-assets/`).

E. **Voice and HUD.** With one manifest entry, "show news", "what's happening near Kharkiv",
   and analyst queries over the records work. HUD summary reports count and freshness. Near free.

F. **AI situation brief.** "Brief me on this region" button or voice action: the Node provider
   calls OpenAI Responses with `web_search` (or Perplexity) using the ported incidentResearchV1
   schema and renders what happened / why it matters / sources / contradictions. Could also upgrade
   the cockpit Regional News page.

G. **Narrative lens and ownership badges.** Tag each headline's domain with the 178-outlet database:
   lens label, state affiliation, owner. A "compare lenses" toggle on a story. This is the unique
   idea from THEATER WATCH and costs nothing at runtime (static JSON).

## 4. Architecture options

1. **Node proxy only (recommended).** `server/providers/news/*` fetches GDELT files and RSS, caches
   on disk like FIRMS, does gazetteer geocoding and the ported clustering in JS, serves `/api/news`.
   Browser layer renders. No database, no Python, no Supabase. Matches the repo's "runs in a browser"
   positioning and its boundary rules.
2. **Python + Supabase sidecar.** Port the OSINT MAP pipeline as-is and have the globe read Supabase.
   Gives persistence, history, LLM research runs and a review queue, at the cost of a second runtime,
   hosting, and keys. Only worth it if the narrative-intelligence product (vision doc) is the goal.
3. **Hybrid.** Option 1 now; LLM enrichment through the existing OpenAI provider when wanted;
   revisit persistence later if history matters.

## 5. Recommended phasing

Phase 1, one PR: layer `news` (A + B + E). GDELT Events CSV via Node proxy, conflict filter,
theater presets, overlay cards, right-rail panel, voice manifest, credits, tests, boundaries.

Phase 2: C (Ukraine alerts) and G (lens/ownership badges from the ported outlets.json), plus tiered
RSS as a second headline source with a gazetteer built from the old COUNTRY_COORDS / LOCATION_HINTS
tables and Natural Earth populated places.

Phase 3: F (AI brief) using the ported schema; optionally Telegram tiers; ACLED/UCDP context layer
if access is granted.

## 6. Constraints to keep in mind
- GDELT is media coverage, not ground truth. Keep the existing wording: headlines are location
  matches, not verified incidents or risk rankings.
- GDELT API: one request per 5 seconds per IP; bulk files for anything heavier. Cache aggressively.
- Google News RSS terms are personal/noncommercial. Do not widen its use.
- World text labels must go through the overlay host (`docs/CODE-BOUNDARIES.md`).
- Every new source needs a `DATA_CREDITS` entry and a `DATA_SOURCES.md` row.
- Rotate the xAI and Perplexity keys from the old repo before reusing either service.
