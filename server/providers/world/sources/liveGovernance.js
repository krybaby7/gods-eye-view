import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { conditionFlag, conditionResult } from '../conditionEvents.js';
import { columnIndices, csvRows } from './csv.js';
import { fipsCountry } from './liveCountryCodes.js';
import { DAY, download, due } from './liveFeedCommon.js';
import { zipEntryChunks } from './zip.js';

const POWELL = 'https://jonathanmpowell.com/coups/';
const GDELT = 'https://www.gdeltproject.org/data.html';
const GDELT_MANIFEST = 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt';
const BATCH = 15 * 60_000;
const MAX_MISSED_BATCHES = 4;
const GDELT_WINDOW = 3 * DAY;
export const GDELT_MIN_EVENTS = 3;
// CAMEO actor roles for military, rebel and other identified armed forces.
const ARMED_ACTOR_ROLES = new Set(['MIL', 'REB', 'INS', 'SEP', 'UAF']);
const COUNTRY_DOMAIN_CATEGORIES = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'go',
  'gob',
  'gov',
  'net',
  'ne',
  'or',
  'org',
]);

function publisherDomain(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(host) || !host.includes('.')) return null;
  const labels = host.split('.');
  const countryCategory =
    labels.at(-1).length === 2 && COUNTRY_DOMAIN_CATEGORIES.has(labels.at(-2));
  return labels.length >= (countryCategory ? 3 : 2)
    ? labels.slice(countryCategory ? -3 : -2).join('.')
    : null;
}

function articleIdentity(url) {
  const source = new URL(url);
  return (
    source.hostname.replace(/^www\d*\./, '') + source.pathname + source.search
  );
}

function gdeltTime(date) {
  const time = Date.parse(date);
  return Number.isFinite(time) &&
    time % BATCH === 0 &&
    new Date(time).toISOString() === date
    ? time
    : NaN;
}

function inGdeltWindow(time, sampledAt) {
  return time <= +sampledAt && +sampledAt - time <= GDELT_WINDOW;
}

const COUP_ALIASES = {
  'Myanmar (Burma)': 'MMR',
  'DR Congo (Zaire)': 'COD',
  'Ivory Coast': 'CIV',
  'South Sudan': 'SSD',
  Congo: 'COG',
  'Congo-Brazzaville': 'COG',
  'Sao Tome and Principe': 'STP',
  'São Tomé and Príncipe': 'STP',
  Swaziland: 'SWZ',
  eSwatini: 'SWZ',
  Eswatini: 'SWZ',
};

export function coupFlags(csv, now, countries, source) {
  const rows = csvRows(csv);
  const fields = columnIndices(rows.next().value, [
    'country',
    'year',
    'month',
    'day',
    'coup',
  ]);
  const byName = new Map(countries.map(({ iso3, name }) => [name, iso3]));
  const flags = new Map();
  let records = 0;
  for (const row of rows) {
    records++;
    const [name, year, month, day, outcome] = fields.map((index) => row[index]);
    const iso3 = byName.get(name) ?? COUP_ALIASES[name];
    const date =
      year + '-' + month?.padStart(2, '0') + '-' + day?.padStart(2, '0');
    const time = Date.parse(date);
    if (
      !iso3 ||
      !['1', '2'].includes(outcome) ||
      !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== date ||
      time > +now ||
      +now - time > 90 * DAY
    )
      continue;
    const flag = conditionFlag('live-coups', {
      iso3,
      slot: 'C1',
      key: date,
      label:
        outcome === '2'
          ? 'Irregular leader change reported after a successful coup'
          : 'Coup attempt reported (coded unsuccessful)',
      date,
      source,
      sourceName: 'Powell and Thyne',
      stage: 'reported',
    });
    flags.set(flag.id, flag);
  }
  if (!records) throw new Error('Powell and Thyne release has no rows');
  return [...flags.values()];
}

