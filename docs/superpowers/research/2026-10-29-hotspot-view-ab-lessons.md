# Lessons from the hotspot-view A/B trial: a hardcoded Haiku/Sonnet sub-agent structure versus default Claude

Date: 2026-10-29. Repository: God's Eye View (`krybaby7/gods-eye-view`). Written for agents and
people in other projects who want to decide whether to force a cheap-model sub-agent structure
onto an implementation task, and how to find out for themselves. Everything here was measured in
one trial of one feature; section 8 says what that does and does not support.

The one-paragraph version: the same reviewed feature spec was built twice by Claude Opus 5.5
from the same commit with no human help. Run A was told to orchestrate four project sub-agents
(three on Haiku 5.5, one on Sonnet 5.5). Run B was told to work as it normally does, free to use
its built-in sub-agents, and chose to use none. Run A cost 26% less in list-price tokens
($30.31 against $40.81) and finished 4 minutes sooner (42.6 against 46.7 minutes). Both passed
every gate and scored 24 of 24 on spec compliance in a blind review; run A had three defects to
run B's two, and the blind reviewer narrowly preferred run B. Haiku itself was 0.5% of run A's
cost. The saving came from the Opus orchestrator writing 46% fewer output tokens and re-reading
59% less context, because bounded implementation went to Sonnet and two long files never entered
the orchestrator's context. Of the six Haiku calls, four were used as is, one needed a rework
pass and one failed outright.

## 1. The task, so you can judge whether yours is similar

**Type of task:** a cross-cutting feature in an existing, mid-sized web application, built from a
spec that had already been reviewed against the code. Not greenfield, not a bug fix, not a
refactor. The spec left numbered decisions open and told the builder to decide and record them.

**The application:** God's Eye View, a CesiumJS globe for open-source intelligence. Vanilla
JavaScript, Vite, Node 24, the Node test runner, Prettier, a package-boundary checker, and a
Puppeteer QA script that drives the real app against fixture data in headless Chrome. About
6,700 unit tests at the time. A news "war monitor" layer digests stories with an LLM on the
server, resolves each story to a place through a gazetteer (built from Natural Earth data by a
script), and draws one pin per story on the globe with a side panel.

**The feature (hotspot view):** when the camera is above 3,500 km, draw one bubble per country or
named region instead of one pin per story, sized by story count with a category ring; switch
back to pins below 3,000 km with hysteresis; clicking a bubble flies the camera in and filters
the panel's story list to that place; grow the World gazetteer from cities of 1 million people to
300,000 plus about 60 hand-written conflict towns, with links from cities to their regions.

**Why it is a fair test of delegation:** the work spans five areas that touch different files
and need different skills:

| Area            | Files                                                                                               | Nature of the work                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Server grouping | a new pure module, the snapshot entry point, the registry validator, the digest's location resolver | Rule-based logic with a precise spec, unit-testable                                      |
| Gazetteer data  | a 1,200-line build script, two JSON theater files, a real download of Natural Earth                 | Data judgement: namesakes, errata, which towns to add, which cities link to which region |
| Globe layer     | the Cesium layer (1,000 lines), its model, a new pure aggregation module                            | Rendering lifecycle, camera callbacks, mode switching, the riskiest integration          |
| Panel and QA    | the side panel, its model, the 2,270-line Puppeteer QA script                                       | DOM wiring and browser automation with real flights and hover                            |
| Docs            | the feature's user and ownership documentation                                                      | Mechanical text insertion                                                                |

The spec is about 3,000 words. The merged feature diff (excluding the regenerated data file) is
27 files, about 2,900 lines added and 140 removed. Both runs committed 8 to 13 small commits and
opened a pull request with a long description. Quality was scored on a 24-point rubric written
before the runs, with gates (tests, build, format, boundaries, layer-token check, the QA script
with new steps) and minus one per defect.

**Constraints both runs shared:** no human in the loop (the prompt said the owner was not
watching and to make the call the spec points to), never run the paid news digest, never merge,
open a PR against the fork, match the surrounding code's style, write tests first, run every
gate and paste real output, list every judgement call and every delegation in the PR.

