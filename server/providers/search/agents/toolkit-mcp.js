import { fileURLToPath } from 'node:url';

import { createLocalMcpServer } from '../../../mcp/server.js';
import { serveStdio } from '../../../mcp/stdio.js';
import {
  composeCatalog,
  defineTool,
  ToolError,
} from '../../../../src/tools/catalog.js';
import { createMcpServer } from '../../../../src/tools/mcp/index.js';
import {
  readResponseBytesCapped,
  readResponseJsonCapped,
} from '../../common/http.js';
import {
  ITEM_ID,
  LIVE_TOOLS,
  MAX_LIVE_RESULTS,
  MAX_PUBLIC_RESULTS,
  RELIEFWEB_TOOL,
  WIKIDATA_TOOL,
  loopbackOrigin,
  publicSources,
  reliefWebAppname,
} from './toolkit.js';

const QUERY_LENGTH = 120;
const TIMEOUT_MS = 6_000;
const MAX_PUBLIC_BYTES = 256 * 1024;
const MAX_LIVE_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_BYTES = 60 * 1024;
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const RELIEFWEB_API = 'https://api.reliefweb.int/v2/reports';
const WIKIDATA_AGENT =
  'GodsEyeView/0.2 (https://github.com/bilawalsidhu/gods-eye-view/issues)';
const EARTH = /^https?:\/\/www\.wikidata\.org\/entity\/Q2$/;
const LIVE_METHODS = new Set([
  'initialize',
  'ping',
  'tools/list',
  'tools/call',
]);
const LIVE_ROUTES = new Set([
  '/api/flights',
  '/api/military',
  '/api/vessels',
  '/api/firms',
  '/api/geocode',
]);

const text = (value, limit) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';
const array = (value) => (Array.isArray(value) ? value : []);

async function readJson(fetchImpl, url, signal, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    signal,
    redirect: 'error',
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Source unavailable');
  }
  return readResponseJsonCapped(response, MAX_PUBLIC_BYTES, signal);
}

async function wikidata(fetchImpl, params, signal) {
  const url = new URL(WIKIDATA_API);
  url.search = new URLSearchParams({ ...params, format: 'json', maxlag: '5' });
  const payload = await readJson(fetchImpl, url, signal, {
    headers: { 'User-Agent': WIKIDATA_AGENT },
  });
  if (!payload || payload.error) throw new Error('Wikidata unavailable');
  return payload;
}

async function wikidataCoordinates(fetchImpl, id, signal) {
  try {
    const payload = await wikidata(
      fetchImpl,
      {
        action: 'wbgetclaims',
        entity: id,
        property: 'P625',
      },
      signal,
    );
    let coordinates = null;
    for (const claim of array(payload.claims?.P625)) {
      if (claim?.rank === 'deprecated') continue;
      const value = claim?.mainsnak?.datavalue?.value;
      const { latitude: lat, longitude: lon, globe } = value || {};
      if (
        !EARTH.test(globe) ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      )
        continue;
      if (claim.rank === 'preferred') return { lat, lon };
      coordinates ??= { lat, lon };
    }
    return coordinates;
  } catch {
    return null;
  }
}

async function wikidataPlaces(fetchImpl, { query, limit }, signal) {
  const payload = await wikidata(
    fetchImpl,
    {
      action: 'wbsearchentities',
      search: query,
      language: 'en',
      type: 'item',
      limit: String(limit),
    },
    signal,
  );
  const matches = array(payload.search)
    .slice(0, limit)
    .filter((item) => typeof item?.id === 'string' && ITEM_ID.test(item.id));
  const results = [];
  for (const { id, label, description } of matches) {
    results.push({
      id,
      title: text(label, 250) || id,
      snippet: text(description, 400),
      url: 'https://www.wikidata.org/wiki/' + id,
      coordinates: signal.aborted
        ? null
        : await wikidataCoordinates(fetchImpl, id, signal),
    });
  }
  return { results, sources: publicSources(WIKIDATA_TOOL, results) };
}

async function reliefWebReports(fetchImpl, appname, { query, limit }, signal) {
  const url = new URL(RELIEFWEB_API);
  url.searchParams.set('appname', appname);
  const from = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const payload = await readJson(fetchImpl, url, signal, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: { value: query },
      filter: { field: 'date.created', value: { from } },
      sort: ['date.created:desc'],
      fields: { include: ['title', 'url', 'date.created', 'source.name'] },
      slim: 1,
      limit,
    }),
  });
  const candidates = array(payload?.data)
    .slice(0, limit)
    .map((item) => item?.fields)
    .map((fields) => ({
      url: fields?.url,
      title: text(fields?.title, 250),
      date: text(fields?.date?.created, 40),
      snippet: array(fields?.source)
        .slice(0, 3)
        .map((source) => text(source?.name, 120))
        .filter(Boolean)
        .join(', '),
    }));
  return { sources: publicSources(RELIEFWEB_TOOL, candidates) };
}

function publicTool(name, title, description, run) {
  return defineTool({
    name,
    title,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: QUERY_LENGTH },
        limit: { type: 'integer', minimum: 1, maximum: MAX_PUBLIC_RESULTS },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async run({ query, limit = 3 }, { signal }) {
      query = query.trim();
      if (!query)
        throw new ToolError('invalid_arguments', 'A query is required.');
      const data = await run({ query, limit }, signal);
      return { summary: title, data };
    },
  });
}

