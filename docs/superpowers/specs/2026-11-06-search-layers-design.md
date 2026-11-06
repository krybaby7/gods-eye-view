# Search layers: ask the globe, get a layer

Date: 2026-11-06. Status: design, drafted with the owner, not built. Section 13 lists the points this
spec proposes and the owner still has to confirm.
Builds on `docs/WAR-MONITOR.md`, `2026-10-25-war-monitor-design.md` and
`2026-10-29-world-hotspot-view-design.md`.

The Perplexity request and response fields below were read from the official SDK's generated types
(`@perplexity-ai/perplexity_ai` 0.41.0, `dist/generated/api.d.ts`, published 2026-10-22), because
docs.perplexity.ai could not be reached from the cloud session that wrote this. Section 4.1 lists
what still has to be checked against a live response.

## 0. Shape in one paragraph

The owner asks the globe a question in plain words: "what's going on with crypto?", "who's talking
about the Sudan ceasefire?", "where are the world's lithium mines?". A research call searches the
web. A second call turns what it found into **findings**: events, statements, places and
country-wide facts, each tied to a place and to the pages it came from. Code checks them, places
them and saves them as a **search layer**: a row in a new Searches panel, labelled by the question,
toggled on and off on its own, drawn on the globe in its own colour. Every new question adds
another layer. When two searches find the same thing, code draws it once and says it belongs to
both. The war monitor's rule carries over: the model writes the content; code decides where it
goes, how it looks, which links are real and what counts as corroborated.

## 1. Decisions (owner, 2026-11-06)

- Same globe, no separate mode. Live layers (flights, ships, fires, the war monitor) stay usable
  next to search layers. Seeing an answer next to live data is the point of the feature.
- Any question the owner would ask a globe: news about anything, who is saying what, and where
  things are. Not how-to questions. The answer always comes back as findings on the globe; the
  text answer is a short summary over them, and every finding can be opened for detail.
- Each search becomes its own layer, labelled by the question and toggled on its own. Searches
  add up.
- Duplicates across searches are merged by code.
- Phase 1 uses Perplexity's Agent API, already wired in for the digest.
- **Phase 2 (recorded 2026-11-06):** the agent becomes Claude or Codex instead of Perplexity, and
  its toolkit grows with MCP servers and APIs that reach stable sources faster. Phase 1 keeps the
  research step behind one function so Phase 2 replaces only that (section 4.1).

## 2. Words used here

- **Search:** one question and everything it produced. Stored, toggleable, updatable. One row in
  the Searches panel, one colour on the globe.
- **Finding:** one thing a search found that can sit on the map. Four kinds (section 3.2).
- **Source:** one web page the research call actually retrieved. Code numbers them; findings cite
  those numbers.
- **Run:** one execution of a search: the first ask, a retry or an Update.

## 3. Data

### 3.1 Search record (`.gev-cache/searches/<id>.json`)

```json
{
  "id": "sr_9c41",
  "question": "What's going on with crypto?",
  "label": "Crypto this week",
  "colorIndex": 2,
  "visible": true,
  "createdAt": "2026-11-06T14:02:00Z",
  "asOf": "2026-11-06T14:03:10Z",
  "status": "ready",
  "answer": {
    "summary": [{ "text": "US and EU regulators both moved on stablecoins...", "sourceIds": ["s3", "s7"] }],
    "groups": [
      { "id": "g1", "label": "Regulation" },
      { "id": "g2", "label": "Markets" },
      { "id": "g3", "label": "Hacks and fraud" }
    ]
  },
  "sources": [
    {
      "id": "s3",
      "url": "https://...",
      "canonicalUrl": "https://...",
      "domain": "reuters.com",
      "title": "...",
      "date": "2026-11-05",
      "snippet": "...",
      "registeredSourceId": "reuters",
      "runId": "run_..."
    }
  ],
  "findings": ["section 3.2"],
  "runs": [
    {
      "id": "run_...",
      "kind": "ask",
      "startedAt": "...",
      "durationMs": 61000,
      "status": "ok",
      "costUsd": 0.31,
      "researchCostUsd": 0.22,
      "toolCallsCostUsd": 0.05,
      "mapCostUsd": 0.09,
      "steps": 5,
      "sourceCount": 38,
      "findingCount": 24,
      "droppedNoSource": 2,
      "listOnly": 3,
      "model": "..."
    }
  ]
}
```