## 2. The two configurations

**Common ground.** Same base commit, two git worktrees, `npm ci` in each, same model (Claude
Opus 5.5), same effort, same permission mode, fast mode off, started 1 second apart from the
same owner session, left unattended. Both prompts were the same 800 words of task, rules,
reading order and PR requirements. Owner messages after the prompt: zero in both. Each run had
its own dev-server port so the two QA runs could share the machine.

**Run A (orchestrated).** The prompt added a 750-word sub-agent section and the worktree carried
four project sub-agents in `.claude/agents/`:

| Agent   | Model      | Effort  | Tools                               | Turn cap | Job                                                                                                                                                             |
| ------- | ---------- | ------- | ----------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scout   | Haiku 5.5  | medium  | Read, Grep, Glob                    | 12       | Read-only search; returns file:line evidence with short excerpts, lists its searches and what it did not cover; never proposes an implementation                |
| runner  | Haiku 5.5  | medium  | Bash, Read, Glob                    | 8        | Runs the exact commands given; reports exit code, elapsed time, last 80 lines verbatim, every failure line; never fixes, retries or summarises                  |
| editor  | Haiku 5.5  | medium  | Read, Edit, Write, Grep, Glob, Bash | 15       | Fully specified mechanical edits; stops and reports if an anchor is missing; runs the named check and pastes its output                                         |
| builder | Sonnet 5.5 | default | Read, Edit, Write, Grep, Glob, Bash | 60       | One bounded module with its tests, test-first, from a brief naming spec section, files, public API, rules and commands; reports API as built and open decisions |

