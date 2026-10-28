You are making the war monitor's news collection reliable again in this repo (God's Eye View, a CesiumJS globe OSINT app, vanilla JS + Vite + Node 24). Fifteen outlets (Reuters, AP, Times of Israel, CENTCOM and others) reach the app only through GDELT, whose search API returned rate limits and empty results on 2026-10-28. One Telegram channel's preview no longer parses. The design is agreed. Diagnose, build, verify, open a PR, and report. You are running overnight in the cloud; the owner is asleep, so don't stop to ask questions. Make the call the spec points to, and list your judgement calls in the PR.

Read first, in this order:

1. `docs/superpowers/specs/2026-10-28-news-collection-reliability-design.md`: the spec.
2. `docs/WAR-MONITOR.md` (transports, health, the `quiet` flag)
3. `server/providers/news/fetchers/gdeltDomain.js`, `fetchers/http.js`, `fetchers/text.js`, `fetchers/telegramPublic.js`, `server/providers/news/collector.js`, `server/providers/news/store.js`
4. `src/data/newsFetchers.test.mjs`, `src/data/newsProxy.test.mjs`
5. `docs/CODE-BOUNDARIES.md`, `scripts/package-boundaries.json`

Rules:

- A parallel cloud task is adding a World theater and owns `public/news/sources.json`, `public/news/theaters/` and `server/providers/news/digest/`. Don't edit them. Leave `server/providers/regional/news.js` (the cockpit's GDELT path) alone.
- Be polite to GDELT: at least 10 seconds between any two requests to its API while diagnosing, never a retry loop, and a size cap on every file download. Never scrape bot-protected sites.
- Node only. No new npm dependency for unzipping: write and test a small single-entry zip reader on top of `zlib.inflateRaw`.
- Verify the GKG 2.1 column layout and `lastupdate.txt` format against GDELT's own documentation or a real file before coding; don't rely on memory.
- Never merge or rebase onto `bilawalsidhu/gods-eye-view` (upstream). Work on your own branch from the fork's main and open a PR against `krybaby7/gods-eye-view` main. Don't merge it.
- Write tests first, with `*.test.mjs` beside the code like the rest of `src`. Match the surrounding code's comment density, naming and idioms.
- Run `npm test`, `npm run build`, `npm run format:check`, `npm run check:boundaries`, `npm run layer-token:check -- --base-ref origin/main`, plus the live collection check in spec section 7. Report actual output. If a test fails, say so first.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

The PR description must include, in plain words for a non-technical owner:
- what was wrong;
- the diagnosis results with timestamps;
- which path you chose and why;
- a per-outlet table from the live check (outlet, items found, or why none);
- the measured download sizes per file and per day;
- what happened with Telegram;
- test results;
- your judgement calls;
- what wasn't verified.
