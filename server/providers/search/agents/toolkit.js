import { fileURLToPath } from 'node:url';

const SERVER = 'gev_search';
const PREFIX = 'mcp__' + SERVER + '__';
// The documented standalone app and MCP default. The subprocess owns the
// MCP service graph, so building its arguments does not load that graph.
const DEFAULT_API_BASE = 'http://localhost:4173';
export const WIKIDATA_TOOL = 'wikidata_places';
export const RELIEFWEB_TOOL = 'reliefweb_reports';
export const LIVE_TOOLS = Object.freeze([
  'aircraft_in_area',
  'vessels_in_area',
  'get_active_fires',
]);

export function reliefWebAppname(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  return /^[a-z0-9][a-z0-9_-]{2,63}$/i.test(name) &&
    !/^(?:apidoc|example|test|replace-with-app-name)$/i.test(name)
    ? name
    : null;
}

export function loopbackOrigin(value) {
  // URL parsing normalizes paths and nonstandard IPv4 spellings. Accept only
  // explicit loopback hosts with an optional port and trailing slash.
  if (
    !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?\/?$/i.test(
      value,
    )
  )
    return null;
  try {
    const url = new URL(value);
    return url.port === '0' ? null : url.origin;
  } catch {
    return null;
  }
}

function defaultApiBase(env, argv) {
  const flag = argv.findLastIndex(
    (arg) => arg === '--port' || arg.startsWith('--port='),
  );
  const port =
    flag < 0
      ? env.PORT
      : argv[flag] === '--port'
        ? argv[flag + 1]
        : argv[flag].slice(7);
  return (
    (port && loopbackOrigin('http://localhost:' + port)) || DEFAULT_API_BASE
  );
}

export function createSearchToolkit(env, argv = process.argv.slice(2)) {
  if (env.SEARCH_TOOLKIT === 'off') return null;
  const apiBase =
    env.SEARCH_MCP_API_BASE == null
      ? defaultApiBase(env, argv)
      : loopbackOrigin(env.SEARCH_MCP_API_BASE);
  const appname = reliefWebAppname(env.SEARCH_RELIEFWEB_APPNAME);
  return {
    apiBase,
    reliefWeb: Boolean(appname),
    tools: [
      WIKIDATA_TOOL,
      ...(appname ? [RELIEFWEB_TOOL] : []),
      ...(apiBase ? LIVE_TOOLS : []),
    ].map((name) => PREFIX + name),
    config: {
      mcpServers: {
        [SERVER]: {
          type: 'stdio',
          command: process.execPath,
          args: [fileURLToPath(new URL('./toolkit-mcp.js', import.meta.url))],
          env: {
            GEV_SEARCH_API_BASE: apiBase || '',
            GEV_SEARCH_RELIEFWEB_APPNAME: appname || '',
          },
        },
      },
    },
  };
}

export const MAX_PUBLIC_RESULTS = 5;
export const MAX_LIVE_RESULTS = 25;
const Q_PAGE = /^\/wiki\/Q[1-9]\d{0,15}$/;
export const ITEM_ID = /^Q[1-9]\d{0,15}$/;
const PUBLIC_PAGES = new Map([
  [WIKIDATA_TOOL, new Map([['www.wikidata.org', Q_PAGE]])],
  [
    RELIEFWEB_TOOL,
    new Map([['reliefweb.int', /^\/(?:node\/\d+|report\/[\w-]+\/[\w%.-]+)$/]]),
  ],
  [
    'aircraft_in_area',
    new Map([
      ['opensky-network.org', /^(?!\/api(?:\/|$))/],
      ['www.adsbexchange.com', /^\//],
      ['globe.adsbexchange.com', /^\//],
      ['adsb.fi', /^\//],
    ]),
  ],
  ['vessels_in_area', new Map([['aisstream.io', /^\//]])],
  [
    'get_active_fires',
    new Map([
      ['firms.modaps.eosdis.nasa.gov', /^(?!\/(?:api|mapserver)(?:\/|$))/],
    ]),
  ],
]);

export function publicSources(tool, entries) {
  if (!Array.isArray(entries)) return [];
  const pages = PUBLIC_PAGES.get(tool);
  if (!pages) return [];
  return entries.slice(0, MAX_PUBLIC_RESULTS).flatMap((entry) => {
    if (typeof entry?.url !== 'string' || entry.url.length > 2_048) return [];
    let url;
    try {
      url = new URL(entry.url);
    } catch {
      return [];
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      !pages.get(url.hostname)?.test(url.pathname)
    )
      return [];
    url.hash = '';
    return [
      {
        url: url.href,
        ...Object.fromEntries(
          [
            ['title', 300],
            ['snippet', 800],
            ['date', 40],
          ]
            .filter(([key]) => typeof entry[key] === 'string')
            .map(([key, cap]) => [key, entry[key].slice(0, cap)]),
        ),
      },
    ];
  });
}

// Claude puts MCP results in tool_result content blocks. The toolkit's last
// text block is an exact JSON serialization of its structured payload.
export function toolkitSources(name, content, output) {
  const tool = name.slice(PREFIX.length);
  if (!name.startsWith(PREFIX) || !PUBLIC_PAGES.has(tool)) return [];
  if (output?.isError) return [];
  if (output?.structuredContent)
    return publicSources(tool, output.structuredContent.sources);
  const last = Array.isArray(content) ? content.at(-1) : null;
  const data = last?.type === 'text' ? last.text : content;
  if (typeof data !== 'string' || data.length > 64 * 1024) return [];
  try {
    return publicSources(tool, JSON.parse(data)?.sources);
  } catch {
    return [];
  }
}
