# GPT-6.1 Terra and Sol delegation for Search Layers

Verified 2026-11-07 against the official model guidance and the repository's hotspot-view trial.

OpenAI recommends Terra for scoped code fixes, concise writing from supplied material, and precise
screen-based tasks with a defined outcome. It recommends Sol for complex projects. The public API
catalog lists Terra at $1 input and $5 output per million tokens and Sol at $2 and $10. These are
API list prices. The guidance supports trying Terra on bounded tasks with a cheap independent
check. It does not establish a pass rate for Terra on this repository.
[OpenAI model selection](https://developers.openai.com/api/docs/guides/model-selection) ·
[OpenAI API model catalog](https://developers.openai.com/api/docs/models)

In the hotspot-view trial, three Haiku scouts and one narrowly scoped Haiku code change were
used as delivered. The documentation edit needed review and the runner hit its eight-turn cap
without a report. The two overall implementations both met the review rubric, and the trial's
cost and latency advantage was measured for that specific split. The Haiku evidence review
recommends narrow briefs, source citations and deterministic checks. Those are useful workflow
constraints for Terra. The Anthropic results do not measure Terra or Sol.
[Hotspot trial](2026-10-29-hotspot-view-ab-lessons.md) ·
[Haiku evidence review](2026-10-29-haiku-55-subagent-evidence.md) ·
[Role definitions](../../../.claude/agents/)

| Task                                                                                                 | Model        | Brief and scope limit                                                                                                                                                                  | Acceptance check                                                                    |
| ---------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Find a code seam in a long file                                                                      | Terra        | One area and 1–2 named files, up to 12 tool turns where enforceable, at most 400 words plus excerpts of at most 5 lines                                                                | Open cited ranges and confirm the signatures, lifecycle and omissions               |
| Evaluate one or two candidate data sources                                                           | Terra        | One fact sheet per source, up to 15 tool turns, at most 500 words. Cover auth, terms, rate limits and observed reliability separately                                                  | Open primary sources and independently decide inclusion                             |
| Registration, token and boundary changes                                                             | Terra        | Up to 8 named files per batch with exact anchors, signatures and values, up to 20 tool turns. Stop on a mismatch                                                                       | Read the diff and run boundary, token and focused registration checks               |
| User docs, changelog and PR evidence                                                                 | Terra        | Up to 4 named documents, provided outline and known results, up to 20 tool turns                                                                                                       | Compare with the spec and run actual checks before publishing results               |
| Focused fixture run or raw logs                                                                      | Terra        | Up to 3 related commands and one worktree. Allow at least 20 tool turns and enough wall time for startup, execution and teardown. Return exit codes, exact failures and artifact names | Check saved output and rerun the final gates from the orchestrator                  |
| Small local implementation with an existing seam                                                     | Terra        | One runtime module and its test. Explicit signature, edge cases and no cross-module API changes, up to 25 tool turns                                                                   | Check the red test, read the diff, rerun green and probe the key edge               |
| Finding rules and history, adapters, storage/routes, panel, voice, fixture QA, toolkit and benchmark | Sol          | One independent package at a time. Name the owned files and contract in the brief. Target 60 tool turns where enforceable. Split if the API or scope grows                             | Review every rule against the spec, rerun module tests and exercise the integration |
| Design, integration, Cesium lifecycle and final verification                                         | Orchestrator | Keep package contracts, the working copy and release evidence in one place                                                                                                             | Full spec-to-diff review and fresh gate runs for each PR                            |

The turn counts are planning limits. This harness does not expose per-agent turn budgets, so
briefs carry a narrow stopping condition and runners get time to finish.

## Preflight delegation log

| Model | Task                                                                                       | Outcome and use                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terra | Find lifecycle, billboard, picking and panel seams in the two long client files            | Returned targeted line references and identified layout policy as outside those files. Kept as delivered for integration.                                                               |
| Terra | Find snapshot, routing and registry seams in the news provider                             | Found that the public snapshot starts collection and that the registry is private. Kept as delivered for integration.                                                                   |
| Terra | Find fixture interception, browser interactions, responsive checks and teardown in news QA | Returned targeted line references and separated the harness from the new feature contract. Kept as delivered for fixture QA.                                                            |
| Sol   | Check Codex tool registration, web result events and subscription terms                    | Found independent patch-tool registration and the optional result payload. Used the evidence, checked the newer release, and narrowed the conclusion to the documented public controls. |

The table held up for read-only scouting. The next Terra task after the adapter decision is
the exact catalog and share-token registration.
