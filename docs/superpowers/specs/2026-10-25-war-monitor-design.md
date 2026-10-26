# War monitor: collect, digest, map

Date: 2026-10-26 (rewritten; first version 2026-10-25). Status: design, agreed with the owner, not built.
Builds on `2026-10-25-news-integration-options.md`.

Input: a curated source directory for the Iran / US / Israel war and its regional fronts, organised
into folders (Reporting, Official statements, Local perspectives, Armed-group messaging,
Verification, Humanitarian impact, Analysis) plus physical observations, with eight handling rules
and a minimum record:

`claim -> event -> publisher -> original source -> evidence -> location -> event time -> publication time -> perspective -> verification status -> corrections`

## 0. Shape in one paragraph

**Collect** continuously and for free: the Node provider polls the directory's feeds, deduplicates
exact repeats, and keeps 72 hours of items. **Digest** on demand: when the owner presses Refresh,
the items collected since the last digest plus the open stories go to Claude Sonnet 5.5 through
Perplexity's Agent API with no search tools attached, and come back as stories: one per real-world
event, with a category, a place name, an event time, the supporting item ids, claims and what is
new. **Map**: code resolves places to coordinates, computes perspectives and verification labels
from the cited items, and draws one pin per story. Categories are toggles over one digest, not
separate searches. The raw feed stays available as a secondary tab.

This is a personal, non-commercial app. The design optimises for trust and cost, not scale.

## 1. How the directory maps onto the app

| Directory piece | Where it lives |
|---|---|
| The six folders and armed-group messaging | Item fields `folder`, `kind`, `perspective` on every collected item; the Raw tab of the Situation panel groups by folder |
| Verification outlets | Items like any other, kind `verification`; their findings are "assessed by <name>", never auto-promoted |
| Physical observations (FIRMS, ADS-B, AIS, imagery) | Existing layers `local-firms`, `flights`, `military`, `vessels`, `recent-imagery`. Phase 2 adds an "evidence nearby" row per story |
| The eight handling rules | Enforced by the record schemas and the code-owned fields in sections 3 and 4 |
| Smart categories (war, humanitarian, environmental, ...) | The digest assigns one category per story from a config list; the UI toggles categories |

## 2. Source registry (the directory as data)

`public/news/sources.json` holds one entry per source:

```json
{
  "id": "haaretz",
  "name": "Haaretz",
  "homepage": "https://www.haaretz.com/",
  "folder": "reporting",
  "kind": "independent",
  "perspective": "israel-dissent",
  "languages": ["en", "he"],
  "starred": true,
  "caution": "Independent, left-of-center; Hebrew and English editions make different editorial choices.",
  "transport": { "type": "rss", "url": "https://www.haaretz.com/srv/haaretz-latest-headlines" },
  "credit": "Haaretz"
}
```

- `folder`: reporting | official | local | armed-group | verification | humanitarian | analysis
- `kind`: independent | state | participant | humanitarian | verification | analysis
- `perspective`: controlled list per theater (international-wire, international-regional,
  israel-mainstream, israel-right, israel-dissent, israel-gov, israel-mil, us-gov, us-mil, iran-state,
  iran-revolutionary, iran-diaspora, iran-gov, palestinian, lebanon, gulf, hezbollah, houthi, un, ngo,
  verification, analysis-western, analysis-crisis)
- `transport.type`: rss | telegram-public | gdelt-domain | reliefweb | link-only

`public/news/theaters/iran-israel-us.json` holds: source ids, the category list, the gazetteer,
GDELT query terms, and a two-paragraph theater brief used in the digest instructions.

### Transports, as probed on 2026-10-25 from a server with the app's user agent

