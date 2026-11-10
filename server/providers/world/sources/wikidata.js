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

export const version = 5;
export const shouldCheck = (context) =>
  !(Date.parse(context.data?.retryAt) > +context.now) &&
  (context.rederive || actorSourceDue(context, 7 * 24));
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

function officeOverrides(role, codes) {
  const key =
    role === 'head-of-state'
      ? 'state'
      : role === 'head-of-government'
        ? 'government'
        : null;
  if (!key) return [];
  return codes.flatMap((code) => {
    const seats = officeSeats.countries[code]?.[key];
    return seats ? [[code, seats]] : [];
  });
}

function seatPattern(role, overrides) {
  const state = role === 'head-of-state';
  if (state || role === 'head-of-government') {
    const seats = overrides.flatMap(([code, offices]) =>
      offices.map((seat) => `("${code}" wd:${seat} true)`),
    );
    const normal = `?country wdt:${state ? 'P1906' : 'P1313'} ?seat .`;
    if (!overrides.length) return normal;
    const exclude = `?iso NOT IN (${overrides.map(([code]) => JSON.stringify(code)).join(', ')})`;
    return seats.length
      ? `{ { ${normal} } UNION { VALUES (?iso ?seat ?override) { ${seats.join(' ')} } } }
         FILTER(BOUND(?override) || ${exclude})`
      : `${normal} FILTER(${exclude})`;
  }
  const kind = role === 'foreign-minister' ? 'Q7330070' : 'Q2518691';
  return `{ ?seat wdt:P279 wd:${kind} . } UNION { ?seat wdt:P31 wd:${kind} . }
          { ?seat wdt:P1001 ?country . }
          UNION {
            ?seat wdt:P17 ?country .
            FILTER NOT EXISTS { ?seat wdt:P1001 [] }
          }`;
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
  if (role === 'government') {
    return `
      SELECT DISTINCT ?iso ?role ?government ?governmentLabel ?governmentParent WHERE {
        BIND("government" AS ?role)
        ${countries}
        ?country p:P122 ?form .
        ?form ps:P122 ?government; wikibase:rank ?rank .
        FILTER(?rank != wikibase:DeprecatedRank)
        FILTER NOT EXISTS { ?form pq:P580 ?start . FILTER(?start > NOW()) }
        FILTER NOT EXISTS { ?form pq:P582 ?end . FILTER(?end <= NOW()) }
        OPTIONAL {
          ?country p:P122/ps:P122 ?governmentParent .
          ?government wdt:P279+ ?governmentParent .
          FILTER(?government != ?governmentParent)
        }
        SERVICE wikibase:label {
          bd:serviceParam wikibase:language "en".
          ?government rdfs:label ?governmentLabel .
        }
      }`;
  }
  const overrides = officeOverrides(role, codes);
  return `
    SELECT DISTINCT ?iso ?role ?seat WHERE {
      hint:Query hint:optimizer "None" .
      BIND("${role}" AS ?role)
      ${countries}
      ${seatPattern(role, overrides)}
      FILTER NOT EXISTS { ?country wdt:P576 [] }
    }`;
}

function boundTuples(rows, role, codes, includePerson) {
  const tuples = new Set();
  const itemId = (value) =>
    /^https?:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d*)$/.exec(value)?.[1];
  for (const row of rows) {
    const iso = row.iso?.value;
    const seat = itemId(row.seat?.value);
    const person = itemId(row.person?.value);
    if (row.role?.value !== role || !codes.includes(iso) || !seat) continue;
    if (includePerson && !person) continue;
    tuples.add(`("${iso}" wd:${seat}${includePerson ? ' wd:' + person : ''})`);
  }
  return [...tuples];
}

function candidatesQuery(role, tuples) {
  return `
    SELECT DISTINCT ?iso ?role ?seat ?person WHERE {
      hint:Query hint:optimizer "None" .
      BIND("${role}" AS ?role)
      VALUES (?iso ?seat) { ${tuples.join(' ')} }
      {
        ?knownStatement ps:P39 ?seat .
        {
          ?knownStatement pq:P580 ?candidateSince .
        } UNION {
          FILTER NOT EXISTS { ?knownStatement pq:P580 [] }
          { ?knownStatement pq:P1365 [] }
          UNION { ?knownStatement wikibase:rank wikibase:PreferredRank }
        }
        FILTER NOT EXISTS { ?knownStatement pq:P582 [] }
        FILTER NOT EXISTS { ?knownStatement pq:P1366 [] }
        ?person p:P39 ?knownStatement .
      } UNION {
        ?seat p:P1308 ?nomination .
        ?nomination ps:P1308 ?person .
        FILTER NOT EXISTS { ?nomination pq:P582 [] }
        FILTER NOT EXISTS { ?nomination pq:P1366 [] }
      }
    }`;
}

