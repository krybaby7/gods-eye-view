#!/usr/bin/env node
/**
 * Build the World theater gazetteer: the `gazetteer` array of
 * public/news/theaters/world.json. Runs by hand; the committed data is what
 * the app uses.
 *
 *   node scripts/build-world-gazetteer.mjs [--data <dir>] [--dry-run]
 *
 * Source: Natural Earth 5.1.2 (public domain, naturalearthdata.com), read
 * from the project's GitHub mirror at that release, or from `--data <dir>`
 * holding the same three GeoJSON files:
 *   - ne_50m_admin_0_countries: every country, and a few self-governing or
 *     disputed territories that make political news, at Natural Earth's
 *     label point (not a geometric centroid, which can fall in the sea);
 *   - ne_10m_populated_places: every national capital, and every city whose
 *     metro population (POP_MAX) is 1 million or more;
 *   - ne_10m_admin_1_states_provinces: label points for the hotspots below
 *     that are provinces or groups of provinces.
 * Hotspots that are not provinces (seas, cross-border regions) are placed by
 * hand at an approximate centre; each names the reference it was read from.
 *
 * Aliases: English variants and the Arabic, Persian, Hebrew, Russian,
 * Chinese, Spanish, French and Portuguese names from Natural Earth, plus the
 * native-language name where Natural Earth has one. A spelling two places
 * share is ambiguous: a country or hotspot keeps it over a city; two cities
 * both drop it; a city whose name another place owns is qualified with its
 * country ("Hyderabad, Pakistan"), a capital keeping the bare name. Names
 * that mean another well-known place too (Georgia, the US state) are
 * dropped outright. Every drop is printed.
 *
 * Countries and capitals carry `prompt: true`: the digest instructions list
 * only them, by name (see placeNamesForPrompt). Matching uses every row and
 * alias.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizePlaceName } from '../server/providers/news/geocode.js';
import {
  validateNewsSources,
  validateNewsTheater,
} from '../server/providers/news/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEATER_FILE = path.join(ROOT, 'public/news/theaters/world.json');
const SOURCES_FILE = path.join(ROOT, 'public/news/sources.json');
const NE_RELEASE = 'v5.1.2';
const NE_MIRROR = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_RELEASE}/geojson`;
const NE_FILES = Object.freeze({
  countries: 'ne_50m_admin_0_countries',
  places: 'ne_10m_populated_places',
  provinces: 'ne_10m_admin_1_states_provinces',
});
const CITY_MIN_POPULATION = 1_000_000;
/** Two rows closer than this with one spelling are one place. */
const SAME_PLACE_KM = 100;

/** Natural Earth language fields used for every place. */
const LANGUAGES = ['AR', 'FA', 'HE', 'RU', 'ZH', 'ZHT', 'ES', 'FR', 'PT'];
/** Native-language names Natural Earth carries beyond LANGUAGES. */
const NATIVE = {
  AUT: ['DE'],
  BEL: ['NL'],
  BGD: ['BN'],
  CHE: ['DE', 'IT'],
  CYN: ['TR'],
  CYP: ['EL', 'TR'],
  DEU: ['DE'],
  GRC: ['EL'],
  HUN: ['HU'],
  IDN: ['ID'],
  IND: ['HI'],
  ITA: ['IT'],
  JPN: ['JA'],
  KOR: ['KO'],
  LIE: ['DE'],
  NLD: ['NL'],
  PAK: ['UR'],
  POL: ['PL'],
  PRK: ['KO'],
  SMR: ['IT'],
  SUR: ['NL'],
  SWE: ['SV'],
  TUR: ['TR'],
  UKR: ['UK'],
  VAT: ['IT'],
  VNM: ['VI'],
};

/**
 * Territories that are not sovereign states but make political news on
 * their own. Every other dependency is left out (its news names its
 * sovereign or a city), as are Antarctica and the Siachen Glacier (a
 * hotspot of the Kashmir row).
 */
const TERRITORIES = new Set([
  'FLK', // Falkland Islands / Malvinas
  'GRL', // Greenland
  'GUM', // Guam
  'HKG', // Hong Kong
  'IOT', // British Indian Ocean Territory (Chagos)
  'MAC', // Macao
  'NCL', // New Caledonia
  'PRI', // Puerto Rico
  'PSX', // Palestine
  'PYF', // French Polynesia
  'SAH', // Western Sahara
]);
const EXCLUDED = new Set(['ATA', 'KAS']);

