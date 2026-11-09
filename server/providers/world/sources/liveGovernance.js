import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { conditionFlag, conditionResult } from '../conditionEvents.js';
import { columnIndices, csvRows } from './csv.js';
import { DAY, download, due } from './liveFeedCommon.js';
import { zipEntryChunks } from './zip.js';

const POWELL = 'https://jonathanmpowell.com/coups/';
const GDELT = 'https://www.gdeltproject.org/data.html';
const GDELT_MANIFEST = 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt';
const BATCH = 15 * 60_000;
const MAX_MISSED_BATCHES = 4;

function gdeltTime(date) {
  const time = Date.parse(date);
  return Number.isFinite(time) &&
    time % BATCH === 0 &&
    new Date(time).toISOString() === date
    ? time
    : NaN;
}

function inGdeltWindow(time, sampledAt) {
  return time <= +sampledAt && +sampledAt - time <= 7 * DAY;
}

const COUNTRIES = {
  AF: 'AFG',
  AG: 'DZA',
  AJ: 'AZE',
  AL: 'ALB',
  AM: 'ARM',
  AR: 'ARG',
  AS: 'AUS',
  AU: 'AUT',
  BA: 'BHR',
  BB: 'BRB',
  BC: 'BWA',
  BD: 'BMU',
  BE: 'BEL',
  BG: 'BGD',
  BH: 'BLZ',
  BK: 'BIH',
  BL: 'BOL',
  BM: 'MMR',
  BN: 'BEN',
  BO: 'BLR',
  BR: 'BRA',
  BT: 'BTN',
  BU: 'BGR',
  BY: 'BDI',
  CA: 'CAN',
  CB: 'KHM',
  CD: 'TCD',
  CE: 'LKA',
  CF: 'COG',
  CG: 'COD',
  CH: 'CHN',
  CI: 'CHL',
  CM: 'CMR',
  CN: 'COM',
  CO: 'COL',
  CS: 'CRI',
  CT: 'CAF',
  CU: 'CUB',
  CY: 'CYP',
  DA: 'DNK',
  DJ: 'DJI',
  DR: 'DOM',
  EC: 'ECU',
  EG: 'EGY',
  EI: 'IRL',
  EK: 'GNQ',
  EN: 'EST',
  ER: 'ERI',
  ES: 'SLV',
  ET: 'ETH',
  EZ: 'CZE',
  FI: 'FIN',
  FJ: 'FJI',
  FR: 'FRA',
  GA: 'GMB',
  GB: 'GAB',
  GG: 'GEO',
  GH: 'GHA',
  GM: 'DEU',
  GR: 'GRC',
  GT: 'GTM',
  GV: 'GIN',
  GY: 'GUY',
  HA: 'HTI',
  HK: 'HKG',
  HO: 'HND',
  HR: 'HRV',
  HU: 'HUN',
  IC: 'ISL',
  ID: 'IDN',
  IN: 'IND',
  IR: 'IRN',
  IS: 'ISR',
  IT: 'ITA',
  IV: 'CIV',
  IZ: 'IRQ',
  JA: 'JPN',
  JM: 'JAM',
  JO: 'JOR',
  KE: 'KEN',
  KG: 'KGZ',
  KN: 'PRK',
  KS: 'KOR',
  KU: 'KWT',
  KV: 'KOS',
  KZ: 'KAZ',
  LA: 'LAO',
  LE: 'LBN',
  LG: 'LVA',
  LH: 'LTU',
  LI: 'LBR',
  LO: 'SVK',
  LT: 'LSO',
  LU: 'LUX',
  LY: 'LBY',
  MA: 'MDG',
  MD: 'MDA',
  MG: 'MNG',
  MI: 'MWI',
  MK: 'MKD',
  ML: 'MLI',
  MO: 'MAR',
  MP: 'MUS',
  MR: 'MRT',
  MX: 'MEX',
  MY: 'MYS',
  MZ: 'MOZ',
  NG: 'NER',
  NI: 'NGA',
  NL: 'NLD',
  NO: 'NOR',
  NP: 'NPL',
  NU: 'NIC',
  NZ: 'NZL',
  OM: 'OMN',
  PA: 'PRY',
  PE: 'PER',
  PK: 'PAK',
  PL: 'POL',
  PM: 'PAN',
  PO: 'PRT',
  PP: 'PNG',
  PU: 'GNB',
  QA: 'QAT',
  RO: 'ROU',
  RP: 'PHL',
  RS: 'RUS',
  RW: 'RWA',
  SA: 'SAU',
  SE: 'SYC',
  SF: 'ZAF',
  SG: 'SEN',
  SI: 'SVN',
  SL: 'SLE',
  SN: 'SGP',
  SO: 'SOM',
  SP: 'ESP',
  SU: 'SDN',
  SW: 'SWE',
  SZ: 'CHE',
  SY: 'SYR',
  TD: 'TTO',
  TH: 'THA',
  TI: 'TJK',
  TL: 'TKL',
  TN: 'TON',
  TO: 'TGO',
  TS: 'TUN',
  TU: 'TUR',
  TW: 'TWN',
  TX: 'TKM',
  TZ: 'TZA',
  UG: 'UGA',
  UK: 'GBR',
  UP: 'UKR',
  US: 'USA',
  UV: 'BFA',
  UY: 'URY',
  UZ: 'UZB',
  VE: 'VEN',
  VM: 'VNM',
  WZ: 'SWZ',
  YM: 'YEM',
  ZA: 'ZMB',
  ZI: 'ZWE',
  AE: 'ARE',
  OD: 'SSD',
  TT: 'TLS',
  WE: 'PSE',
  GZ: 'PSE',
};
const COUP_ALIASES = {
  'Myanmar (Burma)': 'MMR',
  'DR Congo (Zaire)': 'COD',
  'Ivory Coast': 'CIV',
  'South Sudan': 'SSD',
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
  const counts = {};
  const seen = new Set();
  let records = 0;
  for (const line of tsv.split(/\r?\n/)) {
    if (!line) continue;
    const row = line.split('\t');
    if (row.length < 61 || !/^\d+$/.test(row[0]))
      throw new Error('Unexpected GDELT event export');
    records++;
    const root = row[28];
    const iso3 = COUNTRIES[row[53]];
    const eventDate = row[1].replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    const time = Date.parse(eventDate);
    if (
      !known.has(iso3) ||
      seen.has(row[0]) ||
      !Number.isFinite(time) ||
      time > +now ||
      +now - time > 7 * DAY ||
      !['14', '18', '19', '20'].includes(root)
    )
      continue;
    seen.add(row[0]);
    counts[iso3] ??= [0, 0];
    counts[iso3][root === '14' ? 1 : 0]++;
  }
  return { date, counts, records };
}