export function gdeltBatch(tsv, date, now, countries) {
  const known = new Set(countries.map(({ iso3 }) => iso3));
  const events = [];
  const seen = new Set();
  let records = 0;
  for (const line of tsv.split(/\r?\n/)) {
    if (!line) continue;
    const row = line.split('\t');
    if (row.length < 61 || !/^\d+$/.test(row[0]))
      throw new Error('Unexpected GDELT event export');
    records++;
    const root = row[28];
    const iso3 = fipsCountry[row[53]];
    const eventDate = row[1].replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    const time = Date.parse(eventDate);
    if (
      !known.has(iso3) ||
      seen.has(row[0]) ||
      !Number.isFinite(time) ||
      time > +now ||
      time + DAY <= +now - GDELT_WINDOW ||
      !['14', '19', '20'].includes(root)
    )
      continue;
    if (
      root !== '14' &&
      ![...row.slice(12, 15), ...row.slice(22, 25)].some((role) =>
        ARMED_ACTOR_ROLES.has(role),
      )
    )
      continue;
    const actor1 = (row[5] || row[6]).trim();
    const actor2 = (row[15] || row[16]).trim();
    if (!actor1 || (root !== '14' && !actor2) || !row[52]) continue;
    // Collapse variations in actor, subcode and local geography into one
    // report group per country, calendar day, root code and ADM1.
    const eventKey = [eventDate, root, row[54].trim().toUpperCase()].join('|');
    const source = URL.parse(row[60]);
    if (
      !source ||
      !['https:', 'http:'].includes(source.protocol) ||
      source.username ||
      source.password
    )
      continue;
    const domain = publisherDomain(source.hostname);
    if (!domain) continue;
    seen.add(row[0]);
    events.push([
      row[0],
      iso3,
      root === '14' ? 'C6' : 'C2',
      domain,
      source.href,
      eventKey,
    ]);
  }
  return { date, events, records };
}

export function gdeltFlags(
  batches,
  now,
  source = GDELT,
  minEvents = GDELT_MIN_EVENTS,
) {
  const totals = new Map();
  const recent = batches.filter(({ date }) =>
    inGdeltWindow(gdeltTime(date), now),
  );
  const seen = new Set();
  const sampledFiles = new Set(recent.map(({ date }) => date)).size;
  for (const { date, events = [] } of recent) {
    for (const [id, iso3, slot, domain, url, eventKey] of events) {
      if (!eventKey || seen.has(id)) continue;
      seen.add(id);
      const key = iso3 + ':' + slot;
      const group = totals.get(key) ?? {
        iso3,
        slot,
        dates: [],
        sources: new Map(),
        articles: new Set(),
        eventKeys: new Set(),
      };
      const article = articleIdentity(url);
      if (group.articles.has(article)) continue;
      group.articles.add(article);
      if (!group.eventKeys.has(eventKey)) {
        group.eventKeys.add(eventKey);
        group.dates.push(date);
      }
      const lastSource = group.sources.get(domain);
      if (!lastSource || lastSource.date <= date)
        group.sources.set(domain, { url, date });
      totals.set(key, group);
    }
  }
  return [...totals.values()].flatMap(({ iso3, slot, dates, sources }) => {
    if (dates.length < minEvents || sources.size < 3) return [];
    dates.sort();
    const domainDates = [...sources.values()].map(({ date }) => date).sort();
    const requiredDate = [dates.at(-minEvents), domainDates.at(-3)].sort()[0];
    return [
      conditionFlag('live-gdelt', {
        iso3,
        slot,
        date: dates.at(-1),
        periodStart: dates[0],
        label:
          dates.length +
          ' ' +
          (slot === 'C6' ? 'protest' : 'armed-conflict-coded') +
          ' events in sampled 15-minute files · news-derived, low confidence',
        rule:
          `At least ${minEvents} distinct events from 3 source domains in 72 hours` +
          (slot === 'C2' ? ' with a coded armed actor' : ''),
        source,
        sourceName: 'GDELT',
        stage: 'reported',
        reviewed: false,
        sampledFiles,
        eventCount: dates.length,
        sourceDomains: [...sources.keys()].sort(),
        sourceUrls: [...sources.values()].slice(0, 3).map(({ url }) => url),
        expiresAt: new Date(
          Date.parse(requiredDate) + GDELT_WINDOW,
        ).toISOString(),
      }),
    ];
  });
}