- `label`: written by the model (at most 40 characters), editable by the owner. `question` is kept
  verbatim.
- `colorIndex`: assigned by code: the lowest palette slot no other visible search uses (6.1).
- `visible`: the owner's toggle, stored on the server so it survives a reload. Not in share links:
  searches exist only on this machine.
- `status`: `running | ready | failed`. A failed first run keeps the record so the owner can retry
  or delete it. On server start, a record still `running` becomes `failed` with reason
  `interrupted`.
- Index: `.gev-cache/searches/index.json` holds id, label, status, `asOf` and `colorIndex` for each
  search, so the panel loads fast. Every write is atomic (temporary file, then rename), as the
  digest store does.

### 3.2 Finding

```json
{
  "id": "f_2b7e",
  "kind": "statement",
  "title": "SEC chair says stablecoin rules will follow the EU's model",
  "summary": "One or two attributed sentences.",
  "groupId": "g1",
  "actor": "US Securities and Exchange Commission",
  "place": { "name": "Washington", "basis": "speaker-based" },
  "location": { "lat": 38.9, "lon": -77.04, "precision": "city", "method": "gazetteer", "name": "Washington, D.C." },
  "hotspot": { "key": "country:United States", "label": "United States", "kind": "country", "lat": 39.8, "lon": -98.6 },
  "eventAt": "2026-11-05T15:00:00Z",
  "sourceIds": ["s3", "s9"],
  "verification": "reported",
  "sourceCount": 2,
  "firstSeenAt": "2026-11-06T14:03:10Z",
  "lastSeenAt": "2026-11-06T14:03:10Z"
}
```

Kinds are a fixed list. The kind sets the marker shape (6.1).

| Kind | What it is | `place.basis` | Example |
|---|---|---|---|
| `event` | Something happened at a place and a time | `happened-here` | An exchange hack; a protest; an election result |
| `statement` | Someone said, announced or decided something | `speaker-based` (where the speaker sits) or `said-here` (where they spoke) | A regulator's ruling; a minister's remarks at a summit |
| `place` | Something that exists somewhere, with no particular time | `located-here` | A lithium mine; a data centre; an exchange's headquarters |
| `area` | Something true of a whole country or region | `applies-here` | A crypto ban; a sanctions regime; a national adoption figure |

The basis is always shown, so a statement pinned on Washington reads "placed where the speaker is
based", never as if something happened there.

**The model owns:** the search `label`; the summary sentences and the source ids each one cites;
the groups; and for each finding the kind, title, summary, group, actor, place name and basis,
optional lat/lon, `eventAt`, `sourceIds`, and `sameAs` (on an Update, the id of the earlier finding
this one continues).

**Code owns, and the model cannot set:** `id`, `location`, `hotspot`, `verification`,
`sourceCount`, `firstSeenAt`, `lastSeenAt`, every URL, `colorIndex`, and the merges across searches
(section 5).

### 3.3 Caps

- 60 findings per run; 6 groups per search; 80 sources passed to the map call (most-cited by the
  notes first, then newest, when there are more).
- Questions longer than 500 characters are refused in the panel.
- 15 Nominatim lookups per run (4.3).
- At most 8 searches visible at once, the palette size. Turning on a ninth is refused with "Hide a
  search first: all 8 colours are in use".
- No cap on stored searches. Deleting a search removes its file.

## 4. The run

```
question ─▶ research call ─▶ numbered sources + notes ─▶ map call ─▶ findings JSON ─▶ code checks ─▶ saved search ─▶ globe and panel
            (web search on)                               (no tools, strict JSON)
```

Two calls rather than one, on purpose:

1. Strict JSON output never has to share a request with tool use. The SDK types accept `tools` and
   `response_format` together, but nothing read for this spec says how the agent behaves with both.
