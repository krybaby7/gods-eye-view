# Board-first app: roadmap from World Board feature to finished product

Date: 2026-11-11. Status: direction agreed with the owner on 2026-11-11 (section 5). Decisions 7 to
25, section 8.1 and section 9 were added the same day, after a second review on the owner's machine
with live data, and stage 3 was rewritten to follow them. Decisions 26 to 29 followed on 2026-11-12;
the Jev filer of decision 26 is the first thing built and is merged (pull request 25, section 8.2).
The owner approved the stage 0 mock on 2026-11-12 (decisions 30 and 31, section 8.3 and Appendix D).
Piece 2, costume off and board on, was built unattended on 2026-11-12 and merged on 2026-11-13 as
pull request 26, after an independent review. Piece 4, words for numbers and the Overview tab, was
merged the same day as pull request 27 under decision 33. Piece 3, the frame, was merged on
2026-11-16 as pull request 28, also under decision 33, and the tools menu (1.5) the same day as pull
request 29. The layers menu (1.4) was merged on 2026-11-17 as pull request 30 under the same leave.
One look began with the shared tokens and World Board styles (A1), merged the same day as pull
request 31. Pull request 32 merged the corrections from the review of both pieces, and
A2, the shared kit and legend, merged on 17 November as pull request 33. The Layers menu
restyle (B) merged that evening as pull request 34. Weather (C) merged on 18 November as pull
request 35. Cameras (D) merged the same day as pull request 36. On 18 November the owner paused
1.3 at that point and parked E–L and 1.6. Main at `1e2e589e` was deployed privately on the
owner's PC at `http://localhost:4173`. Decision 37 records the release and the topics for a
fresh brainstorming chat. The owner later resumed F–L in parallel under decision 38, and
those seven pieces merged on 18 November as pull request 37.
Codex directs the work. For B, C and D, GPT-6.2 Sol implemented and GPT-6.1 Terra tested (decisions
34 and 35). Section 10 gives the build history and the current status. Builds on
`docs/superpowers/specs/2026-11-08-world-board-design.md` (the World Board spec, whose rules still
hold) and on a review of the code, the docs and the running app on main at 7fb39f6. Section 8 says
what the first review could not see and section 8.1 what the second one found.

## 0. Shape in one paragraph

Today the World Board is one switch in the Data Layers list of another project's app, and it wears
that project's spy-satellite costume. This roadmap makes the board the app. It opens on the board,
already coloured from the last refresh, inside a plain frame with four fixed places: a top bar
(date, what changed, search), a **Today** column on the left (what is happening, ranked, in plain
words), the globe in the middle, and one **sheet** on the right for whatever is selected. Every
live data layer from the original repo stays, regrouped by topic and redrawn in the board's look.
The fake classification banners, mission numbers and other ornament go. Three more things turn a
data board into the place you open instead of the news: every number gets a plain-language
reading, the news and the live feeds join the board as one stream of events, and a server job
refreshes everything each morning so it is current when opened.

## 1. What the owner asked for (2026-11-11)

- The World Board direction is right, but it does not feel finished or production ready.
- It should help a non-specialist understand what is going on, like a video game does.
- It should become the last place the owner needs to check the news and see the state of the
  world.
- The board should be the base app. Everything else is organised around it and looks like it,
  including the live data layers of the original repo, which must not be lost.
- The original repo's decorative elements should be removed.

## 2. What exists today

Seven findings. Each one names what was seen or read; appendix C gives the files.

### 2.1 The board is a guest in another app

- The board is off on a fresh start, like every layer. It is reached at Data Layers > Events >
  World Board, after War Monitor and Searches.
- The start screen is the original project's. In the run captured for this review it showed the
  title "GOD'S EYE VIEW / NO PLACE LEFT BEHIND", a box reading "TOP SECRET // SI-TK // NOFORN"
  with a mission number, a blinking "REC" with a clock, "ORB: 47450 PASS: DESC-248" and
  "BAND: PAN BITS: 11 LVL: 1A". The mission, sensor, orbit and pass numbers are random, made up
  once per session.
- With the board on, its parts sit on top of that chrome instead of in a layout. At 1440×900 the
  legend covers the coordinate readout, the lens bar touches the banner box, and country codes on
  the globe (LBY, IRN, EGY, TZA, IDN) draw across the panels.
- The country sheet is a 330-pixel column. For the United Kingdom at 1440×900, the header (nuclear
  badge, two officeholder cards, the HP bar, the coverage line and two rows of tabs) fills the
  whole visible sheet. No score row shows without scrolling.

### 2.2 The board is thorough, and it speaks specialist

- A row reads "C1 Governing continuity 24 / 100 · Political stability and absence of violence ·
  24 score (0–100) [2024] · World Bank", with the flags WEAKEST and STALE. Opening it gives the
  source code `GOV_WGI_PV.SC`, the dates and a formula.
- Nothing says what 24 means, whether it is unusual, how it compares with other countries or
  which way it is moving. The legend's only words are Weak, Midrange and Strong.
- The board's buttons, tabs, flags and legend labels are 9 to 10 pixel uppercase monospace. Its
  reading text is 11 to 12 pixels.
- There is no introduction. The welcome screen does not mention the board.

### 2.3 There is one way in and no way to look across

- The only way to open a country is to click its shape. There is no search, no list, no ranking,
  no side-by-side comparison and no history.
- The Diplomacy and Ownership lenses show nothing until a country is selected.
- A share link keeps only whether the board is on. It drops the lens and the selected country.

### 2.4 The board and the news do not know each other

- War Monitor (stories, pins, hotspot bubbles), the Situation Brief and Search Layers are separate
  layers with separate panels. No link runs from a country to its stories or from a story to a
  country. The board's code never refers to the news code beyond borrowing its zoom thresholds.
- The news hotspot bubbles and the board's country colours both appear above 3,500 km, so with
  both on they would draw over each other. This is read from the code, not seen.
- The World news theater has 44 sources and a gazetteer of 1,872 places, but no Brief
  (`situationBrief: false`).
- The board's "what changed" covers the last refresh only, as lines such as "India — C4 41/100 →
  38/100". Older turns are stored and never shown.
- "Lens" names two different things: the Air, Sea, Space, Conflict, Hazards, City and Signals
  buttons, which switch groups of layers, and the board's Condition, Strength and other buttons,
  which choose what the country colours mean.

### 2.5 Much of the board is still marked unfinished

- All 18 indicators are draft. Each area has one indicator. S11 and S12 are placeholders. No
  critical threshold is set on any of them, so a critical flag can only come from a live feed.
- None of the 20 curated tables is reviewed. They include 101 foreign bases, 50 chip fabs, 45
  territorial disputes, 44 rivalries and 17 alliances.
- The Stakes tab reads "Stakes arrives in phase 7." Phase 7 of the spec (Claude's estimates,
  stakes and turn narrative) is not started.
- Live chokepoint traffic stays off until the IMF grants permission for PortWatch. Four more
  optional feeds are off by default. Stock cover always reads Unknown.

### 2.6 It only runs as a development server on one machine

- The data routes are part of the Vite development server. They exist only while `npm run dev` or
  `npm run preview` runs. A built copy of the site has no data.
- The live condition flags refresh on timers in the browser page. With the page closed, nothing
  updates.
- The World Board and Search Layers routes refuse any client that is not on the same machine.
- The one recorded cold start took 9½ minutes with 12 of 41 sources failing, on a 4G connection
  measured at 0.32 to 0.50 MB/s. Fixes followed, but no cold start has been measured since. One
  costs about 230 MB.
- Several sources are marked NonCommercial. The spec's position is personal, local use.

### 2.7 The original shell is large, and tests pin its text

- The stylesheets come to about 19,200 lines in 36 files; about 1,750 of those lines are the
  fork's own. One alternative skin, "Cyber", is 2,837 lines, plus about 1,070 lines of sonar code,
  and 14 script files refer to it, not counting tests.
- At least 15 unit tests read the markup or the stylesheets as text. Renaming an element breaks
  them even when nothing is wrong.
- The fork has only added so far. Since the last upstream commit on 13 October, 474 files changed
  with 108,585 lines added and 212 removed. Restyling the shell ends that; from then on this is a
  separate app that shares history with the original.
- One thing helps. The board's panels already use the app's shared fonts, borders and panel
  contract, so the look to extend exists. The gap is that the later board stylesheets hard-code
  about 30 colours instead of naming them.

## 3. Where this ends up

### 3.1 The screen

```text
+--------------------------------------------------------------------------------------+
| Global Eye View  11 Nov 2026  Turn 14 · 6 changes since Tuesday    [ Search ]  gauges|
+----------------------+---------------------------------------+-----------------------+
| TODAY                |                                       | SHEET                 |
|                      |                                       |                       |
| ranked events and    |                GLOBE                  | the selected country, |
| situations, each one |                                       | situation, chokepoint,|
| a plain sentence     |                                       | person, asset, plane, |
|                      |                                       | ship or earthquake    |
+----------------------+------------------+--------------------+-----------------------+
| Lens: Overview  Strength  Energy        legend   | Layers   Presets   Zoom   Voice   |
+--------------------------------------------------+-----------------------------------+
```

- **Top bar.** The date, the turn, a one-line count of what changed since the last visit, one
  search box for countries, people, places and situations, and a few world gauges (oil, food
  prices, active alerts).
- **Today.** The left column. A ranked list of what is happening, each item one plain sentence
  with a place, a time, its sources and why it is listed. Clicking an item flies to it and opens
  its sheet. The column collapses to give the globe the room.
- **Globe.** The board at world zoom, opening on the Overview lens: Condition as the fill, with
  marks on top for alert flags, story counts and current wars (decision 17). Zooming in fades the
  country colours and brings up the live layers, as now.
- **Sheet.** The right column, and the only place details open. A country, a situation, a story,
  a news outlet, a chokepoint, a person, an asset and a live object such as an aircraft all open
  here.
- **Bottom bar.** What the colours mean (one of three lenses and its legend) on the left; what
  else is drawn (layers and presets), zoom and voice on the right.

Nothing else is permanently on screen. Settings, data sources and the original repo's tools open
from a menu.

### 3.2 Words

| Word        | Meaning                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Board       | The home view: the globe with countries coloured by a lens.                                                                                        |
| Lens        | What the country colours mean. The word stays with the board, where Civilization uses it too.                                                      |
| Layer       | Something live or mapped drawn on the globe: flights, ships, earthquakes, cables.                                                                  |
| Preset      | A named group of layers switched together. New name for today's Air, Sea, Space, Conflict, Hazards, City and Signals buttons, ending the clash.    |
| Sheet       | The right-hand panel for the selected thing.                                                                                                       |
| Today       | The ranked list of current events on the left.                                                                                                     |
| Situation   | An ongoing story with a place, actors and a history, such as a war or a blocked strait. Built from a War Monitor theater and its Situation Brief.  |
| Turn        | One refresh and its list of changes. Unchanged from the spec.                                                                                      |
| Watchlist   | The countries and situations the owner follows. Their changes rank first in Today.                                                                 |
| Overview    | The home lens. The fill is Condition; marks on top show what is new.                                                                               |
| Outlet      | A news publisher the app follows. It has three separate facts: where it is based, who owns it and who funds it.                                    |
| Slant       | How an outlet leans toward a party in a situation, shown in four labelled kinds: documented, declared, observed and assessed.                      |
| Allegation  | An unconfirmed claim about who funds or controls an outlet, shown with who made it and never as a fact.                                            |
| Alert level | A four-step reading beside a Condition bar (calm, watch, strained, crisis), set by written rules from dated facts. It is where news acts on a bar. |

### 3.3 Rules

The 13 rules in the World Board spec stay. These are added.

1. **Three depths for everything.** A headline in plain words, then the detail (numbers, trend,
   comparison), then the evidence (source, period, formula). The board has the third depth
   everywhere today. The work is the first two.
2. **One selection, one sheet.** Whatever is clicked opens in the same place with the same parts.
3. **Nothing decorative.** Every mark on screen is information or a control.
4. **The board is ready when opened.** The saved board paints at once. Code fetches datasets and
   live feeds on a schedule on the server, not when the page loads. Claude runs only when asked.
5. **Uncertainty stays visible and leaves the headline.** Unknown stays hatched. Draft, stale and
   low-confidence labels stay, at the detail and evidence depths.
6. **Keep what the original does, change how it looks.** Restyling does not touch how a layer
   fetches or draws its data.
7. **Readable sizes.** Reading text is at least 13 pixels in sentence case. Monospace is for
   figures and codes only.
8. **Everything on the main screen is a command.** Selecting, changing lens, switching a layer
   and opening a sheet can each be done by a command as well as by hand, so the agent of stage 5
   can drive the app (decision 18).

## 4. The work, in order

This section preserves the earlier roadmap. Decisions 37 and 38 record changes to its order.

Five stages and one track that runs beside them. Each stage follows the method already used for
the World Board: a spec, a build prompt, one pull request per numbered item, a review, fix rounds.
Decision 29 changes who builds: Claude, one piece to a fresh session (section 10). Sizes are
relative guesses, not measurements. For scale, the World Board itself took six phase pull
requests, four fix rounds and a follow-up.

### Stage 0: agree the look first (small)

The World Board spec asked for a design mock before any interface was built. The same applies
here, and more, because this changes every screen.

- A mock of six screens, drawn over a real capture of the globe, reviewed by the owner as an
  artifact: the home board; a country sheet at its first depth; the same sheet at its evidence
  depth; Today with a situation open; the layers menu; and a zoomed-in view with a live aircraft
  selected.
- One page of the design tokens: colours with their meanings, the type scale, spacing, panel and
  button shapes.

Done when the owner has approved the mock. Stage 1 builds to it. The owner approved it on
2026-11-12 (decision 30); Appendix D holds its token values and what it settles.

### Stage 1: the board becomes the app (large, the biggest stage)

**1.1 Take the costume off.** Small, and the first pull request. Remove the classification
banners, the random mission numbers, REC, the orbit and band strips, the corner brackets, the
tagline, the title glow, the logo that follows the pointer, the "ACTIVE STYLE" readout, the panel
glows, the scan-line bars, the flip-board text effect and the "TR-3B" joke button. Retire the
Cyber skin and its sonar. Turn the scope vignette off by default. Keep the real readouts
(coordinates, altitude, time) in one quiet status line. Appendix A lists every item. Merged as pull
request 26 on 2026-11-13 (section 10).

**1.2 The frame.** Build the five regions of 3.1. The board is on at first start. Its lens bar,
legend, refresh and turn controls move out of the layer list and into the frame. Country labels
stop drawing across panels. The sheet becomes wide enough to read and shows content, not header,
first.

**1.3 One look.** Extend the existing tokens into a full set: named colours for status, relation
types and data ramps; a type scale; spacing; elevation. Appendix D holds the set the owner approved
with the mock. Replace the hard-coded colours in the
board's later stylesheets. Then move every original panel onto the same components, one panel per
pull request, in this order: layer list, weather, cameras, street level, recent imagery, radio,
context, settings and keys, welcome, and the aircraft cockpit last.