The prompt prescribed the phases: the orchestrator reads the design-sensitive files itself and
sends three scouts in parallel over the two longest files and the panel; then three builders in
parallel on disjoint files (server, gazetteer, and the camera-framing module as a deliberate
Haiku implementation trial using the Agent tool's per-call model override) while the
orchestrator builds the globe layer itself; then a builder for the panel and QA once the layer's
snapshot fields exist, with the editor on the docs in parallel; then a runner for the full check
list, after which the orchestrator reruns the final gate itself and reads the whole diff against
the spec. Rules in the prompt: every brief names spec sections, exact paths, the public API, the
rules to test, the commands to run and what to report; keep a Haiku agent's context under
100,000 tokens (its price is five times higher above that); never raise Haiku above medium
effort; never ask a Haiku agent whether work is correct; a sub-agent's exit code is evidence, its
opinion is not.

**Run B (default Claude).** The same prompt with the sub-agent section replaced by one sentence:
work the way you normally would, with or without sub-agents as you see fit, keep everything in
this conversation. The worktree had no project agents, so only the built-in ones (Explore,
general-purpose, Plan), which run on the session's own model.

**What the comparison isolates.** Default Claude, left alone, never picks Haiku for anything. So
the question was not "is Haiku good" in the abstract but "does hardcoding a Haiku and Sonnet
structure into the agent setup beat what Claude does by itself, on the same job, measured".

## 3. How it was measured

- **Tokens and cost** came from the session transcripts on disk (`~/.claude/projects/<slug>/
<session>.jsonl` plus `<session>/subagents/*.jsonl`), each API call carrying a `usage` block and
  a model name. A script (`scripts/measure-session-usage.mjs` in this repository) sums input,
  cache writes by TTL, cache reads, output and thinking per model, main session and sub-agents
  apart, and prices them at list rates (Opus 5.5 $4/$20 per million input/output, Sonnet 5.5
  $2/$10, Haiku 5.5 $0.10/$0.50 under 100K prompt tokens; cache writes at 1.25× input for the
  5-minute tier and 2× for the 1-hour tier, cache reads at $0.20, $0.10 and $0.01). The prompt
  forbade linked sessions and workflows so nothing could escape the count.
- **Wall clock** is first user message to last assistant message of each session.
- **Quality** was scored by a fresh Claude Opus 5.5 reviewer that did not know which run was
  which: both branches checked out as detached worktrees under neutral names, the plan and agent
  files removed, a recorded coin flip mapping names to runs. The reviewer reran every gate and
  the QA script itself, wrote its own probe script against both apps (an animated flight sampled
  every frame, hysteresis from both sides, horizon culling, the filter lifecycle), rebuilt the
  gazetteer from Natural Earth and compared bytes, and ran a code review at the same level on
  both. It did not trust either PR description.
- **Honesty** was recorded separately: any gate claim in a PR the reviewer could not reproduce.

## 4. Results

### 4.1 Time, tokens, cost

|                                  |                       Run A (orchestrated) | Run B (default) |
| -------------------------------- | -----------------------------------------: | --------------: |
| Wall clock                       |                                   42.6 min |        46.7 min |
| Sub-agents                       | 9 (3 scout, 4 builder, 1 editor, 1 runner) |               0 |
| API calls, main Opus session     |                                        212 |             372 |
| API calls, sub-agents            |                434 (105 Haiku, 329 Sonnet) |               0 |
| Output tokens, main Opus         |                                    258,199 |         476,949 |
| Output tokens, Sonnet sub-agents |                                    380,356 |               0 |
| Output tokens, Haiku sub-agents  |                                    130,633 |               0 |
| Output tokens, all models        |                                    769,188 |         476,949 |
| Cache reads, main Opus           |                                     49.6 M |         120.7 M |
| Cache reads, sub-agents          |                                     30.8 M |               0 |
| Cost, main Opus                  |                                     $21.02 |          $40.81 |
| Cost, Sonnet sub-agents          |                                      $9.13 |               0 |
| Cost, Haiku sub-agents           |                                      $0.16 |               0 |
| **Cost, total**                  |                                 **$30.31** |      **$40.81** |

Run A produced 61% more output tokens in all and cost 26% less. Everything the structure saved
came out of the Opus line: the orchestrator wrote 46% fewer output tokens and re-read 59% less
cached context than default Claude did, and the output that moved landed on models costing a
half (Sonnet) or a fortieth (Haiku) as much per token.

### 4.2 Every sub-agent call in run A

Costs at the list rates above; durations from the sub-agent transcripts; "launched" is minutes
after the first message.

| #   | Agent                             | Model                        | Launched |        Brief | Duration | API calls | Output tokens |   Cost | Outcome                                                                                                                                                                          |
| --- | --------------------------------- | ---------------------------- | -------: | -----------: | -------: | --------: | ------------: | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | scout: gazetteer script           | Haiku                        |     +0.3 |  1,032 chars |  0.5 min |         7 |        11,907 | $0.015 | Accurate line map; withheld full function bodies under its excerpt limit. Used as is                                                                                             |
| 2   | scout: QA script                  | Haiku                        |     +0.4 |  1,243 chars |  0.9 min |         7 |        20,925 | $0.021 | Accurate and complete; the 2,270-line file never entered the orchestrator's context. Used as is                                                                                  |
| 3   | scout: panel + layer test harness | Haiku                        |     +0.5 |  1,460 chars |  0.8 min |        18 |        18,564 | $0.028 | Accurate, partial bodies; the orchestrator still read the layer itself for design reasons. Used as is                                                                            |
| 4   | builder "server"                  | Sonnet                       |     +3.1 |  9,544 chars |  5.7 min |        89 |        84,428 |  $2.09 | Grouping module, snapshot wiring, registry, pass-through, far-match guard, boundaries; 89/89 on its files; fixed two fixtures the guard broke. Used, one comment line rewrapped  |
| 5   | builder "gazetteer"               | Sonnet                       |     +3.8 | 11,018 chars | 17.0 min |       110 |       178,404 |  $3.94 | Threshold, towns, links, aliases, real Natural Earth run, theater links, tests. Went beyond the brief (a namesake-qualifying map, Natural Earth renames). Used after spot checks |
| 6   | builder "focus"                   | **Haiku** (override, medium) |     +4.0 |  3,240 chars |  1.1 min |        33 |        46,286 | $0.054 | The one deliberate Haiku implementation trial: a new framing kind and a per-kind radius cap with tests. 12/12; the orchestrator broke the cap and saw its test fail. Used as is  |
| 7   | builder "panel"                   | Sonnet                       |    +10.3 | 10,232 chars | 13.3 min |       130 |       117,524 |  $3.09 | Place-filter chip, empty note, hint, model tests, five new QA steps with real hover and click. 28/28 QA; added camera resets to two existing steps. Used as is                   |
| 8   | editor: docs                      | Haiku                        |    +22.3 |  4,950 chars |  1.0 min |        25 |        25,026 | $0.032 | All eight edits placed, prettier clean. Reworked: unwrapped lines, one ambiguous sentence, one line rewritten with measured heights                                              |
| 9   | runner: full check list + QA      | Haiku                        |    +24.4 |  1,671 chars |  6.0 min |        15 |         7,925 | $0.011 | Hit its 8-turn cap with no report and left the dev server running. Discarded; the orchestrator ran every check itself                                                            |

Reading the timeline: the three scouts were back within a minute. The three parallel builders
ran from minute 3 to minute 21 while the orchestrator wrote the globe layer; the panel builder
could only start at minute 10, once the layer's snapshot fields existed, and finished near
minute 24. The runner then spent 6 minutes producing nothing, after which the orchestrator reran
the gates itself. Run A's critical path was therefore: orchestrator's own layer work, then the
panel builder, then a failed runner, then the gates again. The parallelism bought 4 minutes net.

Run B, for comparison, made 158 shell calls and 13 file writes from its single context, sent
long command output (the test suite, QA, the gazetteer log) to scratch files and read back only
the relevant lines. Its PR gave this reason for using no sub-agents: the work was one connected
change where each step needed the code read in the step before, so handing pieces off would
have meant re-explaining that context, and checking the result would have cost about as much as
writing it.

### 4.3 Quality (blind review)

|                           | Run A                                                                           | Run B                       |
| ------------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| Gates                     | pass (one pre-existing Windows path failure in an untouched file, same in both) | pass                        |
| QA script by the reviewer | 28/28 first try                                                                 | 27/27 first try             |
| Reviewer's own probes     | 24/24                                                                           | 24/24                       |
| Spec points (of 24)       | 24                                                                              | 24                          |
| Defects                   | 3                                                                               | 2                           |
| Total                     | 21                                                                              | 22                          |
| Honesty                   | every gate claim reproduced                                                     | every gate claim reproduced |

Run A's defects: (1) after a bubble round trip the layer still shows the selected story but the
shared selection used by voice and context is lost, a runtime inconsistency in the layer the
orchestrator wrote itself; (2) two Natural Earth rows whose English name belongs to another
place were left in the data; (3) six cities, including towns this run had itself added, were
not linked to their region, so one place's news splits into two bubbles.

Run B's defects: (1) the same two errata plus six more, two of which made real cities stop
resolving at all; (2) two Donbas cities not linked to their region.

The reviewer preferred run B narrowly: one confirmed defect fewer, and its remaining gaps were
data fixes in one script while run A's was a runtime inconsistency. It judged run A's gazetteer
work and QA the more careful: run A fixed errata the threshold brought in, enforces link rules
in the registry, and shot dedicated screenshots at every width. Run B's tests checked the SVG
and the panel DOM directly where run A's checked the data behind them.

What was merged: run B, with run A's errata fixes ported onto it (which also fixed run B's second
defect). Both runs' PR descriptions were complete, honest and usable by a non-technical owner.

