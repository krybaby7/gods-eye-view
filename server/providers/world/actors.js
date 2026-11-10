import {
  registerWorldFeatureView,
  registerWorldSources,
} from './refreshRegistry.js';
import * as wikidata from './sources/wikidata.js';
import * as cia from './sources/cia-world-leaders.js';
import { mergeOfficeholders, officialOfficeEvidence } from './officeholders.js';
import * as commons from './sources/wikimedia-commons.js';
import * as bluesky from './sources/bluesky.js';
import * as youtube from './sources/youtube-rss.js';
import * as government from './sources/government-rss.js';
import * as organizations from './sources/actor-organizations.js';

registerWorldSources(
  {
    wikidata,
    'cia-world-leaders': cia,
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
  since,
  asOf,
  source,
  sourceUrl,
  stale,
  disagreement,
  ambiguity,
  otherEvidence,
  draft,
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
  since,
  asOf,
  source,
  sourceUrl,
  stale,
  disagreement,
  ambiguity,
  otherEvidence,
  draft,
});

function peopleDirectory(features, registry, now) {
  const wikidata = features.wikidata;
  if (!registry) return wikidata;
  const pages = Object.values(features['cia-world-leaders']?.pages ?? {});
  const official = officialOfficeEvidence(registry, now);
  if (!wikidata && !pages.length && !official.length) return undefined;
  const active = (actor) => !actor.until || Date.parse(actor.until) > +now;
  const actors = mergeOfficeholders(
    (wikidata?.actors ?? []).filter(active),
    pages.flatMap((page) => cia.resolveCiaPage(page, registry)),
    now,
    wikidata?.undatedActors,
    official,
  );
  return { actors, governments: wikidata?.governments ?? {} };
}

const socialFeeds = { bluesky: 'bluesky', 'youtube-rss': 'youtube' };

registerWorldFeatureView('people', {
  summary: {
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
  combine({ summary, features, registry, now }) {
    const directory = peopleDirectory(features, registry, now);
    if (directory)
      summary.wikidata = {
        actors: directory.actors.map(summaryActor),
        governments: directory.governments,
      };
    delete summary['cia-world-leaders'];
  },
  detail({ country, features, registry, now }) {
    const people = peopleDirectory(features, registry, now)?.actors ?? [];
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
