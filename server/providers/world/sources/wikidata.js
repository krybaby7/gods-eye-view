import { setTimeout as wait } from 'node:timers/promises';
import officeSeats from '../../../../public/world/curated/actor-office-seats.json' with { type: 'json' };
import { actorSourceDue, safeHttps } from './actor-fetch.js';
import { createWdqsClient } from './wdqs.js';

const BATCH_SIZE = 40;
const MAX_RECOVERY_CALLS = 8;
const RECOVERY_WINDOW_MS = 45_000;
const RUN_BUDGET_MS = 240_000;
const MAX_RETRY_MS = 60_000;
const ROLES = [
  'head-of-state',
  'head-of-government',
  'foreign-minister',
  'defence-minister',
];

export const version = 2;
export const shouldCheck = (context) =>
  context.rederive || actorSourceDue(context, 7 * 24);
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

function seatPattern(role, codes) {
  const state = role === 'head-of-state';
  if (state || role === 'head-of-government') {
    const officeKey = state ? 'state' : 'government';
    const overrides = codes.filter(
      (code) => officeSeats.countries[code]?.[officeKey],
    );
    const seats = overrides.flatMap((code) =>
      officeSeats.countries[code][officeKey].map(
        (seat) => `("${code}" wd:${seat} true)`,
      ),
    );
    const normal = `?country wdt:${state ? 'P1906' : 'P1313'} ?seat .`;
    if (!overrides.length) return normal;
    const exclude = `?iso NOT IN (${overrides.map(JSON.stringify).join(', ')})`;
    return seats.length
      ? `{ { ${normal} } UNION { VALUES (?iso ?seat ?override) { ${seats.join(' ')} } } }
         FILTER(BOUND(?override) || ${exclude})`
      : `${normal} FILTER(${exclude})`;
  }
  const kind = role === 'foreign-minister' ? 'Q7330070' : 'Q2518691';
  return `?seat (wdt:P279|wdt:P31) wd:${kind} ;
               (wdt:P1001|wdt:P17) ?country .`;
}