**1.4 Layers regrouped.** The bottom bar opens Layers and Presets separately. The layer list uses
the eight topic groups that match the presets (Appendix B). World Board belongs to the frame, the
War Monitor switch is in Menu ▸ Data sources and keys, and Search layers opens its tool. The
cockpit has its own Layers and Presets buttons. Merged as pull request 30 on 2026-11-17
(section 10).

**1.5 The original tools move out of the way.** The cockpit, voice, scenes and recording, drawing,
and the render styles (night vision, thermal, CRT and the others) keep working. They open from a
Tools menu or from the thing they act on, not from the main screen (section 5, decision 3). Merged
as pull request 29 on 2026-11-16 (section 10).

**1.6 Tests follow.** Rewrite the tests that pin text, and add a picture-based check: one capture
per region at three window sizes, compared with an approved set, so a restyle is judged by how it
looks.

Done when:

- a fresh start opens on the coloured board with no invented text anywhere on screen;
- nothing overlaps at 1280×720, 1440×900 or 1920×1080;
- all 29 listed layers still switch on and draw as before;
- every panel uses the tokens, with no colour or font written in place;
- the unit, boundary and format gates pass and the picture check has an approved set.

### Stage 2: readable without a manual (medium)

**2.1 Words for numbers.** Every score gets a band word, one sentence, a comparison and a trend:
for example "Strained. Political stability is in the lowest fifth of all countries, below the
regional median, and has fallen since 2022." Code writes these from stored values. The server
already keeps every past value, so trends need no new data.

**2.2 An Overview tab, first.** Who runs the country; the three things that stand out (strongest,
weakest, moving fastest); current alerts; main allies and rivals; the largest dependency. Six
lines, each opening the tab that holds the detail. Items 2.1 and 2.2 were merged as pull request 27
on 2026-11-13 (section 10).

**2.3 Ways in.** Search. A table of all countries, sortable by any area. Side-by-side comparison
of two countries. Keyboard selection. Share links that keep the lens and the selection.

**2.4 Explain on hover, and a Guide.** Every term, flag and area name explains itself on hover.
The Guide is a built-in reference written from the indicator registry and the docs: what each
area measures, what each lens shows, where each source comes from.

**2.5 First run.** A four-step tour of the frame, and an honest first-download screen that says
how long it will take and what is arriving.

**2.6 Finish the scoring.** Review the 18 anchors and drop "draft" where they hold. Set critical
thresholds. Give each area a second indicator, starting by replacing the S11 and S12
placeholders. Rename what reads as jargon ("HP", "weakest bar", "draft anchors"). Decision 25
widens this item for the six Condition bars: a basket of figures for each, a second reading
against the country's own past, and an alert level with written rules. R10 comes first.

Done when someone who has never seen the app can answer these five questions without the docs,
with the owner watching: Which countries in one region are in the worst condition, and why? Who
are Japan's allies and rivals? What does India depend on the Strait of Hormuz for? Who runs
Pakistan? What do the hatched areas mean?

### Stage 3: what is happening (large)

This stage is the difference between a reference board and a replacement for the news. It was
rewritten on 2026-11-11 to follow decisions 7 to 22. Section 9 lists what is still open. R8 is
merged (section 8.2) and R9 comes first, so that the sources counted are the sources that work.
Decisions 23 and 24 came after the rewrite; once their shape is agreed (section 9.4) they change
items 3.1 and 3.4.

**3.1 One stream of events, shown in Today.** The parts exist and are separate: the board's turn
changes, its live condition flags, chokepoint status, War Monitor's stories, and hazards from the
live layers (large earthquakes, cyclones, red disaster alerts). Join them into one list of typed,
dated, sourced events. Code ranks them by factors the owner can see: how many outlets and camps
tell a story, whether it sets or clears a flag, the watchlist and newness. Each item says why it
is listed. Turn changes are cut down to changes in the world; source housekeeping moves to the
Data sources screen (4.4).

**3.2 Since your last visit.** The top bar counts what changed since the last time the app was
opened and Today marks those items. War Monitor already does this for its own stories.

**3.3 Who is telling it.** Each outlet in the source list gains where it is based, who owns it
and who funds it (decision 14). Code then groups a story's outlets: from inside the country, from
the state of a party to it, and from outside. The story's sheet shows the groups and where they
disagree, and selecting the story draws a line from its place to each outlet's home. Counts are
of outlets, never of items, and are given as "of the outlets followed": with a few dozen outlets,
"no outlet from this country reports it" mostly means none from there is followed.

**3.4 News on the Overview, and country and news linked both ways.** At board zoom each country
carries a count of its stories, in place of hotspot bubbles; pins return on zooming in. A country
sheet lists its stories and shows coverage in both directions: whose outlets are covering this
country, and what this country's outlets are looking at. A story names its countries and each
name opens that sheet. There is no Attention lens (decision 17).

**3.5 Outlets.** An outlet opens in the sheet like anything else: its three facts, its slant in
the four labelled kinds per situation and party (decision 15), and any allegation with who made
it, when, the link and the denial (decision 16). The facts come from the source survey (R9) and
from the owner's media research after review (decision 19, R3).

**3.6 Situations.** An ongoing story gets its own sheet: what is happening, who is involved (each
actor opens its country sheet), a timeline, what to watch next, the preset of layers that shows
it, and how each outlet following it leans. The Situation Brief already writes most of this for
one theater. The work is to give it a sheet, more theaters and a place in Today.

**3.7 Gathering, and a World Brief.** On Refresh the digest groups what was collected into
stories, as now. An agent may then look outward for the top stories: what officials said on X,
named YouTube channels, the web (decisions 20 to 22). What it brings back is cited to a page or a
post that a tool returned. The World Brief follows: five to seven items, two minutes to read,
every sentence cited, with the time it was written. All of it runs only when the owner asks
(decision 4), and a metered tool runs under a daily cap.

**3.8 News to events.** The digest emits typed events that set or clear a status flag, with
citations. Spec rule 5 holds: events change facts, never scores.

**3.9 Turn history.** Step back through past turns and see the board as it was.

**3.10 Watchlist.** Follow a country or a situation.

Done when:

- opening the app shows the Overview with the story counts of the last digest and a Today list
  ranked by code, each item saying why it is listed, without pressing anything;
- one Refresh adds the stories, their tellers and a dated brief;
- every item flies to its place and opens its sheet, and a selected story draws its lines;
- every outlet named opens a sheet with its three facts, and no slant or allegation appears
  without its label and source;
- every country with stories lists them.

### Stage 4: board and live layers joined (medium)

Decision 28 sets the order: "Live here" (4.2) and layers as the camera for a story (4.6) first,
then watchposts (4.7). Zoom tiers (4.3) come with the frame.

**4.1 Live objects open in the sheet.** An aircraft, ship, earthquake, fire or camera uses the
same sheet as a country, with a link up to the country it is in. Earthquakes, satellites and
cables appear to have labels only today, with no detail card.

**4.2 "Live here."** A country, chokepoint or situation sheet shows counts of what is live inside
it (flights, ships, fires, earthquakes, storms) with a switch for each. A chokepoint card with the
ships now in the strait is the clearest case.

**4.3 Zoom tiers.** World, country, city. Each layer says at which tier it draws, the list shows
"zoom in to see" for the rest, and a breadcrumb (World > Asia > India) shows where the view is.

**4.4 Honest status, and a Data sources screen.** Every layer says in plain words whether it is
live, stale, or waiting for a key. One screen lists every source, its key if it needs one, when it
last worked and when it is next checked. The board's optional feeds appear there; today they are
environment variables only.

**4.5 One family for places.** The board's assets (bases, power plants, ports, fabs) and the
original repo's mapped sites (installations, dams, data centres, cables) share one presentation
and one group. News outlets join as holdings: a country's Ownership view shows the foreign-owned
outlets it hosts and the outlets its entities own abroad (decisions 14 and 19).

**4.6 Layers as the camera for a story.** A story, a situation or an alert carries the layers
that show it. Opening it flies there and switches them on: ships for a strait, fires and recent
satellite imagery for a strike or a flood. The layers are labelled "live now". They show the
place; they are never offered as proof of the story (spec rule 9).

**4.7 Watchposts.** About thirty places that matter, taken from what the app already lists: the
chokepoints and the news gazetteer's hotspots. At each one, code counts ships, flights and fires
against that place's own normal and sets the alert level by written rules (decision 25): "Hormuz:
3 tankers today, 40 is normal". The owner's ships key can supply the count at Malacca, Gibraltar
and the Danish Straits. It cannot stand in for the chokepoint traffic that waits on IMF permission
at Hormuz, Suez, Bab-el-Mandeb, the Turkish Straits or Panama, where the feed heard almost nothing
(section 8.2). It needs the server running all day (R1)
to learn what is normal, and a place with poor coverage shows as unknown, never as quiet.

### Stage 5: Claude's jobs (medium)

This is phase 7 of the World Board spec, widened. The shared Claude adapter it waited for is now
merged.

Decision 12 (section 5) asks for one agent in place of several separate helpers, and decision 18
sets what it may do unasked. "Explain this", "Ask about the selection" and "Voice for the board"
below are the likeliest parts of it; which it absorbs is open (section 9.5).

- **Stakes** per country: declared objectives and commitments, with evidence labels.
- **Estimates** for stale values, drawn as the spec's dashed ghost beside the measured value.
- **A turn narrative:** three sentences from the code's change list, adding no facts.
- **Explain this** on any sheet, answering only from what the sheet holds and the stories it
  cites.
- **Ask about the selection:** a Search Layers question scoped to the open country or situation.
- **Voice for the board:** "show Japan's sheet", "colour by energy exposure".
- Later, as the spec says: an experimental overall score and scenario lenses.

### Track R: it runs every day (beside the stages, starting with stage 1)

| Item | What                                                                                                                                                                                                                                                                                                                   | Needed by             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| R1   | A real server. One `npm start` serves the built app and its data routes and runs the code-only schedule (dataset checks, live feeds) whether or not a browser is open. Claude still runs only when asked.                                                                                                              | Stage 3               |
| R2   | A fast first start. The saved board paints in under a second. A seed snapshot ships with the app so the first run is not empty. Downloads resume. Measure a cold start on the owner's connection; target 2 minutes.                                                                                                    | 2.5                   |
| R3   | Data review. The 20 curated tables, row by row, each with its source, by a research agent with the owner signing off. "Draft" comes off one table at a time. Decide each permission-gated feed. The owner's media research joins the list: 333 ownership links, each checked against a retrieved source (decision 19). | End of stage 2        |
| R4   | Budgets. Payload sizes, and frame rate on the owner's hardware, which has not been measured.                                                                                                                                                                                                                           | End of stage 1        |
| R5   | Acceptance. The fixture harness covers each new screen; the live fact checks keep running; the picture check from 1.6 gates every pull request.                                                                                                                                                                        | Every stage           |
| R6   | Docs and name. A README for this app. Spec headers that still say "not built" corrected. KNOWN-ISSUES entries for the fork's features. The new name, Global Eye View, in the title, the README and the package, with the MIT notice and credit to the original kept.                                                   | End of stage 1        |
| R7   | The Telegram question left open in the World Board spec (section 13.5): its 2026 terms and War Monitor's collector.                                                                                                                                                                                                    | Before stage 3.7      |
| R8   | Connection allowance. Raise the time Node allows each connection attempt, set once at server start. On the owner's connection the default fails sources that work (section 8.1). Then count again which sources deliver. Merged in pull request 25; the recount is in section 8.2.                                     | Before R2 is measured |
| R9   | Source survey. Candidate news APIs, feeds, named YouTube channels and X accounts, each with its terms, its cost in money and in megabytes a day on the owner's connection, and the three outlet facts of decision 14. The owner reviews the list before it is adopted (decision 21).                                   | Before stage 3        |
| R10  | Fast figures for the bars. For each Condition bar, the monthly, weekly or daily figures and the named trackers that exist, each with its coverage, its release rhythm and its terms (decision 25). This is the "live data sources" topic the owner set aside.                                                          | Before 2.6            |

## 5. Decisions (owner, 2026-11-11)

1. **A separate app.** It no longer stays mergeable with the original repo. Later fixes to data
   layers are taken from the original by hand when wanted.
2. **Personal and local, for now.** Hosting for other people is not planned. If that changes it
   adds sign-in, a licence review of every NonCommercial and permission-gated source, and a paid
   model key in place of the subscription.
3. **The original's experience features are demoted, not deleted.** The cockpit, voice, scenes
   and recording, drawing, render styles and radio keep working, off the main screen. Only the
   Cyber skin, the sonar and the costume are deleted.
4. **Claude runs only when the owner asks.** No scheduled Claude runs, because the app is not yet
   continuously online. The World Brief is written on Refresh. To be looked at again once R1
   makes the app always-on.
5. **The name is Global Eye View.**
6. **Dark only.** The tokens are named so a light set can be added later.

Added the same day, from the owner's ideas on how news is shown. Section 9 holds what is still
open about each.

7. **Every story shows who is telling it.** A story has two places: where it happened and where
   each outlet reporting it comes from. The globe shows both, so a story about Ukraine told by an
   outlet from another country reads as told from outside.
8. **Outlet bias is shown.** Every outlet has a slant and the owner wants to see it directly, as
   part of knowing where a claim came from. Scores from outside rating sites are not used.
9. **No country is singled out.** Slant is recorded toward any party in a situation, in both
   directions and by one method. The owner's earlier media research is a starting list for
   ownership and for slant in one conflict; other situations get the same treatment.
10. **Allegations are shown as allegations.** An unconfirmed claim about who funds or controls an
    outlet is visible and marked as an allegation. It is never drawn as a fact and never left out
    because it is unconfirmed.
11. **The fewest modes that work.** The owner wants one general view of the board in place of
    choosing among many lenses, and would rather news did not need a lens or mode of its own.
12. **One agent for the whole globe, built last.** A single agent the owner can talk to. It reads
    the board and the news, explains a situation, answers questions and can move the globe itself.
    It is separate from the Search Layers agent. Each question put to it counts as the owner
    asking (decision 4).
13. **The right news feeds and tools are connected.** The app's collectors, and the tools Claude
    is given when it runs, are chosen to serve the goal. Which ones is open.

Accepted the same day, when the owner approved the shapes proposed for decisions 7 to 13:

14. **An outlet's country is three facts.** Based in, owned by and funded by are recorded
    separately, as spec rule 8 does for assets. Al Jazeera is based in Qatar and funded by its
    government; Politico is based in the United States and owned by a German company; Meduza is
    Russian-language and based in Latvia. One colour per outlet would be wrong for all three.
15. **Slant is shown in four labelled kinds.** Documented: who owns and funds the outlet.
    Declared: what the outlet says its line is. Observed: counted by code from the stories this
    app has collected, such as whose claims an outlet carries. Assessed: a researched judgement
    with its sources and date. Slant is stated per situation and per party, never as one number
    for an outlet, and it never changes a verification label, a ranking or a score.
16. **An allegation needs a named maker.** It shows who made it and when, links to a page that
    was retrieved (spec rule 13), shows the denial if there is one, and concerns an organisation
    or a public figure, never a private individual (spec rule 12).
