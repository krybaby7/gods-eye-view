# Where Claude Haiku 5.5 is reliably useful as a sub-agent: evidence review

Produced 2026-10-29 by the Perplexity Agent API (`high` preset) from the prompt in
`2026-10-29-haiku-55-research-prompt.md`; 7.4 minutes, 139 sources, $0.74. The report is the
model's synthesis of cited sources: check a number against its citation before relying on it.
Used to design the sub-agent structure in `../plans/2026-10-29-hotspot-view-prompt-orchestrated.md`.

---

# Claude Haiku 5.5 in coding-agent workflows
**Evidence reviewed through October 29, 2026**

## Executive summary

**Use Haiku 5.5 selectively for bounded, checkable work—not as your default implementer or final reviewer.** The strongest candidates are repository search, narrow extraction, and isolating noisy test/log output. Evidence specific to your JavaScript/Cesium stack is absent. [web:20][web:31][web:1]  
The most relevant controlled vendor experiment used **Opus 5.5 plus Haiku 5.5 workers on 134 coding tasks**: delegation reduced token cost **30–32%**, but pass rates fell **3.3–4.2 percentage points**. It did **not demonstrably outperform a calculated mixture of low- and medium-effort Opus 5.5** at equivalent cost. [web:71]  
A small independent experiment found Haiku 5.5 medium matched Sonnet 5.5 on one agentic implementation for **$0.08 versus $1.68**; high effort used **385 versus 29 requests** without better quality. This is promising, not a reliability estimate. [web:17]  
Another practitioner reports **20-minute Sonnet/Opus jobs taking 40–50 minutes with Haiku**, including revisions; briefing and evaluation consumed more quota than Haiku’s execution. [web:23]  
**Cheaper tokens do not establish fewer tokens, faster completion, or less human review.** No located study measures all those costs together for Claude Code and Haiku 5.5. [web:71][web:23]  
For your workflow, keep feature implementation with **Sonnet 5.5/Opus 5.5**; trial Haiku as a read-only scout and evidence-producing test/log worker first. This is a conservative recommendation, not an experimentally established optimum.

## 1. Task-by-task assessment

**Interpretation:** “Measured” includes small practitioner experiments and vendor-controlled evaluations; it does **not** mean independently reproduced. Recommendations below are my synthesis as of **2026-10-29**. “None” means **no task-specific reliability evidence found**, not that the model necessarily fails.

| Task type | Recommended model | Evidence strength | Caveats |
|---|---|---|---|
| Codebase search and file discovery | **Haiku 5.5**, with citations to files/lines | **Measured**, small practitioner comparison | **2026-10-09:** u/emarkosov compared identical prompts/files. Haiku identified **44 of 48** affected files; Opus 5.5 identified **45**. Missing four files prevents treating its report as exhaustive. Several other numerical fields in the retrieved post were corrupted, so I exclude them. [web:20] |
| Architectural exploration and dependency mapping | **Sonnet 5.5**; **Opus 5.5** for consequential decisions | **Single anecdote**, plus aggregate coding evaluations | **2026-10-07:** a Haiku 5.5 user reported ignored repository documents and a missed central question. Search success does not establish understanding of architectural consequences. [web:16] |
| Reading and summarising specified files | **Haiku 5.5**, source-linked and narrowly scoped | **Measured adjacent task**, not coding-file summaries | **2026-10-07:** AlphaSense’s Daniel Campos reported **400 document questions**, score **0.84 versus Haiku 4.5’s 0.76**. Rogo’s Alex Wang described narrow document-extraction subagents without numerical reliability. Neither establishes comprehensive code-summary fidelity. [web:1] |
| Running existing tests and reporting failures | **Haiku 5.5** for execution/reporting; **Sonnet 5.5** for diagnosis | **None** for a Haiku-specific failure-reporting accuracy study | **Docs checked 2026-10-29:** Anthropic explicitly recommends subagents for verbose test output, but supplies no Haiku-specific accuracy result. Preserve command, exit status and raw output; do not accept “tests passed” alone. [web:31] |
| Mechanical renames and repetitive small edits | **Haiku 5.5**, only with an explicit transformation and automated checks | **Single anecdote**, plus vendor assertion | **2026-10-10:** a commenter reports a straightforward migration working well. Anthropic describes small, specific changes across many files as suitable; neither provides a general rename/refactor success rate. [web:19][web:27] |
| Formatting | **Haiku 5.5 only if orchestration is needed**; otherwise run Prettier directly | **None** | No evidence found that an LLM improves deterministic formatting. My recommendation: use the tool directly and reserve the model for interpreting a failure. |
| Boilerplate | **Haiku 5.5**, schema/template constrained | **None** task-specific | General coding results are not a boilerplate reliability measurement. Require compilation/tests and restrict the editable paths. |
| Fixtures and data files | **Haiku 5.5**, with schema and semantic validation | **None** task-specific | No evidence found for dependable fixture generation in this stack. Plausible-looking but semantically wrong data remains an unchecked risk. |
| Unit tests from a precise spec | **Sonnet 5.5** by default; trial **Haiku 5.5** for isolated cases | **None** for test-generation quality specifically | **2026-10-08:** u/Escobar747 reports strong results on well-defined coding tasks using prewritten answer keys/hidden tests. That does not measure whether Haiku-generated tests detect bugs or avoid encoding a faulty implementation. [web:17] |
| Documentation updates | **Haiku 5.5** for factual, specified edits; **Sonnet 5.5** for explanatory synthesis | **None** for 5.5; **single secondary anecdote** for 4.5 | **2025-10-15, Haiku 4.5 separately:** a secondary account reports excessive unsolicited documentation and greater need for explicit instructions. Do not transfer that observation automatically to Haiku 5.5. [web:99] |
| Log triage and error extraction | **Haiku 5.5** for extraction/grouping; **Sonnet 5.5** for root cause | **Single anecdote/design suggestion** | **2026-10-08:** HN user flaburgan describes Opus delegating noisy production-log filtering to Haiku. No accuracy, cost or latency measurement accompanies it. [web:98] |
| PR description writing | **Haiku 5.5** for a factual draft from a bounded diff | **None** | No evidence found for task-specific reliability. Require separation of “changed,” “tested,” and “not verified”; never let it invent testing evidence. |
| Reviewing diffs | **Sonnet 5.5**; **Opus 5.5** for high-risk changes | **Measured**, tiny practitioner test only | **2026-10-08:** a seeded review contained nine bugs and two decoys; Haiku 5.5 low missed a compile error. The sample is too small to establish recall/false-positive rates for real PRs. [web:17] |
| Classification and routing | **Haiku 5.5**, with labelled local evaluations | **None** for coding-specific routing reliability | **2026-10-07:** vendor/customer evidence supports this positioning, including Asana bug triage, but the published Asana numbers concern latency—not classification accuracy. [web:1] |
| Structured extraction | **Haiku 5.5**, schema validated and evidence linked | **Measured adjacent tasks** | **2026-10-07:** AlphaSense’s document-QA result and HubSpot’s **92.8% over three runs** support narrow enterprise tasks. Neither is a code-extraction benchmark; HubSpot’s suite is private. [web:1] |
| Verifying another agent’s factual or semantic claims | **Opus 5.5**, backed by independent tools/tests | **Measured negative evidence**, small practitioner comparison | **2026-10-09:** Haiku 5.5 found **4** genuine errors but falsely flagged **30** correct statements across two blog posts. This is not code verification, but argues strongly against using it as an unchecked general judge. [web:20] |
| Checking objective claims—file exists, command failed, symbol imported | **Haiku 5.5**, returning primary evidence | **None** task-specific | This is a proposed use, not a proven result. Let deterministic tools establish truth; Haiku should collect evidence, not substitute confidence for it. |
| Multi-file semantic refactors and ambiguous feature implementation | **Opus 5.5**; **Sonnet 5.5** for well-understood changes | **Measured aggregate evidence**, not a refactor-specific experiment | **2026-10:** Haiku 5.5’s Terminal-Bench 4.0 result is substantially below the larger models. The vendor explicitly recommends Sonnet/Opus for complex agentic coding. [web:1][web:62] |