function verificationQuery(role, tuples) {
  return `
    SELECT DISTINCT ?iso ?role ?person ?personLabel ?seat ?office ?officeLabel
        ?since ?rank ?nature ?image ?x ?bluesky ?mastodon ?youtube ?facebook
        ?instagram ?vk ?weibo ?website WHERE {
      BIND("${role}" AS ?role)
      {
        SELECT DISTINCT ?iso ?person ?seat ?office ?since ?rank ?nature WHERE {
          hint:SubQuery hint:optimizer "None" .
          VALUES (?iso ?seat ?person) { ${tuples.join(' ')} }
          ?person p:P39 ?statement .
          ?statement ps:P39 ?office; wikibase:rank ?rank .
          OPTIONAL { ?statement pq:P580 ?since . }
          FILTER(?office = ?seat || EXISTS { ?office wdt:P279 ?seat . })
          ?person wdt:P31 wd:Q5 .
          FILTER(?rank != wikibase:DeprecatedRank)
          FILTER(!BOUND(?since) || ?since <= NOW())
          FILTER(!BOUND(?since) || ${role.startsWith('head-of-') ? '?iso = "CHE" || ' : ''}NOT EXISTS {
            ?laterStatement ps:P39 ?seat; pq:P580 ?laterStart; wikibase:rank ?laterRank .
            FILTER(?laterRank != wikibase:DeprecatedRank && ?laterStart > ?since && ?laterStart <= NOW())
          })
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
    since: row.since?.slice(0, 10) || null,
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
  const undatedClaims = new Map();
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
      (row.since && !(Date.parse(row.since) <= +now)) ||
      row.end ||
      row.replacedBy
    )
      continue;
    if (!row.since) {
      const key = [row.iso, row.role, row.person].join(':');
      if (!undatedClaims.has(key)) undatedClaims.set(key, []);
      undatedClaims.get(key).push(row);
      continue;
    }
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
  const dated = new Set(
    actors.map(({ country, role, id }) => country + ':' + role + ':' + id),
  );
  const undatedActors = [...undatedClaims.values()]
    .map((rows) => chooseActor(rows, now))
    .filter(
      (actor) =>
        actor && !dated.has(actor.country + ':' + actor.role + ':' + actor.id),
    );
  return { actors, undatedActors, governments };
}

export async function fetchObservations({
  fetchImpl,
  registry,
  now,
  data,
  rederive,
}) {
  const codes = [...countryCodes(registry)].sort();
  const slices = [];
  for (let offset = 0; offset < codes.length; offset += BATCH_SIZE)
    slices.push(codes.slice(offset, offset + BATCH_SIZE));
  const batches = [
    ...slices.map((batch) => ['government', batch]),
    ...slices.flatMap((batch) => ROLES.map((role) => [role, batch])),
  ];
  const total = batches.length;
  const budget = AbortSignal.timeout(RUN_BUDGET_MS);
  const query = createWdqsClient(fetchImpl, now, budget);
  const started = performance.now();
  const bindings = [];
  const completed = new Set();
  const errors = [];
  let consecutiveStrikes = 0;
  let retryAt;
  const recovery = [];
  let recoveryCalls = 0;
  let recoveredSlices = 0;

  function stopped() {
    return budget.aborted || consecutiveStrikes >= 3 || Boolean(retryAt);
  }

  async function attempt(sparql) {
    try {
      const rows = await query(sparql);
      consecutiveStrikes = 0;
      return { rows };
    } catch (failure) {
      consecutiveStrikes =
        timedOut(failure) || failure.status === 429
          ? consecutiveStrikes + 1
          : 0;
      return { failure };
    }
  }

  async function attemptWithRetry(sparql) {
    let result = await attempt(sparql);
    const delayFor = (failure) =>
      Date.parse(failure?.retryAt) - (+now + performance.now() - started);
    const retryDelay = delayFor(result.failure);
    if (
      retryDelay > 0 &&
      retryDelay <= MAX_RETRY_MS &&
      result.failure.retryAfterMs <= MAX_RETRY_MS &&
      !stopped()
    ) {
      try {
        await wait(Math.ceil(retryDelay), null, { signal: budget });
      } catch {
        return { failure: budget.reason };
      }
      result = await attempt(sparql);
    }
    if (
      result.failure?.retryAfterMs > MAX_RETRY_MS ||
      delayFor(result.failure) > MAX_RETRY_MS
    )
      retryAt = result.failure.retryAt;
    return result;
  }

  async function loadBatch(role, batch) {
    let { rows, failure } = await attemptWithRetry(directoryQuery(role, batch));
    if (!failure && role !== 'government') {
      const seats = boundTuples(rows, role, batch, false);
      rows = [];
      if (seats.length) {
        const candidates = await attemptWithRetry(candidatesQuery(role, seats));
        failure = candidates.failure;
        if (!failure) {
          const tuples = boundTuples(candidates.rows, role, batch, true);
          if (tuples.length)
            ({ rows, failure } = await attemptWithRetry(
              verificationQuery(role, tuples),
            ));
        }
      }
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
    /^HTTP 504 from (?:query|www)\.wikidata\.org$/.test(failure.message);

  for (const [role, batch] of batches) {
    const failure = await loadBatch(role, batch);
    if (!failure) continue;
    if (
      !failure.retryAt &&
      batch.length > 1 &&
      (timedOut(failure) ||
        failure.message === 'HTTP 502 from query.wikidata.org')
    ) {
      recovery.push({ role, batch, failure });
    } else {
      errors.push(describe(failure));
    }
    if (stopped()) break;
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
    if (recovered !== 2)
      errors.push(...(failures.length ? failures : [describe(failure)]));
  }
  // WDQS reports an item's QID when it has no English label. Resolve the
  // title of the English Wikipedia article linked on that exact item.
  const missingLabels = new Map();
  for (const row of bindings) {
    const id = row.person?.value?.split('/').at(-1);
    if (!/^Q[1-9]\d*$/.test(id) || row.personLabel?.value !== id) continue;
    if (!missingLabels.has(id)) missingLabels.set(id, []);
    missingLabels.get(id).push(row);
  }
  const unlabeled = [...missingLabels.keys()];
  for (let offset = 0; offset < unlabeled.length && !stopped(); offset += 50) {
    const ids = unlabeled.slice(offset, offset + 50);
    const { rows: entities, failure } = await attemptWithRetry(ids);
    if (failure) {
      errors.push(describe(failure));
      continue;
    }
    for (const id of ids) {
      const title = entities[id]?.sitelinks?.enwiki?.title;
      if (typeof title !== 'string' || !title || /^\w+:/u.test(title)) continue;
      for (const row of missingLabels.get(id))
        row.personLabel = { value: title };
    }
  }
  for (const [id, rows] of missingLabels) {
    if (!rows.some((row) => row.personLabel.value === id)) continue;
    for (const row of rows)
      completed.delete(row.iso.value + ':' + row.role.value);
  }
  if (
    unlabeled.some((id) =>
      missingLabels.get(id).some((row) => row.personLabel.value === id),
    )
  )
    errors.push(
      'Unresolved Wikidata sitelinks left the affected roles incomplete.',
    );
  const succeeded = batches.filter(([role, batch]) =>
    batch.every((code) => completed.has(code + ':' + role)),
  ).length;
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
        : retryAt
          ? 'Skipped remaining Wikidata batches because Retry-After exceeded 60 seconds.'
          : 'Skipped remaining Wikidata batches after three consecutive timeouts or rate limits.',
    );
  }
  const error = errors.length
    ? detail + ' ' + [...new Set(errors)].join('; ')
    : undefined;

  // Version 2 partial results predate the marker. Only that implementation
  // wrote the acting boolean on dated Wikidata person-statement records.
  const verifiedCache =
    data?.method === 'person-p39' ||
    data?.actors?.some(
      ({ acting, since, source }) =>
        typeof acting === 'boolean' && Boolean(since) && source === 'wikidata',
    );
  if (
    (!completed.size || !errors.length) &&
    !retryAt &&
    !directory.actors.length &&
    !directory.undatedActors.length &&
    !Object.keys(directory.governments).length
  ) {
    return {
      error:
        error ??
        'Wikidata returned no dated current officeholders or government types',
      detail,
    };
  }
  if (errors.length && (!rederive || verifiedCache)) {
    for (const key of ['actors', 'undatedActors']) {
      const pending = (data?.[key] ?? []).filter(
        ({ country, role }) => !completed.has(country + ':' + role),
      );
      const preserved = new Set(
        pending.map(({ country, role }) => country + ':' + role),
      );
      directory[key] = [
        ...directory[key].filter(
          ({ country, role }) => !preserved.has(country + ':' + role),
        ),
        ...pending,
      ].sort(
        (a, b) =>
          a.country?.localeCompare(b.country) ||
          ROLES.indexOf(a.role) - ROLES.indexOf(b.role),
      );
    }
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
    data: {
      ...directory,
      method: 'person-p39',
      retrievedAt: now.toISOString(),
      retryAt,
      completion: {
        completed: succeeded,
        total,
        completedRoles: completed.size,
        recoveredSlices,
      },
    },
    count: directory.actors.length,
    unit: 'role',
    detail,
    error,
  };
}