| Source | Transport | Result |
|---|---|---|
| Al Jazeera, Haaretz, Ynet, IRNA, IranWire, Iran International, Al-Monitor, Amwaj, Middle East Eye, Mondoweiss, Drop Site, CENTCOM, White House, Al-Manar, Bellingcat, Airwars, IAEA, Crisis Group | rss | Works |
| Al Masirah, IRNA, IDF official | telegram-public (`t.me/s/<channel>` HTML) | Works without an account; scraping, fragile |
| Times of Israel, +972, Israel Hayom, Al Arabiya, The New Arab, Al Mayadeen, AFP Fact Check, CTP/ISW, Tasnim | rss | Bot-protected (403) even with a browser user agent |
| Reuters, AP, AFP, Press TV, L'Orient Today, RUSI, IISS, State Dept, OCHA oPt | none found | No public feed, or URL not located |
| ReliefWeb (OCHA, WHO, Red Crescent reports) | reliefweb v2 API | Free; needs an approved `appname` |
| GDELT DOC 2.0 `domainis:` | gdelt-domain | Covers every blocked or feedless outlet; one request per 5 s per IP |

Bot-protected outlets are never scraped; they arrive through GDELT with a link to the publisher.

## 3. Item record (what collect produces)

```json
{
  "id": "sha1(canonicalUrl)",
  "theater": "iran-israel-us",
  "sourceId": "centcom",
  "folder": "official",
  "kind": "state",
  "perspective": "us-mil",
  "title": "...",
  "titleOriginal": "...",
  "snippet": "first 300 chars of description, plain text",
  "language": "en",
  "url": "https://...",
  "canonicalUrl": "https://...",
  "publishedAt": "2026-10-25T14:02:00Z",
  "collectedAt": "2026-10-25T14:10:31Z",
  "primarySource": { "kind": "statement", "issuer": "US Central Command", "url": "https://..." },
  "transport": "rss",
  "digestedAt": null
}
```

Collect-time rules: dedupe on canonical URL and on lowercase title plus publisher; keep
`titleOriginal` and `language` as published; `primarySource` filled when the item links to a
statement, document or report; 72 h retention; per-source cap 60.

## 4. Story record (what digest produces, after code post-processing)

```json
{
  "id": "st_7f3a",
  "theater": "iran-israel-us",
  "title": "Normalised English headline",
  "summary": "Two sentences, attributed, no adjectives.",
  "category": "war-military",
  "place": { "name": "Bandar Abbas" },
  "location": { "lat": 27.18, "lon": 56.27, "precision": "city", "method": "gazetteer" },
  "eventAt": "2026-10-25T03:00:00Z",
  "itemIds": ["...", "..."],
  "claims": [
    { "text": "A strike hit the port area", "actor": null, "type": "occurrence", "status": "reported" },
    { "text": "CENTCOM conducted it", "actor": "US", "type": "attribution", "status": "participant-claim" }
  ],
  "whatsNew": "Iranian Red Crescent reports 3 killed; CENTCOM has not commented.",
  "contradictions": ["IRNA says a civilian warehouse; CENTCOM says a drone storage site."],
  "status": "open",
  "firstSeenAt": "...",
  "updatedAt": "...",
  "digestRunId": "run_...",
  "perspectives": ["us-mil", "iran-state", "humanitarian"],
  "verification": "reported",
  "sourceCount": 7
}
```

**The model owns:** title, summary, category, place name, eventAt, itemIds, claims text and type,
whatsNew, contradictions, status, and story id continuity.

**Code owns, and the model cannot set:**
- `location`: resolved from the gazetteer by place name and aliases. If no match, the model's
  optional lat/lon is accepted with `method: "model"` and shown as model-placed. Null is valid.
- `perspectives` and `sourceCount`: derived from the cited items.
- `verification`: `participant-claim` when every cited item is kind participant or state;
  `corroborated` only when at least two cited items come from different perspective groups, at
  least one is kind independent or humanitarian or verification, and they do not share a
  `primarySource`; otherwise `reported`. `disputed` when `contradictions` is non-empty and no
  corroboration. Claim-level `status` follows the same rule using only the items the model cites
  for that claim, defaulting to the story's label.
- URLs: the model never returns URLs. Every `itemId` is validated against the store; unknown ids are
  dropped and counted.

Categories for this theater (config, not code): `war-military`, `political-diplomatic`,
`humanitarian-casualties`, `environmental`, `infrastructure-shipping`, `cyber-information`.

## 5. Digest run protocol

Trigger: the Refresh control in the Situation panel, or the voice action "refresh news". Never on a
timer.

