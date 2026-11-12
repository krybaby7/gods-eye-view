# Board-first app: roadmap from World Board feature to finished product

Date: 2026-11-11. Status: direction agreed with the owner on 2026-11-11 (section 5). Decisions 7
to 25, section 8.1 and section 9 were added the same day, after a second review on the owner's
machine with live data, and stage 3 was rewritten to follow them. Decisions 26 and 27 followed on
2026-11-12; the Jev filer of decision 26 is the first thing being built. Builds on
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

Five stages and one track that runs beside them. Each stage follows the method already used for
the World Board: a spec, a build prompt, one pull request per numbered item, a review, fix rounds.
Sizes are relative guesses, not measurements. For scale, the World Board itself took six phase
pull requests, four fix rounds and a follow-up.

### Stage 0: agree the look first (small)

The World Board spec asked for a design mock before any interface was built. The same applies
here, and more, because this changes every screen.

- A mock of six screens, drawn over a real capture of the globe, reviewed by the owner as an
  artifact: the home board; a country sheet at its first depth; the same sheet at its evidence
  depth; Today with a situation open; the layers menu; and a zoomed-in view with a live aircraft
  selected.
- One page of the design tokens: colours with their meanings, the type scale, spacing, panel and
  button shapes.

Done when the owner has approved the mock. Stage 1 builds to it.

### Stage 1: the board becomes the app (large, the biggest stage)

**1.1 Take the costume off.** Small, and the first pull request. Remove the classification
banners, the random mission numbers, REC, the orbit and band strips, the corner brackets, the
tagline, the title glow, the logo that follows the pointer, the "ACTIVE STYLE" readout, the panel
glows, the scan-line bars, the flip-board text effect and the "TR-3B" joke button. Retire the
Cyber skin and its sonar. Turn the scope vignette off by default. Keep the real readouts
(coordinates, altitude, time) in one quiet status line. Appendix A lists every item.

**1.2 The frame.** Build the five regions of 3.1. The board is on at first start. Its lens bar,
legend, refresh and turn controls move out of the layer list and into the frame. Country labels
stop drawing across panels. The sheet becomes wide enough to read and shows content, not header,
first.

**1.3 One look.** Extend the existing tokens into a full set: named colours for status, relation
types and data ramps; a type scale; spacing; elevation. Replace the hard-coded colours in the
board's later stylesheets. Then move every original panel onto the same components, one panel per
pull request, in this order: layer list, weather, cameras, street level, recent imagery, radio,
context, settings and keys, welcome, and the aircraft cockpit last.

**1.4 Layers regrouped.** The layer list is generated from the catalog under topic headings that
match the presets (appendix B). World Board, War Monitor and Searches leave the list: the first is
the frame, the second feeds Today, the third becomes a tool.

**1.5 The original tools move out of the way.** The cockpit, voice, scenes and recording, drawing,
and the render styles (night vision, thermal, CRT and the others) keep working. They open from a
Tools menu or from the thing they act on, not from the main screen (section 5, decision 3).

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
lines, each opening the tab that holds the detail.

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
rewritten on 2026-11-11 to follow decisions 7 to 22. Section 9 lists what is still open. R8 and R9
come first, so that the sources counted are the sources that work. Decisions 23 and 24 came after
the rewrite; once their shape is agreed (section 9.4) they change items 3.1 and 3.4.

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
| R8   | Connection allowance. Raise the time Node allows each connection attempt, set once at server start. On the owner's connection the default fails sources that work (section 8.1). Then count again which sources deliver.                                                                                               | Before R2 is measured |
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

## 9. Open after the discussion of 2026-11-11

Proposals made to the owner and not yet answered, and questions nobody has answered. Each becomes
a decision in section 5 or is dropped.

### 9.1 How news is shown

- **Order of building.** Proposed and not answered: "who is telling this" first, then coverage in
  both directions on the country sheet, then news outlets in the Ownership view. Stage 3 is
  written in that order.
- **How the lines and marks look** is for the stage 0 mock: the lines from a story to its
  outlets' homes, the story count on a country, and how a state-run outlet, a private one and one
  in exile differ at a glance.

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
  bars. Whether twelve areas or the six bars is the better list is for the stage 0 mock.
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

- **Frame and templates.** `index.html` holds nine `gev:template` markers expanded from
  `src/ui/templates/` by `build/application-html.js` (an allowlist). Shell owners are listed in
  `docs/UI-OWNERSHIP.md`. Panel rules are in `docs/panel-surfaces.md`; right-rail rules in
  `docs/CODE-BOUNDARIES.md`.
- **Tokens.** `src/ui/styles/foundation.css` (colours, fonts, radius, motion; no spacing, shadow
  or type scale), `panel-surfaces.css`, and `src/overlays/worldOverlayTokens.js` for text drawn on
  the globe.
- **Board interface.** `src/ui/worldPanel.js` and its siblings `world*.js`; markup in
  `src/ui/templates/context.html`; styles in `src/ui/styles/world-panel.css` and
  `world-phase-2.css` to `world-phase-6.css`, the latter loaded by
  `src/layers/world/phaseRegistry.js`.
- **Board data.** `server/providers/world/` (routes in `index.js`, scores in `scores.js`, turns in
  `turn.js`, live flags in `conditionEvents.js`); reference data in `public/world/`; state in
  `.gev-cache/world/`.
- **News.** `server/providers/news/`, `src/layers/news/`, `src/ui/situationPanel.js`,
  `src/ui/situationBrief.js`, theaters in `public/news/theaters/`, guide in `docs/WAR-MONITOR.md`.
- **Layer list.** Groups and labels are hard-coded in `src/ui/layerPanel.js` (`PANEL_GROUPS`,
  `PANEL_LABELS`); the catalog is built in `src/app/constructCatalog.js`; presets are in
  `src/lenses/catalog.js` and `src/ui/lensBar.js`.
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
