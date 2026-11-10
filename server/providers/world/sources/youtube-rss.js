import { actorSourceDue } from './actor-fetch.js';
import {
  fetchActorFeeds,
  publicAccounts,
  readActorRss,
} from './actor-feeds.js';

const ORIGIN = 'https://www.youtube.com';
export const version = 2;
export const shouldCheck = (context) =>
  context.rederive || actorSourceDue(context, 24);

export function youtubeFeedUrl({ key, account }) {
  const url = new URL('/feeds/videos.xml', ORIGIN);
  url.searchParams.set(
    account?.includes('/user/') ? 'user' : 'channel_id',
    key,
  );
  return url.href;
}

export function fetchObservations(context) {
  return fetchActorFeeds({
    ...context,
    entries: publicAccounts(
      context.features,
      'youtube',
      ORIGIN,
      /^\/(?:channel\/(UC[\w-]{22})|user\/([\w-]+))$/,
    ).map(({ account, key }) => ({
      account,
      key: key ?? new URL(account).pathname.split('/').at(-1),
    })),
    urlFor: youtubeFeedUrl,
    deadlineRetries: 2,
    readPosts: (response) =>
      readActorRss(response, (host) => host === 'www.youtube.com'),
  });
}