/** Country row names where Natural Earth's short name is ambiguous or odd. */
const COUNTRY_NAMES = {
  USA: 'United States',
  SWZ: 'Eswatini',
  // "Georgia" is also the US state: the bare name is dropped (DROPPED).
  GEO: 'Georgia (country)',
  // "Congo" is two countries: each row uses its long name.
  COG: 'Republic of the Congo',
};
const COUNTRY_LABELS = { GEO: 'Georgia' };
/** Common English short forms Natural Earth lacks. */
const COUNTRY_ALIASES = {
  ARE: ['UAE', 'U.A.E.', 'Emirates'],
  BIH: ['Bosnia'],
  CHN: ['中国', 'PRC'],
  COD: ['DR Congo', 'DRC', 'Democratic Republic of Congo', 'Congo-Kinshasa'],
  COG: ['Congo-Brazzaville', 'Republic of Congo'],
  CPV: ['Cape Verde'],
  CYN: ['TRNC'],
  CZE: ['Czech Republic'],
  FLK: ['Falklands', 'Malvinas', 'Islas Malvinas'],
  GBR: ['UK', 'U.K.', 'Britain', 'Great Britain'],
  GEO: ['Republic of Georgia', 'Sakartvelo', 'საქართველო'],
  IOT: ['Chagos Islands', 'Chagos Archipelago'],
  IRN: ['Islamic Republic of Iran'],
  KOS: ['Kosova'],
  LAO: ['Lao PDR'],
  MMR: ['Burma'],
  NLD: ['Holland'],
  PRK: ['DPRK'],
  PSX: [
    'State of Palestine',
    'Palestinian territories',
    'occupied Palestinian territories',
    'פלסטין',
  ],
  RUS: ['Russian Federation'],
  SAH: ['Sahrawi Arab Democratic Republic'],
  SYR: ['Syrian Arab Republic'],
  TUR: ['Türkiye', 'Turkiye'],
  USA: ['US', 'U.S.', 'USA'],
  VAT: ['Holy See'],
};
/**
 * Natural Earth names that are wrong for the row: Palestine's Hebrew name is
 * given as "ארץ ישראל" (the Land of Israel), which names something else.
 */
const COUNTRY_ALIAS_FIXES = { PSX: ['ארץ ישראל'] };

/**
 * City row names: Natural Earth's English label (NAME_EN, which fixes typos
 * in NAME such as "Shenyeng"), except for these, by NAME: city-states,
 * renamed capitals and an ambiguous capital.
 */
const CITY_NAMES = {
  'Washington,  D.C.': 'Washington, D.C.',
  Luxembourg: 'Luxembourg City',
  Djibouti: 'Djibouti City',
  'Nur-Sultan': 'Astana',
  Victoria: 'Victoria, Seychelles',
};
const CITY_ALIASES = {
  'Washington, D.C.': ['Washington', 'Washington DC'],
  'New York City': ['NYC'],
};
/** Capitals Natural Earth lists as "capital alt" that are seats of power. */
const SEATS_OF_GOVERNMENT = new Set([
  'The Hague',
  'Porto-Novo',
  'Dodoma',
  'Putrajaya',
  'Sri Jayawardenepura Kotte',
  'Lobamba',
  'Valparaíso',
]);
/** Natural Earth country codes that differ between its two datasets. */
const PLACE_A3 = { SSD: 'SDS' };
/**
 * Natural Earth errata, by NE_ID: a village in Amapá that carries the
 * population of Vila Velha (Espírito Santo), which is kept.
 */
const PLACE_ERRATA = new Set([1159148899]);

/**
 * Spellings that also name another well-known place, so a match would put
 * stories in the wrong country: dropped wherever they appear.
 */
const DROPPED = new Map(
  [
    // Folded, "Geórgia" (Portuguese) is "Georgia" too.
    ['Georgia', 'also the US state'],
    ['Géorgie', 'also the US state (French)'],
    ['جورجيا', 'also the US state (Arabic)'],
    ['عمان', 'both Amman and Oman (Arabic)'],
    ['Congo', 'two countries'],
    ['Конго', 'two countries (Russian)'],
    ['الكونغو', 'two countries (Arabic)'],
    ['کنگو', 'two countries (Persian)'],
    ['Korea', 'two countries'],
    ['Macedonia', 'also the Greek region'],
    ['Victoria', 'also the Australian state and the Canadian city'],
  ].map(([spelling, why]) => [normalizePlaceName(spelling), why]),
);

/**
 * Named political hotspots and regions. `provinces` averages Natural Earth
 * admin-1 label points ([country code, ...province names]); otherwise `at`
 * is a hand-placed approximate centre read from `ref`.
 */