**Separately labelled Haiku 4.5 evidence:** On **2025-10-15**, Augment co-founder Guy Gur-Ari reported **90% of Sonnet 4.5’s performance** on Augment’s private agentic-coding evaluation; Warp’s Zach Lloyd endorsed subagent responsiveness. Neither published per-task reliability or an end-to-end delegation-cost comparison. [web:35]

## 2. Failure modes: observed versus unestablished

| Failure mode | Evidence and date | What it establishes |
|---|---|---|
| Missing relevant files or the actual question | **Haiku 5.5, 2026-10-07:** repository-summary complaint; **2026-10-09:** 44/48 affected files found in a small comparison. [web:16][web:20] | Even useful search output needs coverage checks. “All relevant files” is not a safe unverified conclusion. |
| Multi-file semantic refactors | **Haiku 5.5, 2026-10-07:** vendor warns complex agentic coding favours Sonnet/Opus; Terminal-Bench 4.0 gap supports the distinction. [web:1] | Aggregate evidence of a capability gap; **no refactor-specific failure rate found**. Mechanical multi-file edits are a different task. |
| Ambiguous specifications | **Haiku 5.5, 2026-10-08:** the small controlled test included ambiguity and reported generally good handling; another repository anecdote stresses precise instructions. [web:17][web:16] | Mixed evidence—not support for “always fails ambiguity,” and not enough to trust requirements interpretation. |
| Excessive tool-use loops | **Haiku 5.5, 2026-10-08:** high effort used **385 requests/$1.03**, versus medium’s **29/$0.08**, with no reported quality improvement. [web:17] | Direct evidence that more effort can destroy efficiency on an individual task. Not a universal optimal-effort result. |
| Anchoring on misleading context | **Haiku 5.5, 2026-10-10:** user reports latching onto a prominent comment and repeated token-consuming traps. [web:19] | Single anecdote; useful warning, not quantified prevalence. |
| Long-context omissions | **Docs checked 2026-10-29:** Anthropic documents declining accuracy/recall as context grows. [web:103] | General model limitation. **No Haiku 5.5 coding-specific long-context reliability curve found.** |
| Instruction drift over long sessions | **Evidence reviewed through 2026-10-29** | **No evidence found** from a longitudinal Haiku 5.5 coding study. Do not present general multi-agent failure taxonomies as model-specific proof. |
| Hallucinated APIs | **Evidence reviewed through 2026-10-29** | **No sufficiently specific Haiku 5.5 API-hallucination study found**, including Cesium, Puppeteer, Vite or Node APIs. |
| Stopping without adequate verification | **Haiku 5.5 low, 2026-10-08:** fabricated explanation that a build had stalled “over an hour” during a run lasting 15 minutes. [web:17] | Evidence of an unreliable verification report; not a measured overall premature-stopping rate. |
| Overconfident wrong reports | **Haiku 5.5, 2026-10-09:** 30 false-positive factual corrections; inaccessible current rulebook replaced with previous-season rules. [web:20] | Cheap verification can create work and introduce errors rather than remove them. |
| Wrong tool strategy | **Haiku 4.5 only, 2025-10-15:** secondary account says it tried installing NPM packages rather than using the requested Playwright MCP workflow; stronger instructions corrected it. [web:99] | Weak historical evidence for explicit tool contracts; not evidence about Puppeteer or Haiku 5.5. |
| Lossy or duplicated handoffs | **Anthropic, 2025-06-13:** vague subagent briefs caused duplicated searches, gaps and misunderstood assignments. [web:32] | Real orchestration failure evidence, but involving the research system—not Haiku 5.5 coding. |

## 3. Benchmarks, prices and latency

### Benchmark results

**Do not compare different benchmark versions as if they were the same test.** In particular, Haiku 4.5’s roughly 41% historical Terminal-Bench result and its 0% on Terminal-Bench 4.0 are not contradictory. Likewise, OSWorld-Verified and OSWorld 2.1 offline-subset results are different evaluations. [web:35][web:1]