17. **The home view is a layered Overview, and three lenses colour the world.** Spec rule 10 and
    the owner's decision of 2026-11-08 rule out one blended number, so Overview layers instead:
    the fill is Condition, and marks on top show what is new (alert flags, a story count per
    country, lines for current wars). Overview, Strength and Energy colour the whole world.
    Diplomacy and Ownership follow the open tab of a selected country's sheet. Data age becomes a
    switch. News has no lens or mode of its own, and the Attention lens once planned is dropped.
18. **The agent looks and points freely and asks before it spends.** It may fly, select, switch
    lenses and layers and open sheets unasked. It asks before a digest, a search, a board refresh
    or any metered tool. It may add background from its own knowledge, marked as unsourced and
    dated to its training, beside sentences cited to the board or to stories. From stage 1 on,
    anything the owner can do on the main screen can also be done by a command (rule 8 in 3.3).
19. **The owner's media research is a starting list, not a source.** Each ownership link is
    checked against a retrieved source under R3 and stays draft until the owner signs it off.

Added the same day, on sources:

20. **X is connected.** Directly, or through Grok if that is the better way to read it.
21. **The source list is made as complete as it can be.** A survey covers news APIs, feeds, named
    YouTube channels and anything else that is possible. It is done later, before stage 3 is
    built (R9).
22. **An agent gathers the best and most relevant stories.**

Added the same day, on how news is selected:

23. **News is filed under the board's own areas.** The owner wants one system: a story is
    categorised by the part of the board it touches, so that the bars and areas a country sheet
    shows are also how news is sorted and filtered.
24. **Jev is tried for selection, and kept only if a test shows it works.** Jev is TypeSafe's
    decision model: it answers typed questions with probabilities and writes no text.

Added the same day, on how a bar moves:

25. **The Condition bars are rebuilt so that they can move honestly.** News and events never add
    or remove points: the weights would be invented, and the countries the press watches most
    would lose the most. Instead each bar becomes a small basket of figures of different speeds.
    Each bar is read against the world and against the country's own past. A separate alert
    level beside each bar is set by written rules from dated facts, and this is where news acts.
    Fast judgements that named organisations already publish are shown under the issuer's name.

Added on 2026-11-12, after the test of section 9.4:

26. **Jev is adopted as the headline filer, and improved later.** It files each collected
    headline before the digest reads it: keep or set aside, and the area. At the owner's
    instruction an Opus subagent builds it on its own branch; it is reviewed against the rules of
    section 9.4 and merged only when the owner asks. The first build files for the World theater
    only, never fails a Refresh if Jev fails, shows every filing in the Raw feed and runs under a
    daily cap. It also carries the connection allowance of R8, which Jev needs on the owner's
    connection.
27. **Jev files headlines as they are collected.** It runs on the collection timers while the
    War Monitor is collecting, not only on Refresh. Decision 4 is about Claude and still holds.
    Filing costs a few US cents a day and stays under the daily cap.
28. **The live layers come in by three routes, in this order.** First "Live here" on every sheet
    and layers as the camera for a story (4.2 and 4.6); then watchposts, where layers act as
    sensors that feed the alert levels (4.7).

Added on 2026-11-12, on how the rest is built:

29. **Claude builds the rest, one piece at a time.** Each piece is built in a fresh Claude
    session and lands as one pull request, merged only when the owner asks. Codex built the World
    Board; from here Claude does. The session plans, reviews, runs the gates and does the git
    work; as with the Jev filer, an Opus subagent writes the code. The reason is measured: the
    planning conversation re-read about 370,000 tokens at each step on average, while the
    subagent built the Jev filer in 21 minutes. Section 10 keeps the order and the state.

Added on 2026-11-12, when the owner approved the stage 0 mock:

30. **The mock is the look of the app.** The owner approved the stage 0 mock as it stood after an
    independent review: six screens, the page of design tokens and the board on how news is
    filed. Stage 1 builds to it. Appendix D holds the token values and what the mock settles, and
    the mock itself stays the picture to build to (section 10).
31. **News is filed under the twelve areas.** The approved mock files every story under one or
    two of the twelve Strength areas, as the filer already does, and a fixed table puts each
    story under a Condition bar on a country sheet. This is read from the approval of the mock,
    which showed both ways and recommended this one. The owner did not answer the question apart
    from that approval, and was told how it was read.

Added on 2026-11-13, when the owner asked for the next pieces to be built by Opus agents in the
cloud:

32. **Build straight to the finished app.** The owner said they will hardly look at the app until
    all of it is built, and asked for the end result to be built at once. So no piece designs a
    stand-in for something a later piece builds. Each part is built as section 3 and the mock show
    it. Where its content does not exist yet, it shows the finished app's own empty state, never
    invented content, and a control that does nothing yet is not shown. Pieces that do not need
    each other's result are built at the same time, in the cloud where that works (section 10).
    This answers what the Today column shows before stage 3: the finished column, empty until
    there are stories. That last reading is Claude's, and the owner was told. Each merge still
    waits for the owner's word (decision 29) unless they say otherwise.

Added later on 2026-11-13, when the owner answered a question put to them that morning:

33. **Reviewed work is pushed and merged without asking each time.** Asked "Until it is all built,
    may I push and merge reviewed work without asking each time?", the owner answered "Yes, go
    ahead". Until the app is all built, Claude merges a piece once its checks pass and an
    independent read finds nothing that breaks it, and pushes this roadmap as it changes. For that
    time this replaces "merged only when the owner asks" in decision 29. It covers a piece's own
    branch, its pull request, its merge into `main` and the roadmap branch. It does not cover a
    forced push, a push straight to `main`, or anything that costs the owner money or mobile data,
    which is still asked first. Each merge is reported to the owner with what was checked and
    what was not.

Added on 2026-11-17, when the owner moved the building to Codex:

34. **Codex continues the build.** The owner wrote "I d like to have a codex agent continue the
    work", with a Codex agent of their own set up on the PC in the `gev-world-board` folder. From
    2026-11-17 Codex directs and builds: it plans, writes the code, runs the checks, does the git
    work and keeps this roadmap. For that time this replaces "Claude builds the rest" in decision 29
    and "Claude merges" in decision 33. Every other rule of decisions 29, 32 and 33 stands. The
    independent read is now made by a Codex context that did not write the change. The handoff is in
    the main folder, `qa-artifacts/handoff-2026-11-17/handoff-prompt-codex.md`, not committed. Asked
    the same day whether Codex may merge finished pieces without asking, the owner answered "Yes,
    same leave": the leave of decision 33 passes to Codex, with its limits.

35. **Codex directs, Sol implements, Terra tests.** The owner directed Codex to orchestrate the
    work, assign implementation to GPT-6.1 Sol and assign testing to GPT-6.1 Terra. The independent
    read and the merge checks in decisions 33 and 34 still apply.

    On 2026-11-17 the owner confirmed the roles in their own words:
    “Continue with A2.you are the orchestrator. Keep using GPT 6.1 sol subagents for implementation
    and 6.1 terra subagents for testing.”

    For the overnight B run on 17 November, the owner assigned implementation to GPT-6.2 Sol
    and testing to GPT-6.1 Terra, with Codex continuing as director.
    On 18 November the owner asked for the same roles for C, Weather, and D, Cameras.

Added later on 2026-11-17, after Codex's first run:

36. **Codex fixes what Claude's read found, before A2.** Claude checked pull requests 30 and 31
    the same day. The trees on `main` equal the tested trees, both gate summaries are clean, and a
    read by Opus agents, each finding then challenged by a second agent, found nothing that breaks
    the app. It found five small faults: panel titles outside the board are spaced too widely; the
    cockpit check and its record say "clear of the instruments" although the open Layers menu
    covers part of the speed and altitude scales; a layer whose state is uncertain is no longer
    announced as uncertain; two status colours changed without a recorded reading; and the new
    readability test barely draws the Exposure sheet. Asked who should fix them, the owner chose
    "Codex, before A2": Codex fixes items 1 to 5 as one small pull request before A2, under the
    same rules, gate and leave, and records them by adding to the history of a piece, not by
    replacing it. The findings are in the main folder,
    `qa-artifacts/handoff-2026-11-17/claude-read-of-codex-run.md`, not committed. Two things
    still wait for the owner's word: decision 35 in their own words, and whether a read by a
    fresh Codex context counts as the independent read of decisions 33 and 34.

    The owner subsequently confirmed the model roles as recorded under decision 35. Pull request 32
    carried the prerequisite correction. The details are in the piece 6 and One look histories in
    section 10.

Added on 2026-11-18:

37. **Pause after Cameras and revisit priorities in a fresh chat.** The owner paused One look
    (1.3) after D, Cameras, merged as pull request 36. Keep the merged work and its verification
    history. Park E–L, beginning with E (Street level), and the test work in 1.6. This supersedes
    the earlier direction to do Street level next.

    The owner chose a private deployment on this PC with their saved board and configured
    providers. Main at `1e2e589ee6fd7b8cc2c7993c71aab4a240e1ce5d` was deployed at
    `http://localhost:4173`. The listener is loopback-only, and a Windows sign-in launcher
    is registered. The pinned release has its own directory and saved data, separate from
    future development. HTTP verification matched the served HTML and both assets to the
    build, and the API returned the saved board dated 11 November, with turn 6 and 256 country
    records. Release verification used the saved board and the built files. Live feeds and
    Claude were outside the scope of that check.

    In a fresh brainstorming chat, revisit priorities across country comparisons and scoring,
    Today news and events, board and live-layer integration, and Claude features for the board.
    The owner left the order of those four topics open and deferred implementation until after
    that discussion.

38. **Resume One look F–L in parallel.** Later on 18 November the owner asked for Recent imagery
    (F), Radio (G), Context (H), Data sources and keys (I), Welcome (J), Cockpit (K) and shared
    controls (L) to be completed in parallel by GPT-6.2 Sol agents. Up to three agents worked
    concurrently in separate worktrees. Context started from Radio's stylesheet split. The work
    was brought together for a shared regression run across those surfaces. Street level (E) and
    the visual regression milestone (1.6) remain parked under decision 37.
39. **Move the direction work to Codex.** On 25 November the owner asked Codex to coordinate
    the work. GPT-6.2 Sol builds the private pages and prepares their data. GPT-6.1 Terra tests
    the pages independently, checks the counts and handles smaller, fully specified tasks.
    Pieces with separate files run in parallel. The owner will review the layouts and sources
    before choosing a direction. The priorities in decision 37 remain open.

Added on 2026-11-27:

40. **Make Global Eye View ready for the owner's test.** The owner asked to “make sure our app is
    complete (for my personal use but still i want it polished) so I can properly test it and see
    what i d like to change/keep/deepen”. They asked for “GPT Astra as the orchestrator that does
    the thinking, and GPT 6.2 Sol agents as the ones that do all the legwork”. For this pass, Astra
    directs and judges the evidence. GPT-6.2 Sol reads, builds, tests, independently reviews and
    deploys. Decisions 33 and 34 govern merges.

    The pass has eight outcomes: Today shows existing stories or a way forward, the welcome
    introduces the board and offers a tour, the top bar has one search box, the visible name is
    Global Eye View, Street level shares the panel design, fonts and icons ship with the app, an
    independent fixture walk checks everything reachable from the frame, and the verified build
    runs on the owner's PC. This resumes Street level (E) for the pass. The priorities in
    decision 37 remain open.

    The director's initial readings, for the owner to confirm, are to keep the npm package
    identifier, use data already held in the browser for frame search with an explicit Enter
    action for remote place lookup, and allow country-scale changes in Today alongside available
    theatre stories. The welcome appears once after this update, with a new storage key. The
    tour introduces the frame in four steps and can be reopened from the Menu.

## 6. Risks

- **Stage 1 is bigger than it looks.** Most of its lines are in panels the owner did not write.
  Doing it one panel per pull request, with the picture check, keeps each step reviewable.
- **Text-pinned tests will fail in bulk** on the first restyle. That is expected; 1.6 budgets for
  it. The risk is deleting a test that guarded behaviour, so each removal needs its reason.
- **The Cyber skin also holds a panel rule** (only one panel open at a time) and the celestial
  ring file also holds geometry that detection uses. Both need to be separated out, not deleted
  whole.
- **The World Brief depends on a local Claude sign-in** and shares one run slot with Search
  Layers. If the sign-in lapses, the brief must say so plainly and Today must still work.
- **Draft data read as fact.** Plain sentences in 2.1 sound more certain than a bare number. The
  sentence has to carry the draft and stale labels with it until R3 clears them.
- **Cold start on a slow connection** is still unmeasured after the fixes.

## 7. The first three pull requests

1. **Costume off, board on.** Item 1.1, the board on at first start, and the three overlaps in 2.1
   fixed. Small, low risk, and the app already looks like the owner's.
2. **The frame.** Item 1.2, built to the stage 0 mock.
3. **Words for numbers and the Overview tab.** Items 2.1 and 2.2, brought forward because they
   need no restyle and change how the board reads more than anything else in stage 2.

## 8. What this review could not see

- The board was seen only with the offline fixture data, which fills a handful of countries,
  under software rendering. The live sources cannot be reached from the review environment, so a
  real refreshed board was not seen.
- Only the home view, the Condition, Strength and Data age lenses, and the India and United
  Kingdom sheets were seen running. The Diplomacy, Energy and Ownership lenses, the People tab and
  the cards are described from the code.
- The fixture harness passed four checks and stopped at the fifth, "Picking Scotland selects the
  whole UK group", on a 20-second wait. The United Kingdom sheet had opened. Whether this is a
  defect or the slow renderer was not established.
- The unit tests were not run.
- The original repo's state after 13 October was not looked at.

### 8.1 Checked on 2026-11-11 on the owner's machine, with live data

A second session ran the app on the saved board (turn 6) with the sources reachable. No digest or
search was run and nothing was downloaded for the board.

- **Both loose ends are closed.** The fixture harness passes 21 of 21 checks with hardware
  rendering, including "Picking Scotland selects the whole UK group", so the earlier stop was the
  slow renderer. The unit tests pass: 7,119 passed, 10 skipped, none failed.
- **Section 2 holds where it was checked:** the start screen, the three overlaps, the 330-pixel
  sheet whose header fills it, the Diplomacy and Ownership lenses empty until a country is
  selected, and "Stakes arrives in phase 7". All six lenses colour with real data and the People
  tab shows portraits with credits and post headlines.
- **The change list is not what 2.4 describes.** Turn 6 reads "0 countries changed · 4 source
  notices". Its four lines are source housekeeping (a Wikidata batch, a YouTube 404, relation rows
  added and removed) and they are printed at the foot of every country sheet. Today cannot take
  turn changes as they are (3.1).
- **The code-only sources say little that is new each day.** Of 108 live condition flags, 93 are
  standing conditions: 50 from 12-month conflict deaths, 28 from annual displacement, 10 from the
  debt list and 5 from inflation. GDELT gave 14 from three sampled files, because it samples one
  15-minute file per check and only while the page is open. GDACS and exchange rates gave none. A
  Today list from code alone (stage 3, "Done when") would hardly change from day to day.
- **No story exists on this machine.** No digest has run in this checkout, so the World theater
  shows no pins and no bubbles, only a Raw feed of 527 headlines. Pins and bubbles were seen in
  the fixture captures only. A digest cannot run until the owner signs in again with
  `claude auth login`.