2. The map call works like the digest: the model sees numbered sources and cites numbers, never
   URLs. Code already enforces that contract.
3. Phase 2 replaces the research call alone.

### 4.1 Research call (the Phase 2 seam)

One function, `research({ question, since, previousFindings, signal })` in
`server/providers/search/research.js`, returns `{ notes, sources, costUsd, toolCallsCostUsd,
model, steps }`. Nothing else in the feature knows which provider ran.

Phase 1: `POST https://api.perplexity.ai/v1/agent`, as the digest does, model
`anthropic/claude-sonnet-5-5`:

```json
{
  "instructions": "...",
  "input": ["the question, today's date, and on an Update the previous findings"],
  "tools": [
    { "type": "web_search", "search_type": "web", "search_context_size": "medium" },
    { "type": "fetch_url", "max_urls": 5 }
  ],
  "max_steps": 8,
  "max_output_tokens": 16000
}
```

- No `preset` or `effort`, as in the digest, so only these two tools attach.
- On an Update the `web_search` tool gets
  `filters: { "search_after_date_filter": <the previous asOf> }`. The types also offer
  `search_domain_filter` and `search_recency_filter`; Phase 1 doesn't use them.
- Instructions (fixed, so they cache): today's date; the answer will be shown on a globe, so find
  where things happen, who is involved and where they are based, and where things are; prefer
  primary and established sources; for questions about now, prefer the last two weeks unless the
  question asks for history; name places precisely (city and country, or coordinates when a source
  gives them).
- **Sources:** code reads every `search_results` output item (`results[]`: `id`, `url`, `title`,
  `snippet`, `date`, `last_updated`, `source`) and every `fetch_url_results` item (`contents[]`).
  It canonicalizes URLs with `canonicalizeUrl` (`server/providers/news/store.js`), drops repeats
  and numbers them `s1…sN` in order of first appearance. Only these pages can ever be shown as a
  finding's source.
- **Notes:** the text of the final message.
- **Cost:** `usage.cost.total_cost`; the run also keeps `usage.cost.tool_calls_cost`.
- `max_steps: 8` is a starting value; the types don't say what a step is.

To verify against a live response before relying on it, and record in the PR: that `search_results`
items appear in `output` on a non-streamed response; what one step is; the date format
`search_after_date_filter` accepts; and the cost and steps of two real questions.

### 4.2 Map call

Same endpoint and model, `tools: []`, `max_steps: 1`, strict `json_schema` output,
`max_output_tokens: 32000`, built the way `server/providers/news/digest/runner.js` builds the
digest request. Reuse its request and cost helpers; move them to a shared module if the boundary
checker requires it.

Input: the question; the research notes; the numbered sources (id, registered publisher name or
domain, date, title, snippet); the place names of the World and Iran · Israel · US gazetteers
(`placeNamesForPrompt`); on an Update, the previous findings (id, kind, title, place, `eventAt`,
`sourceIds`).

Output: `{ label, summary: [{ text, sourceIds }], groups: [{ id, label }], findings: [...] }` with
the model-owned fields of 3.2.

Rules in the instructions:

- Every finding and every summary sentence cites at least one source id.
- Never write a URL.
- Prefer a precise place over a country.
- Place a statement where the speaker is based, unless the source says where it was said.
- Use `area` only when the thing really applies to a whole country or region.
- Leave a finding without a place when it has no honest one.

### 4.3 Code checks (`server/providers/search/findings.js`, pure)

In order:

1. **Sources.** Drop unknown source ids. Drop findings and summary sentences left with none, and
   count them (`droppedNoSource`).
2. **Location.**
   - First, `resolveLocation` (`server/providers/news/digest/stories.js`) against the World and
     Iran · Israel · US gazetteers together.
   - No match: one Nominatim lookup through the existing queue in
     `server/providers/regional/place.js` (1.1 s spacing), at most 15 per run, in finding order.
   - Still none: the model's lat/lon, `method: "model"`, drawn with a dashed outline.
   - Nothing at all: the finding is list-only.
   - An `area` finding resolves only to a `country` or `region` row.
