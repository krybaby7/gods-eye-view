# Prompt: World Board fix round after the first live run

Paste everything below the line as the first message of a fresh Codex session. Open the session in
`C:\Users\adami\projects\Hobby\Tier 1\gev-world-board`, use GPT 6.1 Sol as the orchestrator, and give it
full access with no approval prompts.

---

You are fixing what the first live run of the World Board showed. The board was built overnight as PR #17
(phase 1) and PRs #18 to #22 (phases 5, 2, 3, 4 and 6). PR #23 is the combined test branch. The code
gates pass and the fixture QA passes. The live board, though, is thin: on the owner's PC, the first
launch took 9½ minutes, and 12 of 41 sources failed.

Fix the problems below on the branch each one belongs to, prove each fix live, then rebuild the test
branch. Don't ask questions. Decide, record the judgement call and keep going. Claude reviews the result
against the spec afterwards.

## Read first

1. Claude's evidence from the live check, in
   `C:\Users\adami\projects\Hobby\Tier 1\world-board-downloads\claude-check-2026-11-09\`:
   - `notes.md`;
   - `first-launch-turn.json`, the per-source result of the first turn;
   - `first-launch-state.json`, the whole saved board;
   - `wikidata-people-query-repro.mjs`.
2. The overnight report, `C:\Users\adami\projects\Hobby\Tier 1\world-board-overnight-report.md`.
3. The overnight prompt, `C:\Users\adami\projects\Hobby\Tier 1\world-board-overnight-prompt.md`. Its
   sections "Rules for every phase", "Sub-agents", "Safety rules for the night", "Gates" and "Each PR
   description" all apply to this round.
4. The spec, `docs/superpowers/specs/2026-11-08-world-board-design.md`, for the sections named below.

## The PC this runs on

The owner's connection is a home 4G router:

- **Bandwidth:** curl measured 0.32–0.50 MB/s.
- **IPv6 is broken.** `curl -6` fails at once; IPv4 works. Node's `fetch` reached Wikidata fine from a
  shell, so IPv6 may or may not explain the `ETIMEDOUT` errors inside the dev server. Find out; don't
  assume.

The board must work on this connection. Treat slow, flaky networks as the normal case.

## Order of work

1. **Phase 1 first:** the shared download fixes, on `codex/world-board-phase-1` in this worktree. Push.
2. **Bring them into each phase.** Merge `codex/world-board-phase-1` into each phase branch, in its own
   worktree (`gev-wb-phase-2` to `gev-wb-phase-6`). Use merge commits, never rebase or force-push.
3. **The phase fixes,** in parallel, at most three at a time. Each phase also moves its bulk adapters
   onto the phase 1 download helper. Those adapters include Voeten, the sanctions lists, WRI,
   OurAirports and BACI, and each has its own timeout today.
4. **Rebuild the test branch.** Merge each updated phase branch into `codex/world-board-test-all`, in the
   order 2, 3, 5, 4, 6.
5. **One fresh live first launch** on the test branch, as described below.
6. **Update the PRs and the report.**

**Hard stop:** 6 hours after you start. Anything unfinished then becomes a "Where I stopped" note in its
PR.

## 1. Phase 1 (PR #17): downloads that survive a slow connection

The source runner treats a slow download as a failed one. The first launch also blocks the board until
every source has finished.

- **Stall timeouts, not total deadlines.** For bulk downloads, fail only when no bytes have arrived for
  about 60 seconds. Keep a generous overall cap, around 30 minutes, as a safety net. Small API calls keep
  short deadlines.
- **Keep what was downloaded.**
  - Store bulk files under `.gev-cache/world/downloads/`, with their ETag, Last-Modified and size.
  - Reuse a complete file on later turns until the source has a new release.
  - Resume a partial file with HTTP Range where the server supports it.
  - Show the progress line in bytes for big files, for example "V-Dem · 12 / 27 MB".
- **Show the board early.**
  - The first launch saves and shows the board as soon as the phase 1 base sources have loaded.
  - The heavy sources then continue in the background and update the board when they land.
  - Spec section 5 still holds: one Refresh at a time, and one failure never fails the turn.
- **Run small sources in parallel.** Up to 4 at once, with at most one request at a time per host.
  Order the queue small to large.
- **The network failures.**
  - Reproduce the dev-server `ETIMEDOUT` errors.
  - If IPv6 causes them, make board fetches prefer IPv4, scoped as narrowly as you can, and say why.
  - Retry once on a connection error.
- **Tests first.** A fake stream that trickles bytes slowly must succeed. A stream that stalls must fail
  with a clear message. A resumed download must produce the same file. The early board must appear
  before the heavy sources finish.
- **V-Dem.**
  - With the stall timeout, the 27 MB file should download.
  - Parsing the 406 MB CSV must not block the server's event loop for long. Stream it.
  - Report the download time and the parse time.

## 2. Phase 5 (PR #18): the people directory is empty

The leaders query (`actorDirectoryUrl`) is a single 4,917-character GET covering every country and four
roles. Wikidata's query service gave no answer within 65 seconds, and the overnight run failed the same
way. People, portraits and posts are all empty as a result.

- **Split the query** by role, and by batches of about 40 countries.
- **Send it as POST.**
- **Be polite:** run the queries one after another, with a short pause between them.
  - Honour Retry-After on 429 and on 5xx.
  - Keep each query well under the service's 60-second limit.
- **Keep partial results.** Merge them, keep the countries that did load, and keep the last good
  directory when a later pull fails.
- **Prove it live:**
  - one full directory pull;
  - the count of heads of state and heads of government found, out of about 190 each;
  - the duration;
  - then portraits, Bluesky, YouTube and government RSS for the first 10 actors.

## 3. Phase 4 (PR #21): no assets on the globe

- **NGA ports.** The adapter calls `msi.om.east.paas.nga.mil`, which has no public DNS record. Find the
  working public World Port Index download and verify it live. If there isn't one, say so, and the
  ports wait.
- **WRI, OurAirports, Wikidata assets.**
  - Rerun them with the phase 1 download fixes.
  - Split the Wikidata asset queries the same way as the people query.
  - The OurAirports site failed TLS from this PC, and the GitHub mirror works but is slow. Use whichever
    works, and record it.
- **Coordinates for the hand tables.** All 130 rows (80 foreign bases, 50 fabs) have no coordinates, so
  nothing reaches the globe.
  - Add coordinates only from a source: the item's Wikidata P625, or the operator's published address.
    Record the source per row.
  - Leave a coordinate blank when it can't be sourced.
  - Report the coverage you reached.
- **Country-level fallback.** An asset with a known host country but no exact site is still drawn. Put
  it at the country's label point, styled clearly as "exact site unknown", and include it in the
  Ownership lens lines. Never present it as a real location.
- **Foreign bases beyond the US.** The table is US-heavy. Extend it toward the spec's ~100 rows with the
  other countries that keep forces abroad, such as Russia, China, France, the UK, Turkey, India and the
  UAE. Every row needs a source, and the hand-table rules apply.

## 4. Phase 2 (PR #19): the Energy lens is unknown everywhere

The trade-route model was left out over the routing network's licences: ODbL, MPL-2.0 and EUPL-1.2.

- **This is already decided.** Spec 8.7 and the owner's answer to §13 point 2 allow ShareAlike and
  other marked sources while the app is personal and local. Mark the network data in `sources.json` and
  `DATA_SOURCES.md` with the same warning the cables carry.
- **Build the model as spec 8.2 says:**
  - BACI 2024 for the four HS codes;
  - representative ports;
  - routing;
  - chokepoint tagging;
  - calibration against the EIA totals, reporting the gap for each chokepoint;
  - both denominators;
  - the "modelled, not a published statistic" label.

  It is a build-time job, and only its compact output is committed.
- **BACI size.** Check the BACI file size first. On this connection a large file can take an hour, and
  that is acceptable for a one-time build step. If the file you need is over 2 GB, stop that piece and
  report the size.
- **PortWatch stays gated.** The owner is deciding whether to ask the IMF for permission. Don't change
  that.
- **Prove it.** Japan's and India's Exposure tabs show real modelled shares, with their denominators and
  assumptions. The Energy lens colours most importers.

## 5. Phase 3 (PR #20): voting alignment and two sanctions lists

- **Voeten** (up to 170 MB). With the phase 1 fixes it should download once per release. Confirm that
  it loads, and report the time.
- **UK and OFAC sanctions timed out.**
  - Use the smallest official file that still has the programme field.
  - Verify both live, and report the programme counts.

## 6. Phase 6 (PR #22): noisy and broken feeds

- **Conflict-death flags are too noisy.** 83 countries are flagged, some at 0.03 deaths per million.
  - Flag only at 25 or more recorded deaths in the rolling 12 months. That is UCDP's own conflict
    threshold.
  - Mark the threshold draft.
  - Report the new count.
- **GDELT** fails with "manifest timestamp outside the sampling window". Fix the window, so a few
  missed 15-minute files don't fail the source. Verify it live.
- **IMF monthly CPI** found no mapped series. Find the correct keyless series and verify it. If there
  isn't one, turn the flag off and say so.

## Live calls in this round

Diagnosis and proof need live requests, and that is allowed:

- free, keyless sources only;
- requests one after another, per host;
- no tight loops;
- Retry-After honoured;
- a User-Agent with no personal data.

Never call paid services, use keys, create accounts, request emailed downloads, or press any Claude or
Perplexity Refresh.

## The fresh live first launch

On the rebuilt test branch, run one first launch with an empty cache, as the owner would.

- **Port 5190.** The owner may be testing from `gev-wb-test-all` on port 5189, so leave that dev
  server alone.
- **Cache.** Use a separate cache directory. Never delete the owner's `.gev-cache` in `gev-wb-test-all`.
- **Report:**
  - the time until the board first shows;
  - the time until every source has finished;
  - the total megabytes downloaded;
  - the result of each source.

**The target:** every free keyless source loads, and the board shows within about 2 minutes. The only
sources that may stay off are those waiting on the owner: PortWatch, the keyed feeds and Global Energy
Monitor.

Then take screenshots on the live data:

- India's Condition and Strength tabs;
- the Diplomacy lens on India;
- the Energy lens;
- Ownership on China;
- India's People tab;
- the Hormuz card.

## Report

For each PR, add a "Fix round" section to its description with:

- what changed;
- the live proof, with counts and times;
- the gate output.

Append a "Fix round" section to the overnight report, ending with a table: each PR, its verdict, and
what the owner must still do.

End your final message with that table and the PR #23 link.