- **Many failing sources are not dead.** Node allows each connection attempt a quarter of a
  second, which is often too short on the owner's connection, so a request fails in about a
  second. By default 17 of the 42 World feeds failed, with USGS earthquakes, adsb.lol, Launch
  Library and GDELT's file list. With a five-second allowance all four answered and so did 7 of
  the 10 feeds tried again. Still failing then: Middle East Eye and Anadolu (connection reset), Al
  Jazeera and the GDELT search API (no connection). Reuters and AP refuse automated readers. The
  cold start's 12 failures of 41 (2.6) may share the cause; that was not tested. See R8.
- **The raw feed is uneven.** World events sit beside municipal, court and business items. TASS
  and Buenos Aires Times hold 100 items each, the BBC 25.
- **The Telegram question is smaller than R7 reads.** The World theater has no Telegram source.
  Two channels in the Iran · Israel · US theater are the whole of it.
- **Live layers:** satellites deliver. Ships and active fires report a missing key. Flights and
  earthquakes were not confirmed in the app.
- **The sheet and the Situation panel share the right rail.** With a country sheet open, the
  Situation panel showed only after the sheet was closed.
- **Flags and scores can seem to disagree.** India reads Security and control 97 / 100 beside a
  flag for 343 recorded conflict deaths. Both follow their rules; a plain-language reading (2.1)
  has to explain the pair.

### 8.2 Checked on 2026-11-12, by asking each provider directly

The app was not started, to spare the owner's mobile data, so nothing here was seen on the globe.

- **The Jev filer and the connection allowance (R8) were merged into main that day,** as pull
  request 25. In a live run before the merge, 39 of the World theater's 42 feeds answered with
  the allowance, against 25 the day before, and 794 headlines were filed for about 3 US cents.
  The digest reading filed headlines, and the filer's `refresh` mode, are covered by unit tests
  only until the Claude sign-in is renewed. GitHub runs no automatic checks on the owner's fork:
  the check workflow is registered but has never run, so a pull request rests on the gates run
  locally.
- **The owner's new keys work.** Flights: the account signs in. Cesium: terrain, aerial imagery
  and 3D cities open. OpenAI: the key is accepted, and the summary line would call it at most
  once every 15 seconds while the view changes. Ships: the key is accepted.
- **The free ship feed is nearly deaf where the board's energy routes pass.** A six-minute listen
  heard 446 ships: 181 around Malacca and Singapore, 151 in the Danish Straits, 64 at Gibraltar,
  32 off the Cape of Good Hope and 13 in the Dover Strait, but one at Hormuz, one at Panama, two
  in the Taiwan Strait and none at Suez, Bab-el-Mandeb, the Bosphorus or the Dardanelles. One
  listen is not a measurement, but it changes 4.7.
- **The three sources that failed on 2026-11-11 answered,** even with Node's default allowance:
  earthquakes, military flights and launches. Their failure follows the speed of the link on the
  day. Earthquakes are fetched by the browser, so that layer may never have failed in the app.
- **The Claude sign-in is still lapsed.**

### 8.3 Seen on 2026-11-12, while photographing the board for the mock

The owner allowed one start of the app, to photograph the saved board for the stage 0 mock. A
script took five pictures with every panel hidden. No Refresh was pressed and War Monitor stayed
off.

- **The saved board paints whole.** 256 entries, with 195 of 199 states coloured, as of the
  refresh of 2026-11-11. This is the first capture of the real board without the costume.
- **What a start costs.** One page load took 11.6 MB from outside, 11.2 MB of it Google's 3D
  tiles, because a fresh start flies to a city at 600 metres with the photorealistic map on. A
  second load with flights on took 15.8 MB of flight data in a few minutes: the feed had fallen
  back to adsb.lol, whose regional answer is large. The app also made one Google Places call at
  start. Opening on the board at world zoom (piece 2) removes the first cost. Each figure is one
  measurement. The preview tab was also open for about three minutes and was not measured.
- **The summary line calls OpenAI as soon as the view moves.** The script stopped 28 such calls in
  two loads. Appendix A already drops that call.
- **A trend cannot be written from the saved board yet.** Item 2.1 says the server keeps every
  past value. It keeps what it has fetched, and it has fetched one period for 3,501 of the 3,504
  pairs of country and figure. A trend, and decision 25's reading against a country's own past,
  need the sources' older values fetched first. Section 9.6 already asks whether they are.
- **A callsign's route on record can be wrong.** For the aircraft in the mock a public lookup gave
  Stuttgart to Bucharest while it flew south over Belgium. The app hides a route it judges
  implausible. The sheet of 4.1 has to say so in words, not leave a gap.
- **The repository has Puppeteer, not Playwright.** The capture script and the mock's layout check
  used it.

## 9. Open after the discussion of 2026-11-11

Proposals made to the owner and not yet answered, and questions nobody has answered. Each becomes
a decision in section 5 or is dropped.

### 9.1 How news is shown

- **Order of building.** Proposed and not answered: "who is telling this" first, then coverage in
  both directions on the country sheet, then news outlets in the Ownership view. Stage 3 is
  written in that order.
- **How the lines and marks look** was left to the stage 0 mock and is settled by it (decision
  30, Appendix D): the lines from a story to its outlets' homes, the story count on a country,
  and how a state-run outlet, a private one and one in exile differ at a glance.

### 9.2 X and Grok (decision 20)

- **Both ways cost money for each post.** Checked on 2026-11-11 from search results, not from the
  price pages themselves. xAI's API gives Grok a tool that searches X, priced at about 5 US
  dollars per 1,000 posts returned on top of the model's own charges. X's own API is pay-per-use
  at about half a cent per post read, with no free tier for new accounts. Neither is covered by
  the owner's Claude subscription. The prices are to be read from the two price pages before a
  choice is made.
- **A spending cap.** Proposed: a metered tool gets a daily cap, as the optional Perplexity
  digest already has, and the agent asks before using it (decision 18).
- **What to read on X.** Proposed: start with the official accounts the People tab already lists
  for heads of state, ministers and organisations, and attach their posts to stories and sheets
  as what that actor declared. An open search of X is noisier and easier to manipulate; its
  results would carry the lowest confidence label.
- **A second model in the workflow.** Proposed: Grok is a tool the agent calls, not a second
  agent that writes stories. Whether its summaries may be shown, or only the posts it returns, is
  open. Spec rule 13 applies: a post is cited only by a link the tool returned.

### 9.3 Sources (decisions 13 and 21)

- **Complete in viewpoints before complete in volume.** One Refresh digests 400 items and about
  900 can already be waiting. More feeds without better selection lengthen the queue. Proposed:
  the survey aims first at every region and camp having several outlets, and each outlet gets
  the three facts of decision 14.
- **A data allowance.** The owner is on a slow connection. Proposed: the survey records what each
  source costs in megabytes a day, and the list is cut to an agreed daily total.
- **YouTube.** The board already reads channel feeds for officials without a key: titles, links
  and times, not what is said in the video. Whether titles are enough, or a transcript tool is
  wanted when Claude runs, is open.
- **Wire headlines.** Reuters and AP refuse automated readers and publish no feed.
- **MCP tools.** A tool of this kind works only while Claude is running, so under decision 4 it
  serves the digest, a search and the agent, never the timed collection.
- **The Telegram question** (R7).
- The owner has said sources are looked at later, and has not yet given ideas on the live data
  sources.

### 9.4 How news is selected (decisions 22 to 24)

- **Two jobs.** Grouping: seeing that thirty headlines are one event. Ranking: deciding which
  stories come first. Today's rule for which 400 headlines a Refresh reads is starred outlets
  first, then the newest, so the busiest feeds win.
- **Proposed: the agent gathers, code ranks.** The agent groups what was collected and may look
  outward for more on the top stories. Code orders Today by factors the owner can see: how many
  outlets and camps tell a story, whether it sets or clears a flag, the watchlist and newness.
  Each item says why it is listed. If a model alone chose what is best, the app's own choice
  would be a slant nobody could inspect, which is what decisions 8 to 10 exist to prevent.
- **Two sizes of Refresh.** Proposed: a quick one as today (the digest reads what was collected,
  with no tools) and a deeper one that lets the agent look outward for the top stories, which
  takes minutes and may use metered tools.
- **Filing by area (decision 23).** Proposed: every story is filed under one or two of the
  board's twelve Strength areas (Economy, Fiscal, Government, People, Society, Military, Energy,
  Food, Logistics, Technology, Diplomacy, Culture). They replace the six categories of the World
  theater, each of which has a home: armed conflict in Military, elections in Government,
  protests in Society, diplomacy and sanctions in Diplomacy, humanitarian news in Food or People,
  rights in Society or Government. A fixed table says which areas feed each of the six Condition
  bars. Whether twelve areas or the six bars is the better list was for the stage 0 mock. The
  mock showed the same stories filed both ways, and decision 31 takes the twelve areas: the filer
  already uses them, and diplomacy and energy have no bar of their own. The fixed table is in
  Appendix D as the mock showed it, and is reviewed when stage 3 is built.
- **What filing gives.** On a country sheet each bar and area lists its stories under its number.
  The lens becomes the filter: choosing Strength and then Energy leaves only energy stories on
  the globe and in Today, with no separate category control. Code can rank by it and say so, as
  in "touches this country's weakest bar". A story can also attach to a relation between two
  countries, a chokepoint or a person, which already have cards.
- **News never moves a bar.** Spec rule 5 holds. A bar shows its published measure and, beside
  it, a count of the stories of the last seven days. Whether a word such as "rising" may sit with
  the count, labelled as a model's reading, is open.
- **Who files.** The digest already gives each story one category from a fixed list, and code
  drops anything off the list, so changing the list is small. Filing each headline before the
  digest, so that the right 400 are read, needs a cheaper filer: keyword rules in code, or Jev.
- **The Jev test (decision 24), prepared on 2026-11-11 for the day the owner gets a key.**
  - What Jev is, read from TypeSafe's own docs that day: one request carries a state and typed
    questions and returns probabilities, with no text; version 1.14.0 can be pinned; input costs
    0.042 US dollars per million tokens; there is no seed, so answers can vary. Its one public
    test, of market prediction, scored worse than a coin flip. Filing a headline is a different
    job from predicting.
  - The set: 150 headlines collected that day, at most seven from one outlet. Two labellers
    working apart mark each as keep or drop and file it under an area. Only the items they agree
    on count.
  - Three filers: keyword rules in code, Jev asked twice, and Claude through the digest's own
    path.
  - Pass marks for Jev, fixed before any result was seen: keep or drop right on 90%; at most 5%
    of real news dropped; the right area, as first or second choice, on 80%; ten points above the
    rules; within five points of Claude; the same answer on 95% when asked twice.
  - Limits: one day's headlines, about a hundred kept items, and labellers that are themselves
    Claude models. The owner's check of the items the labellers disagreed on matters.
  - The script and its data stay out of the repository, because collected headlines are not
    committed.
  - If it passes, its answers stay advisory: code applies the threshold, every headline shows
    its filing and probability, and nothing it says sets a flag or a score. It runs under a daily
    cap.
  - Result, 2026-11-12, on version 1.14.0. Keep or drop right on 96% (keyword rules 76%). Real
    news dropped: 3% (rules 20%). Noise kept: 7% (rules 39%). Right area as first or second
    choice on 95% and exactly on 90% (rules 70% and 54%). The same answer on 96% when asked
    twice. 300 requests cost about 1.2 US cents and took 0.3 seconds each. Every mark that was
    run is met. Claude was not run: on the scored run even a perfect Claude would lead by 4.8
    points, inside the mark, though the second run was a point lower, so that margin is thin.
    Adopted on 2026-11-12 (decision 26), filing as headlines are collected (decision 27).
- **What timed filing opens up (decision 27).** Each headline has its area within minutes of
  being collected, without a Refresh. Counting headlines per country for the Overview still needs
  a place for each one, which today only the digest gives. Proposed next step: match headline
  text against the gazetteer in code. That would answer the thin code-only Today of section 8.1.

### 9.5 The agent (decision 12)

- **What it absorbs.** Which stage 5 items become part of it, and whether voice becomes a way of
  talking to it or stays a separate assistant.
- **Hands.** The voice assistant has 32 actions that move the globe, such as flying to a place,
  switching layers and opening panels. None acts on the board yet.

### 9.6 How a bar moves (decision 25)

The owner asked on 2026-11-11 how a bar moves if news never moves it, and then whether a full
rework would do better. Five of the six Condition bars rest on one figure published once a year;
only Security, from conflict deaths, is monthly. All twelve Strength areas are yearly or slower.
No design creates data: for Government, Services and Society nobody publishes a fast figure for
every country. Decision 25 sets the direction. Still open:

- **What goes in each basket.** Known today: monthly consumer prices for Households (already
  fetched for the inflation flag), monthly conflict deaths for Security (already used) and the
  daily exchange rate for Fiscal, for the currencies the feed covers. The baskets of Government,
  Services and Society stay slow, and their alert level carries the present. R10 finds the rest.
- **How a basket is combined,** and how a bar shows the age of its newest figure.
- **The second reading.** How far back "its own past" goes (five years is proposed), and whether
  the sources' older values are fetched for it.
- **The alert level.** Four steps are proposed: calm, watch, strained, crisis. The rules that
  set each step for each bar are written and reviewed like the anchors, and each level says why
  it is set. Proposed: an event taken from stories can raise a level only when the story is
  corroborated.
- **Named outside trackers.** Candidates to check for terms and coverage: a monthly reading of
  conflict direction, food-crisis phases, and travel advisories from several governments. Each
  is shown with its issuer, as any teller is.
- **Estimates stay.** The spec's dashed ghost for a stale figure (rule 4, stage 5) is unchanged.
- **The Strength areas stay yearly.** They describe capacity, which changes slowly.
- **No overall bar.** The sheet's "HP" line is the weakest bar, not a total, and spec rule 10
  keeps a total out for now. Renaming that line is already in 2.6.
- **The spec.** Decision 25 changes how the World Board spec defines an indicator, a bar's score
  and the live condition flags (its sections 4.2, 4.5 and 8.3). It needs a dated revision before
  2.6 is built.

### 9.7 Live layers and providers

Raised on 2026-11-12 and not yet answered.

- **Which layers earn a place on the main screen.** Proposed: ships, flights, fires, hazards,
  cables and installations, and recent satellite imagery serve the goal. Cameras, street
  photographs, traffic, transit and radio stay in the City preset, off the main screen.
- **Providers the owner does not have yet,** by what they would add: a NASA FIRMS key (active
  fires); an HDX app identifier (food-crisis phases and food prices, for the Households bar); an
  ElectionGuide token (the election calendar, for the Government alert level); a ReliefWeb app
  name (humanitarian reports for news and searches); approval for IODA (internet outages, for the
  Services alert level, its licence still unconfirmed); a Grok or X key (decision 20). The Google
  Maps, street-photograph, road-traffic and London-camera keys are not worth getting for this
  goal. They belong in the survey of R10.
- **Launch Library 2** needs no token: it is free up to 15 requests an hour and the app asks at
  most four times an hour. The app uses only its launches. Proposed uses: launches per country in
  the last year as a fresh figure for the Technology area; launch sites with their counts as
  board assets; upcoming launches and events as dated items in Today.