## 5. What we learned

Each lesson states the evidence it rests on, so you can judge whether it transfers.

### 5.1 The saving is in what the expensive model does not do, not in the cheap model's price

Haiku cost $0.16 of $30.31. The $10.50 saved against run B is explained by the Opus
orchestrator's smaller footprint: 212 calls instead of 372, 258K output tokens instead of 477K,
50M cache reads instead of 121M. Two things produced that: Sonnet wrote 380K output tokens of
implementation the orchestrator did not have to write, and the three scouts kept roughly 3,500
lines of long files out of the orchestrator's context for the whole run, so every later Opus
call carried a smaller prompt. If you want the saving, design for a small orchestrator context
and move bounded writing to a mid-tier model. Swapping Haiku in and out barely moves the bill.

### 5.2 Where Haiku 5.5 worked and where it did not, in this trial

- **Scout (read-only search, file:line evidence): the best value.** Three calls, 2.2 minutes,
  $0.06, all used as is. The QA-script scout was the single most valuable delegation of the
  run, since a 2,270-line file the orchestrator needed only a dozen facts from never entered
  its context. Weakness: scouts honour their excerpt limit even when a full function body is
  what you need; if you need a body, ask for it by name.
- **Implementer on a small, fully specified change: worked.** One module, one new framing kind
  and a numeric cap, with tests, from a 3,200-character brief: 33 calls, 1.1 minutes, $0.05,
  12/12 tests, and a mutation check (break the cap, see its test fail) passed. Its one
  unprompted choice, a range bound in a test, was reasonable. This is one data point, on a
  change with no design freedom.
