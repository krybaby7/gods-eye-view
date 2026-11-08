# World Board: actor profiles and X (research, 2026-11-08)

Track D. Facts checked on 2026-11-08. Items seen only in search snippets are marked "(snippet)". I ran read-only requests only: no accounts, no keys, no scraping of x.com.

## Summary

- X API: pay-per-use is now the default (launched 2026-02-06). Reading a post costs $0.005. There is no free read tier. Free and Basic were closed or migrated (snippet). Cost to keep about 200 actor timelines fresh: roughly $30 to $300 a month depending on refresh rate (my estimate, see section 1).
- Free display: the official oEmbed endpoint for a profile timeline still answers without a key, but the widget is login-gated for viewers and unreliable, so do not build the product on it. A single-post oEmbed for a real post id was not tested (the dummy id I used returned an X error page).
- Wikidata: of 191 current heads of government of sovereign states, 101 (53%) have an X username, 98% have an image, 6% a Telegram channel, 6% a Bluesky handle. Ministers via position items: 65 of 121 (54%) with X. Official websites are sparse (23%) on head-of-government items.
- Best fit: use Wikidata as the actor directory, show profile cards from Wikidata plus official feeds (YouTube RSS, Bluesky, Mastodon, government RSS), and show X as a link plus an optional embed button. Add paid X API reads later only if the owner wants it.
- Biggest policy cautions: X forbids training foundation models on X content and requires deletion mirroring within 24 hours. Telegram's terms now prohibit scraping for AI use (the app already scrapes t.me/s/, so this needs a decision).

## 1. X API

Source: docs.x.com pricing page (fetched).

- Model: pay-per-usage, credit based, no subscriptions. Credits are bought up front in the Developer Console; a per-cycle spending limit can be set and requests block when it is reached.
- Cap: pay-per-usage plans are capped at 3 million Post reads per monthly billing cycle. Above that is Enterprise (no public price). One snippet source says 2 million; the official page says 3 million.
- Prices per resource: Post read $0.005; User read $0.010; Like read $0.001; DM event read $0.010; Post create $0.015 per request. "Owned reads" (your own authenticated account, such as `GET /2/users/{id}/tweets` for yourself) are $0.001, which does not help for reading other people's timelines. The page does not list a separate price for another user's timeline; the $0.005 Post read rate is the natural reading but the page does not confirm it.
- Dedup: all resources are deduplicated inside a 24-hour UTC day window (a soft guarantee), so re-reading the same post the same day should not bill twice.
- Free tier: no read access. The page only mentions free credits for new users. Snippets say the Free plan was effectively discontinued; existing free users were moved to pay-per-use with a one-time $10 voucher, with free API kept for "public utility" apps (snippet). Basic closed to new signups and auto-migrated from 2026-06-01; Pro migrates after 2026-09-01 (snippet). Treat the migration dates as unverified.
- Cost estimate (mine): 200 actors, 10 new posts per actor per day is 2,000 reads a day, about $10 a day or $300 a month. At 3 posts per actor per day it is about $90 a month. Fetching only the top 30 actors for a live situation would be about $15 to $45 a month. Add $0.01 per actor for the user lookup.

Developer Agreement and Policy (fetched docs.x.com/developer-terms/policy.md and agreement.md):

- Display: "maintain the integrity of all X Content that you display publicly"; respect protected and blocked status.
- Caching: stored X Content must be kept up to date with its current state on X. Deleted or modified content must be deleted or modified within 24 hours of a request from X or the account owner; content no longer available through the API must be removed as soon as reasonably possible. So a cache needs a periodic re-check job.
- Redistribution: do not sell or redistribute Licensed Material to third parties; no more than 1,500,000 Post IDs to any entity in 30 days. Displaying "a reasonable amount" of X Content to users of your service is allowed.
- AI: Section III.A(k) bars using the X API or X Content "to fine-tune or train a foundation or frontier model". Summarising or ranking posts with an LLM at runtime is not named, but it is a gray area; keep X text out of any training or stored evaluation sets and be cautious about piping it through the digest model.
- Non-commercial: if the service is designated non-commercial it may not make Commercial Use (ads, fees, sponsorship). Section III.L says pay-per-use access is for hobbyists, prototyping and apps with few end users; larger use needs Enterprise. A public hosted version with many users would outgrow this.
- Surveillance: Section XIV.B bars using X Content for surveillance, tracking individuals, or profiling people on sensitive personal information without written approval. A feed of public officials' own posts is not that, but do not add any "who does this person talk to" analytics.
- Off-X matching: linking an X identity to off-platform data needs the person's opt-in unless based on public data or what they provided themselves.
- Republishing content obtained other than through the X API or X tools needs express consent. The documents I could read do not use the word "scraping", but the effect is the same: only API, embeds and official tools are licensed. X also sent cease-and-desist letters to Nitter in 2026 (snippet, see section 2). The x.com Terms of Service page itself returned HTTP 402 to my fetch, so I could not quote its automated-access clause; assume scraping is prohibited.
- The developer.x.com pages returned HTTP 402 to automated fetches; I used docs.x.com instead.