export function gdeltFlags(batches, source = GDELT) {
  if (!batches.length) return [];
  const totals = new Map();
  for (const { counts } of batches)
    for (const [iso3, [conflict, protest]] of Object.entries(counts)) {
      const [oldConflict, oldProtest] = totals.get(iso3) ?? [0, 0];
      totals.set(iso3, [oldConflict + conflict, oldProtest + protest]);
    }
  const coverage =
    ' across ' +
    batches.length +
    ' sampled 15-minute file' +
    (batches.length === 1 ? '' : 's');
  const date = batches.at(-1).date;
  const periodStart = batches[0].date;
  return [...totals].flatMap(([iso3, values]) =>
    values.flatMap((count, index) =>
      !count
        ? []
        : [
            conditionFlag('live-gdelt', {
              iso3,
              slot: index ? 'C6' : 'C2',
              label:
                count +
                ' ' +
                (index ? 'protest' : 'conflict-coded') +
                ' events reported' +
                coverage,
              date,
              periodStart,
              source,
              sourceName: 'GDELT',
              stage: 'reported',
              sampledFiles: batches.length,
            }),
          ],
    ),
  );
}

export const coups = {
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
  live: true,
  shouldCheck: (context) => due(context, BATCH),
  async fetchObservations({
    fetchImpl,
    registry,
    data,
    now,
    currentTime = () => now,
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
    if (!(latest < +sampledAt + BATCH && +sampledAt - latest <= 7 * DAY)) {
      throw new Error(
        'GDELT event manifest timestamp outside the sampling window',
      );
    }
    const batches = (data?.batches ?? []).filter(({ date }) =>
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
    return conditionResult(gdeltFlags(batches), data, sampledAt, {
      batches,
      detail: batches.length + ' sampled 15-minute files. Coverage is partial.',
    });
  },
};
