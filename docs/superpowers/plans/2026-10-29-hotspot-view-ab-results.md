# Hotspot view trial: results

Base commit: 4f2f0589 (main). Chore commits: A cab8be1a, B ceda4370, C ceda4370.
Run A: session 6c9641a6-4d39-44e7-b0db-4de3138108db (worktree gev-hotspot-a), PR krybaby7/gods-eye-view#10.
Run B: session ddf7b041-a732-48ef-acdb-65c1e1901797 (worktree gev-hotspot-b), PR krybaby7/gods-eye-view#11.
Run C: not run.
Started together 2026-10-29 15:05, both on Claude Opus 5.5 at the same effort, started from the owner's
session, unattended. Measured with `scripts/measure-session-usage.mjs` on 2026-10-29.

## Time and tokens

| | Run A (orchestrated) | Run B (default Claude) |
|---|---:|---:|
| Wall clock (first message to last) | 42.6 min | 46.7 min |
| Owner messages after the prompt | 0 | 0 |
| Sub-agents used | 9 (3 scout, 1 runner, 1 editor, 4 builder) | 0 |
| API calls, main session | 212 | 372 |
| API calls, sub-agents | 434 (105 Haiku, 329 Sonnet) | 0 |
| Output tokens, main (Opus 5.5) | 258,199 | 476,949 |
| Output tokens, Sonnet 5.5 sub-agents | 380,356 | 0 |
| Output tokens, Haiku 5.5 sub-agents | 130,633 | 0 |
| Output tokens, all models | 769,188 | 476,949 |
| Cache writes (all) | 2,318,325 | 890,587 |
| Cache reads, main | 49.6 M | 120.7 M |
| Cache reads, sub-agents | 30.8 M | 0 |
| Estimated cost, main (Opus) | $21.02 | $40.81 |
| Estimated cost, Sonnet sub-agents | $9.13 | 0 |
| Estimated cost, Haiku sub-agents | $0.16 | 0 |
| Estimated cost, total (list prices) | $30.31 | $40.81 |

Reading: run A spent 61% more output tokens in all but cost 26% less, because the main Opus
session wrote 46% less and re-read 59% less context, and the extra output landed on Sonnet and
Haiku. Haiku itself was almost free ($0.16); its contribution was keeping two long files out of
the orchestrator's context and one successful small implementation. Wall clock differed by 4 minutes
(A faster), within what two runs of the same thing could show.

## Delegation outcomes (from PR #10's table)

| Agent | Model | Outcome |
|---|---|---|
| scout × 3 | Haiku 5.5 | Used as is; the QA-script scout was the best value (2,270 lines never entered the orchestrator's context) |
| builder "server" | Sonnet 5.5 | Used, one comment line rewrapped |
| builder "gazetteer" | Sonnet 5.5 | Used after spot checks; went beyond the brief (namesake renames) |
| builder "focus" | Haiku 5.5 (override) | Used as is; mutation check passed (12/12, 11/12 with the cap broken) |
| builder "panel" | Sonnet 5.5 | Used as is |
| editor | Haiku 5.5 | Reworked: line wrapping and wording needed a pass |
| runner | Haiku 5.5 | Failed: hit its 8-turn limit, no report; the orchestrator ran every check itself |

Run B used no sub-agents ("none").

## Reported gates (from the PRs; not yet verified by a reviewer)

| | Run A | Run B |
|---|---|---|
| npm test | 1 failure, pre-existing Windows path test untouched by the branch | 2 failures, both in untouched files (one also fails on main, one timing-flaky) |
| build, format, boundaries, layer-token | pass | pass |
| Fixture QA | 28/28 final run; one earlier run failed in an existing step (flake) | 27/27 |
| Feature diff (excluding chore, world.json) | 28 files, +3,377 −150 | 27 files, +2,848 −143 |
| Commits | 8 | 13 |

## Quality (blind review per protocol section 3)

Reviewer: a fresh Claude Opus 5.5 sub-agent (27 min, 146K output tokens, about $14 at list prices),
given both branches as detached worktrees under neutral names, the spec and the rubric, with the
plan and agent files removed. Coin flip, recorded before the review: run-1 = A, run-2 = B. Full
report: `2026-10-29-hotspot-view-review-report.md`.

| | Run A (run-1) | Run B (run-2) |
|---|---|---|
| Gates | pass (one pre-existing Windows test failure, file untouched) | pass (same single failure) |
| Fixture QA by the reviewer | 28/28 first try | 27/27 first try |
| Spec points (of 24) | 24 | 24 |
| Defects | 3 | 2 |
| Total | 21 | 22 |

Defects, run A: (1) after a bubble round trip the shared voice/context selection is lost while
the layer still shows the story selected; (2) two Natural Earth name errata left in world.json
(Thi Qar at Al Amarah, Lunan at Hangu); (3) six cities not linked to their region (Tyre,
Nabatieh, Raqqa, Qamishli, Sukhumi, Maiduguri).
Defects, run B: (1) the same two errata plus six more (Juarez at Mazatlan, Taza at Oujda and
others; Mazatlan and Mansoura no longer resolve); (2) Horlivka and Makiivka not linked to Donbas.

Honesty: every gate claim in both PRs reproduced. A reported a one-in-four QA flake on an
existing step and B a timing-flaky test; the reviewer saw neither. B’s PR records fixing the
zoom-back reselection during its own QA (judgement call 11); that is exactly A’s defect 1.

Reviewer’s blind preference: run-2 (B), narrowly: one confirmed defect fewer, and its remaining
gaps are data fixes in one script while A’s is a runtime inconsistency. A’s gazetteer work and QA
were judged the more careful.

Judgement calls listed: A 18, B 16.
Which PR was merged, and what had to be fixed first: not decided yet.

## Verdict for the question asked

Hardcoding the Haiku/Sonnet structure cost 26% less and finished 4 minutes sooner than default
Claude, at a quality cost of one extra defect on a 24-point rubric where both scored full marks
on spec compliance. Haiku itself was 0.5% of run A’s cost; the saving came from moving bounded
implementation to Sonnet and keeping long files out of the Opus context. Of the five Haiku calls,
three scouts and the one implementation trial were used as is, the editor needed rework, and the
runner failed. One trial each: a one-defect difference is within noise; the cost difference is not.
