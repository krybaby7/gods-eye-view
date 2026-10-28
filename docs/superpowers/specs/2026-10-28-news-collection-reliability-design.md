# News collection reliability: GDELT outlets and Telegram

Date: 2026-10-28. Status: design, agreed with the owner, not built. Overnight cloud task.
Builds on `docs/WAR-MONITOR.md` and `2026-10-25-war-monitor-design.md`.

## 0. Shape in one paragraph

The war monitor reaches 15 outlets only through GDELT, among them Reuters, AP, Times of Israel,
Al Arabiya, ISW and, since 2026-10-28, CENTCOM. On 2026-10-28 GDELT's DOC 2.0 search API
answered with HTTP 429 even at 10 to 20 seconds between requests, and with zero articles even
for a plain `Israel` query over 24 hours. So those 15 outlets deliver nothing. One of the two
Telegram channels also fails with "preview markup not found". This task makes those outlets
deliver again: first diagnose, then switch the `gdelt-domain` transport to GDELT's
15-minute data files if the search API stays unusable, and fix the Telegram parser.

## 1. Decisions (owner, 2026-10-28)

- Collection stays free, Node only, with no new database and no scraping of bot-protected sites.
- The `gdelt-domain` transport keeps its name and its registry fields (`transport.domain`), so
  `public/news/sources.json` and the theater files need no change. Only how it fetches changes.
- The cockpit's regional news (`server/providers/regional/news.js`) keeps its own GDELT path.
  Leave it alone.

## 2. Step 1: diagnose and record

From the cloud machine, spacing every request at least 10 seconds apart:

- One plain DOC query (`query=Israel&mode=artlist&format=json&timespan=24h`). One
  `domainis:reuters.com` query. One of the app's grouped queries, built with
  `buildGdeltDomainQuery`. Record the status, the body's first 100 characters and the article
  count for each.
- `http://data.gdeltproject.org/gdeltv2/lastupdate.txt` and its translation twin
  (`lastupdate-translation.txt`): record the GKG file names, their sizes, and how old the newest
  file is.

Put the findings in the PR. If the DOC API works again and returns articles for most
`gdelt-domain` outlets, say so. Keep the current transport, add only the hardening in section 4,
and skip section 3.

## 3. Step 2: the 15-minute file path (if DOC is still unusable)

GDELT 2.0 publishes a Global Knowledge Graph (GKG) file every 15 minutes, with no search API and
no per-IP query limit. Each row is one article: its URL, its outlet's domain, a timestamp and,
in the extras XML, the page title. Verify the column layout against GDELT's GKG 2.1 codebook
before coding; don't rely on memory.

- **Reading the file**
  - Read `lastupdate.txt`. When the GKG file there is newer than the last one processed,
    download it with a size cap (fail the cycle cleanly above the cap) and unzip it in
    memory.
  - Node's `zlib` handles deflate but not the `.zip` container. Write a small tested
    single-entry zip reader (local file header plus `inflateRaw`) rather than adding a
    dependency.
  - Stream or split the rows. Keep only rows whose URL host is, or is a subdomain of, a
    `gdelt-domain` source's `transport.domain`. Collect that domain set across every theater's
    sources.
- **Turning rows into items**
  - Each matching row becomes a candidate through the existing `candidate()` helper: title
    from the page title (decode entities), URL, `publishedAt` from the row's timestamp, no
    snippet.
  - Apply the theater's `gdeltTerms` as a case-insensitive title filter when the theater has
    terms, as the DOC query did. A row with no title is dropped.
- **Non-English outlets.** Measure whether the translation stream (`lastupdate-translation.txt`)
  adds items for the registered outlets (Arabic, Persian or Hebrew editions). Include it if it
  does, and record the extra size.
- **Cadence and memory**
  - Keep the existing 15-minute cadence.
  - On first start, read at most the last 4 files (one hour) to seed.
  - Remember the last processed file name in the existing disk cache so a restart doesn't
    reprocess. Never hold more than one file's rows in memory at once.
- **Health:** each `gdelt-domain` source reports `ok` and a `count` per cycle, as today. A
  download or parse failure marks every GDELT source with one clear error (`GDELT files: ...`).
  The `quiet` flag from PR #4 keeps working.
- **Bandwidth:** log each cycle's download size, and put measured numbers in the PR: bytes per
  file, and bytes per day if the app runs 24 hours. Add an env var
  `NEWS_GDELT_FILES=off` to fall back to the DOC path.
- **Code:** a new `server/providers/news/fetchers/gdeltFiles.js` plus the zip helper. Switch
  the `gdelt-domain` case in `server/providers/news/collector.js` to it, keeping the DOC fetcher
  as the fallback. Register new modules in `scripts/package-boundaries.json`.

## 4. Hardening, whichever path wins

- **DOC path:** after a 429, back off for at least 15 minutes for the whole queue, not just the
  next request. Never send more than one DOC request per 15-minute cycle per group.
- Neither path ever retries in a tight loop.

## 5. Telegram

One of the two `telegram-public` channels (`t.me/s/<channel>`) fails with "preview markup not
found".

- Fetch both channels' preview pages, find what changed, and update
  `server/providers/news/fetchers/telegramPublic.js` so both parse.
- Add a fixture test from the new markup and keep the old one passing.
- If a channel no longer has a public preview, say so in the PR and leave its registry entry
  alone; the owner decides.

## 6. Out of scope

- Any change to `public/news/sources.json` or the theater files: a parallel task (the World
  theater) owns them.
- The digest, the Brief, the panel, the news layer.
- The cockpit's regional news.

## 7. Tests and verification

- **Unit tests:**
  - the zip reader (stored and deflated entries, a corrupt file);
  - GKG row parsing from a small fixture taken from a real file (a few rows, trimmed), where
    title, URL, domain matching (including subdomains) and timestamp all come out right;
  - the terms filter;
  - "only newer files" and the 4-file seed;
  - the size cap;
  - error health;
  - the `NEWS_GDELT_FILES=off` fallback;
  - the 429 backoff.
- **Live check from the cloud machine:** run one collection cycle with the real files and record
  which `gdelt-domain` outlets returned items and how many. Done when most of them return items,
  or when the PR explains per outlet why not (for example, GDELT doesn't index that outlet).
- **Checks:** `npm test`, `npm run build`, `npm run format:check`, `npm run check:boundaries`,
  `npm run layer-token:check -- --base-ref origin/main`.