- **The owner's new keys** (ships, flights through an account, Cesium, OpenAI) were checked on
  2026-11-12 and work (section 8.2). None has been seen in the running app. With an OpenAI key
  set, the summary line at the top left calls OpenAI by itself while the app is open; Appendix A
  already drops that call.
- **Whether to ask the IMF for permission.** The free ship feed cannot replace PortWatch at the
  Middle East straits (section 8.2). Proposed: the owner sends one short request, and those
  straits show as unknown until an answer comes.
- **Whether to switch on GitHub's automatic checks** on the owner's fork, so that each pull
  request is also tested on a clean machine.

## 10. Building it

Decisions 29 and 33 governed the builds below. The table records what merged and where work paused.
Decision 37 paused unfinished work, decision 38 resumed F–L and decision 40 resumed Street level
for the test-ready pass. Future feature priorities are for a fresh brainstorming chat.

| Order      | Piece                                                                | State on 2026-11-28                                                                             |
| ---------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Done       | The Jev filer and the connection allowance (decisions 26 and 27, R8) | Merged as pull request 25                                                                       |
| 1          | Stage 0: the mock of six screens and the page of design tokens       | Done. Approved 2026-11-12 (decision 30)                                                         |
| 2          | Costume off, board on: the first pull request of section 7           | Merged as pull request 26 on 2026-11-13                                                         |
| 3          | The frame (1.2), built to the approved mock                          | Merged as pull request 28 on 2026-11-16                                                         |
| 4          | Words for numbers and the Overview tab (2.1 and 2.2)                 | Merged as pull request 27 on 2026-11-13                                                         |
| 5          | The tools menu (1.5)                                                 | Merged as pull request 29 on 2026-11-16                                                         |
| 6          | The layers menu (1.4)                                                | Merged as pull request 30 on 2026-11-17                                                         |
| 7          | One look (1.3), A1, A2 and B to D                                    | Merged as pull requests 31, 33, 34, 35 and 36, with corrections in pull request 32              |
| 8          | One look (1.3), F–L                                                  | Merged as pull request 37 on 2026-11-18 (decision 38)                                           |
| 9          | Test-ready pass                                                      | Name and welcome merged as pull requests 38 and 39 (decision 40)                                |
| Parked     | Visual regression tests (1.6)                                        | Paused on 2026-11-18 (decisions 37 and 38)                                                      |
| Deployed   | Private deployment of main at `1e2e589e`                             | Running at `http://localhost:4173` on the owner’s PC (decision 37)                              |
| Order open | Unfinished feature work                                              | Revisit priorities in a fresh brainstorming chat (decision 37)                                  |
| Beside     | Track R                                                              | The original milestones are in section 4. The earlier roadmap recorded this track as unstarted. |

**Piece 2, costume off and board on.** Merged on 2026-11-13 as pull request 26 (merge commit
`c9c6beee`), on the owner's word. Before the merge a separate agent ran the five gates again and
they passed (7,057 tests: 7,047 passing, none failing, 10 skipped), and four reviewers read the
change, each serious finding checked by a second reader. The four fixture QA scripts were not run
again: they start a server, and a server with every key blanked still fetches the free headline
feeds and tries the traffic cameras by itself, which uses the owner's mobile data. The review found
nothing that breaks the app. It left these, none of them built:

- **For the frame (piece 3).** The country codes are hidden under a panel only when the globe draws
  a frame. With the camera still, a panel that opens or closes asks for no frame, so the codes stay
  as they were until the globe moves, and turning the camera in place is not checked again
  (`src/overlays/panelCover.js`, and `cullLabels` in `src/layers/world/geometry.js`). At 720 px and
  narrower the legend still sits a few pixels over the status line. MGRS is always shown; Appendix A
  makes it optional. None of this has been seen in the running app with imagery on.
- **QA scripts outside the gate list.** `qa-ui-disposal.mjs` and `qa-cockpit-utility.mjs` now fail
  on the removed parts. `qa-radio.mjs`, `qa-view-target-prewarm.mjs` and `qa-perf.mjs` still measure
  or mention them without failing.
- **Tests.** Three guards went with the Cyber tests and have no test now: aircraft labels at full
  strength under the infrared boost, a military style preset setting the layout back to Tactical,
  and the single writer of the location readouts.
- **Small.** A saved layer state that cannot be read, or that comes from an older version, counts as
  a first start, so the board comes on. The on-screen tag for a stale live feed went with the
  summary line; the layer list still shows it. The TR-3B registry and its sprites, and the Cyber
  settings of the cockpit strip, can no longer be reached. `docs/CURRENT-STATE.md` still describes
  removed parts in the present tense.

The before and after captures, and the two scripts that took them (`start-server.mjs` and
`capture.mjs`), are in the main folder under `qa-artifacts/costume-off/`, not committed. The
worktree and its local branch are removed.

**Pieces 3 and 4, built at the same time (decision 32).** Started on 2026-11-13 as two Opus agents,
each in its own working folder on the owner's PC and each opening one pull request, from branches
`feat/frame` and `feat/words-for-numbers`. The owner asked for the cloud. The app would not start a
cloud session while the owner was connected from another device, and an agent sent to the cloud
from the session ran on the PC instead, so the cloud is still untried for this project. The two
pieces share the country sheet and split it like this. The frame owns the container: `index.html`,
the templates, where the sheet sits, its width, the look of the tab bar and the layout rules of
`world-panel.css`. Words for numbers owns the content: the code that writes the words, the rows and
the Overview tab. Whichever is merged second is first brought up to date with the other.

**Piece 4, words for numbers and the Overview tab.** Merged on 2026-11-13 as pull request 27 (merge
commit `e3371087`), under decision 33. Every score now has a band word, a sentence, a reading
against the world and a reading against its own past. A selected country opens on an Overview of six
lines, each opening the tab that holds its detail, and a Condition row opens to the world, its past
and "Why this number". The server keeps up to 12 stored periods for each figure so a trend can be
drawn, and a saved board shows them without a Refresh.

Two readers read the change and a second reader checked each serious finding. They found two faults
that made a sentence say something false, and lesser ones: all were fixed, and the fixes were read
again by independent readers. Before the merge, on the final commit `fb3de856` and with nothing else
running on the PC, the five gates passed at the first run (7,087 tests: 7,077 passing, none failing,
10 skipped) and the World Board fixture run passed all 24 steps against a server with no keys, up
for six minutes. After the merge the tree of `main` equals the tree of that commit. Not checked: the
running app with the owner's saved board and keys, and the news, searches and lenses browser runs,
which this piece does not touch. The review left these, none of them built:

- The Overview's Condition line still says "weakest bar", which 2.6 lists among the words to rename.
- A stored history is dropped without a word when its figure no longer matches the board, which
  happens if an anchor or a transform in `public/world/indicators.json` changes before a Refresh.
  The sheet then says earlier years are not stored when they are (`withStoredHistory` in
  `server/providers/world/scores.js`).
- If one indicator ever stored both a yearly and a month-12 period, the trend's "now" could differ
  from the bar beside it. No current source does.
- The whole history travels in every snapshot, not only with an opened country: about 0.2 MB more
  on the wire for each load once sources hold 12 periods.

**Piece 3, the frame.** Merged on 2026-11-16 as pull request 28 (merge commit `286c7bae`), under
decision 33. The World Board now sits in the frame of the approved mock: a top bar, the Today column
on the left, the globe in the middle, one country sheet on the right and a bottom bar, each a solid
region. The lens buttons, the legend, the turn and Refresh moved into the bars. Today shows an
honest empty state until there are stories (decision 32) and folds to a narrow rail. Below 1180 px
Today and the sheet take turns; at 720 px and narrower Today folds and the sheet covers the globe.
The sheet's tab bar holds Overview, Condition, Strength and Relations, and a More menu holds
Exposure, Leverage, Assets and People. News and Stakes are not listed until they have content
(decision 32). Putting Leverage under More, and leaving those two out, are the director's readings,
for the owner to confirm.

What piece 2 left for the frame is done. The globe's canvas and its labels are cut to the globe
region and `src/overlays/panelCover.js` watches the regions' sizes, so a country code no longer
shows under a panel while the camera is still. On a phone the bar does not draw the legend, so
nothing sits over the status line. MGRS is off unless it is turned on under Display.

The legend has a rule, set by the director during the build and also for the owner to confirm. In
the 52 px bottom bar a colour class is shown whole or not at all. While the legend is in the bar,
its title and the "Unknown or disputed" key are whole. Where the bar cannot hold even those two, in
a narrow window, the legend leaves the bar altogether and a button, "The whole legend", stays, as on
a phone. Whenever anything is left out or the note is cut, that button is shown and opens all of it.
Nothing is drawn half-clipped at any window width.

The change was read three times. A reader of `1516244e` found that a class which sets `display`
defeated the `hidden` attribute, so parts the frame hides were still drawn; that was fixed, and
`src/ui/frameHidden.test.mjs` now tests for it. An independent reader then read everything since
(`1516244e..f8080375`), confirmed that fix, and found the legend's title and Unknown key still
clipped between about 721 and 1100 px, the button's own width left out of the fit, and the colour
ramp not measured. A builder fixed these in `43903518`. That last fix, about 100 changed lines of
app code with their tests and browser steps, was read by the directing session and not by an
independent reader.

Before the merge, on the final commit `43903518` and with nothing else running on the PC, the five
gates passed (7,155 tests: 7,145 passing, none failing, 10 skipped) and so did the four fixture
browser runs, against a server with no keys that was up for about 18 minutes: the World Board 25 of
25 steps, the news 28 steps, the searches 11 checks, and the lenses 22 with 1 skipped (the
frame-rate comparison, which the run turns off). That was the second full run. The first failed two
scripts for reasons in the scripts, not the app. The news script expects a digest stamp with a time
only, and fails for about ten minutes after local midnight, when the app rightly adds the day. The
World Board script's first step waits for a loading line that a fast load has already cleared. After
the merge the tree of `main` equals the tree of that commit.

Not checked: the running app with the owner's saved board, keys and imagery (the top bar's gauges
were seen only with test data); window sizes other than the six measured (1280×720, 1440×900,
1920×1080, 1024×768, 800×600 and a 390×844 phone); fonts other than the test browser's; the cockpit,
recording and the clean view; recent imagery's split view, the scope vignette and the sun and moon
ring; and six QA scripts outside the gate list, which were edited for the smaller canvas and never
run (`qa-draw-tool.mjs`, `qa-cctv-v2.mjs`, `qa-directions.mjs`, `qa-installation-polish.mjs`,
`qa-transit.mjs` and `track-regression.mjs`). The review left these, none of them built:

- **For the tools menu and the layers menu (1.5 and 1.4).** The original's floating panels can
  overlap at 1280×720 with Display expanded and with Today and the sheet both open. A panel that can
  be dragged still stops at the window's edge, not the globe region's, so it can be dropped under a
  bar, Today or the sheet. The fixed points that `qa-draw-tool.mjs` clicks can now land on a panel.
  The dock still has a second voice button beside the one in the bottom bar.
- **For the restyle (1.3).** Sheet text under 12 px outside the Overview (`.world-control`,
  `.world-kicker`, `.world-flag`, `.world-slot-id` and `.world-row-score` in
  `src/ui/styles/world-panel.css`). The legend's dense form sets 12 px type on a 12 px line.
  Ownership shows two of its four lines at 1280 and 1440 px wide, and at 1024×768 most legends keep
  only a few marks: shorter wording would let more in.
- **For the tests (1.6).** Tests that only match source text or do arithmetic on tokens
  (`src/costumeOff.test.mjs`, parts of `src/ui/frame.test.mjs`, `src/overlays/panelCover.test.mjs`
  and the additions to `src/hudStatusLine.test.mjs`). `src/testSupport/cssCascade.mjs` takes every
  `@media` and `:has()` as true and skips `@container`, so its guard cannot cover `#frame-presets`
  and `#frame-layers`. The World Board script now takes 13 to 17 minutes, because it measures every
  lens's legend at two more window sizes, and a full run takes 21 to 25. The two script faults of
  the first run are still there.
- **Small.** The status line shows "Eye altitude" and "UTC" with no figure before the first tick, or
  when the altitude is not a number (`src/hud.js`). The frame leaves room for what later items
  bring: the new name in the title (R6), the search box (2.3) and Today's list (stage 3).

The logs of both full runs and the frame's captures are in the main folder under
`qa-artifacts/frame/`, not committed. The worktree and its local branch are removed.

**Piece 5, the tools menu (1.5).** Merged on 2026-11-16 as pull request 29 (merge commit
`7ab45925`), under decision 33. The original app's tools moved off the globe into a menu at the end
of the top bar. Its button opens a list of three: Data sources and keys, Display, and Tools. Each
opens a floating panel under the top bar, on the right, and only when it is chosen. A panel closes
with its close button or with Escape. It does not close on a click on the globe, so drawing and
picking a place still work while one is open. At 720 px and narrower the panels are full-width
sheets above the bottom bar. Data sources and keys opens the provider-keys dialog and holds the War
Monitor's switch. Display holds the render styles, the map source, the render quality and the
display options. Tools holds the place search, north up, tilt and Reset Globe, drawing, scenes and
recording, and the share link. The controls were moved whole, with their ids, so voice, scenes,
share links, embed and MCP still find them. The dock's voice pill and the globe's own zoom pair are
gone: voice is the microphone in the bottom bar, and zoom is the bottom bar's. The cockpit is still
entered from a selected aircraft's card. Other parts of the app open a section through
`openMenuSection` in `src/ui/toolsMenu.js`, or by the `gev:open-menu-section` event, whose names
are in `src/ui/menuSections.js`. With nothing opened, the only part of the original app over the
globe is the status line. The cameras, street level, context and radio panels stay where they were,
as the brief asks.

Two readings are the director's, built as written, for the owner to confirm. The War Monitor's
switch lives in Menu ▸ Data sources and keys until Today takes the news over; 1.4 takes its row out
of the layer list. And, like the World Board, the War Monitor is left alone by "Switch all off" and
by the presets.

An independent reader read the build and a second reader checked each serious finding. A builder
fixed what stood in `0fdf1e56`: "Open the War Monitor panel" had left the menu's own panel lying
over the War Monitor panel, and the legend's width had been read from a picture, not measured. An
independent reader read that fix and found nothing that breaks the piece.

The first full run, on `0fdf1e56`, failed in two places, and neither fault was in the app. One unit
test failed (7,165 tests: 7,154 passing, 1 failing, 10 skipped). `src/annotations/drawTool.test.mjs`
finds the Draw description in three documents by the words "DISPLAY ▸ Draw", and the branch had
rightly changed `README.md` to "Menu ▸ Tools ▸ Draw". No builder saw it, because builders were told
not to run the whole `npm test`. And the World Board script failed at its first step, the fault the
frame's run had met. A fixer cured both, and a third, in `38b7663c`, which touches tests, scripts
and one line of `docs/CURRENT-STATE.md` and no app code:

