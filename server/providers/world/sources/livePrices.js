import {
  conditionResult,
  fxFlags,
  monthlyCpiFlags,
} from '../conditionEvents.js';
import { csvRows } from './csv.js';
import { countryIds, DAY, download, due } from './liveFeedCommon.js';

const FAO_SOURCE = 'https://www.fao.org/worldfoodsituation/foodpricesindex/en/';
const FAO_CSV =
  'https://www.fao.org/media/docs/worldfoodsituationlibraries/wfs-library/food_price_indices_data.csv?download=true';
const IMF_SOURCE = 'https://data.imf.org/Datasets/CPI';
const IMF_CSV =
  'https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.STA/CPI/+/*.CPI.CP00.IX.M';
const FX_SOURCE = 'https://frankfurter.dev/';
const FX_API = 'https://api.frankfurter.dev/v2/rates';
const CURRENCIES = Object.fromEntries(
  Object.entries({
    AED: 'ARE',
    AFN: 'AFG',
    ALL: 'ALB',
    AMD: 'ARM',
    AOA: 'AGO',
    ARS: 'ARG',
    AUD: 'AUS',
    AZN: 'AZE',
    BDT: 'BGD',
    BGN: 'BGR',
    BHD: 'BHR',
    BIF: 'BDI',
    BND: 'BRN',
    BOB: 'BOL',
    BRL: 'BRA',
    BWP: 'BWA',
    BYN: 'BLR',
    CAD: 'CAN',
    CDF: 'COD',
    CHF: 'CHE LIE',
    CLP: 'CHL',
    CNY: 'CHN',
    COP: 'COL',
    CRC: 'CRI',
    CUP: 'CUB',
    CZK: 'CZE',
    DJF: 'DJI',
    DKK: 'DNK',
    DOP: 'DOM',
    DZD: 'DZA',
    EGP: 'EGY',
    ETB: 'ETH',
    EUR: 'AND AUT BEL HRV CYP EST FIN FRA DEU GRC IRL ITA KOS LVA LTU LUX MLT MCO MNE NLD PRT SMR SVK SVN ESP VAT',
    GBP: 'GBR',
    GEL: 'GEO',
    GHS: 'GHA',
    GMD: 'GMB',
    GNF: 'GIN',
    GTQ: 'GTM',
    HKD: 'HKG',
    HNL: 'HND',
    HTG: 'HTI',
    HUF: 'HUN',
    IDR: 'IDN',
    ILS: 'ISR',
    INR: 'IND',
    IQD: 'IRQ',
    IRR: 'IRN',
    ISK: 'ISL',
    JMD: 'JAM',
    JOD: 'JOR',
    JPY: 'JPN',
    KES: 'KEN',
    KGS: 'KGZ',
    KHR: 'KHM',
    KRW: 'KOR',
    KWD: 'KWT',
    KZT: 'KAZ',
    LAK: 'LAO',
    LBP: 'LBN',
    LKR: 'LKA',
    LYD: 'LBY',
    MAD: 'MAR',
    MDL: 'MDA',
    MGA: 'MDG',
    MKD: 'MKD',
    MMK: 'MMR',
    MNT: 'MNG',
    MRU: 'MRT',
    MUR: 'MUS',
    MWK: 'MWI',
    MXN: 'MEX',
    MYR: 'MYS',
    MZN: 'MOZ',
    NGN: 'NGA',
    NIO: 'NIC',
    NOK: 'NOR',
    NPR: 'NPL',
    NZD: 'NZL',
    OMR: 'OMN',
    PEN: 'PER',
    PHP: 'PHL',
    PKR: 'PAK',
    PLN: 'POL',
    PYG: 'PRY',
    QAR: 'QAT',
    RON: 'ROU',
    RSD: 'SRB',
    RUB: 'RUS',
    RWF: 'RWA',
    SAR: 'SAU',
    SDG: 'SDN',
    SEK: 'SWE',
    SGD: 'SGP',
    SOS: 'SOM',
    SSP: 'SSD',
    SYP: 'SYR',
    THB: 'THA',
    TJS: 'TJK',
    TND: 'TUN',
    TRY: 'TUR',
    TWD: 'TWN',
    TZS: 'TZA',
    UAH: 'UKR',
    UGX: 'UGA',
    UYU: 'URY',
    UZS: 'UZB',
    VES: 'VEN',
    VND: 'VNM',
    XAF: 'CMR CAF TCD COG GNQ GAB',
    XCD: 'ATG DMA GRD KNA LCA VCT',
    XOF: 'BEN BFA CIV GNB MLI NER SEN TGO',
    YER: 'YEM',
    ZAR: 'ZAF',
    ZMW: 'ZMB',
    ZWG: 'ZWE',
  }).map(([code, countries]) => [code, countries.split(' ')]),
);

