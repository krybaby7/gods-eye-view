import { actorSourceDue, safeHttps } from './actor-fetch.js';
import { createWdqsClient } from './wdqs.js';

const BATCH_SIZE = 40;
const ROLES = [
  'head-of-state',
  'head-of-government',
  'foreign-minister',
  'defence-minister',
];

export const shouldCheck = (context) => actorSourceDue(context, 7 * 24);
export const requestHost = 'query.wikidata.org';

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

const ROLE_PATTERNS = {
  'head-of-state': `
    ?country p:P35 ?statement .
    ?statement ps:P35 ?person .
    OPTIONAL { ?country wdt:P1906 ?office . }`,
  'head-of-government': `
    ?country p:P6 ?statement .
    ?statement ps:P6 ?person .
    OPTIONAL { ?country wdt:P1313 ?office . }`,
  'foreign-minister': `
    ?office wdt:P279 wd:Q7330070; wdt:P1001 ?country; p:P1308 ?statement .
    ?statement ps:P1308 ?person .`,
  'defence-minister': `
    ?office wdt:P279 wd:Q2518691; wdt:P1001 ?country; p:P1308 ?statement .
    ?statement ps:P1308 ?person .`,
};

function directoryQuery(role, codes) {
  // Kosovo has no assigned ISO 3166-1 alpha-3 code. Match its entity explicitly.
  const kosovo = codes.includes('KOS')
    ? 'UNION { BIND(wd:Q1246 AS ?country) BIND("KOS" AS ?iso) }'
    : '';
  return `
    SELECT DISTINCT ?iso ?role ?person ?personLabel ?officeLabel ?governmentLabel
        ?since ?end ?rank ?image ?x ?bluesky ?mastodon ?youtube ?facebook
        ?instagram ?vk ?weibo ?website WHERE {
      BIND("${role}" AS ?role)
      {
        SELECT DISTINCT ?iso ?country ?person ?office ?since ?end ?rank WHERE {
          {
            SELECT ?iso ?country WHERE {
              { VALUES ?iso { ${codes.map((code) => '"' + code + '"').join(' ')} }
                ?country wdt:P298 ?iso . } ${kosovo}
            }
          }
          ${ROLE_PATTERNS[role]}
          FILTER NOT EXISTS { ?country wdt:P576 [] }
          ?person wdt:P31 wd:Q5 .
          ?statement wikibase:rank ?rank .
          FILTER(?rank != wikibase:DeprecatedRank)
          OPTIONAL { ?statement pq:P580 ?since . }
          OPTIONAL { ?statement pq:P582 ?end . }
          FILTER(!BOUND(?since) || ?since <= NOW())
          FILTER(!BOUND(?end) || ?end > NOW())
          FILTER NOT EXISTS { ?person wdt:P570 ?death . FILTER(?death <= NOW()) }
        }
      }
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
  const codes = [...countryCodes(registry)].sort();
  const total = Math.ceil(codes.length / BATCH_SIZE) * ROLES.length;
  const query = createWdqsClient(fetchImpl, now);
  const bindings = [];
  const completed = new Set();
  const errors = [];
  let succeeded = 0;
  let retryAt;
  batches: for (const role of ROLES) {
    for (let offset = 0; offset < codes.length; offset += BATCH_SIZE) {
      const batch = codes.slice(offset, offset + BATCH_SIZE);
      try {
        const rows = await query(directoryQuery(role, batch));
        for (const code of batch) completed.add(code + ':' + role);
        for (const row of rows) {
          if (row?.role?.value === role && batch.includes(row.iso?.value))
            bindings.push(row);
        }
        succeeded += 1;
      } catch (failure) {
        errors.push(failure.cause?.code ?? failure.message);
        retryAt = failure.retryAt;
        if (retryAt) break batches;
      }
    }
  }
  const directory = normalizeDirectory(bindings, registry, now);
  const detail = `${succeeded} of ${total} Wikidata batches completed.`;
  const error = errors.length
    ? detail + ' ' + [...new Set(errors)].join('; ')
    : undefined;

  if (!directory.actors.length) {
    return {
      ...(retryAt && { data: { ...data, retryAt } }),
      error: error ?? 'Wikidata returned no unambiguous current officeholders',
      detail,
    };
  }
  if (errors.length) {
    directory.actors.push(
      ...(data?.actors ?? []).filter(
        ({ country, role }) => !completed.has(country + ':' + role),
      ),
    );
    directory.actors.sort(
      (a, b) =>
        a.country.localeCompare(b.country) ||
        ROLES.indexOf(a.role) - ROLES.indexOf(b.role),
    );
    directory.governments = { ...data?.governments, ...directory.governments };
  }
  return {
    data: { ...directory, retrievedAt: now.toISOString(), retryAt },
    count: directory.actors.length,
    unit: 'role',
    detail,
    error,
  };
}
