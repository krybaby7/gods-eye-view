import { setTimeout as wait } from 'node:timers/promises';
import { parseFeedEntries } from '../../common/rss.js';
import { readResponseTextCapped } from '../../../../src/sources/httpBody.js';
import { fetchActorSource, safeHttps } from './actor-fetch.js';

const FETCH_BUDGET = 18;
const TIMEOUT = 6000;
const RETRY_PAUSE = 350;
export const POST_LIMIT = 4;

export function publicAccounts(features, platform, origin, pattern) {
  return [
    ...new Set(
      (features.wikidata?.actors ?? []).flatMap(
        (actor) => actor.accounts?.[platform] ?? [],
      ),
    ),
  ].flatMap((account) => {
    const url = safeHttps(account);
    if (!url) return [];
    const { origin: actualOrigin, pathname } = new URL(url);
    const match = pattern.exec(pathname);
    return actualOrigin === origin && match ? [{ account, key: match[1] }] : [];
  });
}

export async function fetchActorFeeds({
  entries,
  fetchImpl,
  now,
  data,
  urlFor,
  readPosts,
  acceptBadRequest = false,
  deadlineRetries = 0,
}) {
  const feeds = {};
  const attemptedAt = {};
  const age = (account) => Date.parse(data?.attemptedAt?.[account]) || 0;
  const ordered = [...entries].sort((a, b) => age(a.account) - age(b.account));
  for (const { account } of entries) {
    if (data?.feeds?.[account]) feeds[account] = data.feeds[account];
    if (age(account)) attemptedAt[account] = data.attemptedAt[account];
  }
  let count = 0;
  let failed = 0;
  let unavailable = 0;
  let retryAt;
  let lastError;
  for (const entry of ordered.slice(0, FETCH_BUDGET)) {
    const { account } = entry;
    async function loadPosts() {
      const response = await fetchActorSource(fetchImpl, urlFor(entry), now, {
        timeout: TIMEOUT,
        acceptBadRequest,
      });
      return readPosts(response, entry);
    }
    try {
      let posts;
      try {
        posts = await loadPosts();
      } catch (error) {
        if (!deadlineRetries || error.name !== 'TimeoutError') throw error;
        deadlineRetries -= 1;
        await wait(RETRY_PAUSE);
        posts = await loadPosts();
      }
      if (posts === null) unavailable += 1;
      feeds[account] = {
        posts: posts ?? [],
        fetchedAt: now.toISOString(),
        actorId: entry.actorId,
      };
      attemptedAt[account] = now.toISOString();
      count += posts?.length ?? 0;
    } catch (error) {
      failed += 1;
      lastError = error.cause?.code ?? error.message;
      retryAt = error.retryAt;
      if (retryAt) break;
      attemptedAt[account] = now.toISOString();
    }
  }
  return {
    data: { feeds, attemptedAt, retryAt },
    count,
    unit: 'post',
    error: failed
      ? failed + ' feed request(s) failed (' + lastError + ')'
      : undefined,
    detail:
      [
        ordered.length > FETCH_BUDGET
          ? `${FETCH_BUDGET} of ${ordered.length} accounts checked per refresh, oldest first.`
          : null,
        unavailable
          ? `${unavailable} ${unavailable === 1 ? 'account' : 'accounts'} unavailable.`
          : null,
      ]
        .filter(Boolean)
        .join(' ') || undefined,
  };
}

export async function readActorRss(response, hostAllowed) {
  const text = await readResponseTextCapped(response, 1_000_000);
  if (!/<(?:rss|feed)\b/i.test(text))
    throw new Error('Expected an RSS or Atom feed');
  const seen = new Set();
  return parseFeedEntries(text)
    .entries.flatMap(({ title, url, publishedAt }) => {
      const target = safeHttps(url);
      if (!target || !hostAllowed(new URL(target).hostname) || seen.has(target))
        return [];
      seen.add(target);
      return [{ text: title.slice(0, 300), url: target, publishedAt }];
    })
    .slice(0, POST_LIMIT);
}