## 2. Free display options

- oEmbed endpoint: `https://publish.x.com/oembed?url=...` needs no key. Tested 2026-11-08: a profile URL (`https://x.com/NASA`) returned JSON with `type: rich`, `provider_name: X` and html `<a class="twitter-timeline" href="https://x.com/NASA?ref_src=twsrc%5Etfw">Posts by NASA</a>`. That is only a stub link; the real content is drawn in the browser by `platform.twitter.com/widgets.js` (reachable, HTTP 200). A made-up status id (`/status/1`) returned an HTML error page, so single-post embeds need a real post id (not tested with a real one).
- Local web app: a localhost page can include the widget script and a `twitter-timeline` anchor. The embed license (Developer Agreement II.B) lets X crawl pages that embed posts or timelines. I did not render the widget (would hit x.com from a browser session), so whether it draws on localhost is not verified.
- Login: multiple sources report that embedded timelines need the viewer to be logged in to X since 2023, and a Discourse thread from October 2025 reports broken embeds (snippet). Expect blank boxes for logged-out viewers and for browsers that block cross-site tracking. Single-post embeds are more reliable than timelines (my understanding; not verified for Nov 2026).
- Reports of free-account restrictions on embedding timelines exist (a single WordPress forum post, snippet). Unconfirmed.
- Official RSS: none. X ended RSS long ago; nothing in the docs offers it.
- Nitter and mirrors: effectively dead. X sent cease-and-desist letters in August 2026; the repository was archived 2026-08-25; nitter.net was down and xcancel.com showed a suspension notice on 2026-09-30; a few small instances still work (snippets from Wikipedia, GetXAPI, TwitterAPI.io, mixed). Do not depend on them, and using them is the same off-API republishing problem.

## 3. Actor directory from Wikidata

Properties (verified label for P12361, P2002, P3789 via the Wikidata API; the rest from your brief and common knowledge, not re-checked):

| Need | Property |
|---|---|
| X username | P2002 |
| Telegram username/channel | P3789 |
| Bluesky handle | P12361 (verified: "Bluesky handle") |
| Mastodon address | P4033 |
| Facebook / Instagram / YouTube channel ID | P2013 / P2003 / P2397 |
| VK / Weibo | P3185 / P3579 |
| Official website | P856 |
| Head of state / government | P35 / P6 on the country item |
| Position held | P39 on the person, with start (P580) and end (P582) qualifiers |
| Officeholder | P1308 on the position item |
| Image | P18 |

Classes found by search: "foreign minister" Q7330070, "defence minister" Q2518691. Note that Q831411 is NOT a minister class (it is a museum); I used it by mistake at first. Sovereign state is Q3624078.

Test results (run 2026-11-08, HTTP 200, a few seconds each):

