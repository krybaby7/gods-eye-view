# Search layers: ask the globe, get a layer

Date: 2026-11-06, revised 2026-11-07 with the owner's answers. Status: design, agreed with the
owner, not built. Builds on `docs/WAR-MONITOR.md`, `2026-10-25-war-monitor-design.md` and
`2026-10-29-world-hotspot-view-design.md`.

## 0. Shape in one paragraph

The owner asks the globe a question in plain words: "what's going on with crypto?", "who's talking
about the Sudan ceasefire?", "where are the world's lithium mines?". Claude Code, running on the owner's subscription, searches the web. A second call turns what it found
into **findings**: events, statements, places and country-wide facts, each tied to a place and to
the pages it came from. Code checks them, places them and saves them as a **search layer**: a row in
a new Searches panel, labelled by the question, toggled on and off on its own, drawn on the globe in
its own colour. Every new question adds another layer. Updates keep every earlier answer, so the
owner can go back to any past day and see what the globe said then. When two searches find the same
thing, code draws it once and says it belongs to both. The war monitor's rule carries over: the
model writes the content; code decides where it goes, how it looks, which links are real and what
counts as corroborated.

## 1. Decisions (owner)

2026-11-06:

- Same globe, no separate mode. Live layers (flights, ships, fires, the war monitor) stay usable
  next to search layers. Seeing an answer next to live data is the point of the feature.
- Any question the owner would ask a globe: news about anything, who is saying what, and where
  things are. Not how-to questions. The answer always comes back as findings on the globe; the text
  answer is a short summary over them, and every finding can be opened for detail.
- Each search becomes its own layer, labelled by the question and toggled on its own. Searches add
  up.
- Duplicates across searches are merged by code.

2026-11-07:

- **No Perplexity.** The search agents run on the owner's **Claude and Codex subscriptions**,
  through the official command-line tools signed in on the owner's machine (section 4.1). The owner
  chooses the default agent in Provider Settings and can override it per search once multiple agents ship.
- **Claude first.** Phases 1 and 2 ship only Claude Code. Codex is deferred because the documented
  public controls do not establish the web-only and tools-off modes this feature requires, and
  the subscription terms for this integration remain unconfirmed. Provider Settings shows Codex
  as "not available yet" and the Searches panel offers Claude only.
- **No budget.** Searches are never refused for cost. Each run still shows what it used (time, and
  tokens or cost when the tool reports them).
- **History.** Updates keep every earlier answer. The owner can go back to any past day and see each
  search as it stood then, and searches stay organized by day in a history (section 7).
- **Code organizes the globe**, not a second agent: colour by search, shape by kind. The owner will
  develop this code further later.
- **Two calls per run:** research, then map.
- **At most 8 searches visible at once**, as one constant, to revisit after seeing it on the globe.
- **Phase 2** gives the agents a toolkit of MCP servers and APIs that reach stable sources faster,
  and tunes their web access and speed (section 14).

## 2. Words used here

- **Search:** one question and everything it produced, across all its runs. One row in the Searches
  panel, one colour on the globe.
- **Run:** one execution of a search: the first ask, a retry or an Update. Every finished run is kept
  as a snapshot.
- **Finding:** one thing a search found that can sit on the map. Four kinds (section 3.2).
- **Source:** one web page the research step actually retrieved. Code numbers them; findings cite
  those numbers.
- **Agent:** the program that does the research and map calls: Claude (Claude Code) or Codex (Codex
  CLI), behind one adapter interface.

## 3. Data

### 3.1 Search record (`.gev-cache/searches/<id>.json`)

```json
{
  "id": "sr_9c41",
  "question": "What's going on with crypto?",
  "label": "Crypto this week",
  "agent": "claude",
  "colorIndex": 2,
  "visible": true,
  "pinned": false,
  "createdAt": "2026-11-06T14:02:00Z",
  "status": "ready",
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
      "checkedBy": "tool-result",
      "firstRunId": "run_..."
    }
  ],
  "findings": ["section 3.2: every finding any run produced"],
  "runs": [
    {
      "id": "run_...",
      "kind": "ask",
      "agent": "claude",
      "agentModel": "...",
      "startedAt": "2026-11-06T14:02:00Z",
      "finishedAt": "2026-11-06T14:03:10Z",
      "status": "ok",
      "answer": {
        "summary": [{ "text": "US and EU regulators both moved on stablecoins...", "sourceIds": ["s3", "s7"] }],
        "groups": [
          { "id": "g1", "label": "Regulation" },
          { "id": "g2", "label": "Markets" }
        ]
      },
      "findingIds": ["f_2b7e", "..."],
      "usage": { "durationMs": 70000, "inputTokens": null, "outputTokens": null, "costUsd": null },
      "sourceCount": 38,
      "droppedNoSource": 2,
      "listOnly": 3
    }
  ]
}
```