const HOTSPOTS = [
  // Middle East and North Africa
  {
    name: 'Gaza Strip',
    precision: 'region',
    country: 'Palestine',
    at: [31.42, 34.37],
    ref: 'Wikipedia: Gaza Strip',
    aliases: [
      'Gaza',
      'the Gaza Strip',
      'قطاع غزة',
      'غزة',
      'רצועת עזה',
      'עזה',
      'نوار غزه',
      'Сектор Газа',
      '加沙地带',
      'Franja de Gaza',
      'bande de Gaza',
      'Faixa de Gaza',
    ],
  },
  {
    name: 'West Bank',
    precision: 'region',
    country: 'Palestine',
    at: [31.95, 35.25],
    ref: 'Wikipedia: West Bank',
    aliases: [
      'occupied West Bank',
      'Judea and Samaria',
      'الضفة الغربية',
      'הגדה המערבית',
      'יהודה ושומרון',
      'کرانه باختری',
      'Западный берег реки Иордан',
      '约旦河西岸',
      'Cisjordania',
      'Cisjordanie',
      'Cisjordânia',
    ],
  },
  {
    name: 'Jordan Valley',
    precision: 'region',
    country: 'Palestine',
    at: [32.0, 35.5],
    ref: 'Wikipedia: Jordan Valley (keeps "Jordan" from matching the country)',
    aliases: ['Jordan Rift Valley', 'غور الأردن', 'בקעת הירדן'],
  },
  {
    name: 'Golan Heights',
    precision: 'region',
    country: 'Syria',
    at: [33.0, 35.75],
    ref: 'Wikipedia: Golan Heights',
    aliases: [
      'Golan',
      'occupied Golan',
      'الجولان',
      'רמת הגולן',
      'Голанские высоты',
      '戈兰高地',
      'Altos del Golán',
      'plateau du Golan',
    ],
  },
  {
    name: 'Southern Lebanon',
    precision: 'region',
    country: 'Lebanon',
    at: [33.27, 35.4],
    ref: 'Wikipedia: Southern Lebanon',
    aliases: ['south Lebanon', 'جنوب لبنان', 'דרום לבנון'],
  },
  {
    name: 'Idlib',
    precision: 'region',
    country: 'Syria',
    provinces: ['SYR', 'Idlib'],
    aliases: ['Idlib province', 'Idlib governorate', 'إدلب', 'Идлиб'],
  },
  {
    name: 'Northeast Syria',
    precision: 'region',
    country: 'Syria',
    at: [36.5, 40.5],
    ref: 'Wikipedia: Autonomous Administration of North and East Syria',
    aliases: ['North and East Syria', 'Rojava', 'AANES', 'شمال شرق سوريا'],
  },
  {
    name: 'Kurdistan Region',
    precision: 'region',
    country: 'Iraq',
    provinces: ['IRQ', 'Dihok', 'Arbil', 'As-Sulaymaniyah'],
    aliases: [
      'Iraqi Kurdistan',
      'Kurdistan Region of Iraq',
      'KRG',
      'إقليم كردستان',
    ],
  },
  {
    name: 'Sinai Peninsula',
    precision: 'region',
    country: 'Egypt',
    at: [29.5, 33.8],
    ref: 'Wikipedia: Sinai Peninsula',
    aliases: ['Sinai', 'North Sinai', 'سيناء', 'סיני', 'Синай'],
  },
  {
    name: 'Red Sea',
    precision: 'water',
    country: 'Regional Waters',
    at: [20.0, 38.5],
    ref: 'Wikipedia: Red Sea',
    aliases: [
      'البحر الأحمر',
      'הים האדום',
      'دریای سرخ',
      'Красное море',
      '红海',
      'Mar Rojo',
      'mer Rouge',
      'Mar Vermelho',
    ],
  },
  {
    name: 'Bab el-Mandeb',
    precision: 'water',
    country: 'Regional Waters',
    at: [12.6, 43.3],
    ref: 'Wikipedia: Bab-el-Mandeb',
    aliases: ['Bab al-Mandab', 'Bab-el-Mandeb Strait', 'باب المندب'],
  },
  {
    name: 'Strait of Hormuz',
    precision: 'water',
    country: 'Regional Waters',
    at: [26.57, 56.25],
    ref: 'Wikipedia: Strait of Hormuz',
    aliases: [
      'Hormuz',
      'Hormuz Strait',
      'مضيق هرمز',
      'تنگه هرمز',
      'Ормузский пролив',
      '霍尔木兹海峡',
      'estrecho de Ormuz',
      "détroit d'Ormuz",
    ],
  },
  // Africa
  {
    name: 'Darfur',
    precision: 'region',
    country: 'Sudan',
    provinces: [
      'SDN',
      'North Darfur',
      'Western Darfur',
      'Central Darfur',
      'Southern Darfur',
      'Eastern Darfur',
    ],
    aliases: ['دارفور', 'Дарфур', '达尔富尔'],
  },
  {
    name: 'Kordofan',
    precision: 'region',
    country: 'Sudan',
    provinces: ['SDN', 'North Kordufan', 'South Kordufan'],
    aliases: [
      'North Kordofan',
      'South Kordofan',
      'West Kordofan',
      'Nuba Mountains',
      'كردفان',
      'جنوب كردفان',
    ],
  },
  {
    name: 'Tigray',
    precision: 'region',
    country: 'Ethiopia',
    provinces: ['ETH', 'Tigray'],
    aliases: ['Tigray Region', 'ትግራይ', 'تيغراي'],
  },
  {
    name: 'Amhara Region',
    precision: 'region',
    country: 'Ethiopia',
    provinces: ['ETH', 'Amhara'],
    aliases: ['Amhara', 'አማራ'],
  },
  {
    name: 'Sahel',
    precision: 'region',
    country: 'Mali, Burkina Faso and Niger',
    at: [14.8, 0.5],
    ref: 'Wikipedia: Liptako-Gourma (the central Sahel border zone)',
    aliases: ['Central Sahel', 'Liptako-Gourma', 'Сахель'],
  },
  {
    name: 'Lake Chad Basin',
    precision: 'region',
    country: 'Nigeria, Niger, Chad and Cameroon',
    at: [13.0, 14.0],
    ref: 'Wikipedia: Lake Chad',
    aliases: [
      'Lake Chad',
      'Lake Chad region',
      'lac Tchad',
      'bassin du lac Tchad',
    ],
  },
  {
    name: 'Cabo Delgado',
    precision: 'region',
    country: 'Mozambique',
    provinces: ['MOZ', 'Cabo Delgado'],
    aliases: ['Cabo Delgado province'],
  },
  {
    name: 'North Kivu',
    precision: 'region',
    country: 'Democratic Republic of the Congo',
    provinces: ['COD', 'Nord-Kivu'],
    aliases: ['Nord-Kivu', 'North Kivu province'],
  },
  {
    name: 'Anglophone Cameroon',
    precision: 'region',
    country: 'Cameroon',
    provinces: ['CMR', 'Nord-Ouest', 'Sud-Ouest'],
    aliases: [
      'Ambazonia',
      'Southern Cameroons',
      'Northwest and Southwest regions',
      'NOSO',
    ],
  },
  {
    name: 'Gulf of Guinea',
    precision: 'water',
    country: 'Regional Waters',
    at: [2.0, 3.0],
    ref: 'Wikipedia: Gulf of Guinea (keeps "Guinea" from matching the country)',
    aliases: ['golfe de Guinée', 'Golfo de Guinea'],
  },
  // Europe and Eurasia
  {
    name: 'Donbas',
    precision: 'region',
    country: 'Ukraine',
    provinces: ['UKR', "Donets'k", "Luhans'k"],
    aliases: [
      'Donbass',
      'Donets Basin',
      'Донбас',
      'Донбасс',
      '顿巴斯',
      'Donbás',
    ],
  },
  {
    name: 'Crimea',
    precision: 'region',
    country: 'Ukraine',
    // Natural Earth files Crimea under Russia's admin-1; the row's country is
    // the internationally recognised one.
    provinces: ['RUS', 'Crimea'],
    aliases: [
      'Crimean Peninsula',
      'Autonomous Republic of Crimea',
      'Крим',
      'Крым',
      '克里米亚',
      'Crimée',
      'Crimeia',
    ],
  },
  {
    name: 'Zaporizhzhia Oblast',
    precision: 'region',
    country: 'Ukraine',
    provinces: ['UKR', 'Zaporizhzhya'],
    aliases: [
      'Zaporizhzhia region',
      'Zaporozhye region',
      'Zaporizhzhia nuclear plant',
      'Запорізька область',
      'Запорожская область',
    ],
  },
  {
    name: 'Kherson Oblast',
    precision: 'region',
    country: 'Ukraine',
    provinces: ['UKR', 'Kherson'],
    aliases: ['Kherson region', 'Херсонська область', 'Херсонская область'],
  },
  {
    name: 'Transnistria',
    precision: 'region',
    country: 'Moldova',
    provinces: ['MDA', 'Transnistria'],
    aliases: [
      'Pridnestrovie',
      'Transdniestria',
      'Trans-Dniester',
      'Приднестровье',
    ],
  },
  {
    name: 'Abkhazia',
    precision: 'region',
    country: 'Georgia',
    provinces: ['GEO', 'Abkhazia'],
    aliases: ['Абхазия', 'აფხაზეთი'],
  },
  {
    name: 'South Ossetia',
    precision: 'region',
    country: 'Georgia',
    at: [42.35, 44.0],
    ref: 'Wikipedia: South Ossetia',
    aliases: ['Tskhinvali Region', 'Южная Осетия', 'სამხრეთ ოსეთი'],
  },
  {
    name: 'Nagorno-Karabakh',
    precision: 'region',
    country: 'Azerbaijan',
    at: [39.8, 46.75],
    ref: 'Wikipedia: Nagorno-Karabakh',
    aliases: ['Karabakh', 'Artsakh', 'Нагорный Карабах', 'Dağlıq Qarabağ'],
  },
  {
    name: 'Republika Srpska',
    precision: 'region',
    country: 'Bosnia and Herzegovina',
    at: [44.6, 17.6],
    ref: 'Wikipedia: Republika Srpska',
    aliases: ['Republic of Srpska', 'Република Српска'],
  },
  {
    name: 'Northern Ireland',
    precision: 'region',
    country: 'United Kingdom',
    at: [54.6, -6.7],
    ref: 'Wikipedia: Northern Ireland (keeps "Ireland" from matching the country)',
    aliases: ['Tuaisceart Éireann'],
  },
  // Asia and the Pacific
  {
    name: 'Kashmir',
    precision: 'region',
    country: 'India and Pakistan',
    at: [34.08, 74.8],
    ref: 'Wikipedia: Kashmir Valley',
    aliases: [
      'Jammu and Kashmir',
      'Kashmir Valley',
      'كشمير',
      'کشمیر',
      'Кашмир',
      '克什米尔',
      'Cachemira',
      'Cachemire',
      'Caxemira',
    ],
  },
  {
    name: 'Balochistan',
    precision: 'region',
    country: 'Pakistan',
    provinces: ['PAK', 'Baluchistan'],
    aliases: ['Baluchistan', 'Balochistan province', 'بلوچستان'],
  },
  {
    name: 'Rakhine State',
    precision: 'region',
    country: 'Myanmar',
    provinces: ['MMR', 'Rakhine'],
    aliases: ['Rakhine', 'Arakan', 'Arakan State'],
  },
  {
    name: 'Taiwan Strait',
    precision: 'water',
    country: 'Regional Waters',
    at: [24.5, 119.5],
    ref: 'Wikipedia: Taiwan Strait',
    aliases: ['Formosa Strait', '台湾海峡', '台灣海峽', 'Тайваньский пролив'],
  },
  {
    name: 'South China Sea',
    precision: 'water',
    country: 'Regional Waters',
    at: [12.0, 113.0],
    ref: 'Wikipedia: South China Sea',
    aliases: [
      'West Philippine Sea',
      '南海',
      'Южно-Китайское море',
      'mar de China Meridional',
      'mer de Chine méridionale',
    ],
  },
  {
    name: 'Spratly Islands',
    precision: 'region',
    country: 'Disputed',
    at: [10.0, 114.3],
    ref: 'Wikipedia: Spratly Islands',
    aliases: [
      'Spratlys',
      'Nansha Islands',
      '南沙群岛',
      'Truong Sa',
      'Kalayaan Islands',
    ],
  },
  {
    name: 'Korean Demilitarized Zone',
    precision: 'region',
    country: 'North Korea and South Korea',
    at: [38.3, 127.2],
    ref: 'Wikipedia: Korean Demilitarized Zone',
    aliases: ['Korean DMZ', 'DMZ', '비무장지대'],
  },
  {
    name: 'Xinjiang',
    precision: 'region',
    country: 'China',
    provinces: ['CHN', 'Xinjiang'],
    aliases: [
      'Xinjiang Uyghur Autonomous Region',
      'East Turkestan',
      '新疆',
      'Синьцзян',
    ],
  },
  {
    name: 'Tibet',
    precision: 'region',
    country: 'China',
    provinces: ['CHN', 'Xizang'],
    aliases: ['Tibet Autonomous Region', 'Xizang', '西藏', 'Тибет', 'Tíbet'],
  },
  {
    name: 'Mindanao',
    precision: 'region',
    country: 'Philippines',
    at: [7.6, 124.9],
    ref: 'Wikipedia: Mindanao',
    aliases: ['Bangsamoro', 'BARMM'],
  },
  {
    name: 'Papua region',
    precision: 'region',
    country: 'Indonesia',
    provinces: ['IDN', 'Papua', 'Papua Barat'],
    aliases: ['Papua', 'West Papua', 'Tanah Papua', 'Papua province'],
  },
  {
    name: 'New South Wales',
    precision: 'region',
    country: 'Australia',
    provinces: ['AUS', 'New South Wales'],
    ref: 'keeps "Wales" from matching elsewhere',
    aliases: ['NSW'],
  },
  // The Americas
  {
    name: 'Darién Gap',
    precision: 'region',
    country: 'Panama and Colombia',
    at: [8.0, -77.6],
    ref: 'Wikipedia: Darién Gap',
    aliases: ['Darien Gap', 'Darién', 'Tapón del Darién'],
  },
  {
    name: 'Essequibo',
    precision: 'region',
    country: 'Guyana',
    at: [5.5, -59.5],
    ref: 'Wikipedia: Guayana Esequiba',
    aliases: ['Guayana Esequiba', 'Essequibo region'],
  },
  {
    name: 'New Mexico',
    precision: 'region',
    country: 'United States',
    provinces: ['USA', 'New Mexico'],
    ref: 'keeps "Mexico" from matching the country',
    aliases: [],
  },
  {
    name: 'Washington State',
    precision: 'region',
    country: 'United States',
    provinces: ['USA', 'Washington'],
    ref: 'keeps "Washington" from matching the capital',
    aliases: ['State of Washington'],
  },
  {
    name: 'Gulf of Mexico',
    precision: 'water',
    country: 'Regional Waters',
    at: [25.0, -90.0],
    ref: 'Wikipedia: Gulf of Mexico (keeps "Mexico" from matching the country)',
    aliases: ['Gulf of America', 'Golfo de México'],
  },
];

