# War monitor

The War monitor turns a curated set of news feeds into mapped stories for one
theater. Phase 1 covers **Iran · Israel · US**. It has three parts:

1. **Collect.** Free and keyless. Feeds are fetched on timers and kept for 72
   hours.
2. **Digest.** Paid and manual. One model call per **Refresh** groups the new
   items into stories.
3. **Map.** Each story with a known place is one pin on the globe. The
   Situation panel lists every story and every collected item.

**Headlines and stories are reporting, not verified incidents or risk
rankings.** Everything below is about where a claim came from, never about
whether it is true.

Design: [`superpowers/specs/2026-10-25-war-monitor-design.md`](superpowers/specs/2026-10-25-war-monitor-design.md).
Sources and terms: the War monitor section of
[`../DATA_SOURCES.md`](../DATA_SOURCES.md).

## Using it

1. Turn on **War Monitor** in the layer panel's Events group. The **Situation**
   panel opens in the right rail.
2. Headlines start arriving within a minute. The **Raw feed** tab shows them by
   folder (Reporting, Official, Local, Armed group, Verification,
   Humanitarian, Analysis). Each item is marked as not digested yet,
   unassigned, or attached to a story.
3. Add `PERPLEXITY_API_KEY` in Provider Settings (or `.env`).
4. Press **Refresh**, or say "refresh news". After the digest:
   - pins appear for located stories;
   - the **Stories** tab lists every story, including list-only ones;
   - the digest line reads, for example:
     `Digest 14:02 · 23 stories from 312 items · 9 unassigned · last run 18¢ · budget $1.42 left`.
5. The category chips filter the pins and the story list together. The choice
   is kept in share links.
6. Open a story row to see:
   - its claims;
   - what's new since the last digest;
   - any contradictions;
   - every cited item, with publisher, perspective, folder, published /
     fetched / digested times, the original title and a link to the original.

   Opening a located story selects its pin and flies there.

Voice:

- "refresh news" runs one digest and reads back the outcome.
- Questions about stories ("what's corroborated near Isfahan?") go through the
  analyst query over the `news` layer and never trigger a digest.
- "open the situation panel" opens the panel.

The Refresh control is disabled with a reason when:

- there is no key;
- today's budget is used up;
- a digest is already running;
- nothing new has arrived since the last digest.

## Collect

The server collects for the theater only after the first `/api/news` request.
Starting the dev server alone fetches nothing.

| Transport         | Cadence | How                                                                                                                                                                                                                                |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rss`             | 10 min  | RSS 2.0 and Atom, gzip/deflate, charset-aware, 4 MB cap. The parser is shared with the cockpit regional briefing (`server/providers/common/rss.js`).                                                                               |
| `gdelt-domain`    | 15 min  | GDELT DOC 2.0 `artlist` queries, `domainis:` OR-groups of up to 10 domains, at most 239 query characters with the terms, 24 h window. One process-wide queue, 5.5 s between requests, doubling backoff after a 429 (up to 15 min). |
| `telegram-public` | 5 min   | The public web preview at `t.me/s/<channel>`. No account, bot or API. Flagged **fragile**: the markup can change.                                                                                                                  |
| `reliefweb`       | 30 min  | ReliefWeb API v2 reports for the theater's countries. Off unless `RELIEFWEB_APPNAME` is set.                                                                                                                                       |
| `link-only`       | never   | Listed in the Raw feed folders as a link to the publisher.                                                                                                                                                                         |

Outlets whose feeds sit behind bot protection are never scraped. They arrive
through GDELT with a link to the publisher.

Each source reports its health: ok, error, blocked (401/403/451), rate
limited, disabled, link-only, fragile, loading or stale. Stale means the last
success is older than two poll cadences, or the source is quiet: it answers,
but its newest entry is older than the 72 h retention, so it delivers nothing
(the panel says "nothing new since" that date). The panel header shows a "N
sources degraded" indicator with the reasons.

Items are deduplicated on the canonical URL and on title plus publisher. Each
source keeps at most 60 items. Items are kept for 72 hours in
`.gev-cache/news/<theater>.json`. What is kept:

- the title (up to 220 characters) and a snippet (up to 300 characters);
- the link and the publisher;
- the published and fetched times.

Article bodies are never fetched. Collection never translates; the digest
writes the English story headline.

## Digest

The digest runs only on an explicit Refresh: the panel button, the
`refresh_news` voice action, or `POST /api/news/digest`. Nothing schedules it.

**The call.** One request to the Perplexity Agent API:

- `POST https://api.perplexity.ai/v1/agent` (the documented endpoint; the
  earlier `/v1/responses` path is no longer documented for creating one);