| Benchmark / setup | Claude Haiku 5.5 | Claude Sonnet 5.5 | Claude Opus 5.5 | Separately labelled 4.x comparison | Date, source and qualifications |
|---|---:|---:|---:|---|---|
| SWE-bench Verified | No evidence found | No evidence found | No evidence found | **Haiku 4.5: 73.3%; Sonnet 4.5: 77.2%; Opus 4.5: 80.9%** | Haiku: **2025-10-15**, vendor result averaged over 50 trials on 500 problems, specialised prompt and 128K thinking budget. Sonnet/Opus: **2025-11-24** comparison. These are not Claude Code success rates. [web:35][web:75][web:148] |
| Terminal-Bench 4.0, vendor headline | **39.2%** | **70.6%** | **66.4%** | **Haiku 4.5: 0.0%** on this version | **2026-09/10** launch tables; effort/harness dependent. Haiku headline results are reported at max effort by the benchmark breakdown; Sonnet’s table marks the Opus comparison separately. [web:1][web:62][web:73] |
| Terminal-Bench 4.0, Vals Mini-SWE-agent | No result established here | **64.14%** | **65.15%** | No comparable result established here | **2026-10-27:** Sonnet **$16.51/test, 1h22m**; Opus **$13.20/test, 1h04m**. Different harness from vendor headline; safeguards/fallback handling affect interpretation. [web:67][web:66] |
| Historical Terminal-Bench | — | — | — | **Haiku 4.5: ~41%**, launch-era Terminus 2 evaluation | **2025-10-15:** footnote gives **40.21% without thinking**, **41.75% with thinking**. Do not relabel this automatically as Terminal-Bench 2.0. [web:35][web:135] |
| Terminal-Bench 2.0 | — | — | — | **Sonnet 4.5: 50.0%; Opus 4.5: 59.3%** | **2025-11-24**, vendor comparison republished by Microsoft. [web:148] |
| τ-bench / τ²-bench | No comparable 5.5 agent score found | No comparable score found | No comparable score found | **Haiku 4.5 τ²:** airline **63.6%**, retail **83.2%**, telecom **83.0%** | Historical scores reproduced by DocsBot; Anthropic’s **2025-10-15** methodology specifies ten runs and policy/prompt additions. A 2026 experiment using Haiku 4.5 as the **simulated user** is not a Haiku agent score. [web:124][web:35][web:71] |
| τ²-bench retail, historical larger models | — | — | — | **Sonnet 4.5: 86.2%; Opus 4.5: 88.9%** | **2025-11-24** comparison. [web:148] |
| Aider polyglot | No evidence found | No evidence found | No evidence found | **Opus 4.5: 89.4%**, vendor-reported; no sufficiently reliable Haiku 4.5 score established | **2025-11-24** result recorded by AI Wiki. Aggregators disagree on historical entries; I exclude unsupported Haiku figures. [web:130][web:124][web:132] |
| OSWorld 2.1, **offline subset** | **72.4%** | **83.9%** | No matched offline-subset value found | **Haiku 4.5: 15.7%** | **2026-10-07** Haiku launch comparison. These are not the Sonnet launch’s differently scoped OSWorld figures. [web:1] |
| OSWorld 2.1, launch comparison | — | **80.1%** | **81.8%** | — | **2026-09-28**, separately reported launch comparison; do not merge with the offline-subset row. [web:72] |
| Historical OSWorld | — | — | — | **Haiku 4.5: 50.7%; Sonnet 4.5: 61.4%; Opus 4.5: 66.3%** | **2025-10/11**; Haiku methodology used OSWorld-Verified, 100 steps, four runs. [web:129][web:35][web:148] |
| FrontierCode 1.1 Main | **46.4%** | **52.1%, xhigh** | No matched value established here | — | **2026-10-07**, vendor launch table. Cognition separately reports **66.2** for its Fusion system with Opus 5.5 lead/Haiku 5.5 sidekick—not Haiku alone. [web:1] |
| Managed Agents scripted task set | **93%** initial run; **91–93%** subsequent runs | — | — | **Haiku 4.5: 62%**, subsequent run **63%** | **2026-10-07–09:** 79 tasks, five attempts/task, scripted tool responses, Sonnet 4.6 checklist grader. Broad agent evidence, not real-repository implementation reliability. [web:71] |

### Prices

**USD per million tokens, documentation checked 2026-10-29.** These are API list prices, not a conversion of Claude subscription quota into dollars. [web:8]

| Exact model | Input | Output | Cache reads | Price qualification / source |
|---|---:|---:|---:|---|
| Claude Haiku 5.5, prompt **≤100,000 tokens** | $0.10 | $0.50 | $0.01 | Threshold includes cached input. [web:8] |
| Claude Haiku 5.5, prompt **>100,000 tokens** | $0.50 | $2.50 | $0.05 | **Entire request** enters the higher band, including output/cache rates—not just excess tokens. [web:8] |
| Claude Sonnet 5.5 | $2 | $10 | $0.10 | Current cache-read rate. [web:8] |
| Claude Opus 5.5 | $4 | $20 | $0.20 | Standard pricing. [web:8] |
| Claude Fable 5.1 | $10 | $50 | $0.25 | Standard pricing. [web:8] |
| Claude Haiku 4.5 | $1 | $5 | $0.10 | Historical model, current listed price. [web:8] |
| Claude Sonnet 4.5 | $3 | $15 | $0.30 | Historical model, current listed price. [web:8] |
| Claude Opus 4.5 | $5 | $25 | $0.50 | Historical model, current listed price. [web:8] |

### Speed and time to first token

These measurements are **configuration-specific snapshots**, not model constants. Artificial Analysis’s displayed reasoning-model latency can represent waiting for the **first answer token**, so high decode throughput can coexist with a long wait. Haiku 5.5 also uses a newer tokenizer, complicating raw tokens/second comparisons with Haiku 4.5. [web:29][web:26][web:97]

| Exact model / effort | Output tokens/second | Displayed TTFT / first-answer latency | Measurement date and source |
|---|---:|---:|---|
| Claude Haiku 5.5 **high** | **191.7** | **17.21 s** | AA comparison, updated **2026-10-29**. [web:29] |
| Claude Haiku 5.5 **max** | **241.0** | **343.38 s** | Same snapshot. “Fastest decode” does not mean fastest completed task. [web:29] |
| Claude Sonnet 5.5 **high, default fallback** | **118.9** | **12.35 s** | AA comparison, updated **2026-10-28**. [web:108] |
| Claude Sonnet 5.5 **max, default fallback** | **136.9** | **463.17 s** | AA comparison, updated **2026-10-29**. [web:112] |
| Claude Opus 5.5 **low, default fallback** | **86.2** | **5.24 s** | AA comparison, updated **2026-10-28**. [web:108] |
| Claude Opus 5.5 **high, default fallback** | **81.5** | **30.74 s** | AA comparison, updated **2026-10-29**. [web:112] |
| Claude Haiku 4.5 **non-reasoning** | No matched throughput established here | **0.47 s** | AA provider page, updated **2026-10-29**. Do not pair this latency with a reasoning-mode throughput figure. [web:115] |

## 4. Orchestration patterns—and their actual economics

### The strongest directly relevant comparison

Anthropic’s **October 21–23, 2026** experiment is unusually relevant: **134 repository coding tasks**, hidden tests, five attempts/task in each of three runs. It used **Claude Managed Agents**, custom shell/editor tools and platform orchestration—not Claude Code. [web:71]

| Configuration | Attempts passed | Token cost/attempt | Token cost/passed attempt |
|---|---:|---:|---:|
| Opus 5.5 medium alone | **72.1%** | **$4.78** | **$6.63**. [web:71] |
| Opus 5.5 medium + Haiku 5.5 medium, no added delegation prompt | **68.8%** | **$3.35** | **$4.86**. [web:71] |
| Opus 5.5 medium + Haiku 5.5 medium, 113-word delegation prompt | **67.9%** | **$3.27** | **$4.81**. [web:71] |
| Opus 5.5 low alone | **63.0%** | **$1.84** | **$2.92**. [web:71] |

