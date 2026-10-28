You are building the World theater in this repo (God's Eye View, a CesiumJS globe OSINT app, vanilla JS + Vite + Node 24): a second war-monitor theater that collects political news from every continent and places it on a worldwide gazetteer, so the owner can pick "World" in the Situation panel and see political news worldwide. The design is agreed. Build it, verify it, open a PR, and report. You are running overnight in the cloud; the owner is asleep, so don't stop to ask questions. Make the call the spec points to, and list your judgement calls in the PR.

Read first, in this order:

1. `docs/superpowers/specs/2026-10-28-world-theater-design.md`: the spec.
2. `docs/WAR-MONITOR.md`, then `docs/superpowers/specs/2026-10-25-war-monitor-design.md` and `docs/superpowers/specs/2026-10-28-situation-brief-design.md` for background.
3. `public/news/sources.json`, `public/news/theaters/iran-israel-us.json`, `server/providers/news/registry.js`, `server/providers/news/geocode.js`, `server/providers/news/digest/runner.js` (`buildDigestInstructions`), `server/providers/news/digest/brief.js`, `server/providers/news/index.js`
4. `src/ui/situationPanel.js`, `src/layers/news/`, `scripts/qa-news.mjs`, `src/data/newsCredits.test.mjs`, `src/data/dataCredits.js`, `DATA_SOURCES.md`
5. `docs/CODE-BOUNDARIES.md`, `scripts/package-boundaries.json`

Rules:

- A parallel cloud task is rewriting the GDELT transport. Don't edit `server/providers/news/fetchers/` or `server/providers/news/collector.js`. Don't change `iran-israel-us.json`.
- Never scrape bot-protected sites or use Google News RSS. Headline, snippet, link and publisher only. Probe every feed you add and record its newest entry date.
- The cloud machine has no Perplexity key: don't attempt a live digest. Verify with fixtures and report estimated input tokens and cost per World Refresh.
- Never merge or rebase onto `bilawalsidhu/gods-eye-view` (upstream). Work on your own branch from the fork's main and open a PR against `krybaby7/gods-eye-view` main. Don't merge it.
- Write tests first for the code changes (prompt gazetteer flag, `situationBrief` flag, geocoding fixtures), with `*.test.mjs` beside the code. Match the surrounding code's comment density, naming and idioms.
- Run `npm test`, `npm run build`, `npm run format:check`, `npm run check:boundaries`, `npm run layer-token:check -- --base-ref origin/main`, and `scripts/qa-news.mjs --fixtures` (use the machine's Chromium via `PUPPETEER_EXECUTABLE_PATH` if needed). Report actual output. If a test fails, say so first.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

The PR description must include, in plain words for a non-technical owner:
- what changed;
- the source table (name, region group, kind, transport, newest entry date);
- the category colours;
- the gazetteer counts (countries, capitals, cities, hotspots) and how many aliases were dropped as ambiguous;
- the World instruction size and estimated cost per Refresh;
- test and QA results;
- your judgement calls;
- what wasn't verified.
