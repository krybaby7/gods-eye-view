# War monitor

The War monitor turns a curated set of news feeds into mapped stories for one
theater at a time. Phase 1 covers **Iran · Israel · US**; the
[**World**](#world-theater) theater covers political news on every
continent. Pick the theater in the Situation panel's menu. It has three parts:

1. **Collect.** Free and keyless. Feeds are fetched on timers and kept for 72
   hours.
2. **Digest.** Paid and manual. One model call per **Refresh** groups the new
   items into stories. A second call then writes the
   [Situation Brief](#situation-brief), which explains the whole crisis from
   those stories.
3. **Map.** Each event story with a known place is one pin on the globe. The
   Situation panel shows the Brief, then lists every story and every
   collected item.

**Headlines and stories are reporting, not verified incidents or risk
rankings.** Everything below is about where a claim came from, never about
whether it is true.

Design: [`superpowers/specs/2026-10-25-war-monitor-design.md`](superpowers/specs/2026-10-25-war-monitor-design.md);
the Brief: [`superpowers/specs/2026-10-28-situation-brief-design.md`](superpowers/specs/2026-10-28-situation-brief-design.md).
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
   - pins appear for located event stories;
   - the **Stories** tab lists every story, including list-only ones
     (no location, or a development such as talks or a sanction);
   - the Situation Brief at the top of the panel is rewritten;
   - the digest line reads, for example:
     `Digest 14:02 · 23 stories from 312 items · 9 unassigned · last run 34¢ · brief 12¢ · budget $1.08 left`.
5. The category chips filter the pins and the story list together. The choice
   is kept in share links. The Brief's actor chips narrow both further.
   **Frame theater**, next to Refresh, flies to every visible pin at once.
6. Open a story row to see:
   - its claims;
   - what's new since the last digest;
   - any contradictions;
   - every cited item, with publisher, perspective, folder, published /
     fetched / digested times, the original title and a link to the original.

   Opening a located story selects its pin and flies there.

### Hotspot view

Zoomed out, pins would pile up where news is dense, so the map changes by
camera height. Above 3,500 km the layer draws one **bubble** per hotspot
instead of one pin per story; below 3,000 km it draws pins again (in
between it keeps what it shows, so zooming does not flicker). A hotspot is
a country, or a named region or water such as Gaza Strip, West Bank,
Donbas, Darfur or the Red Sea, so the map never decides who owns a disputed
place. A bubble grows with its story count (22 px for one story, 54 px at
25 or more), its ring is split by category in the theater's colours, the
count sits inside, and a dot marks new stories since your last visit.
Category chips and the actor filter change the counts; a bubble with no
visible story disappears. Hovering shows the place, the count and up to
three titles, with the reminder that the count is not severity.

Clicking a bubble flies to it (ending low enough that its pins show) and
filters the **Stories** list to that place: a chip such as "Darfur ✕" sits
above the list and the Stories count follows. Clear it with ✕, by switching
theater, or by turning the layer off. Selecting a story, clicking the globe
or a new digest leave it on. Pins, bubbles, the HUD line and voice answers
are never filtered by place, and the filter is not saved in share links.
Frame theater ends high enough for bubbles on both theaters.

Voice:

- "refresh news" runs one digest (and its brief) and reads back the outcome.
- Questions about stories ("what's corroborated near Isfahan?") go through the
  analyst query over the `news` layer and never trigger a digest.
- "open the situation panel" opens the panel.

The Refresh control is disabled with a reason when:

- there is no key;
- today's budget is used up;
- a digest or brief is already running;
- nothing new has arrived since the last digest.

## Collect

The server collects for the theater only after the first `/api/news` request.
Starting the dev server alone fetches nothing.

| Transport         | Cadence | How                                                                                                                                                  |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rss`             | 10 min  | RSS 2.0 and Atom, gzip/deflate, charset-aware, 4 MB cap. The parser is shared with the cockpit regional briefing (`server/providers/common/rss.js`). |
| `gdelt-domain`    | 15 min  | the DOC 2.0 search API by default; GDELT 2.0's 15-minute data files with `NEWS_GDELT_FILES=on`. See [GDELT outlets](#gdelt-outlets).                 |
| `telegram-public` | 5 min   | The public web preview at `t.me/s/<channel>`. No account, bot or API. Flagged **fragile**: the markup can change.                                    |
| `reliefweb`       | 30 min  | ReliefWeb API v2 reports for the theater's countries. Off unless `RELIEFWEB_APPNAME` is set.                                                         |
| `link-only`       | never   | Listed in the Raw feed folders as a link to the publisher.                                                                                           |

Outlets whose feeds sit behind bot protection are never scraped. The
`gdelt-domain` transport can collect them through GDELT, but on 2026-10-29
GDELT indexed none of the registered ones, so they are `link-only`: listed in
the Raw feed folders as a link, and not counted as degraded. Switching one
back is a one-field change in `public/news/sources.json`.

### GDELT outlets

By default these outlets come from GDELT's DOC 2.0 search API (below). With
`NEWS_GDELT_FILES=on` they come from GDELT 2.0's Global Knowledge Graph (GKG)
files instead: one zipped table of articles every 15 minutes, with no search
API and no per-IP query limit. The files path is off by default because on
2026-10-28 a full day of files (about 120,000 articles from 6,400 websites)
held none of the registered outlets, while reading them costs about 514 MB a
day.

- Each cycle reads `lastupdate.txt` and downloads every GKG file newer than the
  last one read: at most the last four (one hour) on first start or after a
  long gap. The last file read is kept in the theater's item cache, so a
  restart does not read it again.
- One reader serves every theater. It downloads each file once and keeps only
  the rows from registered outlets (in any theater) for the newest eight
  files.
- A file is capped at 32 MB zipped and 192 MB unzipped; above the cap the
  cycle fails cleanly. It is unzipped in memory by a small single-entry zip
  reader (`fetchers/zip.js`), one file at a time.
- A row is kept when its URL host is, or is under, a source's
  `transport.domain`. Its title is the page title GDELT records; a row without
  one is dropped. The theater's GDELT terms filter the titles (any case, at the
  start of a word). A row is dated by its file's 15-minute stamp, but never
  later than when it was read: GDELT names files about ten minutes ahead.
- Each source reports ok and its count. A failed download or parse gives every
  GDELT source the same `GDELT files: ...` error. A missing older file is
  skipped; a missing newest file is an error. A file that failed is tried
  again on the next cycle, until it is more than an hour old.
- Each download is logged with its size, for example
  `[news] GDELT files: 1 file, 5.4 MB, 1310 rows, 0 kept`. Measured on
  2026-10-28: 5.35 MB a file on average (2.7 to 8.5 MB), so about 514 MB a day
  when the app runs 24 hours.
- The translation stream (`lastupdate-translation.txt`, articles GDELT
  translated into English) is not read. It would add about 9 MB a file (about
  870 MB a day), and a day of it held none of the registered outlets.

Without `NEWS_GDELT_FILES=on`, the DOC 2.0 search API is used: `domainis:`
OR-groups of up to 10 domains, at most 239 query characters with the terms, a
24 h window, and one process-wide queue with 5.5 s between requests. After a
429 the whole queue sends nothing for at least 15 minutes, doubling up to an
hour while 429s continue; requests that reach it during the pause are not sent
and their sources show rate limited. Each group's query is sent at most once
per cycle. Neither path retries in a loop.

**Coverage on 2026-10-28.** A full day of GKG files (96 files, 119,874 articles
from 6,426 sites) held no article from any of the 15 registered GDELT outlets
(Reuters, AP, Times of Israel, CENTCOM and the others), and the DOC API
answered with 429s, timeouts and empty results. On 2026-10-29 they were
probed for a feed of their own: The New Arab and Press TV have one and moved
to `rss`. The rest answered 403 to automated readers (Times of Israel, Israel
Hayom, +972, Al Arabiya, L'Orient Today, Al Mayadeen, AFP Fact Check, ISW,
Critical Threats), publish no feed (Reuters, AP, CENTCOM since February 2026) or did not resolve (Tasnim), and are now `link-only`.

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

**Kind and actors.** The model also marks each story:

- `event`: something that happened at a place (a strike, a protest). It gets
  a pin when it has a location.
- `development`: a change with no meaningful point on a map (talks, a
  sanction, a ruling). It never gets a pin, even with a place name: a pin in
  Doha would suggest something happened in Doha. It shows in the Stories
  list, marked "development · no pin", and in the Brief.

It tags each story with the theater actors it involves (`actorIds`), chosen
from the actor list only, which includes actors learned from earlier briefs
(see [Actor roles](#actor-roles)). Code drops unknown ids and counts them. A
story from before kinds existed reads as an event with no actors.

## Situation Brief

The Brief is the panel's political view: a card at the top of the Situation
panel that explains the whole crisis in under two minutes. It answers what
changed, who is involved, why now, who is affected, which way it is moving,
what could happen next and what is poorly known. The map still answers
"where". The Brief is a situation brief, never a scoreboard.

**On screen.** Collapsed (the default):

- a headline and up to three change lines;
- one badge per track (Military, Diplomatic, Humanitarian): the state as a
  word (escalating, easing, stalled, shifting or unclear) and a small glyph,
  in neutral colours;
- the Coverage line;
- "AI analysis · 14:03 · cites 12 stories".

**Show more** adds the actor strip, why now (a cited trigger line and the
three curated drivers with their source links), who is affected, two or three
scenario cards with a time horizon and signposts to watch, and what is poorly
known. The choice is remembered per viewer.

- **Every line opens its stories.** Clicking a line selects the first story
  it cites (a located event flies there) and highlights the others in the
  Stories tab.
- **Actor chips** are grouped by each actor's current role (parties,
  mediators, external, institutions, affected), each with its type and the
  number of open stories tagged with it. Hovering a chip says where its role
  comes from. Clicking a chip shows only those stories, in the list and as
  pins, on top of the category chips, and shows the actor's cited role line.
  Clicking it again, or "Show all", clears it. It is not kept in share links.
  Actors with no open stories are hidden (never deleted), at most 16 show,
  and the panel says how many are hidden. The latest **role changes** are
  listed ("Saudi Arabia: external → party · 14:03"), each opening the stories
  behind it.
- **New since your last visit.** Stories updated after the digest you last
  saw get a quiet "new since your last visit" marker on the row and a small
  dot on the pin, apart from the verification ring. "Last seen" is stored in
  the browser per theater and moves to the current digest when the panel
  closes or the page is hidden. A first visit marks nothing.
- **A seen signpost** has a tick that opens the story reporting it. A
  signpost nobody has reported yet reads "not yet seen".

**Rules the Brief never breaks:** no crisis score, tension percentage, health
bar or "x% toward war"; no two coloured teams (roles, not sides); no rolling
casualty counters, sounds or winning and losing language; no single forecast
and no probabilities; a party's claim is written as that party's claim;
quiet is not calm.

**Theaters without a Brief.** The Brief explains one crisis. A theater file
with `situationBrief: false` (World) runs no brief after a digest, offers no
Retry brief (`POST /api/news/brief` answers 409 `brief_off`), and the panel
shows no Brief section for it. The flag defaults to `true`.

**The call.** After a successful digest has saved its stories, the same
Refresh makes one more Agent API call with the digest's shape (same model, no
tools, one step, strict JSON schema) and `max_output_tokens: 16000` (hidden
reasoning counts toward it). It sends:

- fixed instructions with the rules above;
- the theater scope note, the actor list (with types and current roles),
  the drivers and the tracks;
- the previous brief, so the change lines are relative to it;
- the open stories and those closed in the last 72 hours, most recently
  updated first, at most 80: their ids, kind, titles, summaries, claims,
  contradictions, code-computed verification labels, perspectives and actor
  tags. No item ids and no links;
- the coverage note.

A skipped or failed digest runs no brief.

**What code checks.** The model writes the text, the track states, the
horizons, the citations, which signposts it has seen, and a role line per
involved actor (plus actors the list lacks). Code then:

- drops every cited story id that was not sent, and counts it;
- drops every line left citing no story (a signpost may cite none: not seen
  yet);
- rejects a brief without a cited headline: the previous brief stays;
- keeps at most 3 change, affected and unknown lines, 3 scenarios, 4
  signposts each, one role line per actor and 3 proposed new actors;
- decides which proposed roles and actors to accept (see
  [Actor roles](#actor-roles));
- holds track states and horizons to their lists (an unknown state reads
  "unclear");
- removes a scenario that states odds, a probability or a percentage, and
  shows no scenarios at all when fewer than two remain (one would read as a
  forecast);
- strips anything URL-shaped.

The Coverage line, the AI-analysis label, the brief's age, the
new-since marker and the verification labels are all code.

### Actor roles

The theater file says who each actor is (name, aliases, type) and its
starting role. After that, roles come from the stories. Each brief proposes a
role per involved actor (party, mediator, institution, affected or external)
with one cited sentence on why, and may propose actors the list lacks. The
model is told to use only what the stories report, not what it knows. Code
decides:

- **A role changes** only when at least one cited story is corroborated
  **and** tagged with that actor. A corroborated story about something else,
  one side's claim or a single outlet does not count. A downgrade needs the
  same evidence as an upgrade, so roles do not flip back and forth.
  Restating the current role changes nothing, including its date.
- **A new actor joins** only when a cited story is corroborated and names it.
  Code makes its id from the name. A proposal that names an existing actor
  (by name or alias, in any case: "KSA", "Saudi-led coalition") is that
  actor. A proposal using another actor's alias is refused as a possible
  duplicate.
- **Both also need two perspective groups.** Among the items of those
  evidence stories, publishers from at least two perspective groups (the
  groups the verification label uses) must name the actor, by name or alias.
  Two Israeli papers are one group, so they are not enough. A corroborated
  story can rest on parts that have nothing to do with the actor; this keeps
  one outlet's mention inside it from counting. (Added after the first live
  run, where the UAE got in on one outlet's allegation.)
- **Actors are never deleted.** Learned actors join the list the digest tags
  stories with. One the stories stop mentioning is only hidden from the strip.

Each brief run records what changed (`roleChanges`), what was held and why
(`roleChangesHeld`: no corroborated story, or named by one perspective group),
what was added (`actorsAdded`), merged (`actorsMerged`) and refused and why
(`actorsRefused`). With few corroborated stories (for example when GDELT
returns nothing), roles move slowly; that is intended.

**Coverage line.** Computed from source health and item times, never by the
model: sources down (blocked, failing or stale), grouped by perspective;
perspectives with no item in 24 hours ("no Iran state items in 24 h"); open
stories without a location. Show more lists the details.

**Budget.** Brief runs go into the same run log with `kind: "brief"` (older
records without a kind read as digests), so the daily budget covers both.
Before the call, code checks that the remaining budget covers a worst-case
brief: the input plus a full 16,000-token answer at list price, about 20 to 25
cents. If not, the brief is skipped and the reason is shown. A brief is
expected to cost about 10 to 15 cents.

**Failure and Retry brief.** A failed brief keeps the digest's stories and the
previous brief, which is shown with its age ("Brief from 14:02, one digest
behind") and the reason ("The latest brief failed: it hit its output limit").
A billed failure keeps its cost. **Retry brief** appears then, and only then
(also after a brief skipped for budget). It reruns the brief for the latest
digest without running a digest, through `POST /api/news/brief`.

**Storage.** The current and previous brief live in the theater's digest file
(`.gev-cache/news/<theater>-digest.json`) next to the stories.

## Who owns what

| The model writes                | Code computes                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Story title and summary         | **Location**: the gazetteer match for the model's place name first. Model coordinates are used only when nothing matches, or when the match lies over 500 km from them (a namesake, counted as `farMatches` in the run record); the pin is then drawn with a dashed outline and labelled model-placed. Otherwise the story is list-only and counted. |
| Category (one of six)           | **Perspectives**: the distinct perspectives of the cited items.                                                                                                                                                                                                                                                                                      |
| Place name and event time       | **Source count**: the distinct publishers among the cited items.                                                                                                                                                                                                                                                                                     |
| Which item ids it cites         | **Verification label**, for the story and for each claim, from the cited items only.                                                                                                                                                                                                                                                                 |
| Claims (text, actor, type, ids) | Which cited ids are real (each is checked against the store).                                                                                                                                                                                                                                                                                        |
| What's new and contradictions   | Ids, open/closed status and retention.                                                                                                                                                                                                                                                                                                               |
| (nothing)                       | **Hotspot**: the bubble a located event story joins on the zoomed-out map. The place's linked region or water row, its own region or water, else its country (for a model-placed story: the nearest row within 100 km), else its own place name. Computed when the snapshot is served.                                                               |

The model never returns URLs. Every link shown comes from a collected item.

Each theater file carries its gazetteer. Iran · Israel · US has 259
hand-compiled places with Hebrew, Arabic and Persian aliases; World has 1,873
places generated from Natural Earth ([World theater](#world-theater)). A row
may name a region or water row as its `hotspot` (Hebron → West Bank), which
the hotspot view groups it under.
Matching:

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
| `NEWS_GDELT_FILES`             | off     | `on` reads GDELT outlets from the 15-minute files instead of the DOC 2.0 search API (about 514 MB a day).      |

Sources live in `public/news/sources.json`. The theater lives in
`public/news/theaters/<id>.json`: a short scope note (`brief`; it names the
fronts, not the parties or sides), categories, perspective groups, GDELT
terms, gazetteer, and the Brief's actors, drivers and tracks. Two optional
flags: `situationBrief: false` turns the Brief off for the theater, and
`prompt: true` on gazetteer rows limits the place names sent to the digest
model to those rows, by name (see [World theater](#world-theater)). Both are
validated at load. An unknown folder, kind, transport or category, a
duplicate id, or an ambiguous gazetteer spelling throws. So does an actor
with a type or role outside the lists (types: state, armed-group,
institution, population; roles: party, mediator, institution, affected,
external), a duplicate actor or track, or more than three drivers or a
driver without a source link. An actor's role there is only its starting
role; the stories set it after that ([Actor roles](#actor-roles)). Who backs
whom is never written into the actor list.

## Routes

- `GET /api/news?theater=<id>&rev=<n>` returns the snapshot:
  - items, stories and citations;
  - sources with their health;
  - the last run and the last digest;
  - `brief`, `briefRun` and `briefStatus` (how many digests the brief is
    behind and whether Retry brief applies);
  - the theater's actors, drivers and tracks;
  - budget and digest state.

  If `rev` matches, it returns `{unchanged: true}`.

- `POST /api/news/digest?theater=<id>`: same-site only and rate limited. Runs
  the digest and then the brief; the answer carries both runs. See
  [Digest](#digest).
- `POST /api/news/brief?theater=<id>`: Retry brief. Same-site only, sharing
  the digest's rate limit. 409 unless the latest brief failed or was skipped
  for budget; 429 when the budget cannot cover it. See
  [Situation Brief](#situation-brief).
- `GET /api/news/status`: collection health per theater.

## Code

| Part                           | Path                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| Registry, gazetteer matcher    | `server/providers/news/registry.js`, `geocode.js`                            |
| Fetchers                       | `server/providers/news/fetchers/`                                            |
| Item store, collector, routes  | `server/providers/news/store.js`, `collector.js`, `index.js`                 |
| Digest call and validation     | `server/providers/news/digest/runner.js`                                     |
| Brief call and checks          | `server/providers/news/digest/brief.js`                                      |
| Actor roles over time (pure)   | `server/providers/news/digest/actors.js`                                     |
| Code-owned story fields (pure) | `server/providers/news/digest/stories.js`                                    |
| Stories, briefs, run history   | `server/providers/news/digest/store.js`                                      |
| Coverage line (pure, shared)   | `src/layers/news/coverage.js`                                                |
| Browser source and records     | `src/layers/news/source.js`, `records.js`                                    |
| Layer: pins, cards, selection  | `src/layers/news/index.js`, `model.js`                                       |
| Hotspot grouping (pure)        | `server/providers/news/hotspots.js`                                          |
| Bubbles and their cards (pure) | `src/layers/news/hotspots.js`                                                |
| Situation panel                | `src/ui/situationPanel.js`, `situationPanelModel.js`, `styles/situation.css` |
| Situation Brief section        | `src/ui/situationBrief.js`, `situationBriefModel.js`                         |
| Fixture QA                     | `npm run qa:news:fixtures` (`scripts/qa-news.mjs`)                           |
| World gazetteer (by hand)      | `scripts/build-world-gazetteer.mjs`                                          |

## World theater

**World** (`public/news/theaters/world.json`) collects political news from
every continent and places it on a worldwide gazetteer. It uses everything
above (collection, the Refresh digest, one pin per story, verification
labels, the Situation panel) except the Brief, which is off for it.

- **Categories:** Armed conflict (red), Elections & governance (blue),
  Protests & unrest (amber), Diplomacy & sanctions (light grey),
  Humanitarian (green), Rights & justice (pink). The colours were picked
  to stay apart for common colour-blindness types too.
- **Sources:** 44, in perspective groups that drive corroboration:
  `international` (Reuters, AP, BBC, France 24), one group per region
  (`africa`, `asia-pacific`, `europe`, `latin-america`, `middle-east`,
  `north-america`, `south-asia`, `eurasia`; three to five outlets each),
  `state` (TASS, CGTN, Anadolu, teleSUR: kind `state`, each with a caution
  line), `un` (UN News), `ngo` (Human Rights Watch) and `analysis` (Crisis
  Group, InSight Crime). Two outlets of one group never corroborate each
  other, so two Russian state outlets, or two Kenyan papers, count once.
- **Gazetteer:** generated by `scripts/build-world-gazetteer.mjs` from
  Natural Earth (public domain): 209 countries and territories at Natural
  Earth's label points, 205 capitals, 1,352 more cities of 300,000 people or
  more, 58 hand-written conflict towns the threshold misses (`TOWNS`: Hebron,
  Jenin, Khan Younis, Bakhmut, Pokrovsk, El Fasher, Kadugli, Marib, Sumy and
  others, each with its source), and 49 named regions. 42 are political hotspots (Gaza Strip, West
  Bank, Donbas, Crimea, Kashmir, Darfur, Sahel, Taiwan Strait, South China
  Sea, Nagorno-Karabakh, Tigray, Rakhine State and others); 7 stop a
  lookalike name from matching the wrong place (New Mexico, Washington
  State, Northern Ireland, Gulf of Guinea and similar). Aliases are
  Natural Earth's English, Arabic, Persian, Hebrew, Russian, Chinese,
  Spanish, French, Portuguese and native-language names. A spelling two
  places share is dropped or given to the country; a name that also means
  another well-known place (Georgia, the US state; bare "Congo") is
  dropped, so a story placed there falls back to the model's coordinates
  and is drawn as model-placed. A city that would take the bare name of a
  better-known namesake is renamed by hand (Toledo, Ohio; St. Petersburg,
  Florida). `CITY_HOTSPOTS` links 73 cities and towns to their region
  (Donetsk → Donbas, Nyala → Darfur, Sevastopol → Crimea). English press
  spellings are added where Natural Earth uses another (El Obeid, Taizz,
  Hodeidah). The script prints every drop, every qualified name, every
  hand town that duplicates a Natural Earth row, and every link that found
  no row. The run is by hand; the committed file is what the app uses.
- **Prompt size:** listing every World place name with its Latin aliases
  would make the digest instructions about 30,000 characters long.
  Countries and capitals carry `prompt: true`, so the instructions list
  only those 414 names: about 8,400 characters in all, roughly 2,400
  tokens. Code still matches the model's place name against all 1,873
  places and every alias.
- **Cost:** a World Refresh with 400 new items sends about 180,000
  characters (roughly 50,000 input tokens). The two live Iran · Israel · US
  digests ($0.34 and $0.40 for 249 and 334 items) imply about $5.70 per
  million input tokens once Perplexity's cache-write charge is counted; at
  that rate and $10 per million output tokens, expect about 45 to 50 cents
  per World Refresh with 400 items. Not measured live: the build machine
  had no Perplexity key.
- **Frame theater** flies over the visible pins. Pins within half the
  globe are framed from the middle of the shortest stretch of longitude
  that covers them, so pins either side of the date line frame the
  Pacific. Pins all round the world are framed from their average
  longitude, so the view faces the side of the globe that holds most of
  them. The flight's radius is capped, so it never zooms out past a
  hemisphere.

## Known limits (Phase 1)

- **Two theaters.** Iran · Israel · US and World.
- **World collects more than one Refresh digests.** About 900 items can be
  waiting; each Refresh sends 400 (starred sources first, then the newest),
  and the rest wait for the next one or age out after 72 hours.
  High-volume feeds (TASS, The Hindu, SCMP) take more of the 400 places
  than quiet ones.
- **Unchecked feeds.** The Iran · Israel · US feed URLs were taken from
  publisher pages and the design's probe table. They were not fetched from
  the build sandbox, which blocks those hosts. A feed that moved shows as
  degraded, not as an empty panel. The World feeds were probed with the
  app's own fetcher on 2026-10-28.
- **Fragile Telegram previews.** They depend on Telegram's public preview
  markup. A channel whose preview redirects to its contact page (gone, renamed
  or private) shows "no public preview". On 2026-10-28 that was
  `almasirahnet`.
- **GDELT coverage.** See [Coverage on 2026-10-28](#gdelt-outlets): GDELT
  carries none of the registered outlets, so the 13 without a feed of their
  own are listed as links only.
- **Out of scope:**
  - evidence-nearby counts;
  - per-story deep dives with search;
  - correction tracking;
  - stored history beyond the retention above;
  - a World brief and a zoomed-out hotspot view.
