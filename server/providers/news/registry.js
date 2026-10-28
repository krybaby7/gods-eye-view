import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { defaultSourceRoot } from '../common/source-root.js';
import { normalizePlaceName } from './geocode.js';

/**
 * Source directory and theater configuration loader. The registry is data
 * (public/news/sources.json, public/news/theaters/<id>.json); this module
 * refuses anything the rest of the provider cannot interpret, so a typo in
 * the directory fails loudly at load instead of silently dropping a source.
 */

export const NEWS_FOLDERS = Object.freeze([
  'reporting',
  'official',
  'local',
  'armed-group',
  'verification',
  'humanitarian',
  'analysis',
]);
export const NEWS_KINDS = Object.freeze([
  'independent',
  'state',
  'participant',
  'humanitarian',
  'verification',
  'analysis',
]);
export const NEWS_TRANSPORTS = Object.freeze([
  'rss',
  'telegram-public',
  'gdelt-domain',
  'reliefweb',
  'link-only',
]);
export const NEWS_PLACE_PRECISIONS = Object.freeze([
  'country',
  'region',
  'water',
  'city',
  'locality',
  'site',
]);

/** Situation Brief actors: what kind of actor, and its undisputed role. */
export const NEWS_ACTOR_TYPES = Object.freeze([
  'state',
  'armed-group',
  'institution',
  'population',
]);
export const NEWS_ACTOR_ROLES = Object.freeze([
  'party',
  'mediator',
  'institution',
  'affected',
  'external',
]);
/** Drivers are curated, slow-changing and opinion-prone: three at most. */
export const NEWS_DRIVER_CAP = 3;
const ACTOR_CAP = 24;
const TRACK_CAP = 4;

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TELEGRAM_CHANNEL = /^[A-Za-z][A-Za-z0-9_]{3,63}$/;
const DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ISO3 = /^[A-Z]{3}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function fail(message) {
  throw new Error(`news registry: ${message}`);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function validateTransport(id, transport) {
  if (!transport || !NEWS_TRANSPORTS.includes(transport.type))
    fail(`source ${id} has unknown transport ${transport?.type}`);
  switch (transport.type) {
    case 'rss':
      if (!httpsUrl(transport.url)) fail(`source ${id} rss url is invalid`);
      return { type: 'rss', url: transport.url };
    case 'telegram-public':
      if (!TELEGRAM_CHANNEL.test(String(transport.channel || '')))
        fail(`source ${id} telegram channel is invalid`);
      return { type: 'telegram-public', channel: transport.channel };
    case 'gdelt-domain':
      if (!DOMAIN.test(String(transport.domain || '')))
        fail(`source ${id} gdelt domain is invalid`);
      return { type: 'gdelt-domain', domain: transport.domain };
    case 'reliefweb': {
      const countries = Array.isArray(transport.countries)
        ? transport.countries
        : [];
      if (!countries.length || !countries.every((c) => ISO3.test(c)))
        fail(`source ${id} reliefweb countries must be ISO3 codes`);
      return { type: 'reliefweb', countries: [...countries] };
    }
    default:
      return { type: 'link-only' };
  }
}

/**
 * Validate the source directory document.
 * @param {unknown} doc Parsed sources.json.
 * @returns {Array<object>} Frozen, normalized sources.
 */
export function validateNewsSources(doc) {
  if (!Array.isArray(doc?.sources)) fail('sources must be an array');
  const seen = new Set();
  return doc.sources.map((source) => {
    const id = String(source?.id ?? '');
    if (!SLUG.test(id)) fail(`source id ${JSON.stringify(id)} is invalid`);
    if (seen.has(id)) fail(`duplicate source id ${id}`);
    seen.add(id);
    if (!nonEmptyString(source.name)) fail(`source ${id} needs a name`);
    if (!httpsUrl(source.homepage)) fail(`source ${id} homepage is invalid`);
    if (!NEWS_FOLDERS.includes(source.folder))
      fail(`source ${id} has unknown folder ${source.folder}`);
    if (!NEWS_KINDS.includes(source.kind))
      fail(`source ${id} has unknown kind ${source.kind}`);
    if (!SLUG.test(String(source.perspective || '')))
      fail(`source ${id} has an invalid perspective`);
    if (!nonEmptyString(source.credit)) fail(`source ${id} needs a credit`);
    const languages = Array.isArray(source.languages)
      ? source.languages.filter((lang) => /^[a-z]{2,3}$/.test(lang))
      : [];
    return Object.freeze({
      id,
      name: source.name.trim(),
      homepage: source.homepage,
      folder: source.folder,
      kind: source.kind,
      perspective: source.perspective,
      languages: Object.freeze(languages.length ? languages : ['en']),
      starred: source.starred === true,
      caution: typeof source.caution === 'string' ? source.caution : '',
      transport: Object.freeze(validateTransport(id, source.transport)),
      credit: source.credit.trim(),
    });
  });
}

function validateCategories(categories) {
  if (!Array.isArray(categories) || !categories.length)
    fail('theater needs at least one category');
  const ids = new Set();
  return categories.map((category) => {
    const id = String(category?.id ?? '');
    if (!SLUG.test(id)) fail(`category id ${JSON.stringify(id)} is invalid`);
    if (ids.has(id)) fail(`duplicate category ${id}`);
    ids.add(id);
    if (!nonEmptyString(category.label)) fail(`category ${id} needs a label`);
    if (!HEX_COLOR.test(String(category.color || '')))
      fail(`category ${id} needs a #rrggbb color`);
    return Object.freeze({
      id,
      label: category.label,
      color: category.color.toLowerCase(),
    });
  });
}

function validatePerspectives(perspectives) {
  if (!Array.isArray(perspectives) || !perspectives.length)
    fail('theater needs a perspective list');
  const ids = new Set();
  return perspectives.map((perspective) => {
    const id = String(perspective?.id ?? '');
    if (!SLUG.test(id)) fail(`perspective id ${JSON.stringify(id)} is invalid`);
    if (ids.has(id)) fail(`duplicate perspective ${id}`);
    ids.add(id);
    if (!SLUG.test(String(perspective.group || '')))
      fail(`perspective ${id} needs a group`);
    return Object.freeze({
      id,
      label: nonEmptyString(perspective.label) ? perspective.label : id,
      group: perspective.group,
    });
  });
}

function validateGazetteer(gazetteer) {
  if (!Array.isArray(gazetteer)) fail('theater gazetteer must be an array');
  const owners = new Map();
  return gazetteer.map((entry, index) => {
    const name = entry?.name;
    if (!nonEmptyString(name)) fail(`gazetteer row ${index} needs a name`);
    if (
      !Number.isFinite(entry.lat) ||
      Math.abs(entry.lat) > 90 ||
      !Number.isFinite(entry.lon) ||
      Math.abs(entry.lon) > 180
    )
      fail(`gazetteer ${name} has invalid coordinates`);
    if (!NEWS_PLACE_PRECISIONS.includes(entry.precision))
      fail(`gazetteer ${name} has unknown precision ${entry.precision}`);
    const aliases = Array.isArray(entry.aliases)
      ? entry.aliases.filter(nonEmptyString)
      : [];
    for (const spelling of [name, ...aliases]) {
      const key = normalizePlaceName(spelling);
      const owner = owners.get(key);
      if (owner !== undefined && owner !== name)
        fail(`gazetteer spelling ${spelling} is ambiguous (${owner}, ${name})`);
      owners.set(key, name);
    }
    return Object.freeze({
      name,
      lat: entry.lat,
      lon: entry.lon,
      precision: entry.precision,
      country: typeof entry.country === 'string' ? entry.country : null,
      aliases: Object.freeze(aliases),
      // Listed in the digest instructions (see placeNamesForPrompt).
      prompt: entry.prompt === true,
    });
  });
}

function optionalList(value, what) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`theater ${what} must be an array`);
  return value;
}