- **Mechanical editor: usable, with a review pass.** Eight edits to a documentation file from a
  brief containing the exact text: all placed, prettier clean, $0.03. But the orchestrator still
  rewrapped lines, fixed one ambiguous sentence and rewrote one line with measured numbers. The
  text insertion is fine for Haiku; the wrapping and wording were not. Either give it already
  wrapped text and forbid rewrapping, or expect a pass.
- **Runner for a long check list: failed.** The full gate (6,700 tests, a 90-second build, four
  checks, a 3-minute Puppeteer run behind a dev server that must be started and polled) does
  not fit in 8 turns. It produced no report, left a server running, and cost 6 minutes of
  critical path plus a repeat of the gates. Use one runner per command with a turn cap sized to
  that command, run long commands with output redirected to a file and read the summary lines
  yourself, or do not delegate gates at all. The orchestrator's prompt already said to rerun the
  final gate itself; the runner only added overhead.

The research review that designed this structure predicted exactly this split (Haiku reliable
at bounded search, extraction and evidence collection; unreliable as a multi-file implementer
or a judge). The trial confirms the prediction for scouts and the small implementation, and
adds the runner failure mode, which is about turn budgets and long-running commands rather than
model capability.

### 5.3 Sonnet builders on disjoint files, with full briefs, delivered

Three Sonnet builders produced the server module, the gazetteer work and the panel-plus-QA work
for $9.13 and were all used, with one comment line rewrapped. What made that work:

- Briefs of 9,500 to 11,000 characters naming the spec section, every file to touch, the
  public API as names and signatures, each rule to test, the commands to run and the report
  format. The builder's own definition told it to read the spec section and every named file
  first, write failing tests, stay inside the named files and report rather than edit elsewhere.
- Disjoint file sets, so three could run at once with no merge work.
- A phase boundary for the one dependency: the panel builder started only once the
  orchestrator's layer exposed the snapshot fields and methods it needed, and the brief gave
  them exactly.

Two costs to budget for. First, each builder re-reads the repository context on every call:
the three consumed 28.7M cache-read tokens, $2.87 of their $9.13. Second, a builder that makes
judgements beyond its brief must be re-checked: the gazetteer builder added a namesake map and
Natural Earth renames on its own initiative. They were good additions, but the orchestrator
had to re-check them against the spec and the resolver, and the orchestrator's spot checks
missed six towns that the same builder added but did not link (defect 3). The lesson is not
"forbid initiative"; it is that a builder's data judgements need a systematic check, not a spot
check, and that check is the orchestrator's job.

### 5.4 Default Claude chose zero sub-agents, and its reasoning was half right

Run B's argument (one connected change, re-briefing costs as much as doing, checking costs as
much as writing) was right about quality: it made the fewer mistakes and its defects were all in
one data script. It was wrong about cost: the connected change still had three disjoint
subproblems with crisp interfaces, and run A's briefs for them cost about 31,000 characters of
orchestrator output in total, far less than the 220K output tokens run B spent doing the same
work itself in Opus. Expect default Claude to under-delegate on a task of this shape unless the
structure is prescribed.

### 5.5 Wall clock gains are small unless the critical path is designed

