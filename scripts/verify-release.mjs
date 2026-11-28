#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import { get } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createWorldStore } from '../server/providers/world/store.js';

const usage =
  'Usage: node scripts/verify-release.mjs --url http://127.0.0.1:4173 ' +
  '--dist <build-directory> --saved-state <world/state.json>';
const loopback = new Set(['127.0.0.1', '[::1]']);
const cesiumEntryAssets = new Set([
  'cesium/Cesium.js',
  'cesium/Widgets/widgets.css',
]);

function releaseOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Pass an HTTP loopback root URL.');
  }
  if (
    url.protocol !== 'http:' ||
    !loopback.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Pass an HTTP loopback root URL.');
  }
  return url;
}

async function savedWorldMetadata(filename) {
  let saved;
  try {
    if (path.basename(filename) !== 'state.json') throw new Error();
    const file = await realpath(filename);
    const directory = path.dirname(file);
    if (
      path.basename(file) !== 'state.json' ||
      path.basename(directory) !== 'world'
    )
      throw new Error();
    saved = await createWorldStore({
      cacheDir: path.dirname(directory),
    }).read();
  } catch {
    throw new Error(
      'Could not read recognised World Board state from world/state.json.',
    );
  }
  const turn = saved.turns.at(-1);
  const countries = saved?.board?.countries;
  const count =
    countries && typeof countries === 'object' && !Array.isArray(countries)
      ? Object.keys(countries).length
      : 0;
  const asOf =
    typeof saved.board?.asOf === 'string' ? Date.parse(saved.board.asOf) : NaN;
  if (
    !count ||
    !Number.isSafeInteger(turn?.number) ||
    turn.number < 1 ||
    !Number.isFinite(asOf)
  ) {
    throw new Error(
      'Expected a nonempty saved World Board with a turn and as-of date.',
    );
  }
  return {
    turn: turn.number,
    asOf: new Date(asOf).toISOString(),
    countries: count,
  };
}

function entryAssets(html) {
  const assets = new Set();
  const markup = html.replace(/<!--[\s\S]*?-->/g, '');
  if (/<base\b/i.test(markup)) {
    throw new Error('Expected a root build with no base override.');
  }
  let hasScript = false;
  let hasStylesheet = false;
  for (const match of markup.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const attrs = new Map();
    for (const [, name, double, single, bare] of match[0].matchAll(
      /([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/gi,
    )) {
      if (!attrs.has(name.toLowerCase())) {
        attrs.set(name.toLowerCase(), double ?? single ?? bare);
      }
    }
    const script = match[1].toLowerCase() === 'script';
    const rel = attrs.get('rel')?.toLowerCase();
    const src = script ? attrs.get('src') : attrs.get('href');
    if (script ? !src : !['stylesheet', 'modulepreload'].includes(rel))
      continue;

    const asset = src?.replace(/^(?:\/|\.\/)/, '');
    if (
      !asset ||
      (!/^assets\/[A-Za-z0-9._-]+\.(?:js|css)$/.test(asset) &&
        !cesiumEntryAssets.has(asset)) ||
      (script && !asset.endsWith('.js')) ||
      (rel === 'stylesheet' && !asset.endsWith('.css')) ||
      (rel === 'modulepreload' && !asset.endsWith('.js'))
    ) {
      throw new Error('The entry page has an unsupported built asset path.');
    }
    if (script) hasScript = true;
    if (rel === 'stylesheet') hasStylesheet = true;
    assets.add(asset);
  }
  if (!hasScript || !hasStylesheet) {
    throw new Error(
      'Expected linked JavaScript and CSS in the built entry page.',
    );
  }
  return assets;
}

async function builtFile(root, relative) {
  try {
    const expected = path.normalize(relative);
    const file = await realpath(path.join(root, expected));
    if (path.relative(root, file) !== expected) throw new Error();
    return await readFile(file);
  } catch {
    throw new Error(
      'A built file is unavailable or escapes the build directory.',
    );
  }
}

// Use a dedicated direct connection. No environment proxy is consulted, and
// the HTTP client does not follow redirects.
function directGet(url, { maximumBytes }) {
  return new Promise((resolve, reject) => {
    const request = get(
      url,
      {
        agent: false,
        headers: { 'Accept-Encoding': 'identity' },
        signal: AbortSignal.timeout(10_000),
      },
      (response) => {
        const status = response.statusCode;
        if (status !== 200) response.destroy();
        resolve({
          status,
          async arrayBuffer() {
            const chunks = [];
            let total = 0;
            for await (const chunk of response) {
              total += chunk.length;
              if (total > maximumBytes)
                throw new Error('Unexpected static file size.');
              chunks.push(chunk);
            }
            return Buffer.concat(chunks);
          },
        });
      },
    );
    request.on('error', reject);
  });
}

async function matchServed(fetchImpl, url, expected, label) {
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'error',
    maximumBytes: expected.length,
  }).catch(() => {
    throw new Error(
      'The local release did not answer the static file request.',
    );
  });
  if (response.status !== 200)
    throw new Error('The local release did not return HTTP 200.');
  let actual;
  try {
    actual = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new Error('Could not read the served static file.');
  }
  if (!actual.equals(expected))
    throw new Error('Served ' + label + ' bytes do not match the build.');
}

export async function verifyRelease({
  url,
  dist,
  savedState,
  fetchImpl = directGet,
}) {
  const origin = releaseOrigin(url);
  const world = await savedWorldMetadata(savedState);
  const root = await realpath(dist).catch(() => {
    throw new Error('Could not locate the supplied build directory.');
  });
  const entry = await builtFile(root, 'index.html');
  const assets = entryAssets(entry.toString('utf8'));
  const files = await Promise.all(
    [...assets].map(async (asset) => [asset, await builtFile(root, asset)]),
  );

  await matchServed(fetchImpl, origin, entry, 'entry page');
  for (const [asset, bytes] of files) {
    await matchServed(fetchImpl, new URL(asset, origin), bytes, 'build asset');
  }
  return { entryFiles: 1, assetFiles: files.length, world };
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        url: { type: 'string' },
        dist: { type: 'string' },
        'saved-state': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch {
    throw new Error(usage);
  }
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!values.url || !values.dist || !values['saved-state'])
    throw new Error(usage);
  const result = await verifyRelease({
    url: values.url,
    dist: values.dist,
    savedState: values['saved-state'],
  });
  console.log(JSON.stringify(result));
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
