import { actorSourceDue } from './actor-fetch.js';
import {
  fetchActorFeeds,
  publicAccounts,
  readActorRss,
} from './actor-feeds.js';

const ORIGIN = 'https://www.youtube.com';
export const shouldCheck = (context) => actorSourceDue(context, 24);

export function youtubeFeedUrl({ key }) {
  const url = new URL('/feeds/videos.xml', ORIGIN);
  url.searchParams.set('channel_id', key);
  return url.href;
}

export function fetchObservations(context) {
  return fetchActorFeeds({
    ...context,
    entries: publicAccounts(
      context.features,
      'youtube',
      ORIGIN,
      /^\/channel\/(UC[\w-]{22})$/,
    ),
    urlFor: youtubeFeedUrl,
    readPosts: (response) =>
      readActorRss(response, (host) => host === 'www.youtube.com'),
  });
}