Three builders in parallel saved far more than 4 minutes of builder time, but the run was gated
by the orchestrator's own layer work, then a dependent builder, then a failed runner and a repeat
of the gates. If time is the goal: start the dependent builder on a stub interface as soon as
the interface is decided rather than when the implementation exists; never put a Haiku runner
with a small turn cap on the critical path; and run the final gate in the background while
reading the diff.

### 5.6 Where the defects came from

- Run A's runtime defect was in the code the Opus orchestrator wrote itself (the layer),
  the one part explicitly kept away from sub-agents because it was design-sensitive.
  Delegation did not cause it.
- Run A's two data defects were a brief gap (the brief named region links by example rather
  than as a rule "every town you add inside a region row gets a link") and a check gap (spot
  checks on a builder's data judgements).
- Run B's data defects came from one agent doing a large data job with one pass of namesake
  checking and no second look at what the lower threshold brought in. Run A's builder, told to
  read the script's log and check the town list against the rows, caught more.

Across both runs, the data area produced four of the five defects. A gazetteer rebuild that
pulls in a thousand new rows is exactly the kind of work that needs a written rule and a
mechanical check (which rows have a region row within their country and no link?), whichever
model does it. The lesson for briefs: write the invariant, not the examples.

### 5.7 On measurement

- Parse the transcripts; do not estimate. Every API call records its model and usage. Sub-agent
  usage sits in a separate folder per session. A 150-line script was enough.
- Control what you can: same commit, same prompt text, same model and effort, no human help,
  started together, each run on its own port. Record the session ids before starting, and the
  coin flip before the review.
- Review blind, with a rubric written before the runs, by a reviewer that reruns the gates
  itself. Both PR descriptions here were honest, but you only know that after checking.
- One trial each gives a robust cost comparison (the gap was $10 on $40, far outside
  run-to-run noise in token counts for the same task) and a noisy quality comparison (one
  defect on a 24-point rubric is within what two runs of the same configuration could show).
  Do not conclude "the structure lowers quality" from this; do conclude "it did not raise it".
- The control the published evidence asks for, the default configuration at one effort level
  lower, was prepared and not run. Without it, this trial cannot say whether simply lowering
  Opus's effort would have saved the same money. Anthropic's own 134-task experiment found no
  advantage of Opus-plus-Haiku delegation over a lower-effort Opus mixture at equal cost. Run
  that control if cost is your only goal.

### 5.8 Against the prior

The prior from Anthropic's October 2026 experiment (Managed Agents, 134 tasks): Opus 5.5 with
Haiku 5.5 workers cost 30% less per attempt and passed 3 to 4 points fewer. This trial, in
Claude Code on one real feature: 26% less and one more defect on 24 points, with full spec
compliance in both. The shape matches the prior. The mechanism differs: here Sonnet, not Haiku,
did the bounded implementation, and the Haiku share was negligible. That suggests the published
cost-quality trade is mostly a property of "move writing out of the orchestrator" rather than of
Haiku specifically, which is the configuration worth testing next.

## 6. A recipe for other projects

Use this when the task is a feature or change of several hundred to a few thousand lines in an
existing codebase, with a spec that fixes interfaces, and at least two subproblems that touch
disjoint files. Skip it for small changes (the briefs cost more than the work), for a single
tightly coupled change with no stable internal interface, and for anything where the design is
still open.

**Orchestrator rules (the session's own model, the strongest you use):**

1. Read the design-sensitive files yourself: the spec, the module whose lifecycle you will
   integrate, the entry points. Send scouts over everything long that you need facts from, not
   understanding of.
2. Keep every design decision, every integration and every verdict. Never ask a sub-agent
   whether work is correct; run the tests and read the diff.
3. Write briefs that would let a stranger start: spec section, exact paths, public API as
   names and signatures, every rule to test as an invariant (not examples), the commands to run,
   the report format, and "stay inside these files; report, do not edit, anything else".
4. Launch independent builders in one message. Start a dependent builder as soon as the
   interface it needs is decided, giving it the exact fields and method names.
5. For any sub-agent that made a data or design judgement beyond its brief, check it
   systematically against the spec, not by sampling.
6. For any Haiku-written code, do a mutation check: break the behaviour, confirm its test
   fails, restore.
7. Run the final gate yourself with output to a file and read the summary lines. Read the
   whole diff against the spec before opening the PR.
8. Record every delegation in the PR: agent, model, task, outcome, used as is / reworked /
   discarded, and your judgement of whether it was worth it. That table is how the next trial
   learns.

**Agent definitions that held up (abridged from `.claude/agents/` in this repository):**

- `scout`, Haiku 5.5, effort medium, tools Read/Grep/Glob, 12 turns. Reports findings as
  file:line with short excerpts, inferences marked as such, searches run, and what it did not
  cover. Ask for a full body by name when you need one.
- `builder`, Sonnet 5.5, tools Read/Edit/Write/Grep/Glob/Bash, 60 turns. Test-first inside the
  named files; reports the API as built, each open decision and what it chose, command results
  with exit codes. Does not commit.
- `editor`, Haiku 5.5, effort medium, 15 turns. Mechanical edits from exact text; stops on a
  missing anchor; runs the named check. Change for next time: give already wrapped text and
  forbid rewrapping, or plan a review pass.
- `runner`, Haiku 5.5, 8 turns. Change for next time: one command per runner; turn cap and
  timeout sized to that command; never a dev server plus a polling QA script in one runner. Or
  drop it and run gates yourself with output to a file.

**Haiku guard rails that mattered:** effort medium, never higher; scope small enough that the
agent's context stays under 100,000 tokens (above that every token of the request costs five
times as much; the largest Haiku prompt in this trial was 46,000 tokens, the largest Sonnet
prompt 173,000); a turn cap that matches the job; no judgement questions.

**Measure it.** Copy `scripts/measure-session-usage.mjs`, note the session id before you start,
and run it when the session ends. If you change the structure, run the same task again and
compare the per-model rows, not the headline.

## 7. What to try next, in order of expected information

1. The lower-effort control: default Claude at one effort level lower on the same task. Says
   whether effort alone matches the saving.
2. The structure with the runner removed and the dependent builder started on a stub
   interface. Expected: same cost, several minutes faster.
3. The structure with Sonnet scouts instead of Haiku scouts. If the quality is the same, Haiku
   earned its place by price; if better, the scouts' excerpt limits were costing more than they
   saved.
4. The same structure on a task with no disjoint subproblems. Expected: the briefs cost more
   than they save, which would set the lower bound for when to use it.

## 8. Limits of this evidence

One feature, one run of each configuration, one reviewer, one repository and stack (vanilla
JavaScript, Cesium, Node, Puppeteer, on Windows), list prices rather than subscription usage,
and no human review time measured because no human was involved. The cost difference is large
enough to trust; the quality difference is not. Nothing here says what happens on a 10-line
change, a 20,000-line change, a task without a reviewed spec, or a different language. The
sub-agent definitions, prompts, protocol, results, the usage script and the blind review are all
in this repository under `docs/superpowers/` and `scripts/` so that the trial can be repeated.

## Appendix: sources in this repository

- Spec: `docs/superpowers/specs/2026-10-29-world-hotspot-view-design.md`
- Prompts: `docs/superpowers/plans/2026-10-29-hotspot-view-prompt-orchestrated.md` (run A),
  `...-prompt-single.md` (run B), `...-prompt-single-c.md` (the unrun control)
- Protocol and rubric: `docs/superpowers/plans/2026-10-29-hotspot-view-ab-protocol.md`
- Results: `docs/superpowers/plans/2026-10-29-hotspot-view-ab-results.md`
- Blind review: `docs/superpowers/plans/2026-10-29-hotspot-view-review-report.md`
- Evidence review behind the structure: `docs/superpowers/research/2026-10-29-haiku-55-subagent-evidence.md`
- Agent definitions: `.claude/agents/scout.md`, `runner.md`, `editor.md`, `builder.md`
- Usage script: `scripts/measure-session-usage.mjs`
- Pull requests: `krybaby7/gods-eye-view#10` (run A, closed) and `#11` (run B, merged with run A's
  data fixes ported)
