You are building Phase A of the Situation Brief in this repo (God's Eye View, a CesiumJS globe OSINT app, vanilla JS + Vite + Node 24). The Brief is the app's "political view": a card at the top of the war monitor's Situation panel that explains a whole crisis in under two minutes (what changed, who is involved, why now, who is affected, which way it is moving, what could come next, what is poorly known). A second Perplexity call writes it after each successful digest, and every sentence must cite stories; code drops any sentence that does not. The design is agreed. Your job is to build it, verify it, and report back.

Read first, in this order:

1. `docs/superpowers/specs/2026-10-28-situation-brief-design.md`: the spec (screen, data, run protocol, UI, rules, phases, tests). It is untracked in the main checkout at `C:\Users\adami\projects\Hobby\Tier 1\gods-eye-view\docs\superpowers\specs\2026-10-28-situation-brief-design.md`; copy it, and this prompt (`docs/superpowers/plans/2026-10-28-situation-brief-prompt.md` beside it), into your worktree and make them the branch's first commit.
2. `docs/WAR-MONITOR.md` and `docs/superpowers/specs/2026-10-25-war-monitor-design.md`: the war monitor the Brief builds on (item and story records, code-owned fields, digest protocol, budget).
3. `server/providers/news/digest/runner.js`, `digest/stories.js`, `digest/store.js`, `server/providers/news/index.js`, `public/news/theaters/iran-israel-us.json`
4. `src/ui/situationPanel.js`, `src/ui/situationPanelModel.js`, `src/layers/news/` (`index.js`, `records.js`, `source.js`)
5. `docs/CODE-BOUNDARIES.md`, `docs/panel-surfaces.md`, `scripts/package-boundaries.json`, `scripts/qa-news.mjs`

Owner decisions (2026-10-28). Do not reopen them:

- The Brief lives at the top of the Situation panel (between the Refresh controls and the category chips). No new mode, no HUD or camera takeover. Lenses stay as they are.
- Spec section 7, decided as recommended: the Brief runs after every successful digest in the same Refresh (plus a Retry brief button only after a failed Brief); development stories get no pin; 12 to 16 actors for this theater.
- The model writes text, track states, horizons and citations. Code owns citation checks, the Coverage line, verification labels, the "new since your last visit" marker and the AI-analysis label. A line with no valid story id is dropped; a Brief with no valid headline is rejected and the previous one stays.
- Never: crisis scores, tension percentages, health bars, two coloured teams, rolling casualty counters, sounds, winning or losing language, or probabilities (spec section 8).
- You draft the Iran / Israel / US actor list and the three drivers in the theater file. Roles only record what is not in dispute; who backs whom is Phase B. The owner reviews the list before merge, so put it in the PR description too.

Facts measured on 2026-10-28 that the spec relies on:

- The digest posts to `https://api.perplexity.ai/v1/agent` with `anthropic/claude-sonnet-5-5`, `tools: []`, `max_steps: 1`, strict JSON schema, `max_output_tokens: 64000`, and a 15-minute timeout. Reuse `callDigestModel`, `responseCost` and `worstCaseCost`-style handling for the brief call; don't write a second HTTP client.
- Hidden reasoning (about 3,000 to 3,700 tokens per call) counts toward `max_output_tokens`, so the brief call uses 16,000, not 4,000.
- Two live digests cost $0.34 and $0.40, mostly from Perplexity's cache-write charge on the input. Expect a brief at about 10 to 15 cents. Brief runs go into the same run log with `kind: "brief"` (old records read as `"digest"`) so the existing daily budget covers both.
- A response with `status: "incomplete"` fails as `truncated` and keeps its cost; do the same for the brief.

Git and workspace:

- `origin` is the owner's fork `krybaby7/gods-eye-view`; `upstream` is `bilawalsidhu/gods-eye-view` (read-only). Never merge or rebase onto upstream.
- The main checkout has uncommitted imagery-clarity work (`src/maps/`, `src/mapStackChips*`, `src/voice/`, `src/keySetupCore.mjs`, `server/providers/openai/` and others). Never touch or commit it. Work only in your own worktree on a branch named for this feature.
- Run `npm install` if `node_modules` is missing. Use a dev-server port other than 5173 and 5199.
- This machine has no global git identity. Commit with `git -c "user.name=Adam Ifrene" -c user.email=adamifrene@gmail.com commit ...` and end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't change git config.
- The Perplexity key is saved only in `C:\Users\adami\projects\Hobby\Tier 1\gev-wm-review\.env`. If you need it, copy that file into your worktree; never print, log or commit a key.

How to work:

- After reading, post a short plan in chat (at most 8 steps) and wait for the owner's go.
- Build the pure parts first, test-first, with `*.test.mjs` beside the code like the rest of `src`: theater validation for `actors`, `drivers`, `tracks`; digest `kind` and `actorIds`; brief schema, input assembly and validation; the Coverage line. Cover every case in spec section 10.
- Then the run protocol (brief after a successful digest, budget check, failure keeps stories, Retry brief), storage and the `GET /api/news` fields, then the panel section, actor filter, new-since marker and Frame theater. Register new modules in `scripts/package-boundaries.json`.
- Match the surrounding code: its comment density, naming and idioms. Check the panel in the Cyber theme and at 720 px and 390 px, per `docs/panel-surfaces.md`.
- Phase B and C items (event cards over the globe, actor relationship arcs, ReliefWeb figures, voice, the turning-points timeline) are out of scope. If one looks necessary, say so in one line.

Verification. Report the actual output, not a summary of what should happen:

- `npm test`, `npm run build`, `npm run format:check`, `npm run check:boundaries`, `npm run layer-token:check -- --base-ref origin/main`. On Windows the "Codex login resolves an installed executable" test already fails on main; say so if it is the only failure, and run the two allocation suites (`src/data/focusAllocations.test.mjs`, `src/overlays/worldOverlayAllocation.test.mjs`) by hand with `node --expose-gc --test --test-concurrency=1`, since the runner stops before them after a failure.
- Extend `scripts/qa-news.mjs --fixtures` with a fixture Brief: collapsed and expanded, every line opening its stories, the actor filter with category toggles, the new-since marker, a failed Brief with Retry, Cyber theme, 720 px and 390 px with no horizontal scroll. Take screenshots.
- One live Refresh (digest plus brief, about 50 to 60 cents) only after the owner says yes. Record the brief's cost, tokens, reasoning tokens, and how many lines code dropped.

Standing rules:

- If a test or check fails, say so first, with the output.
- Commit on your branch as you go. Push and open a PR against the fork's main when everything passes; don't merge it.
- End with a short report: what was built, test and QA results, the live run's numbers (or that it wasn't run), the actor list and drivers for review, and anything not verified.