function directoryQuery(role, codes) {
  const isoMatch = `{ VALUES ?iso { ${codes.map((code) => '"' + code + '"').join(' ')} }
    ?country wdt:P298 ?iso . }`;
  // Kosovo has no ISO alpha-3 code. Resolve that UNION before the office joins.
  const hasKosovo = codes.includes('KOS');
  const countries = hasKosovo
    ? `{ SELECT ?iso ?country WHERE {
          ${isoMatch} UNION { BIND(wd:Q1246 AS ?country) BIND("KOS" AS ?iso) }
        } }`
    : isoMatch;
  // Blazegraph's default plan timed out on this UNION with the P6 statements.
  const optimizer =
    hasKosovo && role === 'head-of-government'
      ? 'hint:Query hint:optimizer "None" .'
      : '';
  if (role === 'government') {
    return `
      SELECT DISTINCT ?iso ?role ?government ?governmentLabel ?governmentParent WHERE {
        BIND("government" AS ?role)
        ${countries}
        ?country p:P122 ?form .
        ?form ps:P122 ?government; wikibase:rank ?rank .
        FILTER(?rank != wikibase:DeprecatedRank)
        OPTIONAL {
          ?country p:P122/ps:P122 ?governmentParent .
          ?government wdt:P279+ ?governmentParent .
          FILTER(?government != ?governmentParent)
        }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }`;
  }
  return `
    SELECT DISTINCT ?iso ?role ?person ?personLabel ?seat ?office ?officeLabel
        ?since ?rank ?nature ?image ?x ?bluesky ?mastodon ?youtube ?facebook
        ?instagram ?vk ?weibo ?website WHERE {
      ${optimizer}
      BIND("${role}" AS ?role)
      {
        SELECT DISTINCT ?iso ?person ?seat ?office ?since ?rank ?nature WHERE {
          {
            SELECT DISTINCT ?iso ?seat WHERE {
              ${countries}
              ${seatPattern(role, codes)}
              FILTER NOT EXISTS { ?country wdt:P576 [] }
            }
          }
          {
            { ?statement ps:P39 ?seat . BIND(?seat AS ?office) }
            UNION
            { ?office wdt:P279 ?seat . ?statement ps:P39 ?office . }
          }
          ?person p:P39 ?statement .
          ?statement ps:P39 ?office; pq:P580 ?since; wikibase:rank ?rank .
          ?person wdt:P31 wd:Q5 .
          FILTER(?rank != wikibase:DeprecatedRank)
          FILTER(?since <= NOW())
          FILTER NOT EXISTS { ?statement pq:P582 [] }
          FILTER NOT EXISTS { ?statement pq:P1366 [] }
          OPTIONAL { ?statement pq:P5102 ?nature . }
          FILTER NOT EXISTS { ?person wdt:P570 ?death . FILTER(?death <= NOW()) }
        }
      }
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
  const [row] = rows;
  const labels = fieldsFor(rows, 'personLabel');
  if (labels.length !== 1 || /^Q\d+$/.test(labels[0])) return null;
  const id = row.person.split('/').at(-1);
  const [office, conflictingOffice] = fieldsFor(rows, 'officeLabel');
  const [image] = fieldsFor(rows, 'image').map(commonsFile).filter(Boolean);
  const seats = officeSeats.countries[row.iso];
  const collective =
    seats?.collective &&
    (row.role === 'head-of-state' ||
      (row.role === 'head-of-government' && seats.government?.length));
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
    const links = fieldsFor(rows, platform)
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
    since: row.since.slice(0, 10),
    acting: rows.some(
      ({ nature, officeLabel }) =>
        /\/Q(?:4676846|20012923)$/.test(nature ?? '') ||
        /^(?:acting|interim)\b/i.test(officeLabel ?? ''),
    ),
    ...(collective && { collective: seats.collective }),
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
    if (!allowed.has(row.iso)) continue;
    if (row.role === 'government') {
      if (!row.governmentLabel || /^Q\d+$/.test(row.governmentLabel)) continue;
      if (!governmentClaims.has(row.iso)) governmentClaims.set(row.iso, []);
      governmentClaims.get(row.iso).push(row);
      continue;
    }
    if (
      !ROLES.includes(row.role) ||
      !/^https?:\/\/www\.wikidata\.org\/entity\/Q\d+$/.test(row.person) ||
      row.rank?.endsWith('#DeprecatedRank') ||
      !(Date.parse(row.since) <= +now) ||
      row.end ||
      row.replacedBy
    )
      continue;
    const state = row.role === 'head-of-state';
    const seats = officeSeats.countries[row.iso];
    const separateSeats = state && seats?.state?.length > 1;
    const staggered =
      ['head-of-state', 'head-of-government'].includes(row.role) &&
      seats?.staggered;
    const key = [
      row.iso,
      ROLES.indexOf(row.role),
      separateSeats ? row.seat : staggered ? row.person : '',
    ].join(':');
    if (!claims.has(key)) claims.set(key, []);
    claims.get(key).push(row);
  }
  const actors = [...claims.keys()]
    .sort()
    .flatMap((key) => {
      const rows = claims.get(key);
      const latest = Math.max(...rows.map(({ since }) => Date.parse(since)));
      const current = rows.filter(({ since }) => Date.parse(since) === latest);
      return fieldsFor(current, 'person').map((person) =>
        chooseActor(
          current.filter((row) => row.person === person),
          now,
        ),
      );
    })
    .filter(Boolean);
  const governments = {};
  for (const [country, rows] of governmentClaims) {
    const forms = new Map();
    for (const row of rows) {
      if (!forms.has(row.government)) {
        forms.set(row.government, {
          label: row.governmentLabel,
          parents: new Set(),
        });
      }
      if (row.governmentParent)
        forms.get(row.government).parents.add(row.governmentParent);
    }
    governments[country] = [
      ...new Set(
        [...forms.values()]
          .sort(
            (a, b) =>
              b.parents.size - a.parents.size || a.label.localeCompare(b.label),
          )
          .map(({ label }) => label),
      ),
    ];
  }
  for (const {
    until,
    checkedOn,
    reason,
    sourceGapUrl,
    ...actor
  } of officeSeats.corrections) {
    if (
      allowed.has(actor.country) &&
      +now >= Date.parse(actor.since) &&
      +now < Date.parse(until) &&
      !actors.some(
        ({ country, role, name }) =>
          country === actor.country &&
          role === actor.role &&
          name === actor.name,
      )
    ) {
      actors.push({
        ...actor,
        until,
        kind: 'person',
        source: 'official',
        lastChecked: checkedOn,
      });
    }
  }
  return { actors, governments };
}

export async function fetchObservations({
  fetchImpl,
  registry,
  now,
  data,
  rederive,
}) {
  const codes = [...countryCodes(registry)].sort();
  const tracks = ['government', ...ROLES];
  const total = Math.ceil(codes.length / BATCH_SIZE) * tracks.length;
  const budget = AbortSignal.timeout(RUN_BUDGET_MS);
  const query = createWdqsClient(fetchImpl, now, budget);
  const started = performance.now();
  const bindings = [];
  const completed = new Set();
  const errors = [];
  let succeeded = 0;
  let consecutiveTimeouts = 0;
  const recovery = [];
  let recoveryCalls = 0;
  let recoveredSlices = 0;

  function stopped() {
    return budget.aborted || consecutiveTimeouts >= 3;
  }

  async function attempt(sparql) {
    try {
      const rows = await query(sparql);
      consecutiveTimeouts = 0;
      return { rows };
    } catch (failure) {
      consecutiveTimeouts = timedOut(failure) ? consecutiveTimeouts + 1 : 0;
      return { failure };
    }
  }

  async function loadBatch(role, batch) {
    const sparql = directoryQuery(role, batch);
    let { rows, failure } = await attempt(sparql);
    const retryDelay =
      Date.parse(failure?.retryAt) - (+now + performance.now() - started);
    if (retryDelay > 0 && retryDelay <= MAX_RETRY_MS && !stopped()) {
      try {
        await wait(Math.ceil(retryDelay), null, { signal: budget });
      } catch {
        return budget.reason;
      }
      ({ rows, failure } = await attempt(sparql));
    }
    if (!failure) {
      for (const code of batch) completed.add(code + ':' + role);
      for (const row of rows) {
        if (row?.role?.value === role && batch.includes(row.iso?.value))
          bindings.push(row);
      }
    }
    return failure;
  }
  const describe = (failure) => failure.cause?.code ?? failure.message;
  const timedOut = (failure) =>
    failure.name === 'TimeoutError' ||
    failure.message === 'HTTP 504 from query.wikidata.org';

  batches: for (const role of tracks) {
    for (let offset = 0; offset < codes.length; offset += BATCH_SIZE) {
      const batch = codes.slice(offset, offset + BATCH_SIZE);
      const failure = await loadBatch(role, batch);
      if (!failure) succeeded += 1;
      else if (
        !failure.retryAt &&
        batch.length > 1 &&
        (timedOut(failure) ||
          failure.message === 'HTTP 502 from query.wikidata.org')
      ) {
        recovery.push({ role, batch, failure });
      } else {
        errors.push(describe(failure));
      }
      if (stopped()) break batches;
    }
  }

  // Give the original batches a chance before spending extra WDQS quota.
  const recoveryDeadline = performance.now() + RECOVERY_WINDOW_MS;
  for (const { role, batch, failure } of recovery) {
    const midpoint = Math.ceil(batch.length / 2);
    let recovered = 0;
    const failures = [];
    for (const slice of [batch.slice(0, midpoint), batch.slice(midpoint)]) {
      if (
        stopped() ||
        recoveryCalls >= MAX_RECOVERY_CALLS ||
        performance.now() >= recoveryDeadline
      )
        break;
      recoveryCalls += 1;
      const sliceFailure = await loadBatch(role, slice);
      if (sliceFailure) failures.push(describe(sliceFailure));
      else {
        recovered += 1;
        recoveredSlices += 1;
      }
    }
    if (recovered === 2) succeeded += 1;
    else errors.push(...(failures.length ? failures : [describe(failure)]));
  }
  const directory = normalizeDirectory(bindings, registry, now);
  const detail =
    `${succeeded} of ${total} Wikidata batches completed.` +
    (recoveryCalls
      ? ` Loaded ${recoveredSlices} of ${recoveryCalls} recovery slices.`
      : '');
  if (stopped()) {
    errors.push(
      budget.aborted
        ? 'The four-minute Wikidata budget expired.'
        : 'Skipped remaining Wikidata batches after three consecutive timeouts.',
    );
  }
  const error = errors.length
    ? detail + ' ' + [...new Set(errors)].join('; ')
    : undefined;

  if (
    (stopped() && data && !rederive) ||
    (!directory.actors.length && !Object.keys(directory.governments).length)
  ) {
    return {
      error:
        error ??
        'Wikidata returned no dated current officeholders or government types',
      detail,
    };
  }
  if (errors.length && !rederive) {
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
    directory.governments = {
      ...Object.fromEntries(
        Object.entries(data?.governments ?? {}).filter(
          ([country]) => !completed.has(country + ':government'),
        ),
      ),
      ...directory.governments,
    };
  }
  return {
    data: { ...directory, retrievedAt: now.toISOString() },
    count: directory.actors.length,
    unit: 'role',
    detail,
    error,
  };
}