- Query A (below): current heads of government of non-dissolved sovereign states. 256 rows, 191 countries. With X username: 101 (53%). Telegram 8 (4%). Bluesky 12 (6%). Mastodon 1. Official website 43 (23%). Image 188 (98%). Some rows are officeholders with no end date but wrong (e.g. the Vatican row returned a Secretary General) and some countries have more than one row, so a real build needs de-duplication and manual review.
- Query B: holders of positions that are subclasses of foreign minister or defence minister, current (no end qualifier). 121 rows, 65 with X (54%). The row count is far below two ministers per country, so ministerial coverage of the position items is thin; expect to fill gaps with a curated list or a Wikipedia/Wikidata P39 query.
- Freshness: the X username is a current-value property; it can lag a new office holder by days to months and some entries carry old handles. Verify handle exists and name matches at fetch time. I did not measure handle staleness.
- Query Service rules (mediawiki.org User Manual, fetched): 60 s timeout per query; 60 s of processing per 60 s per client (User-Agent + IP); 5 parallel queries per IP; 30 failing queries per minute; HTTP 429 with Retry-After, repeat offenders may be banned; send a descriptive User-Agent or be blocked. Wikidata data is CC0, so no attribution is needed for the data. Cache results locally and refresh weekly.
- Images (P18 point to Wikimedia Commons files): licences vary per file (CC BY, CC BY-SA, public domain, some government works). To show attribution, call the Commons API (`action=query&prop=imageinfo&iiprop=extmetadata|url`) and store `Artist`, `LicenseShortName`, `LicenseUrl` and the file page URL; display "Photo: Artist, licence, Wikimedia Commons" under the portrait. Skip files whose licence is not free. (I could not fetch the Commons reuse guide page, 404; this approach is from general knowledge.)

## 4. Other platforms (keyless reading)

- Bluesky: public AppView at `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=HANDLE` works without auth (tested, returned JSON; profile lookup at `api.bsky.app/xrpc/app.bsky.actor.getProfile` also worked). Terms: the Bluesky Terms of Service say nothing about scraping or AI training (fetched); posts are public by design on an open protocol. Rate limits not verified here (the doc page redirected).
- Mastodon: public timelines and `/api/v1/accounts/lookup` plus `/api/v1/accounts/:id/statuses` are keyless on most instances; per-instance rules and rate limits (not verified here). Profile RSS at `https://INSTANCE/@user.rss` is usually on.
- Telegram t.me/s/CHANNEL: tested, returns HTML with posts (20 message blocks for @telegram). No key. Telegram's Terms now say Telegram "prohibits data scraping as part of its Content Licensing and AI Scraping Terms" and that this applies to all users, businesses and third-party services (fetched). The content licensing page, per a snippet, prohibits scraping, indexing, harvesting, aggregation or use of data for AI development, with exceptions for legitimate clients, bots and mini apps. The app's current t.me/s scraping, especially if fed to an LLM digest, is the risk; I could not read the full text of the licensing terms.
- YouTube channel RSS: `https://www.youtube.com/feeds/videos.xml?channel_id=UC...` keyless; tested, returned Atom XML. Standard YouTube API Services terms apply to the official API; the feeds are a widely used public feature, not a documented API (not verified).
- Official government RSS: keyless, usually permissive for news reuse with attribution; check each site. Many government sites also have press-release pages worth using for actors without social accounts.

## 5. Policy cautions

- X: pay-per-use is meant for hobbyists and small apps; training foundation models is banned; 24 h deletion mirroring; keep cached posts current; no commercial use under a non-commercial designation; no surveillance or profiling. Scraping x.com directly is not licensed.
- Bluesky: nothing blocking in the ToS I read.
- Telegram: scraping and AI-use language in the 2026 terms; the biggest existing exposure in the current codebase.
- Wikidata: CC0 data, User-Agent and rate rules. No blockers. Commons images need per-file attribution.
- Private individuals: list only public officials, official bodies and armed groups' public channels. Do not show accounts of private individuals, family members, or staff who are not public figures. Add an allowlist built from Wikidata positions and a "report/remove" path. Armed groups: some are on sanctions or terror lists; showing their public posts raises moderation and platform-ToS issues (e.g. X and Telegram bans), so treat them as a separate, optional layer and link rather than mirror.
- GDPR note (mine, not legal advice): public officials' official accounts are low risk; keep stored data minimal.

## Options for the app