| Finding | Exact reported result | Interpretation |
|---|---|---|
| Delegation without added prompt | **“30% less”** cost, 95% interval **27–33%**; **3.3 points fewer** passes, interval **0.8–5.8** | Savings with measurable accuracy loss. [web:71] |
| Delegation with prompt | **“32% less”** cost, interval **29–35%**; **4.2 points fewer** passes, interval **1.3–7.1** | Explicit briefing did not establish a better quality/cost frontier. [web:71] |
| Additional checking overhead | Counting the evaluation’s extra tool-safety checks reduces the prompted saving to **27%**, interval **25–30%** | Published headline token cost is not every infrastructure cost. [web:71] |
| Comparison with simpler effort routing | Delegation was only **0.5 or 1.1 points above** a calculated low/medium Opus mixture; both intervals crossed zero | **No demonstrated advantage over that simpler calculated baseline.** The mixture was calculated, not separately run. [web:71] |
| Evaluation confounds | Voided attempts occurred only with subagents; alternative analyses reduced, but did not eliminate, the observed gap | Treat the exact accuracy penalty as setup-dependent. No human-review or completed-task wall-clock comparison was reported. [web:71] |

### Other reported patterns and numbers

| Pattern / reporter | Dated result | Evidence limitation |
|---|---|---|
| **Haiku 5.5 implementer**, u/Escobar747 | **2026-10-08:** medium **29 requests/$0.08**, Sonnet 5.5 **30/$1.68**, both reportedly correct on one agentic task; high **385/$1.03**, no improvement. [web:17] | Author-prepared hidden tests are useful; one codebase and limited repetitions do not establish general reliability or delegation overhead. |
| **Opus lead + Haiku sidekick**, Cognition/Walden Yan | **2026-10-07:** Devin Fusion **FrontierCode 66.2**, “cutting cost and latency.” [web:1] | Measured system score, but **no numerical cost/latency reduction** or matched lead-only result published in the quotation. |
| **Opus planning/review + Haiku execution**, Reddit practitioner | **2026-10-14:** **“20 minutes” becomes “40 or 50 minutes”** after revisions; at extreme effort, **“4 to 5 times” Sonnet’s tokens**; claims nearly **60%** of former Sonnet workloads transferable. [web:23] | Anecdotal, no released task set or controlled accounting. Directly addresses briefing/review/rework concerns. |
| **Cheaper subagents under Opus**, Reddit commenter u/laurilllll | **2026-10-08 thread:** weekly usage reportedly **89% after five days → 22%**. [web:17] | Subscription-usage anecdote, not token-normalised A/B evidence; workload may differ. |
| **Fan-out research**, Anthropic | **2025-06-13:** Opus **4** lead + Sonnet **4** workers **“90.2%”** better than single Opus 4 on internal research evaluation; parallelisation cut research time **“up to 90%.”** [web:32] | **Not Haiku, not coding.** Multi-agent systems used **15× chat tokens**, versus **4×** for agents; 15× is **not** the measured ratio to a single agent. [web:32] |
| **Large-corpus defect search**, Anthropic | **2026-08-30:** Fable 5.1 + up to 25 Sonnet **5** workers cost **47–55% less**, took **2.3 hours versus 15–20 hours**, but scored **10–12 points lower** than Fable alone; read about **560M versus 365M cached tokens**. [web:71] | Strong example of cheaper/faster **but more tokens and less accuracy**. Python corpus, planted defects, no Haiku. |
| **Executor with stronger advisor**, Anthropic | **2026-09-19–20:** Opus 5.5 high + Fable 5.1 advisor **90.1%/$2.92**, versus Opus high **88.4%/$1.38**: **1.7 points for ~2.1× cost**. [web:71] | Gain at edge of run-to-run noise; extra consultations sit on critical path. Not a Haiku implementation result. |
| **Haiku 5.5 compaction threshold**, Anthropic | **2026-10-21:** synthetic 45-request sessions cost **$0.272 at 150K**, **$0.082 at 90K**, **$0.075 at 50K**, **$0.729 without compaction**. [web:71] | Filler-text cost experiment, **not preservation-of-coding-context accuracy**. API compaction settings are not interchangeable with Claude Code subagent settings. |

### What Claude Code actually supports

As checked **2026-10-29**, project agents live in `.claude/agents/*.md`, and `model: haiku` is supported. **Explore does not currently imply Haiku**: the documentation says it generally uses the main conversation’s model, with special Fable/provider handling. A custom `Explore` definition can override it. Check `/tasks` rather than assuming which model ran. [web:31]

A conservative initial configuration—**my proposed experiment**, not a demonstrated optimum—is:

```markdown
---
name: bounded-scout
description: Finds requested symbols and source evidence; does not implement or review.
model: claude-haiku-5-5
tools: Read, Grep, Glob
maxTurns: 12
---
Search only the requested scope.
Return file paths, line references, and short supporting excerpts.
Separate findings from inferences.
State skipped paths, failed reads, and unresolved questions.
Do not claim exhaustive coverage without showing how it was checked.
```

The file format, exact model IDs, tool allowlists and `maxTurns` are documented; the particular prompt and limit above are my choices. Note that per-invocation overrides and organisation configuration can affect model selection. [web:31]

**For your stack, my proposed division of labour is:**

| Workflow component | Initial policy |
|---|---|
| Cesium behaviour, coordinate semantics, rendering lifecycle, feature design | Keep with Opus 5.5/Sonnet 5.5; no stack-specific Haiku reliability evidence found. |
| “Find every import/call site for this symbol” | Trial Haiku scout; require a search record and source references, not just a summary. |
| Node test runner, Vite build, Prettier | Run deterministic commands directly when possible. Use Haiku only to isolate substantial output and return exit status plus evidence. |
| Puppeteer browser QA | Allow execution of existing approved scripts; retain screenshots/logs. Do not equate successful script execution with visual correctness. |
| New tests | Trial Haiku only against precise cases; assess whether tests fail on deliberately broken implementations, not merely pass on current code. |
| Final verification and release decision | Strong orchestrator checks primary artifacts and reruns decisive tools; Haiku is not the final semantic authority. |

Anthropic’s **2026-10 Claude Code guidance** supports this conservative shape: simple jobs can use Haiku; subagents cost extra tokens; handing the same task to another agent does not inherently improve the answer. Its docs also advise staying in the main conversation for quick changes, shared-context phases and latency-sensitive work. [web:120][web:31]

## 5. Papers and industry research

These explain mechanisms and trade-offs. **None establishes Haiku 5.5 reliability in your application.**

