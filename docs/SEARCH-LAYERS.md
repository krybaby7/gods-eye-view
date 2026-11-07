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

## Local data

Search records and run history are stored on the server machine in `.gev-cache/searches/`. Each agent run uses an ephemeral working directory under `.gev-cache/search-runs/`, removed after the run. Search endpoints are localhost-only. Questions and source material are sent to Claude and its web tools during a run. Search-layer source details and geocoding attribution are in [Data Sources](../DATA_SOURCES.md#search-layers).

For unresolved named places, the app uses Nominatim only when you ask or update a search. It caches queries, shares the app's 1.1-second queue, and makes at most 15 lookups per run. The public endpoint is for moderate use. For a local or alternate Nominatim instance, set `SEARCH_NOMINATIM_ENDPOINT` to its complete `/search` URL and restart the app. [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