3. **Hotspot.** `assignHotspots` (`server/providers/news/hotspots.js`), unchanged, on the located
   findings.
4. **Source facts.** A source whose domain matches the homepage or `transport.domain` of an entry
   in `public/news/sources.json` takes that entry's publisher name, kind and perspective. Any other
   source is `unregistered`: its publisher is its domain and its kind is `unknown`.
5. **Verification** (events and statements only). `deriveVerification` runs with the perspective
   groups of the matched sources. All unregistered sources share one group, `unregistered`, and kind
   `unknown` never corroborates. So `corroborated` needs at least one registered independent,
   humanitarian or verification outlet plus a source from another group. Places and areas carry no
   label, only "N sources".
6. **Ids.** A new finding gets `f_` and 4 hex characters from a hash of the search id, kind, title
   and place. On an Update, a valid `sameAs` keeps the earlier id.
7. **Times.** `firstSeenAt` when a finding is created; `lastSeenAt` whenever a run cites it again.

## 5. Duplicates across searches (`server/providers/search/dedupe.js`, pure)

Applied when `GET /api/searches` is served, across visible and hidden searches, so a stored search
never changes because of another one.

Two findings from different searches are the same thing when they have the same kind and:

- they **share a source** (same canonical URL) and sit in the same hotspot or within 50 km; or
- for **places**, their normalized names match (`normalizePlaceName`) within 25 km; or
- for **events and statements**, they share a hotspot, their `eventAt` times are within 24 hours,
  and their titles overlap by at least 0.6 (Jaccard over normalized words).

These thresholds are starting values. Fixture tests pin them with realistic pairs: two crypto
searches, two Sudan searches, and lithium mines asked twice.

Each merged group gets a `mergeKey`. While any member search is visible, the globe draws the
finding once, with its marker split between the visible members' colours. In the panel each
member search lists it with "Also in: Crypto this week". Hiding one search keeps the marker as
long as another member is visible.

A finding that cites a URL also cited by a story in the war monitor's current snapshot shows "Also
in the war monitor: <story title>", with a link that opens that story. It is not merged with war
monitor pins in Phase 1.

## 6. Globe: the `searches` layer

### 6.1 Look

- One new catalog layer, **Searches**, in the layer panel's Events group after War Monitor, with
  its own share token from `npm run layer-token:next`. The token only records that the layer is on.
- **Colour is the search.** A fixed palette of 8 colours that stay distinct from each other on the
  dark and satellite map styles and differ from the war monitor's category colours.
- **Shape is the kind:** event ● circle; statement ■ rounded square; place ◆ diamond; area ◯ hollow
  ring at the country or region's position.
- Size follows source count, as for news pins (`newsMarkerSizePx`). A dashed outline means the
  model placed it. A dot means new since the last Update.
- Zoomed out, above 3,500 km and with the news layer's hysteresis (`newsMapMode`): one bubble per
  hotspot, its ring split by search colour, the count inside. Reuse `aggregateHotspots` by passing
  each search as a category (id and colour).
- Hover card: title, the search's label and colour, kind, place and basis ("placed where the
  speaker is based"), time, source count, verification label.
- Clicking a marker selects it, flies there (`requestWorldFocus`) and opens the finding in the
  panel. Clicking a bubble flies in and sets a place filter in the panel, as in the hotspot view.

### 6.2 Code

