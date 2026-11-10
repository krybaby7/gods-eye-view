import { setTimeout as wait } from 'node:timers/promises';
import overrides from '../../../../public/world/curated/cia-office-overrides.json' with { type: 'json' };
import { readResponseJsonCapped } from '../../../../src/sources/httpBody.js';
import { officeRoles } from '../officeholders.js';
import { fetchOnDispatch } from './transport.js';

const BASE = 'https://www.cia.gov/resources/world-leaders';
const PAGE_DATA = BASE + '/page-data';
const INDEX = PAGE_DATA + '/foreign-governments/page-data.json';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PAUSE_MS = 300;
const DEADLINE_MS = 12_000;
const RUN_BUDGET_MS = 240_000;
const LOOKUP_HASH = '3338022342';

export const requestHost = 'www.cia.gov';

const textKey = (value) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const titlePatterns = {
  'head-of-state': [
    /^(?:(?:(?:fed\.|federal) )?(?:pres\.|president)|king|queen|emperor|pope|sultan|emir|amir)$/,
    /^supreme leader\b/,
    /^king\s*(?:&|and) prime min\.$/,
    /^head of state \(co-prince\)$/,
    /^presidency member\b/,
    /^co-prince\b/,
    /^captain(?:s)? regent\b/,
    /^member,? (?:of )?(?:the )?presidency\b/,
    /^chair(?:man)?,? (?:of )?(?:the )?presidency\b/,
  ],
  'head-of-government': [
    /^(?:prime min\.|prime minister)(?:$|\s*[,&])/,
    /^premier(?:$|\s*[,&])/,
    /^(?:federal )?chancellor$/,
    /^(?:pres\.|president) of the (?:govt\.|government|council of ministers)$/,
    /^head of (?:the )?(?:government|govt\.)$/,
    /^(?:chair|chairman|chairwoman|chmn\.),? (?:of the )?council of ministers$/,
    /^king\s*(?:&|and) prime min\.$/,
  ],
  'foreign-minister': [
    /^(?:cabinet|state) sec\. (?:of|for) foreign(?: and diaspora)? affairs\b/,
    /^(?:min\.|minister) (?:of|for) european (?:&|and) international affairs\b/,
    /^(?:min\.|minister|sec\.|secretary)(?: of| for|,)? (?:foreign|external) (?:affairs|relations)\b/,
    /^(?:foreign|external affairs) (?:min\.|minister)$/,
    /^(?:sec\.|secretary) of state for foreign(?: affairs\b|,|$)/,
    /^(?:min\.|minister) (?:of|for) (?:europe|european(?: affairs)?) (?:&|and) foreign affairs\b/,
    /^(?:min\.|minister) (?:of|for) (?:international|intl\.) relations (?:&|and) cooperation\b/,
  ],
  'defence-minister': [
    /^cabinet sec\. (?:of|for) (?:national )?defen[cs]e(?:$|\s*[,&])/,
    /^(?:min\.|minister) (?:of|for) the armies(?:$|\s*[,&])/,
    /^(?:sec\.|secretary) of state for defen[cs]e(?:$|\s*[,&])/,
    /^(?:min\.|minister|sec\.|secretary)(?: of| for|,)? (?:(?:national )?defen[cs]e(?! (?:production|industry|personnel))|the armed forces)\b/,
    /^(?:defen[cs]e|armed forces) (?:min\.|minister)$/,
  ],
};

function mapTitle(country, title) {
  const key = title.toLowerCase().replace(/\s+/g, ' ').trim();
  const clean = key
    .replace(/^(?:acting|interim) /, '')
    .replace(/\s+\((?:acting|interim)\)$/, '');
  const override = overrides.offices[country];
  if (Object.hasOwn(override?.titles ?? {}, clean)) {
    return {
      roles: override.titles[clean],
      office: override.officeLabels?.[clean],
      draft: override.source,
      plainTitle: isPlainTitle(clean),
    };
  }
  return {
    roles: officeRoles.filter((role) =>
      titlePatterns[role].some((pattern) => pattern.test(clean)),
    ),
    plainTitle: isPlainTitle(clean),
  };
}

// A comma directly after the office abbreviation is formatting, not an
// additional portfolio (e.g. "Chmn., Council of Ministers").
function isPlainTitle(title) {
  return !/(?:,|&|\band\b)/.test(title.replace(/^(\S+),/, '$1'));
}