/**
 * Actors for the Situation Brief. Roles record only what is not in dispute;
 * who backs whom is never written here.
 */
function validateActors(actors) {
  const list = optionalList(actors, 'actors');
  if (list.length > ACTOR_CAP)
    fail(`theater has more than ${ACTOR_CAP} actors`);
  const ids = new Set();
  return list.map((actor) => {
    const id = String(actor?.id ?? '');
    if (!SLUG.test(id)) fail(`actor id ${JSON.stringify(id)} is invalid`);
    if (ids.has(id)) fail(`duplicate actor ${id}`);
    ids.add(id);
    if (!nonEmptyString(actor.name)) fail(`actor ${id} needs a name`);
    if (!NEWS_ACTOR_TYPES.includes(actor.type))
      fail(`actor ${id} has unknown type ${actor.type}`);
    if (!NEWS_ACTOR_ROLES.includes(actor.role))
      fail(`actor ${id} has unknown role ${actor.role}`);
    const aliases = Array.isArray(actor.aliases)
      ? actor.aliases.filter(nonEmptyString).map((alias) => alias.trim())
      : [];
    return Object.freeze({
      id,
      name: actor.name.trim(),
      type: actor.type,
      role: actor.role,
      aliases: Object.freeze(aliases),
    });
  });
}