| Paper / publication date | One-line finding and relevance |
|---|---|
| **FrugalGPT — Chen, Zaharia, Zou, 2023** | Learned cascades matched a strong model with **up to 98% lower inference cost**, or improved accuracy at equal cost; narrow downstream-task results, not autonomous coding or human-review-inclusive savings. [web:52] |
| **RouteLLM — Ong et al., 2024; revised 2025-02-23, ICLR 2025** | Preference-trained strong/weak routing; project reports **>85% MT-Bench, 45% MMLU, 35% GSM8K cost reductions at 95% of GPT-4 performance**—not equal quality and not coding-agent routing evidence. [web:76][web:80] |
| **How Robust Are Router-LLMs? — 2025-04** | Examines fragility of router decisions, including RouteLLM; supports validating routing under prompt/distribution changes rather than assuming a fixed task label implies the right model. [web:79] |
| **Why Do Multi-Agent LLM Systems Fail? / MAST — Cemri et al., 2025** | Identifies **14 failure modes** across specification, inter-agent misalignment and verification; project describes seven frameworks and 200 analysed traces. Highly relevant to duplicated work, lost context and premature completion. [web:49] |
| **Towards a Science of Scaling Agent Systems — Kim et al., 2025-12-09** | Across **180 configurations**, coordination helped some parallelisable tasks but degraded sequential PlanCraft performance **39–70%**; reported error amplification **17.2× independent versus 4.4× centralised**. Not Haiku evidence; the paper contains inconsistencies between some prose and tables, so its exact scaling rules should not be treated as universal laws. [web:82] |
| **Think Big, Search Small: Where Capacity Matters in Hierarchical Search Agents? — Cai, Zhao, Li, 2026-07-08** | Controlled search-agent sweeps found delegation capacity mattered much more than executor scale; a distilled **Qwen3-1.7B** executor matched a frontier worker using **37% fewer worker tokens, 4,758 versus 7,577**. Fixed-corpus QA, not coding. [web:57] |
| **Fine-tuned Judge Model Is Not a General Substitute for GPT-4 — ACL Findings 2025** | Strong in-domain judge performance did not generalise to fairness, adaptability and out-of-domain evaluation; argues against assuming a cheap judge can safely certify arbitrary work. [web:89] |
| **Judging the Judges — Thakur et al., GEM² 2025** | Thirteen judge models showed only the largest aligned reasonably with humans; smaller judges sometimes ranked systems usefully but were sensitive to prompt complexity and leniency. Ranking is not dependable per-change verification. [web:90] |
| **Building Effective Agents — Anthropic, 2024-12-19** | Recommends the simplest sufficient architecture and adding agentic complexity only after evaluation; a useful engineering principle, not a controlled Haiku result. [web:106] |
| **How We Built Our Multi-Agent Research System — Anthropic, 2025-06-13** | Documents real orchestrator-worker benefits alongside token overhead, bad delegation and limited coding parallelisability. [web:32] |
| **Optimizing for Cost and Intelligence — Anthropic, measurements through 2026-10** | Provides the most directly relevant current Haiku 5.5 coding-delegation comparison, including uncertainty intervals, accuracy losses and comparison with simpler effort routing. [web:71] |

## 6. What the evidence does not support

| Unsupported conclusion | Evidence boundary as of 2026-10-29 |
|---|---|
| **“Haiku 5.5 is reliably interchangeable with Sonnet 5.5 for implementation.”** | One encouraging independent experiment conflicts with larger vendor evidence showing weaker complex-coding performance and delegation accuracy losses. [web:17][web:1][web:71] |
| **“Delegation saves tokens.”** | Lower dollar cost can coexist with more tokens, newer tokenisation and expensive retries. The large-corpus experiment explicitly used more cached tokens. [web:71][web:97] |
| **“Delegation saves total time after briefing and reviewing.”** | **No evidence found** measuring Haiku 5.5 Claude Code execution, orchestrator briefing, report reading, human review and rework together. The most relevant practitioner report describes slower completion. [web:23] |
| **“Haiku is a dependable final verifier.”** | The located factual-checking experiment had many false positives; small-judge research also warns against broad generalisation. [web:20][web:89] |
| **“Higher effort always makes Haiku more economical or reliable.”** | The controlled anecdote shows a large request explosion; community effort recommendations conflict. [web:17][web:21][web:23] |
| **“A 1M context window means dependable million-token comprehension.”** | Context capacity is not recall quality; no coding-specific Haiku 5.5 curve was found, and crossing 100K raises request prices fivefold. [web:103][web:8] |
| **“Haiku 4.5 results prove Haiku 5.5 behaviour.”** | Different model, tokenizer, thinking controls, pricing and benchmark versions. Keep historical evidence labelled. [web:35][web:97][web:8] |
| **“Vendor testimonials are independent replications.”** | Asana, AlphaSense, HubSpot, Rogo and Cognition provide useful named evidence, but their launch quotations do not expose complete datasets, failure distributions or reproducible comparisons. [web:1] |
| **“This is validated for Cesium/Vite/Node/Puppeteer.”** | **No evidence found** for that combined stack. |
| **“The other requested communities independently corroborate it.”** | Useful direct evidence was found chiefly in **r/ClaudeCode and HN**. No sufficiently specific, independently checkable measurements were established here from r/LocalLLaMA, r/cursor, r/ChatGPTCoding, X, Discord summaries or indexed YouTube transcripts. |

## Bottom line for your workflow

**Start with Haiku 5.5 as a scout and evidence collector, not a junior developer whose reports you must trust.** Its most plausible benefit is doing substantial bounded reading cheaply while keeping noisy material out of the orchestrator’s context. That benefit is documented architecturally; its net value in your project remains unmeasured. [web:31][web:20]

My recommended local test is a paired comparison of **your existing single-agent workflow**, **the same orchestrator with narrowly scoped Haiku workers**, and **a lower-effort single-agent baseline**. Count orchestrator and worker tokens, briefing/report tokens, elapsed time, review time, retries and accepted correctness. The lower-effort baseline matters because the best available current experiment did not establish that delegation beats it on the quality/cost frontier. [web:71]

**Keep Haiku only where it reduces cost or time per accepted, independently checked result—not where its execution merely looks cheap.**