- `label`: written by the model (at most 40 characters), editable by the owner. `question` is kept
  verbatim.
- `agent`: the default agent for this search's Updates; each run records the agent that ran it.
- `colorIndex`: assigned by code: the lowest palette slot no other visible search uses (6.1).
- `visible` and `pinned`: the owner's toggles, stored on the server so they survive a reload. Not in
  share links: searches exist only on this machine.
- `status`: `running | ready | failed`. A failed first run keeps the record so the owner can retry
  or delete it. On server start, a record still `running` becomes `failed` with reason
  `interrupted`.
- **Snapshots.** A run's `findingIds` and `answer` are that run's answer as it stood. Findings are
  stored once per search and never rewritten by a later run, except `lastSeenAt`. That keeps history
  cheap and exact (section 7).
- `usage`: whatever the agent reports. `null` fields are normal on a subscription.
- Index: `.gev-cache/searches/index.json` holds id, label, status, `createdAt`, the latest run's
  `finishedAt`, `colorIndex`, `visible` and `pinned` for each search, so the panel loads fast. Every
  write is atomic (temporary file, then rename), as the digest store does.

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
  "firstRunId": "run_...",
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
`sourceCount`, `firstRunId`, `firstSeenAt`, `lastSeenAt`, every URL, `colorIndex`, and the merges
across searches (section 5).

### 3.3 Caps

- 60 findings per run; 6 groups per run; 80 sources passed to the map call (most-cited by the notes
  first, then newest, when there are more).
- Questions longer than 500 characters are refused in the panel.
- 15 Nominatim lookups per run (4.3).
- `MAX_VISIBLE_SEARCHES = 8`, one constant. Turning on a ninth is refused with "Hide a search first:
  all 8 colours are in use".
- One run at a time per agent. A run that passes its time limit (`SEARCH_RUN_TIMEOUT_MS`, default 10
  minutes) is stopped and marked failed.
- No cap on stored searches or runs. Deleting a search removes its file.

## 4. The run

```
question ─▶ research step ─▶ numbered sources + notes ─▶ map step ─▶ findings JSON ─▶ code checks ─▶ saved run ─▶ globe and panel
            (web access on)                              (no tools, JSON only)
```

Two steps rather than one, on purpose:

1. JSON output never has to share a step with tool use.
2. The map step works like the war monitor's digest: the model sees numbered sources and cites
   numbers, never URLs. Code already enforces that contract.
3. Phase 2 changes the research step's tools without touching the rest.

### 4.1 Agents (the seam)

One interface, in `server/providers/search/agents/`:

```js
research({ question, since, previousFindings, signal }) → { notes, sources, usage, agentModel }
mapFindings({ prompt, schema, signal })                 → { json, usage, agentModel }
```

Adapters implement it, and the rest of the run pipeline uses the same interface for every agent:

- `claude.js`: Claude Code, signed in with the owner's Claude subscription. It runs non-interactively
  with machine-readable output (headless mode).
- The Codex adapter is deferred to Later (§14).

Rules for both:

- **Official, documented mechanisms only.** The server starts the installed command-line tool as a
  child process, with the owner's existing sign-in. It never reads, copies or forwards session
  tokens, and never calls private endpoints. Before building, the implementer confirms against each
  product's current documentation and terms that this use, by the owner, on the owner's machine, is
  supported. If it is not, they stop and ask the owner instead of working around it.
- **No secrets in this repository.** Sign-in stays with each tool. Provider Settings shows whether
  each tool is installed and signed in (from its own status command), which agent is the default,
  and how to sign in.
- **Contained runs.** Each run gets a fresh empty working directory under `.gev-cache/search-runs/`,
  no file-writing or shell tools, only the web tools the step needs, and a timeout. Cancel kills the
  child process tree.