const RANK = { hotspot: 0, country: 1, capital: 2, city: 3 };

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function readNaturalEarth(dataDir) {
  const out = {};
  for (const [key, file] of Object.entries(NE_FILES)) {
    let text;
    if (dataDir)
      text = readFileSync(path.join(dataDir, `${file}.geojson`), 'utf8');
    else {
      const response = await fetch(`${NE_MIRROR}/${file}.geojson`);
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
      text = await response.text();
    }
    out[key] = JSON.parse(text).features.map((feature) => feature.properties);
  }
  return out;
}

const strings = (...values) =>
  values
    .flat()
    .filter((value) => typeof value === 'string')
    .flatMap((value) => value.split('|'))
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const languageNames = (props, codes) =>
  strings(
    ...codes.map(
      (code) => props[`NAME_${code}`] ?? props[`name_${code.toLowerCase()}`],
    ),
  );

function countryRows(countries, log) {
  const rows = [];
  for (const props of countries) {
    const a3 = props.ADM0_A3;
    const sovereign =
      ['Sovereign country', 'Sovereignty'].includes(props.TYPE) ||
      props.SOVEREIGNT === props.ADMIN;
    if (EXCLUDED.has(a3) || (!sovereign && !TERRITORIES.has(a3))) continue;
    const name =
      COUNTRY_NAMES[a3] ??
      (props.NAME.includes('.') ? props.NAME_LONG : props.NAME);
    const fixes = new Set(
      (COUNTRY_ALIAS_FIXES[a3] || []).map(normalizePlaceName),
    );
    const aliases = strings(
      props.NAME,
      props.NAME_LONG,
      props.NAME_EN,
      props.FORMAL_EN,
      props.NAME_ALT,
      languageNames(props, [...LANGUAGES, ...(NATIVE[a3] || [])]),
      COUNTRY_ALIASES[a3] || [],
    ).filter((alias) => {
      if (!fixes.has(normalizePlaceName(alias))) return true;
      log.fixed.push(`${name}: "${alias}" (wrong in Natural Earth)`);
      return false;
    });
    rows.push({
      kind: 'country',
      a3,
      name,
      // The `country` label on its places reads plainly.
      display: COUNTRY_LABELS[a3] ?? name,
      lat: props.LABEL_Y,
      lon: props.LABEL_X,
      precision: 'country',
      aliases,
    });
  }
  return rows;
}