Citations:
[1] https://www.anthropic.com/claude-haiku-5-5 — Introducing Claude Haiku 5.5 - Anthropic
[2] https://platform.claude.com/docs/en/models/opus-5-5/overview — Claude Opus 5.5 - Claude Platform Docs
[3] https://docs.anthropic.com/en/docs/about-claude/models/overview — Models overview - Claude Platform Docs
[4] https://www.anthropic.com/news?cid=1909 — Newsroom - Anthropic
[5] https://platform.claude.com/docs/en/models/haiku-5-5/overview.md — platform.claude.com
[6] https://support.claude.com/en/articles/11940350-claude-code-model-configuration — Claude Code model configuration | Claude Help Center
[7] https://platform.claude.com/docs/en/models/sonnet-5-5/overview — Claude Sonnet 5.5 - Claude Platform Docs
[8] https://docs.anthropic.com/en/docs/about-claude/pricing — Pricing - Claude Platform Docs
[9] https://support.claude.com/en/articles/12138966-release-notes.md — 12138966-release-notes.md
[10] https://support.claude.com/en/articles/12138966-release-notes%23h_bcd77beae0 — July 2026
[11] https://support.claude.com/en/articles/12138966-release-notes%23h_07678d11e2 — June 2026
[12] https://platform.claude.com/docs/ko/models/sonnet-5-5/overview — Claude Sonnet 5.5 - Claude Platform Docs
[13] https://support.claude.com/en/articles/12138966-release-notes%23h_a5c201d6fe — March 2026
[14] https://platform.claude.com/docs/en/models/fable-5-1/overview — Claude Fable 5.1 - Claude Platform Docs
[15] https://support.claude.com/en/articles/12138966-release-notes%23h_41305cb17a — February 2026
[16] https://www.reddit.com/r/ClaudeCode/comments/1x04uxh/somethings_seriously_off_with_haiku_55/ — Somethings seriously off with Haiku 5.5
[17] https://www.reddit.com/r/ClaudeCode/comments/1x132yy/is_haiku_55_good_enough_to_be_your_main_coding/ — Is Haiku 5.5 good enough to be your main coding agent, not just the cheap one? I ran a small controlled test
[18] https://www.reddit.com/r/ClaudeCode/comments/1x15lty/i_cant_update_the_app_to_use_haiku_55/ — I can't update the app to use Haiku 5.5
[19] https://www.reddit.com/r/ClaudeCode/comments/1x27a6k/haiku_55_is_cheap_bad/ — Haiku 5.5 is cheap bad
[20] https://www.reddit.com/r/ClaudeCode/comments/1x1e7ts/i_tested_haiku_55_sonnet_55_and_opus_55_as/ — I tested Haiku 5.5, Sonnet 5.5 and Opus 5.5 as subagents on 6 real tasks
[21] https://www.reddit.com/r/ClaudeCode/comments/1x0ob6k/do_not_use_haiku_55_on_medium_effort/ — DO NOT USE Haiku 5.5 on Medium effort...
[22] https://www.reddit.com/r/ClaudeCode/comments/1x4bb56/thanks_to_haiku_55_i_can_do_hundreds_of_agents/ — Thanks to Haiku 5.5, I can do hundreds of agents without blowing through my 20X sub instantly.
[23] https://www.reddit.com/r/ClaudeCode/comments/1x5rbwy/haiku_55_on_steroids/ — Haiku 5.5 on Steroids.
[24] https://www.reddit.com/r/ClaudeCode/comments/1x0nw4u/haiku_55_routed/ — Haiku 5.5 routed?
[25] https://www.reddit.com/r/ClaudeCode/comments/1xf1qmm/is_haiku_55_on_max_effort_enough_to_build_code/ — Is Haiku 5.5 on Max effort enough to build code?
[26] https://ai.thesatyajit.com/articles/claude-haiku-5-5 — Claude Haiku 5.5: what "75% less to run" is made of
[27] https://www.anthropic.com/claude/haiku — Claude Haiku \ Anthropic
[29] https://artificialanalysis.ai/models/comparisons/claude-haiku-5-5-high-vs-claude-haiku-5-5 — Claude Haiku 5.5 (High) vs Claude Haiku 5.5 (Max)
[30] https://artificialanalysis.ai/models/releases/claude-haiku-5-5 — Claude Haiku 5.5: Release Intelligence, Performance & Price
[31] https://code.claude.com/docs/en/subagents — subagents
[32] https://www.anthropic.com/research/multi-agent-research-system — How we built our multi-agent research system
[34] https://code.claude.com/docs/ja/sub-agents — カスタムサブエージェントの作成 - Claude Code Docs
[35] https://www.anthropic.com/news/claude-haiku-4-5 — Introducing Claude Haiku 4.5
[36] https://www.pwc.com/us/en/services/ai/agent-os/agent-os-recent-enhancements.html — Agent OS Recent Enhancements
[37] https://github.com/aurabroker/claude/blob/main/docs/token-optimization.md — claude/docs/token-optimization.md at main · aurabroker/claude
[38] https://code.claude.com/docs/fr/sub-agents — Créer des sous-agents personnalisés - Claude Code Docs
[39] https://ishchuk.eu/blog/building-a-multi-agent-os-with-claude-for-production-ai-agents — Building a Multi-Agent OS with Claude: Architecture, Tools, and ...
[40] https://github.com/JinKin/everything-claude-code/blob/main/docs/token-optimization.md — everything-claude-code/docs/token-optimization.md at main · JinKin/everything-claude-code
[41] https://the-decoder.com/anthropic-shares-blueprint-for-claude-research-agent-using-multiple-ai-agents-in-parallel/ — Anthropic shares blueprint for Claude Research agent using ...
[42] https://github.com/tontran/claude-code/blob/main/docs/token-optimization.md — token-optimization.md - tontran/claude-code - GitHub
[43] https://claude.com/resources/articles/maximizing-the-value-of-your-claude-code-sessions — Maximizing the value of your Claude Code sessions
[44] https://github.com/engr-talha-coder/everything-claude-code/blob/main/docs/token-optimization.md — everything-claude-code/docs/token-optimization.md at main
[45] https://github.com/handbook-academy/engineering-handbook/blob/main/content/hld/part-9-ai-ml-system-design/04-multi-agent-orchestration.md — engineering-handbook/content/hld/part-9-ai-ml-system-design/04-multi-agent-orchestration.md at main · handbook-academy/engineering-handbook
[46] https://github.com/AkihikoWatanabe/paper_notes/issues/1816 — Why Do Multi-Agent LLM Systems Fail?, Mert Cemri+, arXiv'25 · Issue #1816 · AkihikoWatanabe/paper_notes
[47] https://github.com/AkihikoWatanabe/paper_notes/issues/1904 — [Paper Note] Why Do Multi-Agent LLM Systems Fail?, Mert Cemri+ ...
[48] https://www.augmentcode.com/guides/why-multi-agent-llm-systems-fail-and-how-to-fix-them?trk=article-ssr-frontend-pulse_little-text-block — Multi-Agent AI Systems: Why They Fail and How to Fix Coordination Issues (2026)
[49] https://sites.google.com/berkeley.edu/mast/home — MAST
[50] https://christophermeiklejohn.com/ai/agents/mas-series/2026/04/27/mas-series-04-wave-two.html — Getting Up to Speed on Multi-Agent Systems, Part 4: Wave ...
[51] https://openreview.net/pdf?id=MqBzKkb8eK — [PDF] Why Do Multi-Agent LLM Systems Fail? - OpenReview
[52] https://arxiv.org/html/2305.05176v1 — FrugalGPT: How to Use Large Language Models While Reducing ...
[53] https://github.com/liatrio-labs/claude-code-gauntlet/blob/main/docs/research/artifacts/12-model-routing-for-code-review.md — Model routing in AI code review: more intuition than evidence
[54] https://neuraltrust.ai/blog/llm-model-routing — LLM Model Routing: Route Queries to the Right Model ...
[55] https://gpusmith.com/articles/en/pdfs/small-vs-large-model-routing-cost-model.pdf — gpusmith.com › articles › enLLM Model Routing: Small vs Large Models Cost Model
[56] https://github.com/pastorsj/LLMRouting/blob/main/README.md — LLMRouting/README.md at main · pastorsj/LLMRouting
[57] https://arxiv.org/html/2607.07548v1 — Where Capacity Matters in Hierarchical Search Agents?
[58] https://www.tencentcloud.com/techpedia/147954 — How Multi-Agent Orchestration Works Delegation, Parallelism, and ...
[59] https://github.com/quanpan302/KB-engineering-handbook/blob/main/content/hld/part-9-ai-ml-system-design/04-multi-agent-orchestration.md — KB-engineering-handbook/content/hld/part-9-ai-ml-system ...
[60] https://huggingface.co/ML-Intern-lab/agent-swarms-lit-review — ML-Intern-lab/agent-swarms-lit-review · Hugging Face
[61] https://llmbenchmark.ai/models/claude-haiku-5-5 — Claude Haiku 5.5 Benchmarks, Pricing & Specs (October 2026)
[62] https://www.anthropic.com/claude-sonnet-5-5 — Introducing Claude Sonnet 5.5
[63] https://llmlearner.com/models/claude-sonnet-5-5 — Claude Sonnet 5.5: Benchmarks, Pricing & Specs | LLMLearner
[64] https://apidog.com/blog/claude-sonnet-5-5-benchmarks/ — Claude Sonnet 5.5 Benchmarks: Anthropic's Numbers, Independent ...
[65] https://github.com/wsxiaoys/omsi/blob/master/sources/anthropic.com/claude-sonnet-5-5-system-card/2026-10-26.md — omsi/sources/anthropic.com/claude-sonnet-5-5-system-card/2026 ...
[66] https://klu.ai/benchmarks/terminal-bench-4 — Terminal-Bench 4.0 - Klu.ai
[67] https://www.vals.ai/benchmarks/terminal-bench-4 — Terminal-Bench 4.0 Leaderboard and Methodology
[68] https://benchlm.ai/models/claude-opus-5-5 — Claude Opus 5.5 Benchmarks, Pricing & Speed (October 2026)
[69] https://apidog.com/blog/claude-sonnet-5-5-vs-opus-5-5/ — Claude Sonnet 5.5 vs Opus 5.5: Half the Price, How Close ...
[70] https://llm-stats.com/models/compare/claude-haiku-5-5-vs-qwen3-coder-480b-a35b-instruct — Claude Haiku 5.5 vs Qwen3-Coder 480B A35B Instruct: Benchmarks, Pricing & Which Is Better in 2026
[71] https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence — Optimizing for cost and intelligence - Claude Platform Docs
[72] https://kingy.ai/blog/claude-sonnet-5-5-specs-benchmarks-pricing/ — Claude Sonnet 5.5 Review: Specs, Benchmarks, Pricing and Cost per Task
[73] https://apidog.com/blog/claude-haiku-5-5-benchmarks/ — Claude Haiku 5.5 Benchmarks - Apidog
[74] https://www.vals.ai/models/anthropic_claude-haiku-5-5 — Claude Haiku 5.5 Benchmarks, Cost and Capabilities
[76] https://arxiv.org/abs/2406.18665 — RouteLLM: Learning to Route LLMs with Preference Data - arXiv
[77] https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/ — Towards a science of scaling agent systems - Google Research
[78] https://www.semanticscholar.org/paper/RouteLLM:-Learning-to-Route-LLMs-with-Preference-Ong-Almahairi/9b3239cff17327960804098e33e1ca903e7b9e85 — [PDF] RouteLLM: Learning to Route LLMs with Preference Data | Semantic Scholar
[79] https://arxiv.org/html/2504.07113 — How Robust Are Router-LLMs? Analysis of the Fragility of LLM ...
[80] https://www.lmsys.org/blog/2024-07-01-routellm/?trk=article-ssr-frontend-pulse_little-text-block — RouteLLM: An Open-Source Framework for Cost-Effective LLM Routing
[81] https://theaitalks.org/talks/2026/0224/ — Towards a science of scaling agent systems
[82] https://arxiv.org/html/2512.08296v1 — Towards a Science of Scaling Agent Systems
[83] https://github.com/Liqs-v2/RouteLLM — GitHub - Liqs-v2/RouteLLM: A framework for serving and evaluating LLM routers - save LLM costs without compromising quality
[84] https://arxiv.org/audio/2406.18665 — Audio for 2406.18665v4
[85] https://ai-systems-2026.halla.ai/en/weeks/week-07/ — Week 7: Multi-Agent SDLC Design
[86] https://maxpool.dev/research-papers/scaling_agent_systems_report.html — Towards a Science of Scaling Agent Systems - Quantitative ...
[87] https://www.zartis.com/the-compounding-errors-problem-why-multi-agent-systems-fail-and-the-architecture-that-fixes-it/ — The Compounding Errors Problem: Why Multi-Agent ...
[88] https://github.com/ybkim95/agent-scaling — Towards a Science of Scaling Agent Systems
[89] https://aclanthology.org/2025.findings-acl.306.pdf — [PDF] Fine-tuned Judge Model is not a General Substitute for GPT-4
[90] https://aclanthology.org/2025.gem-1.33/ — Judging the Judges: Evaluating Alignment and Vulnerabilities ...
[91] https://news.ycombinator.com/item?id=49996437 — Claude Haiku 5.5 - Hacker News
[92] https://github.com/code-yeongyu/senpi/commit/a885f75a51cbed4390c71020d396ed862abe60da — feat(ai): open Claude Haiku 5.5 at its 100K price band (#2892) · code-yeongyu/senpi@a885f75
[94] https://platform.claude.com/docs/en/build-with-claude/compaction — Compaction overview - Claude Platform Docs
[95] https://seedrouter.ai/docs/claude-haiku-5-5 — Claude Haiku 5.5 | SeedRouter Docs
[96] https://newsletter.claudecodemasterclass.com/p/last-week-in-claude-code-7-haiku — Last Week In Claude Code #7 — Haiku 5.5, Idle Compaction, Hook ...
[97] https://platform.claude.com/docs/it/models/haiku-5-5/overview — Claude Haiku 5.5 - Claude Platform Docs
[98] https://news.ycombinator.com/item?id=50002254 — Haiku is basically useful to be called as a sub...
[99] https://www.linkedin.com/posts/neo-lky_haiku-45-dropped-4-hours-ago-and-ive-been-activity-7384344551320244225-wjCd — Haiku 4.5 review: fast, but needs clear prompts
[100] https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html — Claude Haiku 5.5 - Amazon Bedrock - docs.aws.amazon.com
[101] https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.md — AWS Documentation
[102] https://aws.amazon.com/blogs/machine-learning/introducing-claude-haiku-5-5-on-aws/ — Introducing Claude Haiku 5.5 on AWS | Artificial Intelligence
[103] https://docs.anthropic.com/en/docs/build-with-claude/context-windows — Context windows - Claude Platform Docs
[104] https://platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5 — What's new in Claude Haiku 5.5 - Claude Platform Docs
[105] https://news.ycombinator.com/item?id=47202787 — It's mainly that people on here, regardless of profession, speak ...
[106] https://www.anthropic.com/research/building-effective-agents — Building Effective Agents
[107] https://code.claude.com/docs/en/subagents.md — Create custom subagents
[108] https://artificialanalysis.ai/models/comparisons/claude-sonnet-5-5-high-vs-claude-opus-5-5-low — Claude Sonnet 5.5 (High, Default Fallback) vs Claude Opus 5.5 ...
[109] https://www.deeplearning.ai/the-batch/claude-fills-out-its-model-family — Claude Sonnet 5.5 and Haiku 5.5 Give Developers Fast ...
[110] https://code.claude.com/docs/en/agent-sdk/subagents — Subagents in the SDK - Claude Code Docs
[112] https://artificialanalysis.ai/models/comparisons/claude-sonnet-5-5-vs-claude-opus-5-5-high — Claude Sonnet 5.5 (Max, Default Fallback) vs Claude Opus 5.5 ...
[114] https://claude.com/resources/articles/building-agents-with-the-claude-agent-sdk — Building agents with the Claude Agent SDK | Claude by Anthropic
[115] https://artificialanalysis.ai/providers/anthropic — Anthropic: Models Intelligence, Performance & Price
[117] https://claude.com/resources/best-practices — Best practices | Claude by Anthropic
[118] https://code.claude.com/docs/en/sub-agents — Create custom subagents - Claude Code Docs
[119] https://artificialanalysis.ai/models/releases/claude-sonnet-5-5 — Claude Sonnet 5.5: Release Intelligence, Performance & Price
[120] https://code.claude.com/docs/en/best-practices — Best Practices for Claude Code
[122] https://www.anthropic.com/news/claude-sonnet-4-5 — Introducing Claude Sonnet 4.5 - Anthropic
[123] https://www.taskade.com/blog/claude-models-explained — Claude Models Explained (2026): Opus vs Sonnet vs Haiku
[124] https://docsbot.ai/models/compare/claude-haiku-4-5/gpt-5 — Claude Haiku 4.5 vs GPT‑5 - Detailed Performance & Feature ...
[125] https://docsbot.ai/models/compare/gpt-5-pro/claude-haiku-4-5 — GPT-5 Pro vs Claude Haiku 4.5 - DocsBot
[126] https://kunavo.com/guides/aider-prix — Aider Pricing: Free Software, Real API Bill · Kunavo
[127] https://claw.mobile/leaderboard — AI Coding Model Leaderboard — SWE-bench + Aider Rankings ...
[128] https://epoch.ai/data/charts/ai-capabilities-over-past-year/benchmark_scores.csv — benchmark_scores.csv
[129] https://the-decoder.com/anthropic-claims-to-lower-the-entry-barrier-for-advanced-ai-models-with-claude-haiku-4-5/ — Anthropic claims to lower the entry barrier for advanced AI models ...
[130] https://aiwiki.ai/wiki/aider_polyglot — Aider Polyglot - AI Wiki
[131] https://github.com/PatrickWiloak/ai-zero-to-hero/blob/main/explainers/benchmarks/agents-and-computer-use.md — Agents and Computer-Use Benchmarks
[132] https://failingfast.io/ai-coding-guide/benchmarks/ — AI coding benchmarks - Failing Fast
[133] https://www.codegpt.co/blog/anthropic-claude-models-complete-guide — Anthropic Claude Models Complete Guide - Sonnet 4.5 - CodeGPT
[135] https://techcrunch.com/2025/10/15/anthropic-launches-new-version-of-scaled-down-haiku-model/ — Anthropic launches new version of scaled-down 'Haiku' ...
[136] https://www.anthropic.com/claude/opus?= — Claude Opus 4.5 \ Anthropic
[137] https://www.anthropic.com/news/claude-opus-4-5 — Introducing Claude Opus 4.5
[138] https://www.benchleader.com/models/claude-opus-4-5 — Claude Opus 4.5: benchmarks, pricing, speed and rank (2026)
[139] https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-5.html — Claude Opus 4.5 - Amazon Bedrock - AWS Documentation
[140] https://platform.claude.com/docs/en/release-notes/system-prompts/claude-haiku-5-5 — Claude Haiku 5.5 system prompts
[141] https://www.datacamp.com/blog/claude-opus-4-5 — Claude Opus 4.5: Benchmarks, Agents, Tools, and More
[142] https://github.com/jakemanger/whatmodel/blob/main/pages/model/claude-opus-4-5.md — whatmodel/pages/model/claude-opus-4-5.md at main · jakemanger/whatmodel
[143] https://platform.claude.com/docs/it/release-notes/system-prompts/claude-haiku-5-5 — Prompt di sistema di Claude Haiku 5.5
[144] https://platform.claude.com/docs/en/resources/overview — Model cards - Claude Platform Docs
[145] https://www.anthropic.com/transparency?939688b5_page=1&_bhlid=c595d10ba7838789de6243d0af84e54335efee11 — Anthropic's Transparency Hub
[146] https://platform.claude.com/docs/en/models/haiku-5-5/overview — Claude Haiku 5.5 - Claude Platform Docs
[148] https://azure.microsoft.com/en-us/blog/introducing-claude-opus-4-5-in-microsoft-foundry/ — Introducing Claude Opus 4.5 in Microsoft Foundry
[149] https://docs.flora.ai/models/text-models/claude-opus-4.5-by-anthropic — claude-opus-4.5-by-anthropic
