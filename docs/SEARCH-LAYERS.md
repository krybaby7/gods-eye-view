# Search layers

Searches turn a question into a source-backed layer on the globe. Try “What's going on with crypto?” or “Where are the world's lithium mines?” Open **Events > Searches**, enter a question and choose **Ask**. Enter submits. Shift+Enter starts a new line.

## Setup

Install [Claude Code](https://code.claude.com/docs/en/setup) version **2.1.248 or later** on the machine running God's Eye View, then run `claude auth login` in a terminal and sign in with your own Claude subscription. See Anthropic's [authentication documentation](https://code.claude.com/docs/en/authentication) and [non-interactive usage](https://code.claude.com/docs/en/headless). Provider Settings lists Claude as the default and Codex as not available yet. If Claude is missing, too old, or not signed in, the panel explains why Ask is unavailable. A busy agent cannot start another run until its current run finishes or is cancelled.

## Reading a search

Each run researches the question and then places findings. Sources must have evidence from a web tool result or a bounded same-origin fetch. The panel links to the original sources. A source's publisher and perspective are matched against the news registry when possible. Events and statements may show a verification label; places and areas show source counts. Read the linked sources and placement basis alongside the summary.

Each search has its own colour. Circles are events, rounded squares statements, diamonds places, and hollow rings areas. A dashed outline means the model supplied the location. A finding without a usable location remains in the list only. A dot marks a finding new in the displayed run. Related findings from visible searches can share a marker, and a finding may link to a war monitor story citing the same source.

Up to eight searches can be visible at once. If all slots are occupied, a new search is created hidden. Hide another search to show it. Use the search's colour control to show or hide it. The panel can filter findings and markers by group, and filter searches by text. Pin a search to keep it at the top or rename its label without changing its question.

## Runs and history

The panel reports research and placement progress. **Cancel** stops an active run. You can retry a failed run. **Update** repeats the question with context from the previous run. It creates a new snapshot: findings seen again remain current, new findings are marked, and findings not mentioned remain available under earlier findings. Updates never run on a timer or automatically refresh.

The day picker uses UTC. A selected day shows the latest run finished by the end of that day for each search. The history view hides searches created later. Select an exact run to inspect that search alone, and use **Back to now** to return to current results. **Changes** compares two runs as added, seen again, and not seen since. Delete a finding to remove it from the search's snapshots, or delete the entire search using the panel confirmation.

## Research toolkit

Claude gets a fresh MCP configuration for each research run. The mapping step still receives numbered evidence and uses structured output with tools off.

| Source                 | Why it is included                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wikidata entity lookup | Keyless lookup for named places and coordinates when the item has them. Wikidata's structured data is CC0 and community-maintained. The adapter uses a bounded Action API lookup with an identifying User-Agent. [Data access](https://www.wikidata.org/wiki/Help:Data_access) · [API limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits)                |
| ReliefWeb reports      | Humanitarian reports give Claude an additional source. Add an approved appname in **Provider Settings → ReliefWeb · Search Layers** to enable the tool. ReliefWeb allows 10,000 read calls per day and original publishers retain their rights. [ReliefWeb API](https://apidoc.reliefweb.int/#appname) · [Response limits](https://apidoc.reliefweb.int/read/response/) |
| God's Eye View         | Three existing MCP tools can check aircraft, vessels and active fires in an area. Searches uses the app's bound loopback address. For a custom address, set `SEARCH_MCP_API_BASE` to the app's loopback origin. Only confirmed public evidence URLs qualify as sources. [MCP setup](MCP_SETUP.md)                                                                       |

GDELT DOC is keyless, but this repo's War Monitor source checks encountered 429s and other failures. ACLED requires an account and OAuth, and its licence needs separate review for this use. Public Overpass shares rate-limited infrastructure. Nominatim stays in the existing geocoding queue. The World Bank Indicators API is a candidate for historical statistics. [GDELT DOC](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) · [War Monitor source notes](WAR-MONITOR.md) · [ACLED terms](https://acleddata.com/eula) · [Overpass limits](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) · [World Bank API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392)

### Benchmark

Start the app and run `node scripts/bench-searches.mjs` on the machine signed in to Claude. The benchmark asks eight fixed questions twice, once with built-in web access and once with the toolkit. It records duration, sources, findings placed, list-only and dropped findings, how the sources were checked, and reported usage.

The report lands in `qa-artifacts/searches/benchmark.json`. Use `--url http://127.0.0.1:5182` for a different local port. Run `node scripts/bench-searches.mjs --fixtures` to exercise the report flow with synthetic answers and usage. Live before-and-after speed and coverage require a run on the owner's machine.

## Local data

Search records and run history are stored on the server machine in `.gev-cache/searches/`. Claude research with the toolkit uses a private operating-system temporary directory for its working files and MCP configuration. Other invocations use `.gev-cache/search-runs/`. The app removes each working directory after use. Search endpoints are localhost-only. Questions and source material are sent to Claude and its web tools during a run. Search-layer source details and geocoding attribution are in [Data Sources](../DATA_SOURCES.md#search-layers).

For unresolved named places, the app uses Nominatim only when you ask or update a search. It caches queries, shares the app's 1.1-second queue, and makes at most 15 lookups per run. The public endpoint is for moderate use. For a local or alternate Nominatim instance, set `SEARCH_NOMINATIM_ENDPOINT` to its complete `/search` URL and restart the app. [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
