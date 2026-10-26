# Hand-off prompt: implement War monitor Phase 1 (collect, digest, map)

Copy everything below the line into a new chat opened in `C:\Users\adami\projects\Hobby\Tier 1\gods-eye-view`.

---

Implement Phase 1 of the war monitor feature in this repo (God's Eye View, a CesiumJS globe OSINT app, vanilla JS + Vite + Node 24). The feature has three parts: collect news items from a curated source directory continuously and for free; on a Refresh press, run one Claude Sonnet 5.5 digest through Perplexity's Agent API that turns the new items into stories; draw one pin per located story on the globe with category toggles and a right-rail Situation panel.

Read these first, in order, and treat them as the spec:
1. docs/superpowers/specs/2026-10-25-war-monitor-design.md (item and story records, which fields the model owns and which code owns, the digest run protocol, UI, decisions in section 9)
2. docs/superpowers/plans/2026-10-25-war-monitor-phase1.md (the task list; work top to bottom, ticking boxes as you go)
3. docs/superpowers/specs/2026-10-25-news-integration-options.md section 1 (which existing files are the templates)
4. docs/CODE-BOUNDARIES.md, docs/panel-surfaces.md, scripts/package-boundaries.json

Templates to copy patterns from, not to modify: src/layers/earthquakes (smallest layer), src/layers/firms + server/providers/firms.js (keyed proxy with disk cache, click selection, context registration), src/layers/recentImagery + src/ui/recentImagery.js (right-rail panel driven by getSnapshot/subscribe), server/providers/regional/news.js (existing RSS and GDELT code; move its RSS parser into a shared module and keep the regional provider working), src/voice/layerManifest.js and src/voice/gevActions.js.

Decisions already made, do not reopen them:
- Personal non-commercial app. Node only. No Python, no Supabase, no new database.
- Collect runs on timers; the digest runs only when the user presses Refresh or says "refresh news". Never call the model on a timer.
- The digest call is Perplexity Agent API, model anthropic/claude-sonnet-5-5, no effort preset, empty tools, max_steps 1, max_output_tokens 16000, strict JSON schema output. Verify the exact field names for schema output and for disabling tools against docs.perplexity.ai before writing code; do not guess. Read usage.cost.total_cost from each response and enforce NEWS_DIGEST_DAILY_BUDGET_USD (default 2.00). Add a perplexity entry to KEY_SETUP_KEYS in src/keySetupCore.mjs so the key is entered through Provider Settings. Never log the key or request bodies.
- The model owns story title, summary, category, place name, event time, cited item ids, claims, what's new and contradictions. Code owns coordinates (gazetteer first; model lat/lon only when no gazetteer match, flagged model-placed), perspectives, source count and verification labels. The model never returns URLs; every cited item id is validated against the store. Corroborated is computed by code only, per the design's rule.
- One pin per story, never per item. Stories without a location are list-only and counted. Unassigned items stay visible in the Raw feed tab.
- Telegram public previews (t.me/s/<channel>) are an allowed transport. ReliefWeb is enabled only when RELIEFWEB_APPNAME is set. Bot-blocked outlets are never scraped; they come through GDELT domainis: queries through one global queue with 5.5 s spacing and 429 backoff. Google News RSS stays confined to the cockpit fallback.
- World text labels go through the overlay host; Cesium labels are forbidden (src/noCesiumLabels.test.mjs).

Seed values for the gazetteer (country and city centroids, strategic sites, airports with IATA codes, FIRs, location hints) and the X handle tiers are in docs/superpowers/plans/2026-10-25-war-monitor-seeds.json. Build the theater gazetteer from that file plus your own additions for Gaza, Lebanon and Iranian localities; coordinates there are approximate and should be spot-checked. No other external folder is needed.

Working rules:
- The working tree on main has uncommitted imagery-clarity changes in src/maps/*, src/mapStackChips*, src/voice/actionSchemas*, src/keySetupCore.mjs, server/providers/openai/* and a few others. Create a branch feat/war-monitor-phase1 and do not commit those pre-existing changes. You will need to edit src/keySetupCore.mjs, src/voice/actionSchemas.js, src/voice/actionSchemas.test.mjs and server/providers/openai/toolDescriptions.js; keep your edits in those files minimal and stage only your hunks.
- Tests are node:test files next to the code, run with npm test. Write the failing test first for each task, then implement. The story computation functions (verification rules, location resolution, id continuity) must be pure and fully covered.
- Before finishing: npm test, npm run build, npm run format:check, npm run check:boundaries, npm run layer-token:check all green; run the new scripts/qa-news.mjs --fixtures; check the panel in default and Cyber themes and in Cockpit; run one real digest against the live Perplexity key and record its cost in the PR.
- Every new source needs a DATA_CREDITS entry and a DATA_SOURCES.md row. Keep the existing disclaimer wording: headlines and stories are reporting, not verified incidents or risk rankings.
- Commit in task-sized commits with clear messages. Open a PR titled "feat(news): war monitor phase 1 (collect, digest, map)" summarising what works, what is behind a key, the measured digest cost, and what was verified.

Deliverable: a news layer in the Events group drawing one pin per located story with category toggles and overlay cards; a Situation panel with Refresh, the digest line, Stories and Raw feed tabs, story rows that expand to their cited items; the refresh_news voice action and analyst queries over stories; credits and docs; all tests green.
