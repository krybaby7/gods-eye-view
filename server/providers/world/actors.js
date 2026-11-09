import {
  registerWorldFeatureView,
  registerWorldSources,
} from './refreshRegistry.js';
import * as wikidata from './sources/wikidata.js';
import * as commons from './sources/wikimedia-commons.js';
import * as bluesky from './sources/bluesky.js';
import * as youtube from './sources/youtube-rss.js';
import * as government from './sources/government-rss.js';
import * as organizations from './sources/actor-organizations.js';

registerWorldSources(
  {
    wikidata,
    'wikimedia-commons': commons,
    bluesky,
    'youtube-rss': youtube,
    'government-rss': government,
    'actor-organizations': organizations,
  },
  {
    wikidata: 'actor-organizations',
    'wikimedia-commons': 'wikidata',
    bluesky: 'wikidata',
    'youtube-rss': 'wikidata',
  },
);

const summaryActor = ({
  id,
  kind,
  name,
  role,
  country,
  office,
  imageFile,
  acting,
  collective,
  reviewed,
  until,
}) => ({
  id,
  kind,
  name,
  role,
  country,
  office,
  imageFile,
  acting,
  collective,
  reviewed,
  until,
});

const socialFeeds = { bluesky: 'bluesky', 'youtube-rss': 'youtube' };

registerWorldFeatureView('people', {
  summary: {
    wikidata: ({ actors, governments }) => ({
      actors: (actors ?? []).map(summaryActor),
      governments,
    }),
    'actor-organizations': ({ organizations }) => ({
      organizations: Object.fromEntries(
        Object.entries(organizations ?? {}).map(([id, actor]) => [
          id,
          summaryActor(actor),
        ]),
      ),
    }),
    bluesky: () => undefined,
    'youtube-rss': () => undefined,
    'government-rss': () => undefined,
  },
  detail({ country, features }) {
    const people = features.wikidata?.actors ?? [];
    const ids = new Set(
      people.filter((actor) => actor.country === country).map(({ id }) => id),
    );
    const actors = people.filter(({ id }) => ids.has(id));
    const organizations = Object.fromEntries(
      Object.entries(
        features['actor-organizations']?.organizations ?? {},
      ).filter(
        ([, actor]) => actor.country === country || actor.country === null,
      ),
    );
    const entries = [...actors, ...Object.values(organizations)];
    const detail = {
      wikidata: { actors },
      'actor-organizations': { organizations },
      'government-rss': {
        feeds: Object.fromEntries(
          Object.entries(features['government-rss']?.feeds ?? {}).filter(
            ([, feed]) =>
              ids.has(feed.actorId) ||
              Object.hasOwn(organizations, feed.actorId),
          ),
        ),
      },
    };
    for (const [source, platform] of Object.entries(socialFeeds)) {
      const urls = new Set(
        entries.flatMap((actor) => actor.accounts?.[platform] ?? []),
      );
      detail[source] = {
        feeds: Object.fromEntries(
          Object.entries(features[source]?.feeds ?? {}).filter(([url]) =>
            urls.has(url),
          ),
        ),
      };
    }
    return { features: detail };
  },
});