function validateDrivers(drivers) {
  const list = optionalList(drivers, 'drivers');
  if (list.length > NEWS_DRIVER_CAP)
    fail(`theater may list at most ${NEWS_DRIVER_CAP} drivers`);
  return list.map((driver, index) => {
    if (!nonEmptyString(driver?.text)) fail(`driver ${index} needs text`);
    const source = driver.source;
    if (!nonEmptyString(source?.name) || !httpsUrl(source?.url))
      fail(`driver ${index} needs a source name and link`);
    return Object.freeze({
      text: driver.text.trim(),
      source: Object.freeze({ name: source.name.trim(), url: source.url }),
    });
  });
}

function validateTracks(tracks) {
  const list = optionalList(tracks, 'tracks');
  if (list.length > TRACK_CAP)
    fail(`theater has more than ${TRACK_CAP} tracks`);
  const ids = new Set();
  return list.map((track) => {
    const id = String(track?.id ?? '');
    if (!SLUG.test(id)) fail(`track id ${JSON.stringify(id)} is invalid`);
    if (ids.has(id)) fail(`duplicate track ${id}`);
    ids.add(id);
    if (!nonEmptyString(track.label)) fail(`track ${id} needs a label`);
    return Object.freeze({ id, label: track.label.trim() });
  });
}

/**
 * Validate one theater against the loaded source directory.
 * @param {unknown} doc Parsed theater file.
 * @param {Map<string, object>} sourcesById
 * @returns {object} Frozen theater.
 */
export function validateNewsTheater(doc, sourcesById) {
  const id = String(doc?.id ?? '');
  if (!SLUG.test(id)) fail(`theater id ${JSON.stringify(id)} is invalid`);
  if (!nonEmptyString(doc.name)) fail(`theater ${id} needs a name`);
  const categories = validateCategories(doc.categories);
  const perspectives = validatePerspectives(doc.perspectives);
  const perspectiveIds = new Set(perspectives.map((p) => p.id));
  if (!Array.isArray(doc.sourceIds) || !doc.sourceIds.length)
    fail(`theater ${id} needs source ids`);
  const sourceIds = [];
  for (const sourceId of doc.sourceIds) {
    const source = sourcesById.get(sourceId);
    if (!source) fail(`theater ${id} names unknown source ${sourceId}`);
    if (sourceIds.includes(sourceId))
      fail(`theater ${id} lists source ${sourceId} twice`);
    if (!perspectiveIds.has(source.perspective))
      fail(`source ${sourceId} has unknown perspective ${source.perspective}`);
    sourceIds.push(sourceId);
  }
  const brief = (Array.isArray(doc.brief) ? doc.brief : [doc.brief]).filter(
    nonEmptyString,
  );
  if (!brief.length) fail(`theater ${id} needs a brief`);
  const gdeltTerms = Array.isArray(doc.gdeltTerms)
    ? doc.gdeltTerms.filter((term) => /^[\p{L}\p{N} '-]{2,40}$/u.test(term))
    : [];
  // The Situation Brief explains one crisis; a theater without one (World)
  // turns it off.
  if (
    doc.situationBrief !== undefined &&
    typeof doc.situationBrief !== 'boolean'
  )
    fail(`theater ${id} situationBrief must be true or false`);
  return Object.freeze({
    id,
    name: doc.name,
    situationBrief: doc.situationBrief !== false,
    brief: Object.freeze(brief),
    sourceIds: Object.freeze(sourceIds),
    categories: Object.freeze(categories),
    perspectives: Object.freeze(perspectives),
    gdeltTerms: Object.freeze(gdeltTerms),
    gazetteer: Object.freeze(validateGazetteer(doc.gazetteer)),
    actors: Object.freeze(validateActors(doc.actors)),
    drivers: Object.freeze(validateDrivers(doc.drivers)),
    tracks: Object.freeze(validateTracks(doc.tracks)),
  });
}

/**
 * Load and cross-validate the source directory and one theater.
 * @param {{theaterId: string, root?: string}} options
 */
export async function loadNewsRegistry({
  theaterId,
  root = defaultSourceRoot,
} = {}) {
  if (!SLUG.test(String(theaterId || '')))
    fail(`unknown theater ${JSON.stringify(theaterId)}`);
  const newsDir = path.join(root, 'public', 'news');
  const sources = validateNewsSources(
    JSON.parse(await fsp.readFile(path.join(newsDir, 'sources.json'), 'utf8')),
  );
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  let theaterDoc;
  try {
    theaterDoc = JSON.parse(
      await fsp.readFile(
        path.join(newsDir, 'theaters', `${theaterId}.json`),
        'utf8',
      ),
    );
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`unknown theater ${theaterId}`);
    throw error;
  }
  const theater = validateNewsTheater(theaterDoc, sourcesById);
  if (theater.id !== theaterId)
    fail(`theater file ${theaterId} declares id ${theater.id}`);
  return { sources, sourcesById, theater };
}