- The document test accepts the old words or the menu's.
- Before it clicks, `toggleWorld` in `scripts/qa-world.mjs` notes when the loading line is shown,
  and the first step (`scripts/qa-world.phase-1.mjs`) waits until it was shown or is still showing,
  so a fast load no longer slips past. The layers menu's branch carries the same lines.
- Each fixture snapshot in `scripts/qa-news.mjs` reads the clock once. Before, every story read it
  for itself, so three stories given the same age tied only when built in the same millisecond, and
  the app, rightly sorting by time, sometimes put them in an order the script did not expect. That
  had failed one earlier run.

Two independent readers read that commit and found nothing that breaks it. They found two untrue
sentences in the pull request's text, which the director corrected.

Before the merge, on the final commit `38b7663c` and with nothing else running on the PC, the five
gates passed (7,165 tests: 7,155 passing, none failing, 10 skipped) and so did the four fixture
browser runs, against a server with no keys that was up for about 19 minutes: the World Board 33 of
33 steps, eight of them the menu's, the news 29 steps, the searches 11 checks, and the lenses 22
with 1 skipped. After the merge the tree of `main` equals the tree of that commit.

Two things learned. The legend's width follows the lens: at 1280×720 its band in the bottom bar is
481 px under Strength and 472 px under Condition, on `main` before this piece and after it. The
pull request first read those two numbers as 9 px lost; a width is compared only under the same
lens. And the rule that kept builders from the whole `npm test` let a test pinned on a document's
words fail unseen. A builder who changes a document's words now searches the tests for the old
words first, and makes one run of the five checks, under the shared lock, on the final commit.

Not checked: the running app with the owner's keys; a War Monitor Refresh or a Search Layers run; a
real phone (only a 390×844 window); and `scripts/qa-draw-tool.mjs`, rewritten to open the menu and
to aim at the open globe and never run. GitHub runs no checks on the fork, so the local run is the
evidence. The review left these:

- **Given to the layers menu's second stage (1.4).** Type sizes written in place in
  `src/ui/styles/tools-menu.css`. The Share button's word is not a real text node. The menu's
  wrapper borrows the sheet's `frame-more` class. The note about keys does not follow the keys
  dialog. The Tools panel's "View" heading shows even when its group is empty. Nothing records that
  the hidden zoom pair is tied to the bottom bar's. `README.md` still sends the reader to a "POWER
  UP" chip, `docs/CURRENT-STATE.md` still describes a DISPLAY rail, and `CHANGELOG.md` has no
  entry for the menu.
- **For the tests (1.6).** The first step's new wait passes if the loading line is missing
  altogether, and does not look at whether it is really drawn. In the document test the old words
  win over the menu's where a document holds both.
- **Still there.** The news script still fails for about ten minutes after local midnight, so no
  full run is started then. The panels this piece leaves in place, and the War Monitor panel, still
  float over the globe and may overlap at 1280×720; that is not measured.

The logs of both full runs, of the builder's five browser runs, and the captures are in the main
folder under `qa-artifacts/tools-menu/`, not committed.

**Piece 6, the layers menu (1.4).** Merged on 2026-11-17 at 13:00 Cairo time as pull request 30
(merge commit `bad1d88a9ddfc64a31caf6f90e96e4f00e513407`), under decisions 33 and 34. Layers and
Presets open from the bottom bar. Layers shows eight topic groups, an on count, Switch all off,
and plain state words. The two preset bars share their busy state. Search layers opens its tool.
World and the War Monitor have no list rows. Presets and Switch all off leave those two frame
layers alone, and the count covers the layers in the list. The War Monitor stays under Menu ▸ Data
sources and keys until Today takes the news over. These are the director's readings for the owner
to confirm.

The three footer links open the matching Menu panels. Escape or the close button returns focus
to Layers for a panel opened from the footer, and to Menu for the other routes. The cockpit has
its own Layers and Presets buttons and hides the footer links while the top bar is unavailable.
Leaving the cockpit closes both menus and returns Presets to the bottom bar. Layers, Presets,
the top-bar Menu and its panels, the sheet's More menu and the legend popover open one at a time.

The directing context read the whole second stage. An independent Sol context reviewed the final
app fixes, test changes and local gate runner changes. Three new behaviour tests failed against
the previous app code and passed with the fixes. The local runner safeguards were checked with
synthetic cases. The runner and its evidence are kept locally outside Git.

The full run was alone on the PC on 2026-11-17 from 12:29 to 12:58 Cairo time, on
`1655243ee2aa1fa4c3935595bbd1f578b6bdaa0a`. All nine steps exited 0. Format, boundaries, layer
tokens and the production build passed. Of 7,200 tests, 7,190 passed, none failed and 10 were
skipped. The World Board fixture passed 38 of 38 steps, news passed 30, searches passed 11, and
presets and lenses passed 23 with one performance check skipped. The checkout was clean before
and after, the server stopped and the shared lock was removed. The merged `main` tree matches the
tested head. The run, screenshots and evidence manifest are under
`qa-artifacts/layers-menu/layers14b-codex-final-1655243e/` in the main folder, outside Git.

At 1280×720 the Strength legend was 481 px wide with and without the Menu button, matching the
Strength baseline. The cockpit fixture entered with the C key on a tracked synthetic aircraft.
Both menus cleared the named instruments at 1440×900. The new route buttons and menu boxes fitted
inside 390×844. The old cockpit HUD still crowds at that width and some icons fall back to text
in the fixture. The cockpit restyle is 1.3 K. This run used fixtures. Live keys, aircraft and
imagery, a real phone, the microphone, a paid War Monitor Refresh and a real Search Layers run
are untested. The keyless server can still fetch free feeds, and its mobile-data use was unmeasured.

Six edited scripts outside the gate remain unrun: `qa-radio.mjs`, `qa-failstate-b10.mjs`,
`qa-map-source-tray.mjs`, `qa-weather-journey.mjs`, `qa-draw-tool.mjs` and `qa-cctv-v2.mjs`.
`qa-cockpit-utility.mjs`, `qa-directions.mjs`, `qa-transit.mjs` and `qa-overpass-offload.mjs`
were unchanged and unrun.

Premerge history, restored on 2026-11-17. The earlier World Board fixture run on `d07c31b1` passed
37 of 38 steps. The cockpit Layers menu overlapped the compass at 1440×900. Commit `43b3c855`
raised the menu based on its calculated placement. The follow-up run stopped before it produced a
summary. An independent reader also found that the three cockpit footer links closed the Layers
menu and tried to open panels in the hidden top bar. The panels stayed hidden and focus dropped to
the page body. The final PR 30 fix hid those links in cockpit mode and the full run recorded above
passed.

Scope of the cockpit result. At 1440×900 the check covered seven named readouts and four buttons.
The speed and altitude scales were informational checks. The open Layers menu covered part of both
scales and their labels. Pull request 32 updated the check and its report to name the readouts and
controls they cover. The new run again reported overlap with the scale bounding boxes. The cockpit
restyle remains scheduled for 1.3 K.

The same pull request gave an uncertain layer switch an accessible description from the visible
“State uncertain” text. The description clears when the layer recovers. The layer name and any key
guidance remain its accessible name.

**One look (1.3): the plan.** Scoped on 2026-11-16 by six readers and a challenger, from the code
and the mock. The scoping review used no browser. The plan is in the main
folder, `qa-artifacts/handoff-2026-11-13b/briefs/piece-1.3-plan.md`, not committed. The readers
counted, by script, 1,632 colours, 54 font families and 342 sizes under 12 px written in place in
the app's source. The 51 tokens from the approved mock are in `src/ui/styles/foundation.css`.
Piece 1.4 added three control type tokens and A1 added seven more tokens and applied shared styles
to the World Board and common panel surfaces. The other panels follow in later pieces.

The scope covers thirteen pull requests: A1 and A2, ten panel pieces from B to K, and L. Each
gets the full local run and an independent read, one at a time.

- **A1, the tokens and the board's later sheets.** The seven old tokens that equal an approved one
  become its alias. The world sheets, `panel-surfaces.css` and the last colour written in
  `frame.css` take the tokens, and sheet text under 12 px is cured. One module of plain values,
  `src/designTokens.js`, feeds the globe's colours, with a guard that it equals the style sheet.
- **A2, the kit.** One sheet of shared components, `src/ui/styles/kit.css`. A check that no colour,
  font, size, radius or shadow is written in place, with an allowance per file that only goes down.
  A capture script, `scripts/qa-look.mjs`, that pictures one panel, empty and filled, at 1280×720,
  1440×900 and 1920×1080 and fails when a panel lies over the frame or over another panel. The lens
  bar's sizes and the dense legend.
- **B to K, one panel each,** in the order of item 1.3: layer list, weather, cameras, street level,
  recent imagery, radio, context, settings and keys, welcome, and the cockpit last, as one pull
  request.
- **L, what item 1.3 does not list.** The command dock, the voice card, directions, drawing, scenes,
  the agent's panel, toasts, credits and the sync chips. "No colour or font written in place" cannot
  be met without them.

**One look (1.3), A1, the tokens and the World Board sheets.** Merged on 2026-11-17 at 13:45 Cairo
time as pull request 31 (merge commit `274b9a1a5907509a26ec09ca327e68129ad33491`), under decisions
33–35. Seven legacy names now refer to the matching shared values for the background, menus,
borders, panel and button corners, panel shadow and primary text. The global focus ring uses
the primary text colour at its existing width and offset. The World Board sheets and common
panel surfaces use the shared colours, radii and type. The frame tabs and area selector use the
control type and the globe status line uses the space surface at 72% opacity. Captions use at
least 12 px and reading text at least 13 px in the scoped sheets. Known scores can use the figure
face. Band words, periods, score phrases and unknown labels use the reading face.

`src/designTokens.js` supplies the CSS palette values to the globe for relation fills and
lines, the five score ramp stops, the civil, military, sea and space defaults and the documented
ownership fill. A Node test checks that palette against the stylesheet. The type test exercises
the rendered sheet tree in both cascade orders with the eagerly loaded World Board styles.

The independent read cleared the change. Nine behaviour cases failed on the baseline and
passed with the implementation. The rendered-tree assertions added afterwards passed in the
targeted run. The targeted checks passed 208 tests, the focus checks passed 12 and the three
light checks passed. The full gate ran from 13:21 to 13:43 Cairo time on
`31e39eb1d23e93cd826d51033cfb6325258af90c`. All nine steps exited 0. Of 7,214 unit tests,
7,204 passed, none failed and 10 were skipped. World Board passed 38 steps, news 30, searches
11, and lenses 23 with one performance check skipped. The checkout stayed clean at the tested
head. The server stopped, its port closed and the lock was removed. The merged `main` tree
matches the tested tree, `7b7a217c7e100bd99bc1f2159a8d305da914299f`. Gate evidence is filed
locally at `qa-artifacts/one-look-a1/one-look-a1-final-31e39eb1/`.

Comparisons of the Condition explanation, People, Exposure, Ownership and the frame at three
sizes showed the same sampled values and globe colours, with larger sentence-case labels and
no new clipping in those views. The area picker now wraps to three rows and extends farther
upwards. It passed the bounds check. The Strength legend measured 481 px. The browser used
keyless fixtures. No test run or server remains active.

At the A1 handoff, A2 was next and had yet to start. Its scope was the shared panel
components, the check for style literals, the panel capture script, and the lens bar and legend
type.

**Before A2, corrections from the 17 November review.** Pull request 32 merged at 16:05 Cairo time
as `fd2193114eb54e663fdd3cb98c2aa3e87fe00a0f` under decision 36. The shared panel titles restored
`0.1em` tracking for Situation and Search Layers. Stale live flags again use `#f2cf91` via
`--status-stale` and normal energy statuses use `#6cddff` via `--status-normal`. The readable-type
tests now render Exposure energy rows, their headings and route controls, plus the chokepoint
sheet. The layer-switch description and cockpit check are recorded in the piece 6 history.

The independent read cleared the changes. An initial gate stopped at the format step because of
line endings. The full rerun was alone on the PC from 15:36 to 16:04 Cairo time on 2026-11-17,
on `3424c34b2aabb67d3a2d61df9e7ed010b5d4237c`. All nine steps exited 0. Format, boundaries, layer
tokens and the production build passed. Of 7,217 unit tests, 7,207 passed, none failed and 10 were
skipped. World Board passed 38 steps, news 30, searches 11, and lenses 23 with one performance
check skipped. The checkout stayed clean at the tested commit. The server stopped, its port closed
and the lock was removed. The tested tree, `8228e2eeacc079d9a62458debacbb1bcb8dfb4e7`, matches
the merged tree. The gate evidence is at `qa-artifacts/before-a2/before-a2-final-3424c34b-run2/`.
The SHA-256 of its `summary.json` is
`5571cb7b9d55253156abaaaf2bf43b0098a9b19c355269a8f03b2e8ed9a7be24`.

The browser used keyless fixtures. A real phone, a screen reader and the panel title fit at the
176 px collapsed width were untested. A real Search Layers run was not made. Mobile-data use was
not measured. Inspection of the archived Search Layers picture after the merge showed a World
Board load in progress. The older news, searches and lenses fixture scripts pass unrelated World
API requests to the server, allowing a cold load in a fresh checkout. A2 will block these requests
in fixture mode before its next browser run. The earlier gate proves the recorded checks; it does
not prove that every provider request was isolated.

A2 started after the correction merged, in `gev-one-look-kit` from `fd219311`, with the testing
tools first.

**One look (1.3), A2, the shared kit and legend.** Pull request 33 merged on 2026-11-17 at
18:36 Cairo time as `8c561726e8eff4ccf2a832639c495bdaa84bf961`. The opt-in kit supplies the shared
panel, popover and control styles. The preset strip and menu use those styles and keep the eight
presets, state, counts and hotkeys. The legend's band and popover now use 12 px type with a 16 px
line height. The dense band tightens gaps and swatches. The whole legend opens within the globe's
side insets and retains the complete title, stops, Unknown key and source note.

The style-literal check ratchets legacy counts by file and kind. It counts 2,005 occurrences in
148 rows, down from 2,012 in 149. The new kit and preset stylesheet have no findings. The check
covers shipped CSS and HTML and statically recognizable JavaScript style forms. Dynamically
constructed JavaScript styles are outside its scope. The provider correction noted above is in
this change. The news, searches and lenses fixture scripts now reject World API requests locally,
including refresh. The Look capture has its own World fixtures and a restrictive proxy.

The first three tooling-only captures stopped before the baseline matrix. On `183dcf51` a worker
denial surfaced as a fetch error. On `88f64dcb` the app's content security policy blocked the
cross-port probe before it reached the proxy. On `9c53aff0` the isolated worker probe passed, but
the capture timed out opening the India sheet. The completed baseline ran at 16:30–16:32 Cairo
time on `0f82c5dd64f04639d30fdf28f234690d3f8d5a41` before the product edits. It saved 23 cases
across six lenses and three desktop sizes. Five popovers overlapped the country sheet: Diplomacy
and Ownership at 1280×720 and 1440×900, and Diplomacy at 1920×1080. This explains the baseline's
nonzero exit. The evidence is at `qa-artifacts/one-look-a2/before-0f82c5dd/restyle-1.3/legend/`.