- `model: "anthropic/claude-sonnet-5-5"`;
- `tools: []` and `max_steps: 1`, so it does no search and takes one step;
- no `preset` and no `effort`;
- `max_output_tokens: 64000`. Hidden reasoning counts toward it. Two live runs
  used about 14,300 tokens each, 3,100 to 3,700 of them reasoning, so the
  limit leaves room for the 400-item and 60-open-story caps. Only tokens
  actually written are billed. The rules ask for short stories with at most
  five claims each, and code keeps only the first five;
- `response_format: {type: "json_schema", json_schema: {name, schema, strict: true}}`.

These field names were checked against the official Perplexity SDK types and
OpenAPI spec (`perplexity-node` `src/generated/api.ts`). They were not guessed
from other APIs.

The schema uses only what Claude structured outputs accepts: `anyOf` for
nullable fields, `enum`, required keys and `additionalProperties: false`.
Bounds are enforced in code after parsing.

**The input:**

- fixed instructions;
- the theater brief and categories;
- the gazetteer's place names;
- up to 60 open stories: id, title, category, place name, event time, cited
  ids and claims;
- up to 400 new items: id, publisher, kind, perspective, published time,
  title and snippet.

When more than 400 items are waiting, starred sources go first. The rest stay
undigested for the next Refresh, and the run records how many were left out.

**Validation:**

- Unknown item ids are dropped and counted.
- An item can belong to only one story.
- A story left with no valid ids is rejected.
- Story ids must be open stories that were sent.
- Unknown categories are clamped to the configured list.
- Anything URL-shaped in the model's text is stripped.

**Outcomes.** The route answers:

| Status            | Meaning                                                                                                                                                        | Recorded as a run?                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 503 `no_key`      | No key is configured.                                                                                                                                          | —                                        |
| 409 `in_flight`   | A digest is already running.                                                                                                                                   | —                                        |
| 429 `over_budget` | Today's budget is used up.                                                                                                                                     | —                                        |
| 200 `skipped`     | Nothing new since the last digest. No call is made.                                                                                                            | Yes, at $0                               |
| 200 `ok`          | The digest ran.                                                                                                                                                | Yes                                      |
| 502               | The call failed: `auth`, `rate_limited`, `upstream`, `model_error`, `malformed_output`, `truncated` (the answer hit the output limit), `network` or `timeout`. | Yes, with its reported or estimated cost |

A failed run that was still billed keeps its cost. A call that timed out (after
15 minutes, room for a full answer at the measured 95 tokens a second) or was cut off mid-answer returns no usage, so it is charged a
worst-case estimate instead: the input size plus a full 64k-token answer, at
list price.

**Cost and budget.** Every run records `usage.cost.total_cost` from the
response. If a response omits it, the cost is estimated from the token counts
at list price ($2 input / $10 output per million tokens) and flagged as an
estimate.

`NEWS_DIGEST_DAILY_BUDGET_USD` (default 2.00) is checked before each run
against the day's recorded spend, by local calendar day. Because the check
happens before the call, the run that crosses the cap is allowed to finish.

The key, the request bodies and the response bodies are never logged. The
server logs one line per run: counts and cost.

**Story lifetime:**

- An open story untouched for 48 hours closes.
- So do the oldest open stories beyond 60.
- Closed stories, with snapshots of the items they cite, are kept until 7
  days after their last update.
- Run records are kept for 30 days, at most 500. Today's billed runs are never
  dropped by that cap, since the budget sums them.

Story ids stay stable from run to run. The model updates an open story by
returning its id. New stories get `st_` ids that code mints.

## Who owns what

| The model writes                | Code computes                                                                                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Story title and summary         | **Location**: the gazetteer match for the model's place name first. Model coordinates are used only when nothing matches; the pin is then drawn with a dashed outline and labelled model-placed. Otherwise the story is list-only and counted. |
| Category (one of six)           | **Perspectives**: the distinct perspectives of the cited items.                                                                                                                                                                                |
| Place name and event time       | **Source count**: the distinct publishers among the cited items.                                                                                                                                                                               |
| Which item ids it cites         | **Verification label**, for the story and for each claim, from the cited items only.                                                                                                                                                           |
| Claims (text, actor, type, ids) | Which cited ids are real (each is checked against the store).                                                                                                                                                                                  |
| What's new and contradictions   | Ids, open/closed status and retention.                                                                                                                                                                                                         |

The model never returns URLs. Every link shown comes from a collected item.

The gazetteer is `public/news/theaters/iran-israel-us.json`: 259 places with
Hebrew, Arabic and Persian aliases. Matching:

- folds case and diacritics, Arabic letter variants and Hebrew points;
- tries an exact or article-stripped match first;
- otherwise takes the longest contained name on word boundaries, and among
  separate mentions the most precise one (site, then locality, city, region
  or water, country).