Input assembled by code:
1. Fixed instructions (cacheable): role, the eight handling rules in model-facing form, output
   schema description, the rule "cite item ids only, never URLs; prefer updating an open story
   over creating a new one; put an item in at most one story; leave it unassigned if unsure".
2. Theater brief and category list (cacheable).
3. Gazetteer place names and aliases, names only (cacheable).
4. Open stories from the last digest: id, title, category, place, eventAt, itemIds, claims
   (cap 60, oldest closed first).
5. New items since the last digest: id, publisher, kind, perspective, publishedAt, title,
   snippet (cap 400). Pre-trim when over cap: drop non-starred sources' oldest items first and
   record how many were left out.

Request: Perplexity Agent API, `model: "anthropic/claude-sonnet-5-5"`, no effort preset (so no
preset tools attach), `tools` empty, `max_steps: 1`, `max_output_tokens: 16000`, strict JSON
schema output. The implementer verifies the exact field names for schema output and tool
disabling against docs.perplexity.ai before coding.

Output handling: parse, validate ids, resolve locations, compute code-owned fields, assign ids to
new stories, mark cited items `digestedAt`, persist `{ stories, runs[] }` to
`.gev-cache/news/<theater>-digest.json`. Each run record stores startedAt, duration, item and story
counts, unassigned count, left-out count, `usage.cost.total_cost` from the response, and the model
reported by the response.

Cost controls: daily budget from `NEWS_DIGEST_DAILY_BUDGET_USD` (default 2.00); Refresh is disabled
with the reason shown when the sum of today's run costs exceeds it. The last run's cost and the
remaining budget are shown next to the Refresh control. One run in flight at a time (409 otherwise).
A run is skipped with a message when there are no new items and no open stories.

Expected size: about 300 new items is roughly 30 to 40 thousand input tokens and 5 to 10 thousand
output tokens, in the range of 15 to 25 cents per refresh at list token prices. The run takes
roughly half a minute to a minute; the previous digest stays on screen while it runs.

## 6. Ingestion provider `server/providers/news/`

Follows the FIRMS provider (memory and disk cache, single-flight, serve stale, `/status`, no key in
logs) and the regional provider's capped HTTP helpers.

- `registry.js`: load and validate `sources.json` and theater files.
- `fetchers/rss.js`, `fetchers/telegramPublic.js`, `fetchers/gdeltDomain.js` (one `domainis:`
  OR-query per group of up to 10 domains every 15 min through one global queue with 5.5 s
  spacing and 429 backoff), `fetchers/reliefweb.js` (disabled until `RELIEFWEB_APPNAME`).
- `geocode.js`: gazetteer matcher, alias-aware, longest match wins, returns precision.
- `store.js`: items, 72 h retention, dedupe, disk cache `.gev-cache/news/<theater>.json`.
- `digest/runner.js`: assembles input, calls Perplexity, validates output.
- `digest/stories.js`: pure functions computing location, perspectives, verification, ids.
- `digest/store.js`: stories and run log on disk.
- `index.js`: routes `GET /api/news?theater=` (items, stories, lastRun, source health, budget),
  `POST /api/news/digest?theater=` (same-site gated, rate limited, 409 in flight, 429 over
  budget), `GET /api/news/status`.

Poll cadence: RSS 10 min, Telegram 5 min, GDELT 15 min, ReliefWeb 30 min. Serve stale on failure
with per-source `stale`, `error`, `loading`, `blocked`.

## 7. UI

### `news` layer (Events group, next to earthquakes and fires)
- One point per story with a location. Colour by category, size by `sourceCount`, a ring when the
  story is `participant-claim` only, a dashed outline when `location.method` is `model`.
- Category toggles (from the theater config) filter pins and the stories list together.
- Overlay-host card on hover: title, category, source count, verification label.
- Click: register entity context, request world focus, scroll the panel to the story.
- Items are never drawn individually. Stories without a location are list-only and counted.

### Situation panel (right rail, `#situation-panel`, built like Recent Imagery)
- Header: theater selector, **Refresh** (idle, running with elapsed time, disabled with reason),
  digest line "Digest 14:02 · 23 stories from 312 items · 9 unassigned · last run 18¢ · budget
  1.42 left", degraded-source indicator.