export function parseCiaPage(json, slug) {
  const page = json?.result?.data?.page;
  const asOf = /^\d{4}-\d{2}-\d{2}(?=$|[T ])/.exec(page?.date_updated)?.[0];
  const stamp = Date.parse(asOf);
  if (
    !Number.isFinite(stamp) ||
    new Date(stamp).toISOString().slice(0, 10) !== asOf ||
    typeof page?.country !== 'string' ||
    !Array.isArray(page.leaders)
  )
    throw new Error('Invalid CIA country page for ' + slug);
  // Secondary lists represent a different administration or cabinet. Use the
  // primary cabinet consistently and retain the caveat for the offline audit.
  return {
    country: page.country,
    slug,
    asOf,
    caveat: String(page.caveat ?? ''),
    leaders: page.leaders
      .filter(
        ({ name, title }) =>
          typeof name === 'string' && typeof title === 'string',
      )
      .map(({ name, title }) => ({ name: name.trim(), title: title.trim() })),
  };
}

function displayName(name) {
  return name.replace(/\p{L}+/gu, (word, offset) => {
    const regnal =
      offset > 0 &&
      /^(?=[IVXLCDM]+$)M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(
        word,
      );
    if (word.length < 2 || word !== word.toUpperCase() || regnal) return word;
    // CIA capitalizes surnames wholesale. Only restore Mac for known Gaelic
    // forms, since names like Macron and Macut do not have a medial capital.
    const prefix =
      /^(?:MC(?=\p{L})|MAC(?=DONALD|KENNA|KENZIE|KINNON|NEILL|PHERSON|INTOSH))/u.exec(
        word,
      )?.[0];
    const split = prefix?.length ?? 0;
    return (
      (prefix ? 'M' + prefix.slice(1).toLowerCase() : '') +
      word[split] +
      word.slice(split + 1).toLowerCase()
    );
  });
}

export function resolveCiaCountry(label, registry) {
  return registry.countries.find(
    ({ iso3, name, kind, dataIso3 }) =>
      kind !== 'disputed' &&
      !dataIso3 &&
      textKey(overrides.countries[iso3]?.country ?? name ?? '') ===
        textKey(label),
  );
}

export function resolveCiaPage(page, registry) {
  const matching = resolveCiaCountry(page.country, registry);
  if (!matching) return [];
  const country = matching.iso3;
  const sourceUrl = BASE + '/foreign-governments/' + page.slug + '/';
  const actors = new Map();
  for (const { name, title } of page.leaders) {
    const acting = /\b(?:acting|interim)\b/i.test(name + ' ' + title);
    const label = displayName(
      name.replace(/\s*\((?:acting|interim|a\.k\.a\..*)\)$/i, ''),
    ).trim();
    if (
      !label ||
      /^(?:vacant|unknown|tbd|none|not appointed|n\/a|[-–—]+)$/i.test(label)
    )
      continue;
    const {
      roles,
      office,
      draft: titleSource,
      plainTitle,
    } = mapTitle(country, title);
    const draft = titleSource ?? overrides.countries[country]?.source;
    const { aliases } = overrides.nameAliases[country]?.[textKey(label)] ?? {};
    for (const role of roles) {
      const id = 'cia-' + country.toLowerCase() + '-' + textKey(label);
      const key = role + ':' + id;
      if (actors.has(key) && (!plainTitle || actors.get(key).plainTitle))
        continue;
      actors.delete(key);
      actors.set(key, {
        id,
        name: label,
        ...(aliases && { aliases }),
        kind: 'person',
        country,
        role,
        office: office ?? title,
        plainTitle,
        acting,
        asOf: page.asOf,
        source: 'cia-world-leaders',
        sourceUrl,
        ...(draft && { draft }),
      });
    }
  }
  return [...actors.values()].sort(
    (a, b) => officeRoles.indexOf(a.role) - officeRoles.indexOf(b.role),
  );
}

const due = (checked, now) => !(+now - Date.parse(checked) < WEEK_MS);

export function shouldCheck({ data, now }) {
  return (
    !(Date.parse(data?.retryAt) > +now) &&
    (due(data?.directory?.checkedAt, now) ||
      data.directory.entries.some(({ slug }) =>
        due(data.attempted?.[slug], now),
      ))
  );
}

function indexEntries(body) {
  const nodes = body?.data?.leaders?.nodes;
  if (!Array.isArray(nodes) || !nodes.length) return null;
  return [
    ...new Map(
      nodes.flatMap(({ country, uri }) => {
        if (typeof country !== 'string') return [];
        const slug =
          /^\/foreign-governments\/([a-z0-9-]+)\/?$/.exec(uri)?.[1] ??
          textKey(country);
        return slug ? [[slug, { slug, country }]] : [];
      }),
    ).values(),
  ];
}

