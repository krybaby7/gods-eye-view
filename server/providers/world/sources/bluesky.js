import { readResponseJsonCapped } from '../../../../src/sources/httpBody.js';
import { actorSourceDue } from './actor-fetch.js';
import { fetchActorFeeds, POST_LIMIT, publicAccounts } from './actor-feeds.js';

const ORIGIN = 'https://bsky.app';
export const version = 2;
export const shouldCheck = (context) =>
  context.rederive || actorSourceDue(context, 24);

export function blueskyFeedUrl({ key }) {
  const url = new URL(
    'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed',
  );
  url.search = new URLSearchParams({
    actor: key,
    limit: '12',
    filter: 'posts_no_replies',
  });
  return url.href;
}

export async function readBlueskyPosts(response, { key }) {
  const body = await readResponseJsonCapped(response, 1_000_000);
  if (response.status === 400) {
    if (
      body?.error === 'InvalidRequest' &&
      body?.message === 'Profile not found'
    )
      return null;
    throw new Error('HTTP 400 from public.api.bsky.app');
  }
  const seen = new Set();
  return body.feed
    .flatMap(({ post, reason }) => {
      if (
        reason?.$type?.endsWith('#reasonRepost') ||
        post?.author?.handle?.toLowerCase() !== key.toLowerCase()
      )
        return [];
      const uri =
        /^at:\/\/(did:[\w:.-]+)\/app\.bsky\.feed\.post\/([\w.~-]+)$/.exec(
          post.uri,
        );
      const text = post.record?.text?.trim();
      if (!uri || uri[1] !== post.author.did || !text || seen.has(post.uri))
        return [];
      seen.add(post.uri);
      const date = Date.parse(post.record.createdAt);
      return [
        {
          text: text.slice(0, 500),
          url: ORIGIN + '/profile/' + uri[1] + '/post/' + uri[2],
          publishedAt: Number.isFinite(date)
            ? new Date(date).toISOString()
            : null,
        },
      ];
    })
    .slice(0, POST_LIMIT);
}

export function fetchObservations(context) {
  return fetchActorFeeds({
    ...context,
    entries: publicAccounts(
      context.features,
      'bluesky',
      ORIGIN,
      /^\/profile\/([a-z\d-]+(?:\.[a-z\d-]+)+)$/i,
    ),
    urlFor: blueskyFeedUrl,
    readPosts: readBlueskyPosts,
    acceptBadRequest: true,
  });
}