- `src/layers/searches/`:
  - `index.js`: the layer lifecycle, modelled on `src/layers/news/index.js` (its lifecycle lives in
    closures and can't be reused directly);
  - `records.js`: normalizes the server payload;
  - `model.js`: marker images per shape (extend `newsMarkerImage` with a `shape` option, or add a
    sibling);
  - `source.js`: the `/api/searches` client.
- Reuse from `src/layers/news/`, all exported already: `newsMapMode`, `aggregateHotspots`,
  `hotspotBubbleImage`, `buildHotspotCard`, `newsMarkerSizePx`.
- Register it the way `news` is registered: `src/app/layers/searches.js`,
  `src/app/constructCatalog.js`, `src/app/sourceComposition.js`, `src/standalone/layerSources.js`,
  `src/data/layerState.js` with `src/data/layerStateTokenReservations.json`, the Events group in
  `src/ui/layerPanel.js`, `src/voice/layerManifest.js`, `src/data/dataCredits.js`.
- Data loads when the layer turns on, after each run and after panel actions. There is no timer,
  as in the news layer. While a run is in flight the panel polls `GET /api/searches?rev=` every 3 s
  and stops when the run ends.

## 7. Updating a search

A search is a snapshot as of the moment it ran. Its row has **Update**, which runs both calls
again with the same question, the previous findings and a date filter from the previous `asOf`.
After an Update:

- new findings appear with the "new" dot;
- findings the Update cites again (`sameAs`) get a new `lastSeenAt`;
- findings it doesn't mention stay, marked "not seen since <date>".

An Update never deletes; the owner can delete a single finding. Updates are manual only and never
run on a timer, like Refresh.

## 8. Searches panel

A right-rail panel, `#searches-panel`, built like the Situation panel (`src/ui/situationPanel.js`).
It is mounted through an `attachSearches(factory)` hook in `src/ui/layerPanel.js`, beside
`attachSituation`, called from `src/app/tools.js`, and opens when the layer turns on. It follows
`docs/panel-surfaces.md`, the Cyber one-panel rule, Cockpit collapse, Clean UI and recording.

**Top:**

- An ask box (a textarea: Enter asks, Shift+Enter starts a new line) and **Ask**.
- While running: "Searching the web… 0:41", then "Placing findings… 1:02", with **Cancel**.
  Cancelling aborts the request; what was already spent is logged.
- A cost line: "Last search 31¢ · $1.37 of today's budget left".
- Ask is disabled, with the reason shown, when there is no Perplexity key, today's budget is spent,
  a search or digest is running, or the box is empty.

**Search rows, newest first:**

- A colour swatch that toggles visibility; the label; "as of 14:03"; counts such as "21 on the
  globe · 3 list-only · 2 also in other searches"; a status (running, or failed with Retry).
- A menu: Update, Rename, Show question, Delete (confirmed inside the panel).

**An open row:**

- The summary sentences, each with its source chips.
- Group chips that filter the list and that search's markers.
- The findings by group: kind icon, title, place, time, verification label, "also in". Each one
  expands to its summary, placement basis and sources (publisher, date, title, link to the
  original).
- List-only findings at the end, under "Not on the globe".
- The place chip from a bubble click, as in the Situation panel.

## 9. Server: `server/providers/search/`

A new package, `search-provider`, in `scripts/package-boundaries.json`, depending on
`news-provider` for the pure functions it reuses.

| File | Job |
|---|---|
| `research.js` | The research call (4.1). Phase 2 replaces this file. |
| `mapper.js` | The map call, its JSON schema and parsing (4.2). |
| `findings.js` | The code checks (4.3), pure. |
| `dedupe.js` | Merges across searches (5), pure. |
| `store.js` | Search files and the index, atomic writes. |
| `index.js` | Routes and the run queue. |

Routes, same-site gated and rate limited like `/api/news`:

- `GET /api/searches?rev=`: every search with its findings, merge keys, war monitor links, the
  budget and `disabledReason`; `{ unchanged: true }` when `rev` matches.
- `POST /api/searches` with `{ question }`: 202 with the new id; the run continues on the server.
  409 while a search, digest or brief runs; 429 over budget; 503 without a key.
- `POST /api/searches/:id/update`, `POST /api/searches/:id/retry`, `POST /api/searches/:id/cancel`.
- `PATCH /api/searches/:id` with `{ label?, visible? }`.
- `DELETE /api/searches/:id` and `DELETE /api/searches/:id/findings/:findingId`.

One paid call runs at a time across searches, digests and briefs, through one lock module both
providers import.

**Budget.** One daily budget for the whole app: `NEWS_DIGEST_DAILY_BUDGET_USD` (default $2.00)
now covers digests, briefs and searches, and `budget()` in `server/providers/news/index.js` adds
the day's search runs. A run is refused when the remaining budget is below a worst-case estimate,
as the brief does. Start at $0.75 and adjust after the first measurements. If the owner searches
often, raising the budget is an environment change, not code.

## 10. Voice

- An `ask_globe` action in `src/voice/actionSchemas.js` and `src/voice/gevActions.js`: "ask the
  globe what's going on with crypto". It turns the layer on, posts the question, says "Searching",
  and when the run ends reads back the label and count ("Crypto this week: 21 findings on the
  globe"). Its hint in `server/providers/openai/toolDescriptions.js` says it costs money and runs
  only when asked.
- A `searches` entry in `src/voice/layerManifest.js`. Aliases: searches, search layers, findings.
  Query fields: title, kind, search label, place, actor, verification. Time field: `eventAt`. So
  "which of my searches mention Binance?" is an analyst query over stored findings, never a new
  search.

## 11. Rules to UI states

| Rule | UI |
|---|---|
| Links are real | Every source shown came from the search tool; findings without one are dropped and counted |
| Placement is honest | A basis line on every finding; a dashed outline when the model placed it; list-only when no place fits |
| Uncertainty stays visible | A verification label on events and statements; "N sources" on places and areas |
| Answers age | "as of" on every search; "not seen since" on findings an Update didn't confirm |
| Nothing disappears silently | Dropped, list-only and merged counts on each row |
| Cost is visible | Each run's cost and the day's remaining budget next to Ask |

## 12. Testing

- Unit tests for `findings.js`, `dedupe.js`, `mapper.js` (schema and parsing), `research.js`
  (request shape, and reading `search_results` and `fetch_url_results` from recorded response
  fixtures), `store.js`, the budget sum, the client records and the marker shapes.
- `scripts/qa-searches.mjs --fixtures`, modelled on `scripts/qa-news.mjs`, stubs both calls in the
  page. It covers: ask and the running state; a finished search on the globe; a second search with
  a merged finding; toggles and the 8-colour limit; Update; delete; bubbles and the place chip;
  Cyber and narrow widths; Cockpit collapse. No test makes a live call.
- Live: after merge, the owner asks two real questions, one about news and one "where are". The PR
  records their cost, steps and timings.
- Docs: `docs/SEARCH-LAYERS.md`, a `DATA_SOURCES.md` entry (Perplexity web search, Nominatim), a
  changelog entry and `docs/CURRENT-STATE.md`.

## 13. Open points for the owner

Proposed by this spec, to confirm or change:

1. **Updating (section 7):** a snapshot plus a manual Update that keeps old findings. Alternative:
   Update replaces them.
2. **Code organizes the globe, not a second agent:** colour by search, shape by kind.
3. **Two calls per run:** research, then map.
4. **One shared daily budget**, $2.00 unless raised.
5. **At most 8 searches visible** at once.

## 14. Phases

- **Phase 1 (this spec, one PR):** everything above.
- **Phase 2 (owner, recorded 2026-11-06):** the research step moves from Perplexity to Claude or
  Codex, with a toolkit of MCP servers and APIs for stable, faster sources. Candidates to evaluate
  then: GDELT, ReliefWeb (needs the app id), ACLED, Wikidata and OpenStreetMap for places, official
  statistics and market-data APIs, and the app's own MCP tools for live flights, ships and fires
  (`server/mcp/`). The Perplexity SDK also declares an `mcp` tool type (`server_url`,
  `allowed_tools`), so remote MCP servers are reachable from the current provider too; that is
  context for the choice, not a change to the decision.
- **Later:** lines between places (trade or migration routes), areas drawn as outlines, follow-up
  questions inside a search, pinning a search as a theater that updates with each Refresh, a Brief
  per search, and the war monitor's "evidence nearby" from live layers.

**The existing roadmap:** this feature replaces the war monitor's Phase 2 "per-story deep dive with
web search". War monitor Phase 3 and Brief phases B and C wait until search layers ship.