function placeRows(places, countriesByA3, log) {
  const rows = [];
  const seen = new Set();
  for (const props of places) {
    const capital =
      props.FEATURECLA === 'Admin-0 capital' ||
      (props.FEATURECLA === 'Admin-0 capital alt' &&
        SEATS_OF_GOVERNMENT.has(props.NAME));
    const regionCapital = props.FEATURECLA === 'Admin-0 region capital';
    if (!capital && !regionCapital && !(props.POP_MAX >= CITY_MIN_POPULATION))
      continue;
    if (PLACE_ERRATA.has(props.NE_ID)) continue;
    const a3 = PLACE_A3[props.ADM0_A3] ?? props.ADM0_A3;
    const country = countriesByA3.get(a3);
    if (!country) {
      log.skipped.push(
        `${props.NAME} (${props.ADM0_A3}): its territory is not a row`,
      );
      continue;
    }
    const name = CITY_NAMES[props.NAME] ?? props.NAME_EN ?? props.NAME;
    // Natural Earth lists a few cities twice.
    const dedupe = `${a3}:${normalizePlaceName(name)}:${Math.round(props.LATITUDE)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const spellings = strings(
      props.NAME,
      props.NAMEASCII,
      props.NAME_EN,
      languageNames(props, [...LANGUAGES, ...(NATIVE[a3] || [])]),
    );
    // Natural Earth cuts some alternate names short ("Ciudad de M").
    const alternates = strings(props.NAMEALT).filter((alias) => {
      if (!truncated(alias, spellings)) return true;
      log.truncated.push(`${name}: "${alias}"`);
      return false;
    });
    rows.push({
      kind: capital ? 'capital' : 'city',
      a3,
      name,
      display: country.display,
      adm1: props.ADM1NAME,
      population: props.POP_MAX,
      lat: props.LATITUDE,
      lon: props.LONGITUDE,
      precision: 'city',
      aliases: [...spellings, ...alternates, ...(CITY_ALIASES[name] || [])],
    });
  }
  return rows;
}

function hotspotRows(provinces) {
  return HOTSPOTS.map((spot) => {
    let { at } = spot;
    if (spot.provinces) {
      const [a3, ...names] = spot.provinces;
      const points = names.map((wanted) => {
        const hit = provinces.find(
          (props) => props.adm0_a3 === a3 && props.name === wanted,
        );
        if (!hit)
          throw new Error(`hotspot ${spot.name}: no province ${a3} ${wanted}`);
        return [hit.latitude, hit.longitude];
      });
      at = [
        points.reduce((sum, [lat]) => sum + lat, 0) / points.length,
        points.reduce((sum, [, lon]) => sum + lon, 0) / points.length,
      ];
    }
    return {
      kind: 'hotspot',
      name: spot.name,
      display: spot.country,
      lat: at[0],
      lon: at[1],
      precision: spot.precision,
      aliases: [...spot.aliases],
    };
  });
}

/**
 * Drop an alias that ends inside a word another spelling of the row
 * continues: Natural Earth truncates some alternates ("Ciudad de M").
 */
function truncated(alias, spellings) {
  const key = normalizePlaceName(alias);
  return spellings.some((other) => {
    const full = normalizePlaceName(other);
    return (
      full.length > key.length &&
      full.startsWith(key) &&
      /\p{L}/u.test(full[key.length])
    );
  });
}

/**
 * Give every row a unique name. A city spelled like an earlier place is
 * that place when it lies within SAME_PLACE_KM (dropped); otherwise it gets
 * its country appended (a US or same-country namesake its state or
 * province) when the earlier place has that name, and keeps its name when
 * the earlier place only has it as an alias (which uniqueAliases then
 * drops). Of two cities with one name a capital keeps it.
 */
function uniqueNames(rows, log) {
  const kept = [];
  const names = new Map();
  const spellings = new Map();
  const own = (row) => {
    names.set(normalizePlaceName(row.name), row);
    for (const spelling of [row.name, ...row.aliases])
      if (!spellings.has(normalizePlaceName(spelling)))
        spellings.set(normalizePlaceName(spelling), row);
  };
  const qualify = (row, other) => {
    const qualifier =
      row.a3 === 'USA' || row.a3 === other?.a3 ? row.adm1 : row.display;
    log.qualified.push(`${row.name} → ${row.name}, ${qualifier}`);
    row.name = `${row.name}, ${qualifier}`;
  };
  // Two cities (neither a capital) sharing a name are both qualified.
  const cityNames = new Map();
  for (const row of rows.filter(
    (r) => r.kind === 'city' || r.kind === 'capital',
  )) {
    const key = normalizePlaceName(row.name);
    cityNames.set(key, [...(cityNames.get(key) || []), row]);
  }
  for (const group of cityNames.values()) {
    if (group.length < 2) continue;
    const capitals = group.filter((row) => row.kind === 'capital');
    for (const row of group)
      if (!capitals.includes(row))
        qualify(
          row,
          group.find((other) => other !== row),
        );
  }
  for (const row of rows) {
    const key = normalizePlaceName(row.name);
    const owner = spellings.get(key);
    if (owner && (row.kind === 'hotspot' || row.kind === 'country')) {
      if (names.has(key))
        throw new Error(`${row.name} is also ${owner.name}: fix by hand`);
    } else if (owner && distanceKm(owner, row) < SAME_PLACE_KM) {
      log.merged.push(`${row.name} (${row.kind}): same place as ${owner.name}`);
      continue;
    } else if (names.has(key)) qualify(row, names.get(key));
    kept.push(row);
    own(row);
  }
  return kept;
}

/**
 * One owner per spelling. A primary name owns its spelling outright. An
 * alias several rows share goes to the highest rank (hotspot, country,
 * capital, city); two rows of the same rank both drop it.
 */
function uniqueAliases(rows, log) {
  const owner = new Map(rows.map((row) => [normalizePlaceName(row.name), row]));
  const claims = new Map();
  for (const row of rows) {
    const own = new Set([normalizePlaceName(row.name)]);
    row.keep = [];
    for (const alias of row.aliases) {
      const key = normalizePlaceName(alias);
      if (!key || own.has(key)) continue;
      own.add(key);
      if (DROPPED.has(key)) {
        log.ambiguous.push(`${row.name}: "${alias}" (${DROPPED.get(key)})`);
        continue;
      }
      if (owner.has(key)) {
        log.ambiguous.push(
          `${row.name}: "${alias}" (the name of ${owner.get(key).name})`,
        );
        continue;
      }
      claims.set(key, [...(claims.get(key) || []), { row, alias }]);
    }
  }
  for (const list of claims.values()) {
    const best = Math.min(...list.map(({ row }) => RANK[row.kind]));
    const winners = list.filter(({ row }) => RANK[row.kind] === best);
    for (const { row, alias } of list) {
      if (winners.length === 1 && winners[0].row === row) row.keep.push(alias);
      else
        log.ambiguous.push(
          `${row.name}: "${alias}" (also ${list
            .filter((other) => other.row !== row)
            .map((other) => other.row.name)
            .join(', ')})`,
        );
    }
  }
}

function toEntry(row) {
  return {
    name: row.name,
    lat: round(row.lat, 4),
    lon: round(row.lon, 4),
    precision: row.precision,
    country: row.display,
    aliases: row.keep,
    ...(row.kind === 'country' || row.kind === 'capital'
      ? { prompt: true }
      : {}),
  };
}

/** The theater file with one gazetteer row per line, like the other theater. */
export function serializeTheater(doc) {
  const { gazetteer, ...rest } = doc;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  const lines = gazetteer.map((row) => `    ${JSON.stringify(row)}`);
  return `${head},\n  "gazetteer": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

/**
 * @param {{countries: object[], places: object[], provinces: object[]}} ne
 * @returns {{gazetteer: object[], log: object}}
 */
export function buildWorldGazetteer(ne) {
  const log = {
    skipped: [],
    merged: [],
    qualified: [],
    ambiguous: [],
    truncated: [],
    fixed: [],
  };
  const countries = countryRows(ne.countries, log);
  const countriesByA3 = new Map(countries.map((row) => [row.a3, row]));
  const places = placeRows(ne.places, countriesByA3, log).sort(
    (a, b) => RANK[a.kind] - RANK[b.kind] || b.population - a.population,
  );
  const rows = uniqueNames(
    [...hotspotRows(ne.provinces), ...countries, ...places],
    log,
  );
  for (const row of rows)
    if (DROPPED.has(normalizePlaceName(row.name)))
      throw new Error(`${row.name} is an ambiguous name: rename it`);
  uniqueAliases(rows, log);
  // Hotspots in list order, countries and capitals A to Z, then cities by
  // population.
  const byName = (a, b) => a.name.localeCompare(b.name, 'en');
  const of = (kind) => rows.filter((row) => row.kind === kind);
  const ordered = [
    ...of('hotspot'),
    ...of('country').sort(byName),
    ...of('capital').sort(byName),
    ...of('city').sort((a, b) => b.population - a.population || byName(a, b)),
  ];
  return { gazetteer: ordered.map(toEntry), log };
}

async function main() {
  const args = process.argv.slice(2);
  const dataIndex = args.indexOf('--data');
  const dataDir = dataIndex >= 0 ? args[dataIndex + 1] : null;
  const ne = await readNaturalEarth(dataDir);
  const { gazetteer, log } = buildWorldGazetteer(ne);
  const doc = JSON.parse(readFileSync(THEATER_FILE, 'utf8'));
  doc.gazetteer = gazetteer;
  // The registry's own checks, ambiguous spellings included.
  const sources = validateNewsSources(
    JSON.parse(readFileSync(SOURCES_FILE, 'utf8')),
  );
  validateNewsTheater(
    doc,
    new Map(sources.map((source) => [source.id, source])),
  );
  const count = (test) => gazetteer.filter(test).length;
  console.log(
    `countries ${count((r) => r.precision === 'country')} · capitals ${count((r) => r.precision === 'city' && r.prompt)} · cities ${count((r) => r.precision === 'city' && !r.prompt)} · hotspots ${count((r) => r.precision === 'region' || r.precision === 'water')} · aliases ${gazetteer.reduce((sum, r) => sum + r.aliases.length, 0)}`,
  );
  for (const [what, lines] of Object.entries(log)) {
    console.log(`\n${what} (${lines.length}):`);
    for (const line of lines) console.log(`  ${line}`);
  }
  if (args.includes('--dry-run')) return;
  writeFileSync(THEATER_FILE, serializeTheater(doc));
  console.log(`\nwrote ${path.relative(ROOT, THEATER_FILE)}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