- **Research step:** web search and page fetch on (in Phase 1, each tool's built-in web access).
  Instructions: today's date; the answer will be shown on a globe, so find where things happen, who
  is involved and where they are based, and where things are; prefer primary and established
  sources; for questions about now, prefer the last two weeks unless the question asks for history;
  name places precisely (city and country, or coordinates when a source gives them). On an Update,
  also the previous findings and "since <date of the previous run>".
- **Map step:** no tools, a JSON schema, and the tool's structured-output option if it has one.
  Otherwise code parses the reply strictly and asks once for a corrected reply when it fails to
  parse.

**Links are real.** The research adapter returns as sources only pages its tools actually returned,
read from the tool's machine-readable event output (the web search results and fetched URLs). If a
tool cannot expose them, code confirms each cited URL itself before accepting it: one capped GET
through the server's existing capped-fetch helpers, timeouts on, redirects followed only within the
same site. Such sources are marked `checkedBy: "fetch"`, the others `"tool-result"`. Code
canonicalizes URLs with `canonicalizeUrl` (`server/providers/news/store.js`), drops repeats and
numbers them `s1…sN`. Only these pages can ever be shown as a finding's source.

**Tests never need a subscription.** Each adapter's command line is built by a pure function, and
its output is read by a pure parser. Tests drive them with recorded output fixtures and a fake
executable. Live runs happen only on the owner's machine.

### 4.1a Adapter details (verified 2026-11-07)

Start each installed executable from Node with an argument array, a fresh working directory,
stdin for the prompt, and separate stdout and stderr. The executable owns sign-in. Do not load
its credential files or supply a session token.

**Claude Code.** Use `claude -p --output-format stream-json --verbose` for research, with
`--restricted --no-chrome --no-session-persistence --permission-mode dontAsk`.
`--tools WebSearch,WebFetch` selects the built-ins and `--allowedTools WebSearch,WebFetch`
preapproves them. Use `--strict-mcp-config` and deny `mcp__*` for Phase 1. Pair
`assistant.message.content` tool-use blocks with matching successful
`user.message.content` tool-result blocks via the tool-use ID. Read search URLs from the
result payload. Use a WebFetch URL only when the paired response confirms retrieval. The
final `result` event includes text and usage. For mapping, use `--tools ""`,
`--output-format json --json-schema <schema>` and read `structured_output`. For one-run MCP
configuration, use `--strict-mcp-config --mcp-config <json-file>` with a per-tool allowlist.
`--model <alias-or-id>` chooses the model. `claude --version` checks installation and
`claude auth status --json` checks for `loggedIn` with `authMethod: "claude.ai"`. The installed
version was 2.1.302 and reported subscription sign-in. Anthropic's consumer terms allow
automation where Anthropic explicitly permits it. Anthropic documents `claude -p` on a
signed-in subscriber's plan and recommends API credentials for tools built for others.
[CLI reference](https://code.claude.com/docs/en/cli-reference) ·
[Headless output](https://code.claude.com/docs/en/headless) ·
[MCP configuration](https://code.claude.com/docs/en/mcp) ·
[Subscription usage](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) ·
[Sign-in guidance](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account) ·
[Consumer terms](https://www.anthropic.com/legal/consumer-terms)

**Codex CLI.** Use `codex exec --json --skip-git-repo-check --ephemeral -` for JSON Lines and
stdin. `-m <model-id>` chooses the model. `-c 'web_search="live"'` enables built-in live search
and page opening. Completed `web_search` items can include `item.results`. Use URLs in those
results. An `open_page` action URL describes the request. If the response omits result
URLs, section 4.1's capped GET fallback applies. The final `agent_message` contains the
answer and `turn.completed.usage` reports tokens. Use `--output-schema <file>` for the map
response and `-c 'web_search="disabled"'` to turn off web access. Pass MCP servers as
invocation-only TOML overrides (`-c mcp_servers.<id>…`) with `enabled_tools` and
`--ignore-user-config`. `codex --version` and `codex login status` verify installation and
ChatGPT sign-in. The installed version was 0.164.0 and reported ChatGPT sign-in.
[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) ·
[Web search](https://learn.chatgpt.com/docs/web-search) ·
[CLI reference](https://learn.chatgpt.com/docs/cli/reference) ·
[Config reference](https://learn.chatgpt.com/docs/config-file/config-reference) ·
[JSONL event schema](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/exec/src/exec_events.rs)

**Codex containment and terms gate.** The documented `--disable shell_tool` disables shell
execution tools. In both 0.164.0 and 0.167.0, `apply_patch` is registered separately for
models that advertise it. A read-only sandbox restricts writes while the tool remains
available. The public CLI and app-server documentation do not provide an allowlist for the
entire tool set. The documented local catalog override can change model metadata, but
editing internal tool fields is not a documented guarantee that every other tool is absent.
OpenAI documents scripted JSONL consumption and reuse of saved CLI authentication.
Its individual Terms of Use also restrict programmatic extraction of data or output.
The public documentation does not expressly reconcile that clause for this app integration.
The owner decided on 2026-11-07 to ship Claude only in both phases. This preserves the
adapter interface for a future Codex or OpenAI API integration.
[Installed version tool registration](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/tools/spec_plan.rs) ·
[Current release tool registration](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/core/src/tools/spec_plan.rs) ·
[App-server protocol](https://learn.chatgpt.com/docs/app-server) ·
[Codex subscription terms guidance](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) ·
[OpenAI individual Terms of Use](https://openai.com/policies/row-terms-of-use/)

Only the installed version and sign-in status were checked locally. No live research or map
prompts were sent.

### 4.2 Map step

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
7. **Times.** `firstRunId` and `firstSeenAt` when a finding is created; `lastSeenAt` whenever a run
   cites it again.

## 5. Duplicates across searches (`server/providers/search/dedupe.js`, pure)

Applied when `GET /api/searches` is served, over the snapshots being shown (the latest runs, or the
runs of the chosen day in history), so a stored search never changes because of another one.

Two findings from different searches are the same thing when they have the same kind and:

- they **share a source** (same canonical URL) and sit in the same hotspot or within 50 km; or
- for **places**, their normalized names match (`normalizePlaceName`) within 25 km; or
- for **events and statements**, they share a hotspot, their `eventAt` times are within 24 hours,
  and their titles overlap by at least 0.6 (Jaccard over normalized words).

These thresholds are starting values. Fixture tests pin them with realistic pairs: two crypto
searches, two Sudan searches, and lithium mines asked twice.

Each merged group gets a `mergeKey`. While any member search is visible, the globe draws the
finding once, with its marker split between the visible members' colours. In the panel each member
search lists it with "Also in: Crypto this week". Hiding one search keeps the marker as long as
another member is visible.

A finding that cites a URL also cited by a story in the war monitor's current snapshot shows "Also
in the war monitor: <story title>", with a link that opens that story. It is not merged with war
monitor pins.

## 6. Globe: the `searches` layer

### 6.1 Look

- One new catalog layer, **Searches**, in the layer panel's Events group after War Monitor, with its
  own share token from `npm run layer-token:next`. The token only records that the layer is on.
- **Colour is the search.** A fixed palette of 8 colours that stay distinct from each other on the
  dark and satellite map styles and differ from the war monitor's category colours.
- **Shape is the kind:** event ● circle; statement ■ rounded square; place ◆ diamond; area ◯ hollow
  ring at the country or region's position.
- Size follows source count, as for news pins (`newsMarkerSizePx`). A dashed outline means the model
  placed it. A dot means new in the run being shown.
- Zoomed out, above 3,500 km and with the news layer's hysteresis (`newsMapMode`): one bubble per
  hotspot, its ring split by search colour, the count inside. Reuse `aggregateHotspots` by passing
  each search as a category (id and colour).
- Hover card: title, the search's label and colour, kind, place and basis ("placed where the speaker
  is based"), time, source count, verification label.
- Clicking a marker selects it, flies there (`requestWorldFocus`) and opens the finding in the panel.
  Clicking a bubble flies in and sets a place filter in the panel, as in the hotspot view.
- While the panel shows a past day (section 7), the layer draws that day's snapshots and the panel
  says so with an "As of 4 Nov · Back to now" bar.

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
- Data loads when the layer turns on, after each run and after panel actions. There is no timer, as
  in the news layer. While a run is in flight the panel polls `GET /api/searches?rev=` every 3 s and
  stops when the run ends.

## 7. Updates and history

**Update.** Each search row has **Update**, which runs both steps again with the same question, the
previous findings and "since <date of the previous run>". The result is a new run, a new snapshot:

- new findings appear with the "new" dot;
- findings the Update cites again (`sameAs`) get a new `lastSeenAt` and are part of the new snapshot;
- findings it doesn't mention are not in the new snapshot. They stay in the earlier ones and in the
  search's "Earlier findings" list, marked "not seen since <date>".

Nothing is ever deleted by an Update. The owner can delete a single finding (from every snapshot) or
a whole search. Updates are manual only and never run on a timer.

**Going back in time.** The panel has a day picker: Now, then every day that has a run.

- Choosing a day shows, for each search, its latest run that finished on or before the end of that
  day. Searches created later are hidden while the day is chosen.
- The globe, the counts, the merges and the finding lists all follow the chosen day.
- Each search's row also lists its runs ("Asked 4 Nov 14:02 · Updated 6 Nov 09:15 · Updated today
  08:40"). Choosing one shows that search as of that run, alone or with the others at the same day.
- A **Changes** view compares two runs of a search: added, seen again, not seen since.
- "Back to now" returns to the latest runs.

**Organized history.** The search list is grouped by day of the latest run: Today, Yesterday, then
dates. Pinned searches stay at the top. The owner can rename a search and filter the list by text.
Folders or tags are later work (section 14).

## 8. Searches panel

A right-rail panel, `#searches-panel`, built like the Situation panel (`src/ui/situationPanel.js`).
It is mounted through an `attachSearches(factory)` hook in `src/ui/layerPanel.js`, beside
`attachSituation`, called from `src/app/tools.js`, and opens when the layer turns on. It follows
`docs/panel-surfaces.md`, the Cyber one-panel rule, Cockpit collapse, Clean UI and recording.

**Top:**

- An ask box (a textarea: Enter asks, Shift+Enter starts a new line), an agent choice (Claude for Phases 1 and 2) and **Ask**.
- While running: "Searching the web… 0:41", then "Placing findings… 1:02", with **Cancel**.
- A usage line for the last run: its time, and tokens or cost when the agent reported them.
- Ask is disabled, with the reason shown, when the chosen agent isn't installed or signed in, a run
  is already going on that agent, or the box is empty.
- The day picker and the "As of … · Back to now" bar (section 7).

**Search list,** grouped by day as in section 7:

- A colour swatch that toggles visibility; the label; "as of 14:03"; counts such as "21 on the
  globe · 3 list-only · 2 also in other searches"; a status (running, or failed with Retry); a pin.
- A menu: Update, Changes, Rename, Show question, Delete (confirmed inside the panel).

**An open search:**

- The summary sentences of the run being shown, each with its source chips.
- Its runs, to step through history.
- Group chips that filter the list and that search's markers.
- The findings by group: kind icon, title, place, time, verification label, "also in". Each one
  expands to its summary, placement basis and sources (publisher, date, title, link to the original,
  and "checked by fetch" when that applies).
- List-only findings under "Not on the globe", and findings from earlier runs under "Earlier
  findings".
- The place chip from a bubble click, as in the Situation panel.

## 9. Server: `server/providers/search/`

A new package, `search-provider`, in `scripts/package-boundaries.json`, depending on `news-provider`
for the pure functions it reuses.

| File | Job |
|---|---|
| `agents/index.js` | The interface, agent selection and status. |
| `agents/claude.js` | Claude adapter (4.1): command lines, process control, output parsing. |
| `research.js` | The research step's instructions and source collection. |
| `mapper.js` | The map step's prompt, JSON schema and validation. |
| `findings.js` | The code checks (4.3), pure. |
| `dedupe.js` | Merges across searches (5), pure. |
| `history.js` | Snapshots by run and by day, and run comparisons (7), pure. |
| `store.js` | Search files and the index, atomic writes. |
| `index.js` | Routes and the per-agent run queue. |

Routes, same-site gated and rate limited like `/api/news`:

- `GET /api/searches?rev=&asOf=`: every search with the findings of the snapshot being shown, merge
  keys, war monitor links, agent status and `disabledReason`; `{ unchanged: true }` when `rev`
  matches. `asOf` is a day; without it, the latest runs.
- `GET /api/searches/:id/runs/:runId` and `GET /api/searches/:id/changes?from=&to=`.
- `POST /api/searches` with `{ question, agent? }`: 202 with the new id; the run continues on the
  server. 409 while that agent is busy; 503 when it isn't installed or signed in.
- `POST /api/searches/:id/update`, `POST /api/searches/:id/retry`, `POST /api/searches/:id/cancel`.
- `PATCH /api/searches/:id` with `{ label?, visible?, pinned?, agent? }`.
- `DELETE /api/searches/:id` and `DELETE /api/searches/:id/findings/:findingId`.

No budget and no daily cap for searches. The war monitor's digest keeps its own Perplexity setup
and budget unchanged; moving it to these agents is a separate, later decision.

## 10. Voice

- An `ask_globe` action in `src/voice/actionSchemas.js` and `src/voice/gevActions.js`: "ask the
  globe what's going on with crypto". It turns the layer on, posts the question with the default
  agent, says "Searching", and when the run ends reads back the label and count ("Crypto this week:
  21 findings on the globe"). Its hint in `server/providers/openai/toolDescriptions.js` says it runs
  a web search and should run only when asked.
- A `searches` entry in `src/voice/layerManifest.js`. Aliases: searches, search layers, findings.
  Query fields: title, kind, search label, place, actor, verification. Time field: `eventAt`. So
  "which of my searches mention Binance?" is an analyst query over stored findings, never a new
  search.

## 11. Rules to UI states

| Rule | UI |
|---|---|
| Links are real | Every source shown came from the agent's own tool results, or was fetched and confirmed by code; findings without one are dropped and counted |
| Placement is honest | A basis line on every finding; a dashed outline when the model placed it; list-only when no place fits |
| Uncertainty stays visible | A verification label on events and statements; "N sources" on places and areas |
| Answers age | "as of" on every search; history by day; "not seen since" on findings an Update didn't confirm |
| Nothing disappears silently | Dropped, list-only, earlier and merged counts on each search |
| Work is visible | Each run's duration, agent and reported usage |

## 12. Testing

- Unit tests for `findings.js`, `dedupe.js`, `history.js`, `mapper.js` (schema and parsing),
  `research.js` (source collection), both adapters (command lines, parsing recorded output, a fake
  executable for process control, cancel and timeout), `store.js`, and the client records and
  marker shapes.
- `scripts/qa-searches.mjs --fixtures`, modelled on `scripts/qa-news.mjs`, stubs the agents in the
  page. It covers: ask and the running state; a finished search on the globe; a second search with a
  merged finding; toggles and the 8-colour limit; Update and the "new" dot; the day picker, a past
  day and Back to now; Changes; delete; bubbles and the place chip; Cyber and narrow widths; Cockpit
  collapse. No test makes a live call.
- Live: on the owner's machine, two real questions per agent (one news, one "where are"), recorded in
  the PR with their durations and reported usage.
- Docs: `docs/SEARCH-LAYERS.md`, a `DATA_SOURCES.md` entry (the agents' web access, Nominatim), a
  changelog entry and `docs/CURRENT-STATE.md`.

## 13. Open points

None blocking. Revisit after first use: the visible-search limit, the merge thresholds, and the
palette.

## 14. Phases

- **Phase 1:** everything above, with Claude Code's built-in web access.
- **Phase 2:** a toolkit and benchmark for Claude Code.
  - MCP servers and APIs for stable, faster sources, chosen after a short evaluation. Candidates:
    GDELT, ReliefWeb (needs the app id), ACLED, Wikidata and OpenStreetMap for places, official
    statistics and market-data APIs.
  - The app's own MCP server (`server/mcp/stdio.js`; `docs/MCP_SETUP.md` already shows how Claude
    Code and the Codex CLI add it), so the agent can check live flights, ships and fires near a
    finding.
  - One MCP configuration that the server generates per run for whichever agent runs it, with a
    per-tool allowlist. Keys the owner adds go in Provider Settings, never in the repository.
  - Measure, per agent, the speed and quality on a fixed set of questions, before and after the
    toolkit, and record it in `docs/SEARCH-LAYERS.md`.
  - Phase 2 changes only `research.js` and the adapters' tool configuration.
- **Later:** Codex adapter: subscription with read-only sandbox, or metered OpenAI API.
  Folders or tags in the history; lines between places (trade or migration routes);
  areas drawn as outlines; follow-up questions inside a search; pinning a search as a theater; a
  Brief per search; the war monitor's "evidence nearby" from live layers; moving the war monitor's
  digest off Perplexity.

**The existing roadmap:** this feature replaces the war monitor's Phase 2 "per-story deep dive with
web search". War monitor Phase 3 and Brief phases B and C wait until search layers ship.
