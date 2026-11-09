import { actorSourceDue } from './actor-fetch.js';
import { fetchActorFeeds, readActorRss } from './actor-feeds.js';

const FEEDS = [
  {
    actorId: 'Q53536',
    account: 'https://www.federalreserve.gov/feeds/press_all.xml',
    host: 'www.federalreserve.gov',
  },
];

export const shouldCheck = (context) => actorSourceDue(context, 24);

export function fetchObservations(context) {
  return fetchActorFeeds({
    ...context,
    entries: FEEDS,
    urlFor: ({ account }) => account,
    readPosts: (response, { host }) =>
      readActorRss(response, (candidate) => host === candidate),
  });
}
