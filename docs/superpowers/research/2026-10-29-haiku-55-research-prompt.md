Research question: where is Claude Haiku 5.5 (Anthropic's smallest Claude 5 model, 2026) reliably useful inside AI-agent software-development workflows, especially as a sub-agent under a stronger orchestrator (Claude Opus 5.5, Claude Sonnet 5.5 or Claude Fable 5.1) in Claude Code? I want evidence, not marketing.

Context: I build a JavaScript web app (Cesium globe, Vite, Node test runner, Prettier, Puppeteer-based browser QA scripts, a Node server). I plan features and write specs with a strong model, then implement with Opus 5.5 or Sonnet 5.5. I never use Haiku. I want to know which task types Haiku 5.5 handles reliably enough to delegate, which it does not, and whether delegating to it actually saves time and tokens once the overhead of briefing a sub-agent and reading its report is counted.

Please cover:

1. Reported, reliable use cases of Claude Haiku 5.5 (and, separately labelled, Claude Haiku 4.5 where 5.5 evidence is thin) in agentic coding: codebase search and exploration, reading and summarising files, running test suites and reporting failures, mechanical edits (renames, formatting, boilerplate, fixtures, data files), writing unit tests from a precise spec, documentation updates, log triage, PR description writing, reviewing diffs, classification and routing, structured data extraction, verifying another agent's claims. For each: who reports it, how it was measured (benchmark, A/B test, anecdote), and reliability caveats.

2. Known failure modes: where Haiku breaks (multi-file refactors, ambiguous specs, long context, tool-use loops, instruction drift over long sessions, hallucinated APIs, stopping early, over-confident reports), with sources.

3. Benchmarks and numbers: SWE-bench Verified, Terminal-Bench, tau-bench / tau2-bench, Aider polyglot, OSWorld, any agentic tool-use evals for Haiku 5.5 vs Sonnet 5.5 vs Opus 5.5 (and the 4.x generation for comparison), with price per million input and output tokens, output speed (tokens per second) and time-to-first-token, each with its date and source.

4. Orchestration patterns people actually use and report results for: Claude Code sub-agents with `model: haiku` in `.claude/agents/*.md`, "plan with Opus, execute with Sonnet or Haiku", fan-out exploration with Haiku, Haiku as verifier or judge versus Haiku as implementer, Haiku for context compaction or summarising tool output, and the cost or time savings claimed (with numbers). Also the opposite: reports where delegation cost more tokens or time than one capable agent doing the job (briefing overhead, re-reading the same files, lossy handoffs, confident wrong reports), and any measured comparison of single-agent versus multi-agent on the same task.

5. Academic or industry papers: model cascades and routing (FrugalGPT, RouteLLM and successors), small-model delegation, multi-agent token overhead, "why do multi-agent LLM systems fail" style failure taxonomies, agent-as-judge and verifier results for small models, and anything from 2025 to 2026 on orchestrator-worker systems with heterogeneous model sizes.

6. Community and vendor sources: Reddit (r/ClaudeAI, r/ClaudeCode, r/LocalLLaMA, r/cursor, r/ChatGPTCoding), Hacker News, X/Twitter, Anthropic's engineering blog and docs (Claude Code sub-agents docs, "Building effective agents", the multi-agent research system post, Claude Code best practices), practitioner blog posts, newsletters, Discord summaries, YouTube transcripts if indexed.

Output: a structured report with
- an executive summary (ten lines at most);
- a table of task type × recommended model (Haiku 5.5 / Sonnet 5.5 / Opus 5.5) × evidence strength (measured / several independent anecdotes / single anecdote / none) × caveats;
- the failure-mode list;
- the benchmark and price table;
- the orchestration-pattern findings, with every measured token or time saving (or loss) quoted with its source;
- the paper list with one line each on what it found;
- an explicit section "what the evidence does not support".

Date every claim, name the model version exactly (Haiku 4.5 versus Haiku 5.5; do not blur them), cite URLs, prefer 2026 sources and include 2025 where nothing newer exists. Do not pad. Write "no evidence found" where that is the case rather than inferring.