The first full gate on `54bbc89ff294df55b8ec9237f5988c9ff96ca24a` passed the nine checks outside
Look. Look saved the entire matrix, then an unhandled socket reset stopped cleanup before the
report was written. The proxy fix handles peer errors on rejected tunnels and closes its side
after the denial flushes, including when the peer leaves its side open. The Look-only preflight
on `485956d6cbfb0c08498c7f41c8f4d2637fdaf8d1` passed all 23 cases at 17:22–17:24 Cairo time. The
second full gate on the same head passed all nine other checks but failed Look. Today folded
after the 1440×900 Diplomacy band was captured, so ten subsequent cases failed the required
open-Today check. The cause was unproven. A transient viewport change during a clipped screenshot
was the leading explanation. The capture now takes one viewport PNG per case and derives its
crop from that image. The checks still require Today and the India sheet to stay open, and
the report records frame-state changes.

An independent Sol review cleared the final change. The final gate ran alone on the PC on
`f985a7ea1bc60cf10f89e625a7aaeb9fffd3addc`, from 18:05 to 18:34 Cairo time on 2026-11-17. All
ten steps exited 0. Format, boundaries, layer tokens and build passed. Of 7,276 unit tests,
7,266 passed and 10 skipped, with no failures. World Board passed 38 steps, news 30, searches
11, and lenses 23 with one performance check skipped. Look passed all 23 cases, with 18 bands,
five popovers and 46 images. All captured legend type was 12/16. There were no assertion errors,
collisions or capture-state changes. The frame timeline shows Today opening at app startup and
no subsequent transitions. The two worker probes returned 403 with no sentinel hits.
The final checkout stayed clean and at the tested head. The server stopped, its port closed and
the lock was removed. The tested and merged trees match at
`82a669dcaf6bb3511256837924d08257546909b2`.

Terra compared matching cases from the baseline and final image sets. All five baseline overlaps
are gone. Each popover clears the sheet by 8 px. Final evidence is at
`qa-artifacts/one-look-a2/final-f985a7ea/`. The archive contains 218 hash-verified browser files,
and its 300-file manifest is `qa-artifacts/one-look-a2/final-manifest.json`. The final summary
SHA-256 is `24b64623e52890137d36bccc31143e0061cbb5624182f63ed9401ad209336474`.
The failed-run evidence remains in `final-54bbc89f/` and `final-485956d6/` alongside the passing
`preflight-485956d6/` record. Eight merged remote branches are retained, including
`feat/one-look-kit`.

This was keyless fixture QA. A real phone, microphone, screen reader, live imagery, a real
Search Layers run and paid or keyed refreshes were untested. The test server's mobile-data use
was unmeasured. The cockpit Layers menu's side-scale overlap remains as recorded under piece 6.
The merged local branch and its clean worktree were removed. No gate or test server is running.
At the A2 handoff, B was next.

**One look (1.3), B, the Layers menu.** Pull request 34 merged at 22:25 Cairo time on
17 November as `2fa4cacf8836ac971ffa41cfcf89e1d6c976ea9e`. The menu uses the shared popover,
headings, switches and buttons. Enabling a layer also brings its optional controls into the
same type system. The compact radio controls in the cockpit and context panels keep their own
styles. The style check now counts 1,971 legacy occurrences in 147 entries, down from 2,005 in 148.

Terra compared all six matching views at 1280×720, 1440×900 and 1920×1080. Each had 28 rows,
first with none on, then with Directions, Fire perimeters and Data centres on. The old menu
covered rail panels in 17 places across the six views. The new menu hides a panel only while
their rectangles intersect. All six views cleared the frame and other panels, kept Today and
the India sheet open, and returned keyboard focus on Escape. The fire legend and Directions
options grew from 8 to 13 px. At the two smaller sizes the filled list scrolls further vertically.
None of the six views scrolls horizontally.

An independent read found that an early change hid a dragged panel even when clear of Layers.
After the fix, Terra dragged a collapsed Cameras panel at 1920×1080. It remained focusable beside
Layers, left keyboard navigation when covered, and returned to its position and disclosure state
on dismissal. The capture also caught an interrupted World Board fixture request. The test now
keeps the startup request active and waits for the loaded India record and Turn 1.

The first full gate found one test that required an exact list of header classes. It now checks
the button's type and actual position inside the Layers header. In that run, the News fixture
timed out waiting for story pins after a bubble click. The cause remains unconfirmed. A separate
instrumented News run passed all 30 steps with the same assertion.

The final gate ran from 21:52 to 22:19 Cairo time on `3dd53f507c92e20da79d62fcb97ac92a5545c647`.
All 12 steps exited zero. Format, boundaries, layer tokens, the full test command and build passed.
Of 7,281 main-suite tests, 7,271 passed and ten skipped. World passed 38 steps, News 30,
Searches 11 and Lenses 23 with its performance check skipped. The legend passed all 23 cases.
Both Layers captures passed. Terra inspected the final pictures and independently cleared the
code. The tested and merged trees match at `648d47d0a59b19034a1538e49562124e98ea030b`.

Local evidence is in `qa-artifacts/one-look-b/final-3dd53f50/`. Its manifest lists 322 files,
including 218 copied and hash-verified browser files. The summary SHA-256 is
`f6eca6409b25ccde7a5765e86a0cb09261efa9cac2ddac65f80607a3b27ad9d9`. The server stopped
and released port 5315 and the shared lock. The gate used keyless fixtures and guarded Vite's
provider fetches. Live providers, a physical phone and a screen reader were untested. The
previously recorded cockpit side-scale overlap remains for K. Weather (C) followed.

**One look (1.3), C, Weather.** Pull request 35 merged at 01:47 Cairo time on 18 November as
`e3ab5d13a55782878a90522521bc0a2ff0079d79`. Weather uses the solid rail panel and shared cards.
The forecast has a dashed edge with its issued and valid times. Observed weather keeps its own
history clock. Expanded cards name their sources. The freezing point is text on the temperature
scale. An unavailable source or tile claims a previous image only when one was retained. Recent
Imagery keeps its compact controls until F. The Weather sheet's 34 literal-style allowances are
gone, bringing the total to 1,937 across 142 entries.

The before and after runs each captured 18 fixture views at 1280×720, 1440×900 and 1920×1080
with Today and the India sheet open. The views cover a failed first observation, latest and
historical observations alongside the wind forecast, and all Weather layers switched off. The
smallest active text went from 8 to 12 px, with reading text at least 13 px. The lowest measured
active-text contrast went from 1.88:1 to 7.75:1. At 1280×720 a 385 px body scrolls through 962 px
of filled content. A wheel check reached the lower controls without moving the frame.

The pictures exposed the wind reading marker covering Weather. Hit testing confirmed the fix
behind the panel at 1280 and 1440, and above the uncovered globe at 1920. Earlier runs timed out
during repeated imagery swaps across resizes. The final fixture settles each observation at its
expected time before resizing. A relative age can tick during a screenshot. The test records both
readings and requires the same absolute time, clock mode and selection.

Terra independently reviewed the final commit and inspected the paired pictures. All 14 gate
steps passed on `1acf00ca7466335d7b1354e78badc285b0587b6b`. The main suite passed 7,276 tests
and skipped ten. Both later groups passed. World passed 38 checks, News 30, Searches 11 and Lenses
23 with its performance check skipped. The legend and Layers captures passed all 23 and six
views respectively. The tested and merged trees both equal
`bff56f6a5fc1031dbbf914ac3fc233e730f8315d`.

The final archive in `qa-artifacts/one-look-c/final-1acf00ca/` holds 374 hashed files, including
218 browser evidence files verified against their originals. The summary SHA-256 is
`332fdfad2b9cb4ddceee8f0b2d8e8a3bbf293e7e5e24e14290a0959e00a8dbed`. The matched baseline is
in `before-e1f44cc7/` beside it. The gate stopped its server and released port 5316 and the
shared lock. Live providers, a physical phone and a screen reader were unverified at that point.

**One look (1.3), D, Cameras.** Pull request 36 merged at 05:01 Cairo time on 18 November as
`1e2e589e`. The Cameras rail uses the shared solid panel, sentence-case controls and a scrolling
body. The source and its reported health appear separately from the preview. A snapshot gives the
time it loaded in the browser in UTC. A failed refresh can retain the previous frame. Switching
cameras clears the previous camera’s preview. The video panel waits for the first painted frame and
reports decoder failures. The Cameras sheet retired its 74 literal-style allowances.

Floating Cameras and Street level panels use the measured globe bounds for dragging, resizing and
restoring a saved position. Their usual minimum is 300 by 160 pixels. A smaller globe region can
shrink the panel further and the normal minimum returns when space permits. The narrow layout
retains its full-width drawers. A collapsed rail disclosure stays accessible while it holds keyboard
focus. On the three tested desktop sizes, Today and the country sheet remained open throughout the
comparison.

The matched browser runs captured 15 views each, covering Cameras off, a decoded local snapshot and
the built-in camera fallback when the configured catalogue is empty. That fallback showed an
unavailable frame. The tests exercised navigation controls, keyboard disclosure, real wheel
scrolling and the coverage switch. The smallest measured active text grew from 8 to 13 px. The
lowest measured active-text contrast rose from 1.94:1 to 8.54:1. Measured intersections with the
frame or other panels fell from 12 to 0. At 1280×720 the populated docked body holds 831 px of
content in 393 px. The resize journey also exercised all eight handles, reload, collapse and
docking.

GPT-6.2 Sol implemented D. GPT-6.1 Terra tested it and independently reviewed the final changes. All
17 steps passed on `94b22938abf49469223e6de6d79f5b5ce16c7734`. The main suite passed 7,288 tests,
skipped 10 and failed none. The unit process used four logical CPUs for the final run. Two existing
tests, for key storage and news-digest cleanup, failed intermittently at normal host concurrency.
Both passed in isolation. The merged and tested trees both equal
`f8beeaf424aa8b857426348842d87a06f759719c`. The final archive contains 424 hashed files in
`qa-artifacts/one-look-d/final-94b22938-r5/`. Its gate summary SHA-256 is
`069a93e96642e5ffc11dac67e9b666051d04da170a2e0b1400066a58d2c2aa25`. The matched baseline is in
`before-da7f6ff4/` beside it. The test server stopped and released port 5317 and its lock. Live
providers, a physical phone and a screen reader remain unverified. Decision 37 supersedes the
original direction to follow Cameras with Street level (E).

**One look (1.3), F–L.** Three GPT-6.2 Sol agents implemented and cross-reviewed Recent imagery,
Radio, Context, Data sources and keys, Welcome, Cockpit and the shared controls. The group
merged as pull request 37 at `a004b94df8279e4d6ea67ceff5418008e4cb8c04`. The merged
tree equals the verified release branch at `601d1370ff04333b2f0e21003a63ba9603983a67`.

The main suite passed 7,298 tests and skipped 10, with 14 more tests passing in the two
supplemental suites. The browser regressions covered World Board, news, searches, lenses,
Weather, Cameras, Layers and panel resizing. The final Cockpit and shared-controls runs
covered 21 and 30 views respectively. Cockpit checks included short landscape, phone portrait,
and attribution in recording mode. Browser runs used local fixtures. Live provider and radio
playback checks and physical-device testing were outside this run. At roughly 390×390 the
Cockpit menus can still run out of vertical room. The local reports are in
`qa-artifacts/one-look-f-l/`.

These are the director's readings, taken on the plan's recommendation and not yet put to the owner:

- **Names.** The shared components are prefixed `kit-`: `kit-pop`, `kit-panel`, `kit-sec`,
  `kit-btn`, `kit-iconbtn`, `kit-seg`, `kit-switch`, `kit-chip`, `kit-dl`, `kit-card`, `kit-note`
  and `kit-empty`. Cost: the old names live beside them until L.
- **Panels the mock does not show.** The mock shows two floating surfaces, the layers menu and the
  hover card. Every original panel, weather to welcome, is a solid `kit-panel` docked in the
  right-hand rail of the globe region, and stays solid when dragged. Only menus and hover cards
  float (`kit-pop`). A drag is held inside the globe region, built with cameras, because a dragged
  panel can otherwise lie over Today or the sheet. Cost: this is not the mock's; a later mock of
  these panels changes one sheet.
- **States the mock does not draw.** Hover lifts a surface one step (`--surface-2`). Disabled is
  dimmed. Inputs use `--surface-0`, `--line-strong` and `--radius-control`.
- **A1 colour and shape readings.** Board links share the existing light cyan `--link`
  (`#a3dfff`), and panel errors use the crisis red `--alert-crisis` (`#ff5d6c`). The
  armed-conflict line uses the mock's `--rel-armed` (`#f4525d`), and the at-war country fill
  uses `--rel-war` (`#db474f`). The Ownership swatch matches the globe's existing `#519bd4`
  fill for one category, documented foreign ownership. It marks a host country with assets
  owned or operated from the selected country. Grey dashes still mark documented military
  presence. Appendix D records the seven added tokens. The phase 4 badge and draft text
  colours stay as they were until their meaning is read. The radio's `--cat-*` tokens are for G.
- **Welcome.** It takes the kit on its present layout, and that is its finished look until 2.5
  replaces it.
- **Settings and keys.** The dialog is named "Data sources and keys" and sits centred on the globe
  region.
- **Proof.** The capture script's pictures, before and after, with each merge. They are the start of
  the approved set of 1.6.

The plan read the layers menu at its first stage, before it was joined to the tools menu, so part of
what it says 1.4 removes is wrong: at the second stage 1.4 removes only `src/data/localLayers.js`.
Each brief reads its files again on `main` after 1.4 merges.

**Test-ready pass, the name.** Pull request 38 merged on 28 November. The app and its README
show Global Eye View, and the README preserves the original project credit and the MIT notice.
The npm package identifier and the existing machine-facing names are kept. The merge
`85e59f6a` has the same tree as the tested head `659068c9`. The main suite passed 7,298 tests
and skipped 10, and all 14 supplemental tests passed. Fixture browser checks covered the
name, World Board, news, searches, lenses, legend, Layers, Weather, Cameras and resizing.
The app showed its new name at 1280×720, 1440×900 and 1920×1080. An independent read verified
the final change. The installed release remains at `1e2e589e`.

**Test-ready pass, the welcome.** Pull request 39 merged on 28 November. The welcome introduces
Global Eye View, offers a four-step tour and can be skipped. The Menu can reopen the tour.
Fixtures checked the first opening, repeat opening, skip, completion, keyboard focus and replay.
Separate pictures checked the layout at 1280×720, 1440×900 and 1920×1080. The tested head
`b242eb4a` has the same tree as merge `dd7f6646`. The main suite passed 7,276 tests and skipped
10 tests. All 14 supplemental tests passed. The lower count reflects replacing tests of the old
launch screen with tests of the tour. The full gate also checked the board, news, searches,
lenses, legend, Layers, Weather, Cameras and resizing. Independent review cleared the verified
change. The installed release remains at `1e2e589e`.