export const coups = {
  version: 2,
  live: true,
  shouldCheck: (context) => due(context, 7 * DAY),
  async fetchObservations({ fetchImpl, registry, data, now }) {
    const html = await download(fetchImpl, POWELL, 'text');
    const href = html.match(
      /href=["'](https:\/\/jonathanmpowell\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/pt_\d{8}\.csv)["']/i,
    )?.[1];
    if (!href) throw new Error('Powell and Thyne CSV release link not found');
    const csv = await download(fetchImpl, href, 'text');
    return conditionResult(
      coupFlags(csv, now, registry.countries, POWELL),
      data,
      now,
      { covered: () => false },
    );
  },
};

async function fetchGdeltBatch(
  fetchImpl,
  date,
  sampledAt,
  countries,
  expected,
) {
  const stamp = date.replace(/\D/g, '').slice(0, 14);
  const filename = stamp + '.export.CSV';
  const bytes = await download(
    fetchImpl,
    'https://data.gdeltproject.org/gdeltv2/' + filename + '.zip',
    'bytes',
    10_000_000,
  );
  if (
    expected &&
    (bytes.length !== expected.size ||
      createHash('md5').update(bytes).digest('hex') !== expected.checksum)
  )
    throw new Error('GDELT event archive did not match the manifest');

  const decoder = new TextDecoder();
  let tsv = '';
  // For a preceding export with no current manifest hash, require the exact
  // dated entry and let the ZIP reader verify its length and CRC.
  for await (const chunk of zipEntryChunks(
    bytes,
    (name) => name.split('/').at(-1).toLowerCase() === filename.toLowerCase(),
    40_000_000,
  )) {
    tsv += decoder.decode(chunk, { stream: true });
  }
  return gdeltBatch(tsv + decoder.decode(), date, sampledAt, countries);
}

export const gdelt = {
  version: 4,
  live: true,
  shouldCheck: (context) => due(context, BATCH),
  async fetchObservations({
    fetchImpl,
    registry,
    data,
    now,
    currentTime = () => now,
    rederive,
  }) {
    const manifest = await download(fetchImpl, GDELT_MANIFEST, 'text', 20_000);
    const sampledAt = currentTime();
    const entry = manifest.match(
      /^(\d+) ([0-9a-f]{32}) https?:\/\/data\.gdeltproject\.org\/gdeltv2\/(\d{14})\.export\.CSV\.zip\s*$/im,
    );
    if (!entry) throw new Error('GDELT event manifest entry missing');
    const [, size, checksum, stamp] = entry;
    const date = stamp.replace(
      /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
      '$1-$2-$3T$4:$5:$6.000Z',
    );
    const latest = gdeltTime(date);
    // The publisher sometimes advertises the next scheduled file before
    // its timestamp. Start with the preceding completed slot in that case.
    if (!(latest < +sampledAt + BATCH && +sampledAt - latest <= GDELT_WINDOW)) {
      throw new Error(
        'GDELT event manifest timestamp outside the sampling window',
      );
    }
    // The old cached identities lack reliable ADM1 codes and cannot be regrouped.
    const batches = (rederive ? [] : (data?.batches ?? [])).filter(({ date }) =>
      inGdeltWindow(gdeltTime(date), sampledAt),
    );
    const first = latest > +sampledAt ? latest - BATCH : latest;
    for (let missed = 0; missed <= MAX_MISSED_BATCHES; missed++) {
      const time = first - missed * BATCH;
      if (!inGdeltWindow(time, sampledAt)) break;
      const candidate = new Date(time).toISOString();
      if (batches.some((batch) => batch.date === candidate)) break;
      try {
        const expected =
          time === latest
            ? { size: Number(size), checksum: checksum.toLowerCase() }
            : undefined;
        batches.push(
          await fetchGdeltBatch(
            fetchImpl,
            candidate,
            sampledAt,
            registry.countries,
            expected,
          ),
        );
        break;
      } catch (error) {
        if (![404, 410].includes(error.status)) throw error;
        if (missed < MAX_MISSED_BATCHES) await pause(500);
      }
    }
    if (!batches.length)
      throw new Error('No recent completed GDELT event export was available');
    batches.sort((a, b) => a.date.localeCompare(b.date));
    return conditionResult(gdeltFlags(batches, sampledAt), data, sampledAt, {
      batches,
      sampledFiles: batches.length,
      covered: () => false,
      detail: batches.length + ' sampled 15-minute files. Coverage is partial.',
    });
  },
};