export function faoBanner(csv) {
  const rows = csvRows(csv);
  let headers;
  for (let next = rows.next(); !next.done; next = rows.next()) {
    const row = next.value;
    if (row[0]?.trim() === 'Date' && row.includes('Food Price Index')) {
      headers = row;
      break;
    }
  }
  if (!headers) throw new Error('FAO monthly food price index header missing');
  const index = headers.indexOf('Food Price Index');
  const periods = new Map();
  for (const row of rows) {
    const date = row[0]?.trim();
    const value = Number(row[index]);
    if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(date) && value > 0)
      periods.set(date, value);
  }
  const [date, previousDate] = [...periods.keys()].sort().slice(-2).reverse();
  const value = periods.get(date);
  const previous = periods.get(previousDate);
  if (!value || !previous)
    throw new Error('FAO monthly food price index has fewer than two periods');
  const priorMonth = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5)) - 2),
  )
    .toISOString()
    .slice(0, 7);
  if (previousDate !== priorMonth)
    throw new Error(
      'FAO monthly food price index does not have adjacent months',
    );
  const change = ((value - previous) * 100) / previous;
  return {
    date,
    previousDate,
    value,
    change,
    source: FAO_SOURCE,
    label:
      'World food price index ' +
      value.toFixed(1) +
      ' · ' +
      (Math.abs(change) < 0.05
        ? 'steady'
        : (change > 0 ? 'up ' : 'down ') + Math.abs(change).toFixed(1) + '%'),
  };
}

export function cpiRows(csv) {
  const lines = csvRows(csv);
  const header = lines.next().value ?? [];
  const country = Math.max(
    header.indexOf('COUNTRY'),
    header.indexOf('REF_AREA'),
  );
  const indicator = Math.max(
    header.indexOf('INDEX_TYPE'),
    header.indexOf('INDICATOR'),
  );
  const frequency = Math.max(
    header.indexOf('FREQUENCY'),
    header.indexOf('FREQ'),
  );
  const category = header.indexOf('COICOP_1999');
  const transform = header.indexOf('TYPE_OF_TRANSFORMATION');
  const time = header.indexOf('TIME_PERIOD');
  const value = header.indexOf('OBS_VALUE');
  if ([country, indicator, frequency, time, value].includes(-1))
    throw new Error('IMF CPI CSV headers unavailable');
  const result = [];
  for (const row of lines) {
    if (
      row[frequency] !== 'M' ||
      !['CPI', 'CPI_IX'].includes(row[indicator]) ||
      (category !== -1 && row[category] !== 'CP00') ||
      (transform !== -1 && row[transform] !== 'IX') ||
      !row[value]?.trim()
    )
      continue;
    const iso3 = row[country] === 'XKX' ? 'KOS' : row[country];
    const reading = Number(row[value]);
    if (/^[A-Z]{3}$/.test(iso3) && Number.isFinite(reading))
      result.push({ iso3, period: row[time], value: reading });
  }
  return result;
}

export const fao = {
  live: true,
  shouldCheck: (context) => due(context, 7 * DAY),
  async fetchObservations({ fetchImpl, now, data }) {
    const banner = faoBanner(await download(fetchImpl, FAO_CSV, 'text'));
    const result = conditionResult([], data, now, { banner });
    return {
      ...result,
      count: 1,
      unit: 'index',
      detail: banner.label + ' (' + banner.date + ').',
    };
  },
};

export const imfCpi = {
  live: true,
  shouldCheck: (context) => due(context, 7 * DAY),
  async fetchObservations({ fetchImpl, now, data, registry }) {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 17),
    )
      .toISOString()
      .slice(0, 7);
    const url = IMF_CSV + '?startPeriod=' + start;
    const csv = await download(
      fetchImpl,
      url,
      'text',
      40_000_000,
      'application/vnd.sdmx.data+csv;version=2.0',
    );
    const countries = countryIds(registry);
    const rows = cpiRows(csv).filter(({ iso3 }) => countries.has(iso3));
    if (!rows.length)
      throw new Error('IMF CPI returned no mapped monthly all-items series');
    return conditionResult(monthlyCpiFlags(rows, now, IMF_SOURCE), data, now, {
      records: rows.length,
    });
  },
};

export const fx = {
  live: true,
  shouldCheck: (context) => due(context, DAY),
  async fetchObservations({ fetchImpl, now, data, registry }) {
    const from = new Date(+now - 40 * DAY).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    const payload = await download(
      fetchImpl,
      FX_API + '?base=USD&from=' + from + '&to=' + to,
    );
    if (!Array.isArray(payload) || !payload.length)
      throw new Error('Frankfurter rate window unavailable');
    const rates = payload.filter(
      ({ base, quote, rate, date }) =>
        base === 'USD' &&
        typeof quote === 'string' &&
        Number.isFinite(rate) &&
        typeof date === 'string',
    );
    if (!rates.length)
      throw new Error('Frankfurter rate window has no valid USD quotes');
    const countries = countryIds(registry);
    const mapping = Object.fromEntries(
      Object.entries(CURRENCIES).map(([code, ids]) => [
        code,
        ids.filter((id) => countries.has(id)),
      ]),
    );
    const flags = fxFlags(rates, mapping, now, FX_SOURCE);
    return conditionResult(flags, data, now, {
      rateCount: rates.length,
      currencyCount: new Set(rates.map(({ quote }) => quote)).size,
    });
  },
};
