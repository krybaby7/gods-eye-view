import { registerWorldSources } from './refreshRegistry.js';
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
    'wikimedia-commons': 'wikidata',
    bluesky: 'wikidata',
    'youtube-rss': 'wikidata',
  },
);
