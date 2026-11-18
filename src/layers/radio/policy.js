import { DESIGN_COLORS } from '../../designTokens.js';

export const RADIO_PREFIX = 'radio:';

export const DIRECTORY_ENDPOINT = '/api/radio/stations';

export const HORIZON_TICK_MS = 250;

export const HORIZON_CAMERA_MOVE_EPSILON_M = 1;

export const MARKER_LIFT_M = 2.5;

export const SELECTED_LIFT_M = 5;

export const RADIO_PICK_TOLERANCE_PX = 8;

export const RADIO_TUNER_DIRECTORY_LIMIT = 750;

export const RADIO_TUNER_STATION_LIMIT = RADIO_TUNER_DIRECTORY_LIMIT;

export const RADIO_TUNER_STATIC_MAX_GAIN = 0.018;

export const RADIO_VOICE_PLAYBACK_TIMEOUT_MS = 12_000;

export const RADIO_DIRECTORY_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export const RADIO_DIRECTORY_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const RADIO_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RADIO_OVERLAY_SOURCE_ID = 'radio';

export const RADIO_OVERLAY_COHORT_LIMIT = 64;

export const RADIO_SINGLETON_GLOBAL_LIMIT = 16;

export const RADIO_SINGLETON_MID_LIMIT = 32;

export const RADIO_SINGLETON_NEAR_LIMIT = 48;

export const RADIO_GLOBE_INTERACTION_MAX_DISTANCE_M = 50_000_000;

export const RADIO_GLOBE_RECENTER_MAX_HEIGHT_M = 13_000_000;

export const RADIO_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: RADIO_OVERLAY_COHORT_LIMIT,
  collisionCapacity: 96,
  moving: false,
});

export const RADIO_PICK_OFFSETS = Object.freeze([
  [0, -RADIO_PICK_TOLERANCE_PX],
  [RADIO_PICK_TOLERANCE_PX, 0],
  [0, RADIO_PICK_TOLERANCE_PX],
  [-RADIO_PICK_TOLERANCE_PX, 0],
  [6, -6],
  [6, 6],
  [-6, 6],
  [-6, -6],
]);

export const DEFAULT_RADIO_FILTER = 'all';

export const GLOBAL_RADIO_ALTITUDE_M = 2_000_000;

export const MUSIC_GENRES = Object.freeze([
  ['alternative', 'Alternative'],
  ['ambient', 'Ambient'],
  ['blues', 'Blues'],
  ['classical', 'Classical'],
  ['country', 'Country'],
  ['dance', 'Dance'],
  ['electronic', 'Electronic'],
  ['folk', 'Folk'],
  ['funk', 'Funk'],
  ['hip hop', 'Hip-Hop'],
  ['house', 'House'],
  ['indie', 'Indie'],
  ['jazz', 'Jazz'],
  ['latin', 'Latin'],
  ['metal', 'Metal'],
  ['oldies', 'Oldies'],
  ['pop', 'Pop'],
  ['punk', 'Punk'],
  ['r&b', 'R&B'],
  ['reggae', 'Reggae'],
  ['rock', 'Rock'],
  ['soul', 'Soul'],
  ['techno', 'Techno'],
  ['trance', 'Trance'],
  ['world', 'World'],
]);

export const CATEGORY_MATCHERS = Object.freeze({
  news: ['news', 'current affairs', 'journalism'],
  talk: ['talk', 'spoken word', 'interview', 'podcast'],
  weather: ['weather', 'emergency', 'noaa'],
  'public-safety': [
    'public safety',
    'scanner',
    'police',
    'fire',
    'ems',
    'dispatch',
    'emergency',
  ],
  'aviation-marine': [
    'aviation',
    'air traffic',
    'atc',
    'airport',
    'marine',
    'maritime',
    'coast guard',
  ],
  'traffic-transit': ['traffic', 'transit', 'transport', 'rail', 'metro'],
});

export const RADIO_CATEGORY_COLORS = Object.freeze({
  all: DESIGN_COLORS['--cat-all'],
  news: DESIGN_COLORS['--cat-news'],
  talk: DESIGN_COLORS['--cat-talk'],
  weather: DESIGN_COLORS['--cat-weather'],
  'public-safety': DESIGN_COLORS['--cat-public-safety'],
  'aviation-marine': DESIGN_COLORS['--cat-aviation-marine'],
  'traffic-transit': DESIGN_COLORS['--cat-traffic-transit'],
  music: DESIGN_COLORS['--cat-music'],
  other: DESIGN_COLORS['--cat-other'],
});

export const RADIO_CLUSTER_LABELS = Object.freeze({
  news: 'NEWS',
  talk: 'TALK',
  weather: 'WEATHER',
  'public-safety': 'SAFETY',
  'aviation-marine': 'AIR / SEA',
  'traffic-transit': 'TRANSIT',
  music: 'MUSIC',
  other: 'OTHER',
});

export const RADIO_MARKER_CATEGORY_ORDER = Object.freeze([
  'news',
  'public-safety',
  'weather',
  'aviation-marine',
  'traffic-transit',
  'talk',
  'music',
]);

export const DEFAULT_RADIO_VOLUME = 0.8;

export const EMPTY_ACCEPTED_CATALOG_SNAPSHOT = Object.freeze({
  instance: null,
  generation: null,
  updatedAt: null,
  stations: Object.freeze([]),
  stationIds: Object.freeze([]),
});

export const VOICE_RESTORE_DELAY_MS = 650;

export const VOICE_RESTORE_DURATION_MS = 1800;

export const RADIO_GLOBE_LABEL_MAX_CHARS = 30;

export const RADIO_LABEL_SEGMENTER =
  typeof Intl?.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