function dispatchError(message, code = -32601) {
  return {
    jsonrpc: '2.0',
    id: message.id,
    error: { code, message: 'Unavailable in search toolkit' },
  };
}

function resultError(response) {
  return {
    jsonrpc: response.jsonrpc,
    id: response.id,
    result: {
      isError: true,
      content: [
        {
          type: 'text',
          text: 'The search toolkit could not return a bounded result.',
        },
      ],
    },
  };
}

function liveArguments(message) {
  const args = message.params.arguments;
  if (args != null && (typeof args !== 'object' || Array.isArray(args)))
    return message;
  const limit = args?.limit;
  return {
    ...message,
    params: {
      ...message.params,
      arguments: {
        ...args,
        limit:
          limit == null
            ? MAX_LIVE_RESULTS
            : Number.isInteger(limit)
              ? Math.min(limit, MAX_LIVE_RESULTS)
              : limit,
      },
    },
  };
}

function liveResult(name, response) {
  if (!response?.result || response.result.isError) return response;
  const { view, sources, ...data } = response.result.structuredContent ?? {};
  data.sources = publicSources(name, sources);
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized) > MAX_RESULT_BYTES)
    return resultError(response);
  response.result.structuredContent = data;
  response.result.content = [
    { type: 'text', text: text(response.result.content[0]?.text, 500) },
    { type: 'text', text: serialized },
  ];
  return response;
}

/** Restrict the app MCP to the live queries used during search research. */
export function createToolkitServer({
  apiBase,
  appname,
  fetchImpl = globalThis.fetch,
} = {}) {
  const origin = loopbackOrigin(apiBase);
  const relief = reliefWebAppname(appname);
  const liveServer = origin
    ? createLocalMcpServer({
        apiBase: origin,
        async fetchImpl(input, init) {
          const url = new URL(input);
          if (
            url.origin !== origin ||
            !LIVE_ROUTES.has(url.pathname) ||
            (init?.method ?? 'GET') !== 'GET'
          )
            throw new Error('Expected a local API URL');
          const response = await fetchImpl(url, { ...init, redirect: 'error' });
          if (!response.body) return response;
          const bytes = await readResponseBytesCapped(
            response,
            MAX_LIVE_BYTES,
            init?.signal,
          );
          return new Response(bytes, {
            status: response.status,
            headers: response.headers,
          });
        },
      })
    : null;
  const publicTools = [
    publicTool(
      WIKIDATA_TOOL,
      'Wikidata place search',
      'Find named places by label or alias on Wikidata and return matching Q pages and Earth coordinates where available.',
      (args, signal) => wikidataPlaces(fetchImpl, args, signal),
    ),
    ...(relief
      ? [
          publicTool(
            RELIEFWEB_TOOL,
            'ReliefWeb reports',
            'Find humanitarian reports published on ReliefWeb in the last two weeks.',
            (args, signal) => reliefWebReports(fetchImpl, relief, args, signal),
          ),
        ]
      : []),
  ];
  const publicServer = createMcpServer({
    catalog: composeCatalog({ tools: publicTools }),
    name: 'gev-search',
    version: '1.0.0',
  });
  const liveNames = new Set(liveServer ? LIVE_TOOLS : []);
  const publicNames = new Set(publicTools.map(({ name }) => name));
  return {
    async handle(message, { signal } = {}) {
      if (
        message?.jsonrpc !== '2.0' ||
        message.id === undefined ||
        typeof message.method !== 'string'
      )
        return publicServer.handle(message);
      if (!LIVE_METHODS.has(message.method)) return dispatchError(message);
      if (message.method === 'tools/list' && liveServer) {
        const result = await publicServer.handle(message);
        if (result.error) return result;
        const local = await liveServer.handle(message);
        result.result.tools.push(
          ...local.result.tools
            .filter(({ name }) => liveNames.has(name))
            .map(({ _meta, ...tool }) => ({
              ...tool,
              inputSchema: {
                ...tool.inputSchema,
                properties: {
                  ...tool.inputSchema.properties,
                  limit: {
                    ...tool.inputSchema.properties.limit,
                    maximum: MAX_LIVE_RESULTS,
                    description:
                      'Most rows to return (default and maximum 25).',
                  },
                },
              },
            })),
        );
        return result;
      }
      if (message.method !== 'tools/call') return publicServer.handle(message);
      const name = message.params?.name;
      const deadline = AbortSignal.timeout(TIMEOUT_MS);
      const options = {
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      };
      if (liveNames.has(name))
        return liveResult(
          name,
          await liveServer.handle(liveArguments(message), options),
        );
      if (publicNames.has(name)) return publicServer.handle(message, options);
      return dispatchError(message, -32602);
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await serveStdio(
    createToolkitServer({
      apiBase: process.env.GEV_SEARCH_API_BASE,
      appname: process.env.GEV_SEARCH_RELIEFWEB_APPNAME,
    }),
    { input: process.stdin, output: process.stdout },
  );
}