async function fetchJson(
  fetchImpl,
  url,
  clock,
  budget,
  onDispatch,
  retryConnection,
) {
  const response = await fetchOnDispatch(
    fetchImpl,
    url,
    {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      retryConnection,
      signal: budget,
    },
    () => {
      onDispatch(clock());
      return AbortSignal.any([budget, AbortSignal.timeout(DEADLINE_MS)]);
    },
  );
  if (response.ok) return readResponseJsonCapped(response, 1_000_000);
  const failure = new Error('HTTP ' + response.status + ' from ' + requestHost);
  const now = clock();
  const retry = response.headers.get('Retry-After')?.trim();
  if (response.status === 429 || retry) {
    const requested = /^\d+$/.test(retry)
      ? +now + Number(retry) * 1000
      : Date.parse(retry);
    failure.retryAt = new Date(
      Number.isFinite(requested)
        ? Math.max(+now + 1000, requested)
        : +now + 3_600_000,
    ).toISOString();
  }
  await response.body?.cancel();
  throw failure;
}

export async function fetchObservations({
  fetchImpl,
  now,
  data,
  pause = wait,
  monotonic = () => performance.now(),
}) {
  let checkedAt = now.toISOString();
  const started = monotonic();
  const elapsed = () => Math.round(monotonic() - started);
  const clock = () => new Date(+now + elapsed());
  const budget = AbortSignal.timeout(RUN_BUDGET_MS);
  const budgetSpent = () => budget.aborted || elapsed() >= RUN_BUDGET_MS;
  const budgetError = new Error('CIA run budget exhausted');
  const errors = [];
  const pages = { ...data?.pages };
  const attempted = { ...data?.attempted };
  let directory = data?.directory;
  let retryAt;
  let requests = 0;
  let loadedPages = 0;
  let attemptedPages = 0;
  let consecutiveFailures = 0;
  async function request(url, onAttempt) {
    if (requests) await pause(PAUSE_MS, null, { signal: budget });
    if (budgetSpent()) throw budgetError;
    return fetchJson(
      fetchImpl,
      url,
      clock,
      budget,
      (startedAt) => {
        requests++;
        onAttempt?.(startedAt);
      },
      !onAttempt,
    );
  }
  function recordFailure(label, failure) {
    errors.push(label + ': ' + failure.message);
    retryAt = failure.retryAt;
  }
  if (!shouldCheck({ data, now }))
    return { data, count: 0, unit: 'page', checkedRelease: false };

  if (due(directory?.checkedAt, now)) {
    try {
      const index = await request(INDEX, (startedAt) => {
        checkedAt = startedAt.toISOString();
      });
      let entries = indexEntries(index);
      const hashes =
        index.staticQueryHashes?.filter((hash) => /^\d+$/.test(hash)) ?? [];
      if (hashes.includes(LOOKUP_HASH))
        hashes.sort((a, b) => (b === LOOKUP_HASH) - (a === LOOKUP_HASH));
      for (const hash of hashes) {
        if (entries) break;
        entries = indexEntries(
          await request(PAGE_DATA + '/sq/d/' + hash + '.json'),
        );
      }
      if (!entries?.length)
        throw new Error('Missing government list in CIA Gatsby index');
      directory = { entries, checkedAt };
    } catch (failure) {
      recordFailure('directory', failure);
      // Preserve the last index and avoid issuing another weekly directory
      // request on every Refresh after an outage.
      directory = { entries: directory?.entries ?? [], checkedAt };
    }
  }
  for (const { slug, country } of directory.entries) {
    if (retryAt || consecutiveFailures >= 3 || budgetSpent()) break;
    if (!due(attempted[slug], clock())) continue;
    try {
      const page = parseCiaPage(
        await request(
          PAGE_DATA + '/foreign-governments/' + slug + '/page-data.json',
          (startedAt) => {
            attempted[slug] = startedAt.toISOString();
            attemptedPages++;
          },
        ),
        slug,
      );
      if (textKey(country) !== textKey(page.country))
        throw new Error('Country label differs from the index');
      pages[slug] = page;
      loadedPages++;
      consecutiveFailures = 0;
    } catch (failure) {
      if (budgetSpent()) break;
      recordFailure(slug, failure);
      consecutiveFailures++;
    }
  }
  if (budgetSpent()) errors.push(budgetError.message);
  else if (consecutiveFailures >= 3)
    errors.push('Stopped CIA country pages after three consecutive failures');
  const active = new Set(directory.entries.map(({ slug }) => slug));
  const detail = `${loadedPages} of ${attemptedPages} CIA country pages loaded in ${elapsed()} ms (${requests} total requests, ${directory.entries.length} listed).`;
  return {
    data: {
      directory,
      pages: Object.fromEntries(
        Object.entries(pages).filter(([slug]) => active.has(slug)),
      ),
      attempted: Object.fromEntries(
        Object.entries(attempted).filter(([slug]) => active.has(slug)),
      ),
      retryAt,
      report: {
        listedPages: directory.entries.length,
        loadedPages,
        attemptedPages,
        requests,
        durationMs: elapsed(),
        errors,
      },
    },
    count: loadedPages,
    unit: 'page',
    detail,
    error: errors.length ? errors.join('; ') : undefined,
  };
}