**The stage 0 mock.** A private artifact, <https://claude.ai/artifact/Xz8cSXbG97cCbXVrkTrPoK>. It
holds eight boards: the six screens of stage 0, the page of design tokens and the board on how news
is filed (decision 31). Every screen is drawn over a capture of the owner's saved board (section
8.3). The owner approved it on 2026-11-12 (decision 30). Appendix D holds its token values and what
it settles. Its boards and its style sheet, `project/gev.css`, stay in the artifact: the session
that builds the frame reads them from there and gives the builder the pictures and the style sheet.

## Appendix A: the original's ornament and tools

| Item                                                                                 | Action                                         | Note                                                                                                      |
| ------------------------------------------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Classification banners, mission and sensor numbers, REC, orbit and pass, band strips | Remove                                         | Built in `src/hud.js`. The numbers are random.                                                            |
| Corner brackets, title glow, tagline, "ACTIVE STYLE" readout                         | Remove                                         | Other code measures `#title-bar` to avoid it; keep an element for that.                                   |
| Coordinates, altitude, time, vessel line                                             | Keep, restyle                                  | One status line. MGRS becomes optional.                                                                   |
| The HUD's AI summary line                                                            | Keep the plain place name, drop the model call | The model call needs an OpenAI key.                                                                       |
| Logo that follows the pointer, pulsing loader logo                                   | Remove                                         | `src/logoGaze.js` and its test.                                                                           |
| Panel glows, scan-line bars, flip-board status text                                  | Remove                                         | Panel measurement skips the glow element today; simplify with it.                                         |
| Cyber skin and sonar                                                                 | Remove                                         | 2,837 lines of stylesheet, three sonar files, 14 referring files. Keep the one-panel-open rule if wanted. |
| Scope vignette                                                                       | Off by default, under Display                  | A test pins its default values.                                                                           |
| Sun and moon ring                                                                    | Off by default, under Display                  | The same file holds geometry used by detection.                                                           |
| Render styles: night vision, thermal, CRT, anime, noir, snow                         | Demote to Display                              | Used by share links, scenes and the cockpit.                                                              |
| "TR-3B" reclassify button                                                            | Remove                                         |                                                                                                           |
| Military wording: "MISSION CONTROL", "GROUND STATION", "POWER UP", "CONTACTS"        | Rewrite in plain words                         | Voice actions and tests match on some labels.                                                             |
| Welcome screen                                                                       | Keep the function, rewrite                     | It asks before switching live feeds on. It becomes the first run of 2.5.                                  |
| Provider settings                                                                    | Keep, becomes Data sources                     | See 4.4.                                                                                                  |
| Cockpit                                                                              | Demote: an action on an aircraft's sheet       | Restyled last.                                                                                            |
| Voice                                                                                | Keep, in the bottom bar                        | Board commands arrive in stage 5.                                                                         |
| Scenes, recording, drawing                                                           | Demote to Tools                                |                                                                                                           |
| Camera viewer, street level, recent imagery, weather panel, radio                    | Keep, restyle                                  | These are how their layers show detail.                                                                   |
| Bhote Koshi flood event                                                              | Leave as it is                                 | Hidden layers reached through a scene. A candidate for a Situation later.                                 |
| Embed mode and the MCP panel                                                         | Keep                                           | No shell of their own.                                                                                    |

## Appendix B: layers regrouped

Today's groups are Movement, Cameras, Infrastructure, Events, Weather and Utilities. The proposed
groups match the presets, so a group heading and a preset mean the same thing.

| Group               | Layers                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Air                 | Live flights, military flights, local ADS-B                                                            |
| Sea                 | Live vessels, submarine cables                                                                         |
| Space               | Satellites, space missions                                                                             |
| Hazards and weather | Earthquakes, active fires, fire perimeters, cyclones, rain radar, satellite clouds, lightning, wind    |
| Security            | Mapped installations, and the board's foreign bases and nuclear sites                                  |
| Infrastructure      | Data centres, dams, and the board's power plants, ports, fabs and launch sites                         |
| City                | Street traffic, transit, bike share, cameras, street level, mapped ALPR cameras                        |
| Tools               | Directions, recent imagery, radio, search layers                                                       |
| Not in the list     | World Board (the frame), War Monitor (feeds Today and Situations), and the three hidden layers, as now |

Other tidying found on the way: the layer id `local-firms` is live data with a legacy name; the
same icon serves four layers; "Cameras" in the list is "CCTV" in its own panel; radio is
controlled from three places and weather and space from two each; `src/data/localLayers.js`
appears to be unused; the README's layer table omits nine layers.

## Appendix C: where things are, for builders

- **Frame and templates.** `index.html` holds eleven `gev:template` markers expanded from
  `src/ui/templates/` by `build/application-html.js` (an allowlist). Shell owners are listed in
  `docs/UI-OWNERSHIP.md`. Panel rules are in `docs/panel-surfaces.md`; right-rail rules in
  `docs/CODE-BOUNDARIES.md`.
- **Tokens.** `src/ui/styles/foundation.css` defines the shared colours, type, spacing, radii,
  shadow and motion. `src/ui/styles/panel-surfaces.css` applies them to panel surfaces.
  `src/designTokens.js` mirrors the globe colours, checked by `src/designTokensParity.test.mjs`.
  `src/overlays/worldOverlayTokens.js` holds the overlay type and theme and uses the shared
  default live colours.
- **Board interface.** The board header controls, country sheet, lens switch and legend are in
  `src/ui/templates/frame.html`. `src/ui/frame.js` owns the frame and `src/ui/worldPanel.js`
  and its sibling modules render the board. The main stylesheet is
  `src/ui/styles/world-panel.css`. `src/layers/world/phaseRegistry.js` eagerly loads
  `world-phase-*.css`. `src/ui/worldOverview.js` and `src/ui/worldScoreWords.js` eagerly load
  `world-words.css`.
- **Board data.** `server/providers/world/` (routes in `index.js`, scores in `scores.js`, turns in
  `turn.js`, live flags in `conditionEvents.js`); reference data in `public/world/`; state in
  `.gev-cache/world/`.
- **News.** `server/providers/news/`, `src/layers/news/`, `src/ui/situationPanel.js`,
  `src/ui/situationBrief.js`, theaters in `public/news/theaters/`, guide in `docs/WAR-MONITOR.md`.
- **Layers and presets.** `src/lenses/groups.js` owns the groups, row labels, preset membership
  and exclusions. `src/app/constructCatalog.js` builds the application layer catalogue.
  `src/ui/layerPanel.js` builds the visible rows. `src/lenses/catalog.js` and
  `src/ui/lensBar.js` supply the preset catalogue and controls.
- **Clicks.** Each layer installs its own click handler; `src/data/pickRegistry.js` only stops
  them competing. Cards draw through `src/overlays/worldOverlay.js`. Stage 4.1 needs one selection
  model in front of these.
- **Ornament.** `src/hud.js`, `src/logoGaze.js`, `src/splitFlap.js`, `src/scopeMask.js`,
  `src/celestialRing.js`, `src/cyberSonar*.js`, `src/hudLayouts.js`, `src/ui/styles/cyber.css`,
  `overlays.css`.
- **Tests that read markup or styles as text.** Among them `src/cockpitMarkup.test.mjs`,
  `src/ui/cyberTheme.test.mjs`, `src/hudA11y.test.mjs`, `src/firstRunExperience.test.mjs`,
  `src/reasonableDefaults.test.mjs`, `src/keyboardFocusStyles.test.mjs` and
  `src/materialSymbolsSubset.test.mjs`.
- **Server.** `server/standalone/vite.config.js` attaches every data route as Vite middleware
  through `server/providers/local.js`.
- **Acceptance.** `scripts/qa-world.mjs --fixtures` with `scripts/qa-world.phase-*.mjs`;
  `scripts/world-fact-check.mjs`.

## Appendix D: the approved look (stage 0 mock, decision 30)

Copied from the mock's style sheet on the day of approval, with the control type additions from
1.4 and seven additions from 1.3 A1. A name says what a value is for, so a
light set can be added later under the same names (decision 6). Where a comment says "the app's
own", the value is unchanged from today's code.

The prerequisite correction before A2 restored two app colours as foundation tokens:
`--status-normal: #6cddff` for normal energy statuses and `--status-stale: #f2cf91` for stale live
flags.

```css
:root {
  /* Surfaces. surface-0 and surface-1 are the app's own --bg-dark and --menu-bg. */
  --surface-space: #05070b; /* behind the globe */
  --surface-0: #0a0a0f; /* wells and inputs */
  --surface-1: #12121c; /* bars, Today and the sheet */
  --surface-2: #1b1c28; /* cards and hovered rows */
  --surface-3: #262838; /* selected and pressed */
  --line-soft: rgba(255, 255, 255, 0.08);
  --line-strong: rgba(255, 255, 255, 0.16);
  /* Text on surface-1: 15.4, 8.5 and 5.5 to 1. text-3 is not used on surface-3. */
  --text-1: #e8eaed;
  --text-2: #aab0bb;
  --text-3: #868c99;
  --link: #a3dfff; /* A1 */
  /* One accent, the app's own, with its glow dropped. */
  --accent: #00d4ff;
  --accent-dim: rgba(0, 212, 255, 0.15);
  --on-accent: #04222b;
  /* Score ramp: the board's five stops, the app's own. */
  --ramp-0: #c2410c;
  --ramp-25: #f08c3a;
  --ramp-50: #d9c58f;
  --ramp-75: #4aa8d8;
  --ramp-100: #1d6fd1;
  --unknown-hatch: repeating-linear-gradient(
    135deg,
    rgba(185, 219, 223, 0.4) 0 1px,
    rgba(10, 18, 25, 0.55) 1px 5px
  );
  /* Alert level, four steps (decision 25). */
  --alert-calm: #8b97a8;
  --alert-watch: #e6c453;
  --alert-strained: #f0935a;
  --alert-crisis: #ff5d6c;
  --status-reduced: #ffc47b; /* A1 */
  --status-disrupted: #ff9aa0; /* A1 */
  /* Relations and live objects: the app's own colours, now named. */
  --rel-war: #db474f;
  --rel-armed: #f4525d; /* A1 */
  --rel-sanctions: #e8933f;
  --rel-ally: #3da1ea;
  --rel-rival: #b25ec5;
  --rel-partner: #3eaf97;
  --rel-neutral: #949faf;
  --live-civil: #22e0ff;
  --live-military: #ffb347;
  --live-sea: #3fe0c8;
  --live-space: #bda4ff;
  --ownership-documented: #519bd4; /* A1 */
  /* Shape, depth and motion: the app's own values. Spacing is new. */
  --radius-panel: 16px;
  --radius-control: 10px;
  --radius-chip: 6px;
  --radius-pill: 999px; /* A1 */
  --radius-mark: 2px; /* A1 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --shadow-pop: 0 8px 24px rgba(0, 0, 0, 0.38);
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-smooth: 300ms cubic-bezier(0.4, 0, 0.2, 1);
  /* Frame, at a window 1366 wide or more. Below that: Today 300, sheet 420. */
  --frame-bar: 52px;
  --frame-today: 340px;
  --frame-sheet: 460px;
  --frame-rail: 48px;
  --font-sans: 'Inter', -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  /* Control type added by the layers menu (1.4). */
  --type-control: 500 13px/19px var(--font-sans);
  --type-label: 600 13px/19px var(--font-sans);
  --type-control-figure: 600 13px/19px var(--font-mono);
}
```

| Type    | Face and weight    | Size / line | Used for                                           |
| ------- | ------------------ | ----------- | -------------------------------------------------- |
| display | Inter 600          | 24 / 30     | The name on a sheet                                |
| title   | Inter 600          | 18 / 24     | A panel or section title                           |
| heading | Inter 600          | 15 / 20     | A row or story title                               |
| body    | Inter 400          | 14 / 21     | Reading text                                       |
| small   | Inter 400          | 13 / 19     | The smallest size a sentence is set in             |
| caption | Inter 500          | 12 / 16     | Labels, periods and sources. Nothing is smaller    |
| figure  | JetBrains Mono 600 | 15 / 20     | Scores                                             |
| code    | JetBrains Mono 500 | 12 / 18     | Codes, such as a series code or a transponder code |

Sentence case everywhere, capitals only in codes, and monospace for figures and codes only.

What the mock settles, beyond the values:

- **The frame is solid, not glass.** The top and bottom bars and the two columns are opaque. The
  globe has its own region between them, so nothing on it draws across a panel. Only menus and
  hover cards float. Today folds to a rail. One status line over the globe keeps the coordinates,
  the eye altitude, the time and the imagery credit.
- **The bars.** Top: the name, the date and the turn, a pill counting what is new since the last
  visit, one search box, three gauges each with its period and source, refresh and the menu.
  Bottom: the lens switch (Overview, Strength, Energy), the legend with its period and sources,
  the data age switch, Layers, Presets, zoom and voice.
- **Band words for a score:** Very weak from 0 to 19, Weak 20 to 39, Midrange 40 to 59, Solid 60
  to 79, Strong 80 to 100. A bar takes the ramp colour of its score, as the country does on the
  globe.
- **Three edges for a claim.** Solid is a fact (measured, documented, declared, observed). Dotted
  is someone's reading (assessed, AI analysis, allegation, hypothesis). Dashed is a forecast or
  an estimate (a source's forecast, a source's own estimate, an estimate, a scenario). A bar is
  solid when measured, dashed when forecast or estimated and hatched when unknown. Story labels,
  data states (stale, draft, low confidence) and area tags are plain chips with no edge.
- **Alert level:** four steps of rising height and a word (Calm, Watch, Strained, Crisis), drawn
  beside the bar it belongs to.
- **On the globe.** A country shows its name, not its code, with a count of its alerts
  (triangle) and of its stories (page), and a corner dot for what is new. An armed conflict
  between states recorded by UCDP is a solid red line. The selected story's place is a ring. A
  story is a dot, dashed when the model placed it.
- **Who is telling it (section 9.1).** White lines run from the story's place to each outlet's
  home. The weight says where the outlet stands: thick from inside the country, medium from the
  state of a party, thin from outside. A party's outlets count as inside when the story happens
  in its own country. The mark at the end says who stands behind the outlet: a filled square is
  state-run, a hollow square state-funded, a circle private, a diamond a party's own channel,
  and a dashed ring adds "in exile". There is no colour, so no side is singled out (decision 9).
  An outlet's three facts are always three labels, with "not recorded yet" where none is held.
- **The country sheet.** Four tabs and More: Overview, Condition, Strength and Relations, with
  Exposure, Assets, People, News and Stakes under More. The line above the name counts alerts
  and stories. Overview holds the six bars, who runs it, the alert, partners, rivals and
  conflicts, the largest dependency and "Live here". On the Condition tab each row shows its band
  word, period, source and state. An opened row adds the reading against the world, the reading
  against its own past and "Why this number".
- **The layers menu.** The eight groups of Appendix B, and the presets are those eight groups, so
  today's Conflict and Signals buttons fold into them. Each row says its state in plain words.
- **The filing table (decision 31),** as the mock showed it and to be reviewed when stage 3 is
  built: Government takes Government and Diplomacy; Security takes Military; Services takes
  People, Logistics and Technology; Households takes Economy, Food and Energy; Fiscal takes
  Fiscal; Society takes Society and Culture.
- **Not drawn, and still open:** an outlet's own sheet with slant in its four kinds, a trend
  (section 8.3) and a light set.
