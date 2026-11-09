import { readResponseJsonCapped } from '../../../../src/sources/httpBody.js';
import { actorSourceDue, fetchActorSource, safeHttps } from './actor-fetch.js';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const ROLES = [
  'head-of-state',
  'head-of-government',
  'foreign-minister',
  'defence-minister',
];

export const shouldCheck = (context) => actorSourceDue(context, 7 * 24);

function countryCodes(registry) {
  return new Set(
    registry.countries
      .filter(
        ({ kind, dataIso3, iso3 }) =>
          kind !== 'disputed' && !dataIso3 && /^[A-Z]{3}$/.test(iso3),
      )
      .map(({ iso3 }) => iso3),
  );
}

export function actorDirectoryUrl(registry) {
  const codes = [...countryCodes(registry)]
    .map((code) => '"' + code + '"')
    .join(' ');
  // Kosovo has no assigned ISO 3166-1 alpha-3 code. Match its entity explicitly.
  const kosovo = countryCodes(registry).has('KOS')
    ? 'UNION { BIND(wd:Q1246 AS ?country) BIND("KOS" AS ?iso) }'
    : '';
  const query = `
    SELECT DISTINCT ?iso ?role ?person ?personLabel ?officeLabel ?governmentLabel
        ?since ?end ?rank ?image ?x ?bluesky ?mastodon ?youtube ?facebook
        ?instagram ?vk ?weibo ?website WHERE {
      { { VALUES ?iso { ${codes} } ?country wdt:P298 ?iso . } ${kosovo} }
      FILTER NOT EXISTS { ?country wdt:P576 [] }
      {
        VALUES (?role ?claim ?value ?officeProperty) {
          ("head-of-state" p:P35 ps:P35 wdt:P1906)
          ("head-of-government" p:P6 ps:P6 wdt:P1313)
        }
        ?country ?claim ?statement .
        ?statement ?value ?person .
        OPTIONAL { ?country ?officeProperty ?office . }
      }
      UNION
      {
        VALUES (?role ?class) {
          ("foreign-minister" wd:Q7330070)
          ("defence-minister" wd:Q2518691)
        }
        ?office wdt:P279 ?class; wdt:P1001 ?country; p:P1308 ?statement .
        ?statement ps:P1308 ?person .
      }
      ?person wdt:P31 wd:Q5 .
      ?statement wikibase:rank ?rank .
      FILTER(?rank != wikibase:DeprecatedRank)
      OPTIONAL { ?statement pq:P580 ?since . }
      OPTIONAL { ?statement pq:P582 ?end . }
      FILTER(!BOUND(?since) || ?since <= NOW())
      FILTER(!BOUND(?end) || ?end > NOW())
      FILTER NOT EXISTS { ?person wdt:P570 ?death . FILTER(?death <= NOW()) }
      OPTIONAL { ?country wdt:P122 ?government . }
      OPTIONAL { ?person wdt:P18 ?image . }
      OPTIONAL { ?person wdt:P2002 ?x . }
      OPTIONAL { ?person wdt:P12361 ?bluesky . }
      OPTIONAL { ?person wdt:P4033 ?mastodon . }
      OPTIONAL { ?person wdt:P2397 ?youtube . }
      OPTIONAL { ?person wdt:P2013 ?facebook . }
      OPTIONAL { ?person wdt:P2003 ?instagram . }
      OPTIONAL { ?person wdt:P3185 ?vk . }
      OPTIONAL { ?person wdt:P3579 ?weibo . }
      OPTIONAL { ?person wdt:P856 ?website . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
  const url = new URL(ENDPOINT);
  url.searchParams.set('query', query);
  return url.href;
}

function accountUrl(platform, raw) {
  const handle = raw?.trim().replace(/^@/, '');
  if (!handle) return null;
  const platforms = {
    x: [/^\w{1,15}$/, 'https://x.com/'],
    bluesky: [/^[a-z\d-]+(?:\.[a-z\d-]+)+$/i, 'https://bsky.app/profile/'],
    youtube: [/^UC[\w-]{22}$/, 'https://www.youtube.com/channel/'],
    facebook: [/^[\w.]+$/, 'https://www.facebook.com/'],
    instagram: [/^[\w.]+$/, 'https://www.instagram.com/'],
    vk: [/^[\w.]+$/, 'https://vk.com/'],
    weibo: [/^[\w-]+$/, 'https://weibo.com/u/'],
  };
  if (platform === 'website') return safeHttps(raw);
  if (platform === 'mastodon') {
    if (raw.startsWith('https://')) return safeHttps(raw);
    const match = /^([\w.-]+)@([a-z\d.-]+\.[a-z]{2,})$/i.exec(handle);
    return match ? 'https://' + match[2] + '/@' + match[1] : null;
  }
  const [pattern, base] = platforms[platform];
  return pattern.test(handle) ? base + handle : null;
}

function commonsFile(image) {
  const prefix =
    /^https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//i;
  if (!prefix.test(image)) return null;
  try {
    return decodeURIComponent(image.replace(prefix, '')) || null;
  } catch {
    return null;
  }
}

function fieldsFor(rows, key) {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort();
}

function chooseActor(rows, now) {
  const bestRank = rows.some(({ rank }) => rank?.endsWith('#PreferredRank'))
    ? rows.filter(({ rank }) => rank?.endsWith('#PreferredRank'))
    : rows;
  // Multiple distinct people at the best rank can represent acting or overlapping roles.
  // Without corroboration, do not pick a winner by label, QID, or response order.
  const [person, conflict] = fieldsFor(bestRank, 'person');
  if (!person || conflict) return null;
  const [row] = bestRank;
  const labels = fieldsFor(bestRank, 'personLabel');
  if (labels.length !== 1 || /^Q\d+$/.test(labels[0])) return null;
  const id = person.split('/').at(-1);
  const [office, conflictingOffice] = fieldsFor(bestRank, 'officeLabel');
  const [image] = fieldsFor(bestRank, 'image').map(commonsFile).filter(Boolean);
  const [since, conflictingSince] = fieldsFor(bestRank, 'since');
  const accountLinks = {};
  for (const platform of [
    'x',
    'bluesky',
    'mastodon',
    'youtube',
    'facebook',
    'instagram',
    'vk',
    'weibo',
    'website',
  ]) {
    const links = fieldsFor(bestRank, platform)
      .map((value) => accountUrl(platform, value))
      .filter(Boolean);
    if (links.length)
      accountLinks[platform] =
        links.length === 1 ? links[0] : [...new Set(links)];
  }
  return {
    id,
    kind: 'person',
    name: labels[0],
    role: row.role,
    country: row.iso,
    office:
      !conflictingOffice && office && !/^Q\d+$/.test(office) ? office : null,
    since: !conflictingSince && since ? since.slice(0, 10) : null,
    imageFile: image ?? null,
    accounts: accountLinks,
    source: 'wikidata',
    wikidataUrl: 'https://www.wikidata.org/wiki/' + id,
    lastChecked: now.toISOString(),
  };
}

function normalizeDirectory(bindings, registry, now) {
  const allowed = countryCodes(registry);
  const claims = new Map();
  const governmentClaims = new Map();
  for (const binding of bindings) {
    const row = Object.fromEntries(
      Object.entries(binding).map(([key, cell]) => [key, cell?.value]),
    );
    if (
      !allowed.has(row.iso) ||
      !ROLES.includes(row.role) ||
      !/^https?:\/\/www\.wikidata\.org\/entity\/Q\d+$/.test(row.person) ||
      row.rank?.endsWith('#DeprecatedRank') ||
      (row.since && !(Date.parse(row.since) <= +now)) ||
      (row.end && !(Date.parse(row.end) > +now))
    )
      continue;
    const key = row.iso + ':' + ROLES.indexOf(row.role);
    if (!claims.has(key)) claims.set(key, []);
    claims.get(key).push(row);
    if (!governmentClaims.has(row.iso)) governmentClaims.set(row.iso, []);
    governmentClaims.get(row.iso).push(row);
  }
  const actors = [...claims.keys()]
    .sort()
    .map((key) => chooseActor(claims.get(key), now))
    .filter(Boolean);
  const governments = {};
  for (const [country, rows] of governmentClaims) {
    const [label, conflict] = fieldsFor(rows, 'governmentLabel');
    if (label && !conflict && !/^Q\d+$/.test(label))
      governments[country] = label;
  }
  return { actors, governments };
}

export async function fetchObservations({ fetchImpl, registry, now, data }) {
  try {
    const response = await fetchActorSource(
      fetchImpl,
      actorDirectoryUrl(registry),
      now,
      {
        timeout: 65_000,
        headers: { Accept: 'application/sparql-results+json' },
      },
    );
    const body = await readResponseJsonCapped(response, 12_000_000);
    const directory = normalizeDirectory(body.results.bindings, registry, now);
    if (!directory.actors.length)
      return {
        error: 'Wikidata returned no unambiguous current officeholders',
      };
    return {
      data: { ...directory, retrievedAt: now.toISOString() },
      count: directory.actors.length,
      unit: 'role',
    };
  } catch (failure) {
    if (failure.retryAt)
      return {
        data: { ...data, retryAt: failure.retryAt },
        error: failure.message,
      };
    throw failure;
  }
}