Coordinates are approximate: city centroids and publicly reported site
locations.

## Verification labels

Code applies the first rule that holds:

1. **Corroborated.** Two cited items that:
   - come from different perspective groups;
   - include at least one independent, humanitarian or verification outlet;
   - do not trace to the same primary source: the same statement URL or the
     same issuer. Official and armed-group posts are their own primary
     source. An RSS entry whose text links to an official or armed-group
     website (not a shared platform such as Telegram or X) records that
     statement as its primary source. ReliefWeb reports carry their
     authoring body.
2. **Disputed.** The digest recorded contradictions and nothing corroborates.
3. **Participant claim.** Every cited item comes from a party to the conflict
   or a state outlet. The pin is drawn with a ring.
4. **Reported.** Anything else.

Each claim gets its own label from the items it cites. A claim that cites
nothing takes the story's label.

**What the labels do not mean:**

- **Corroborated** is not "confirmed". Two outlets from different camps
  carried the claim, and at least one of them is registered as independent,
  humanitarian or verification rather than as a state outlet or a party to
  the conflict. Both can be wrong. Both can be repeating an unnamed shared source that code
  cannot see.
- **Participant claim** is not "false". It means only parties to the
  conflict or state media have said it so far.
- **Disputed** means the cited items disagree on something: a number, an
  attribution or whether it happened. It does not say which side is right.
- **Reported** is not a weaker "corroborated". There is not yet a second
  independent perspective among the cited items.
- **Source count** counts publishers, not witnesses.
- **Category** and pin size (by source count) are not severity or risk.
- **A pin's position** is the story's place name resolved through the
  gazetteer, at the precision of that entry (country, region, city, site).
  It is not an impact point. Model-placed pins are less reliable still.

Perspectives come from the registry
([`public/news/sources.json`](../public/news/sources.json)): one label per
outlet, grouped into camps by the theater file. They describe an outlet's
usual vantage point, not any one article.

## Configuration

| Setting                        | Default | Effect                                                                                                         |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------- |
| `PERPLEXITY_API_KEY`           | unset   | Turns on the digest. Without it, collection and the Raw feed still work and Refresh is disabled with "no key". |
| `NEWS_DIGEST_DAILY_BUDGET_USD` | `2.00`  | Daily spend cap.                                                                                               |
| `RELIEFWEB_APPNAME`            | unset   | Turns on the ReliefWeb source.                                                                                 |

Sources live in `public/news/sources.json`. The theater lives in
`public/news/theaters/<id>.json`: brief, categories, perspective groups,
GDELT terms and gazetteer. Both are validated at load. An unknown folder,
kind, transport or category, a duplicate id, or an ambiguous gazetteer
spelling throws.

## Routes

- `GET /api/news?theater=<id>&rev=<n>` returns the snapshot:
  - items, stories and citations;
  - sources with their health;
  - the last run and the last digest;
  - budget and digest state.

  If `rev` matches, it returns `{unchanged: true}`.

- `POST /api/news/digest?theater=<id>`: same-site only and rate limited. See
  [Digest](#digest).
- `GET /api/news/status`: collection health per theater.

## Code

| Part                           | Path                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| Registry, gazetteer matcher    | `server/providers/news/registry.js`, `geocode.js`                            |
| Fetchers                       | `server/providers/news/fetchers/`                                            |
| Item store, collector, routes  | `server/providers/news/store.js`, `collector.js`, `index.js`                 |
| Digest call and validation     | `server/providers/news/digest/runner.js`                                     |
| Code-owned story fields (pure) | `server/providers/news/digest/stories.js`                                    |
| Stories and run history        | `server/providers/news/digest/store.js`                                      |
| Browser source and records     | `src/layers/news/source.js`, `records.js`                                    |
| Layer: pins, cards, selection  | `src/layers/news/index.js`, `model.js`                                       |
| Situation panel                | `src/ui/situationPanel.js`, `situationPanelModel.js`, `styles/situation.css` |
| Fixture QA                     | `npm run qa:news:fixtures` (`scripts/qa-news.mjs`)                           |

## Known limits (Phase 1)

- **One theater.** The theater selector is wired, but only Iran · Israel · US
  is configured.
- **Unchecked feeds.** The feed URLs were taken from publisher pages and the
  design's probe table. They were not fetched from the build sandbox, which
  blocks those hosts. A feed that moved shows as degraded, not as an empty
  panel.
- **Fragile Telegram previews.** They depend on Telegram's public preview
  markup.
- **Out of scope:**
  - evidence-nearby counts;
  - per-story deep dives with search;
  - correction tracking;
  - stored history beyond the retention above;
  - more theaters.