1. Directory plus links only (recommended starting point). Build the actor list from Wikidata (weekly cache), show the portrait with Commons attribution, role, country, and buttons that open the X, Telegram, Bluesky, YouTube and website pages in a new tab. For actors with a Bluesky/Mastodon/YouTube/official RSS, show the latest few posts inline from those keyless sources. Cost $0. Effort: medium (SPARQL job, de-dup, card UI, Commons attribution). Terms risk: low.
2. Option 1 plus an on-demand X embed. A "Show X timeline" button inserts the official `twitter-timeline` widget for that one actor. Cost $0. Effort: low on top of option 1. Terms risk: low (official embed), but quality risk: login wall and blank boxes, and the widget loads X trackers, which matters if the app is hosted publicly.
3. Option 1 plus paid X API for a "situation shortlist". Only the 20 to 40 actors tied to the selected situation get timeline reads, cached with a 24 h deletion/refresh job. Cost about $15 to $90 a month at 3 to 5 posts per actor per day. Effort: medium-high (credit setup, caching, delete compliance, spend cap). Terms risk: medium (no AI/training use; keep X text out of the LLM digest, or ask X; fine for a hobby, not for a public multi-user site).
4. Telegram and X mirrors (Nitter, t.me/s scraping of everything). Cost $0, effort medium. Terms risk: high and the mirrors are unreliable. Not recommended.

Recommendation: option 1 now, add option 2 as a button, and treat option 3 as a later paid upgrade once the owner decides the monthly spend. Decide separately whether to keep scraping t.me/s given Telegram's 2026 terms, and keep X post text out of the digest model either way.

## SPARQL queries used

Query A (current heads of government with handles; run against `https://query.wikidata.org/sparql`, `Accept: text/csv`, User-Agent `GodsEyeView-research/0.1 (hobby; contact via GitHub krybaby7)`):

```sparql
SELECT ?country ?hog ?x ?tg ?bsky ?mast ?web ?img WHERE {
  ?country wdt:P31 wd:Q3624078 .
  FILTER NOT EXISTS { ?country wdt:P576 [] }
  ?country p:P6 ?st . ?st ps:P6 ?hog .
  FILTER NOT EXISTS { ?st pq:P582 [] }
  FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
  OPTIONAL { ?hog wdt:P2002 ?x } OPTIONAL { ?hog wdt:P3789 ?tg } OPTIONAL { ?hog wdt:P12361 ?bsky }
  OPTIONAL { ?hog wdt:P4033 ?mast } OPTIONAL { ?hog wdt:P856 ?web } OPTIONAL { ?hog wdt:P18 ?img }
}
```

Query B (foreign and defence ministers via position items):

```sparql
SELECT ?pos ?holder ?x WHERE {
  VALUES ?cls { wd:Q7330070 wd:Q2518691 }
  ?pos wdt:P279 ?cls .
  ?pos p:P1308 ?st . ?st ps:P1308 ?holder . FILTER NOT EXISTS { ?st pq:P582 [] }
  OPTIONAL { ?holder wdt:P2002 ?x }
}
```

Other requests run: publish.x.com oEmbed (profile URL and a dummy status id), platform.twitter.com/widgets.js (HEAD), Bluesky getAuthorFeed and getProfile, YouTube channel feed, t.me/s/telegram.

## Sources

- https://docs.x.com/x-api/getting-started/pricing (fetched)
- https://docs.x.com/developer-terms/policy.md (fetched)
- https://docs.x.com/developer-terms/agreement.md (fetched)
- https://developer.x.com/en/developer-terms (blocked, HTTP 402; found by search)
- https://www.gigazine.net/gsc_news/en/20260209-x-api-pay-per-use/ (snippet)
- https://opentermsarchive.org/en/memos/x-replaces-its-dollar200-entry-level-api-plan-with-a-pay-per-use-model/ (snippet)
- https://roboin.io/article/en/2026/02/08/x-transitions-api-to-pay-per-use-model-ending-free-plan/ (snippet)
- https://developer.x.com/web/embedded-timelines and https://help.x.com/articles/20170071 (snippet)
- https://meta.discourse.org/t/twitter-oneboxes-are-no-longer-working-on-my-install/267003/5 (snippet)
- https://en.wikipedia.org/wiki/Nitter ; https://twitterapi.io/blog/nitter-instances ; https://www.getxapi.com/alternatives/nitter (snippets)
- https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual (fetched)
- https://www.wikidata.org/w/api.php (property labels, fetched) ; https://query.wikidata.org/sparql (queries run)
- https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed (tested) ; https://bsky.social/about/support/tos (fetched)
- https://telegram.org/tos (fetched) ; https://telegram.org/tos/content-licensing ; https://opentermsarchive.org/en/memos/telegram-prohibits-collecting-data-for-ai-use/ (snippets)
- https://www.youtube.com/feeds/videos.xml (tested) ; https://t.me/s/telegram (tested)
- https://publish.x.com/oembed (tested)