- Category toggle chips.
- Tabs: **Stories** (default) and **Raw feed**.
- Story row: title, category chip, source count, perspective chips, verification label, event
  time and updated time, what's new line, contradictions when present, expandable cited items
  (publisher, perspective, folder, published time, original-language title toggle, open-original
  link). Select flies to the location when there is one.
- Raw feed tab: the folder tabs (Reporting, Official, Local, Armed-group, Verification,
  Humanitarian, Analysis) with perspective and language filters, three timestamps per item, a
  "not yet digested" marker, and the unassigned-after-digest marker.
- Follows `docs/panel-surfaces.md`, share state, Cockpit collapse and the Cyber one-panel rule.

### Cockpit
- The Regional News page keeps its own Google News RSS and GDELT path; it may additionally show
  stories within range of the aircraft from the same store.

### Voice and HUD
- `layerManifest.js` entry: aliases news, situation, stories, headlines; query fields title,
  category, perspectives, verification, sourceCount, place; time field updatedAt.
- A `refresh_news` action in `gevActions.js` that posts to `/api/news/digest` and reads back the
  run summary. Hints in `toolDescriptions.js`.
- HUD summary: story count, digest age, degraded sources, budget state.

### Rules to UI states

| Rule | UI |
|---|---|
| Preserve the original source | every story expands to its cited items with publisher and primary source |
| Separate event and publication time | story shows event time and updated time; items show published and collected |
| Track claims not articles | claims list per story with per-claim status |
| Keep uncertainty visible | verification label on every story and pin; `disputed` when sources contradict |
| Deduplicate shared evidence | the digest groups by event; items sharing a primary source count once toward corroboration |
| Preserve original language | `titleOriginal` and language chip on items; the model sees the original title |
| Keep civilian and dissenting voices visible | perspective chips per story; the Raw tab keeps the Local and Humanitarian folders separate |
| Allow unknown | null location, null event time, unassigned items and a skipped run are all first-class states |

## 8. Licensing and attribution
- RSS and Telegram previews: headline, snippet, link and publisher only; `DATA_CREDITS` per
  publisher group; `DATA_SOURCES.md` section listing every registry source and transport.
- GDELT: citation and link, already present. ReliefWeb: appname terms plus report author credit.
- Perplexity and Anthropic: credited as the digest provider in the panel footer and lightbox.
- Google News RSS stays confined to the cockpit fallback (noncommercial terms).
- Bot-protected outlets are not scraped.

## 9. Decisions (owner)
- Personal, non-commercial app. Node only, no Python, no Supabase, no new database.
- ReliefWeb: owner requests the free `appname`; `RELIEFWEB_APPNAME` enables the fetcher.
- Telegram public previews are an accepted transport, marked fragile in `/status`.
- The digest runs only on Refresh, never on a timer. Model is Claude Sonnet 5.5 through
  Perplexity's Agent API (key id `perplexity`, env `PERPLEXITY_API_KEY`, entered through Provider
  Settings). Perplexity requires `max_output_tokens` on `anthropic/*` requests.
- Web-search-backed work (a per-story deep dive, smart search layers) is Phase 2 and user-triggered.
- The xAI and Perplexity keys exposed in the old repo are rotated before the new key is entered.

## 10. Phases
- **Phase 1 (one PR):** registry and theater files; fetchers, store and routes; gazetteer; digest
  runner, story computation and persistence with the budget cap; `news` layer with one pin per
  story and category toggles; Situation panel with Refresh, Stories and Raw feed tabs; voice
  `refresh_news` and manifest entry; credits, docs, tests, boundaries.
  Plan: `docs/superpowers/plans/2026-10-25-war-monitor-phase1.md`.
- **Phase 2:** evidence-nearby counts per story from FIRMS, military flights, vessels and
  imagery; per-story deep dive with web search and domain allowlist from the registry; ReliefWeb
  once the appname exists; media-ownership badges from the old `outlets.json`; GDELT Events file
  for event time and Goldstein.
- **Phase 3:** corrections tracking by re-fetch and diff; story history timeline in `node:sqlite`;
  additional theaters.
