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
 *     metro population (POP_MAX) is 300,000 or more;
 *   - ne_10m_admin_1_states_provinces: label points for the hotspots below
 *     that are provinces or groups of provinces.
 * Hotspots that are not provinces (seas, cross-border regions) are placed by
 * hand at an approximate centre; each names the reference it was read from.
 * Conflict towns below the population threshold (TOWNS) are placed by hand
 * the same way. CITY_HOTSPOTS links a city, whichever of the two it comes
 * from, to the region or water row it lies in: the `hotspot` field the
 * hotspot view groups stories by.
 *
 * Aliases: English variants and the Arabic, Persian, Hebrew, Russian,
 * Chinese, Spanish, French and Portuguese names from Natural Earth, plus the
 * native-language name where Natural Earth has one. A spelling two places
 * share is ambiguous: a country or hotspot keeps it over a city; two cities
 * both drop it; a city whose name another place owns is qualified with its
 * country ("Hyderabad, Pakistan"), a capital keeping the bare name. Names
 * that mean another well-known place too (Georgia, the US state) are
 * dropped outright, and so are the bare names of cities whose better-known
 * namesake stays below the population threshold (QUALIFY: "Toledo, Ohio").
 * Every drop is printed.
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
const CITY_MIN_POPULATION = 300_000;
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
  // Natural Earth's spellings; the press writes these.
  'Al-Ubayyid': ['El Obeid'],
  "Ta'izz": ['Taizz', 'Taiz'],
  'Al Hudaydah': ['Hodeidah', 'Hudaydah'],
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
 * Natural Earth errata, by NE_ID, dropped: a village in Amapá that carries
 * the population of Vila Velha (Espírito Santo), which is kept; Mazatán in
 * Sonora carrying Mazatlán's population (Mazatlán, Sinaloa is kept); and a
 * town near Al-Kharj carrying the population of Hillah, Iraq.
 */
const PLACE_ERRATA = new Set([1159148899, 1159138371, 1159128275]);
/**
 * Natural Earth errata, by NE_ID, renamed: NAME_EN is another city's name.
 * Left alone, the 300,000 threshold would put these on the map under it
 * ("Juarez" at Mazatlán, "Taza" at Oujda, a city called "Saudi Arabia").
 */
const PLACE_RENAMES = new Map([
  [1159136215, 'Hail'], // NAME_EN "Saudi Arabia"
  [1159150011, 'Cuttack'], // "Pochinki"
  [1159129345, 'Celaya'], // "Guanajuato"
  [1159149507, 'Oujda'], // "Taza"
  [1159150755, 'Mazatlán'], // "Juarez"
  [1159140381, 'Mansoura'], // "sharkia", the governorate
]);

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
 * Cities that are the only row of their name, but whose better-known
 * namesake lies below the population threshold: left bare, a story about
 * Toledo, Spain would be pinned in Ohio. Keyed by country code and the name
 * Natural Earth gives; qualified like any other namesake, with the bare
 * spelling dropped from its aliases.
 */
const QUALIFY = new Map([
  ['USA:Toledo', 'Toledo, Spain'],
  ['AUS:Newcastle', 'Newcastle upon Tyne'],
  ['CAN:Hamilton', 'Hamilton, Bermuda and New Zealand'],
  ['CAN:Windsor', 'Windsor, England'],
  ['BLR:Brest', 'Brest, France'],
  ['ARG:Santa Fe', 'Santa Fe, New Mexico'],
  ['USA:Durham', 'Durham, England'],
  ['USA:Syracuse', 'Syracuse, Sicily'],
  ['USA:Springfield', 'Springfield, Illinois, and a dozen others'],
  ['USA:Arlington', 'Arlington, Virginia'],
  ['PHL:Naga', 'the Naga people of northeast India'],
  ['USA:St. Petersburg', 'Saint Petersburg, Russia'],
]);

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

/**
 * Conflict-relevant towns below the population threshold, placed by hand at
 * the town centre (two decimals) from `ref`. `country` is the label the
 * country's other rows carry. A town Natural Earth also has at 300,000 is
 * reported by findDuplicateTowns and removed from this list; uniqueNames
 * would drop it anyway.
 */
const TOWNS = [
  // West Bank
  {
    name: 'Hebron',
    precision: 'city',
    country: 'Palestine',
    at: [31.53, 35.1],
    ref: 'Wikipedia: Hebron',
    aliases: ['Al-Khalil', 'الخليل'],
  },
  {
    name: 'Jenin',
    precision: 'city',
    country: 'Palestine',
    at: [32.46, 35.29],
    ref: 'Wikipedia: Jenin',
    aliases: ['جنين'],
  },
  {
    name: 'Nablus',
    precision: 'city',
    country: 'Palestine',
    at: [32.22, 35.25],
    ref: 'Wikipedia: Nablus',
    aliases: ['Nabulus', 'نابلس'],
  },
  {
    name: 'Tulkarm',
    precision: 'city',
    country: 'Palestine',
    at: [32.31, 35.03],
    ref: 'Wikipedia: Tulkarm',
    aliases: ['Tulkarem', 'طولكرم'],
  },
  {
    name: 'Bethlehem',
    precision: 'city',
    country: 'Palestine',
    at: [31.71, 35.2],
    ref: 'Wikipedia: Bethlehem',
    aliases: ['Bayt Lahm', 'بيت لحم'],
  },
  {
    name: 'Qalqilya',
    precision: 'city',
    country: 'Palestine',
    at: [32.19, 34.97],
    ref: 'Wikipedia: Qalqilya',
    aliases: ['Qalqilyah', 'Qalqiliya', 'قلقيلية'],
  },
  {
    name: 'Jericho',
    precision: 'city',
    country: 'Palestine',
    at: [31.87, 35.45],
    ref: 'Wikipedia: Jericho',
    aliases: ['Ariha', 'أريحا'],
  },
  {
    name: 'Tubas',
    precision: 'city',
    country: 'Palestine',
    at: [32.32, 35.37],
    ref: 'Wikipedia: Tubas',
    aliases: ['طوباس'],
  },
  // Gaza Strip
  {
    name: 'Khan Younis',
    precision: 'city',
    country: 'Palestine',
    at: [31.35, 34.31],
    ref: 'Wikipedia: Khan Younis',
    aliases: ['Khan Yunis', 'Khan Yunus', 'خان يونس'],
  },
  {
    name: 'Rafah',
    precision: 'city',
    country: 'Palestine',
    at: [31.3, 34.25],
    ref: 'Wikipedia: Rafah',
    aliases: ['رفح'],
  },
  {
    name: 'Deir al-Balah',
    precision: 'city',
    country: 'Palestine',
    at: [31.42, 34.35],
    ref: 'Wikipedia: Deir al-Balah',
    aliases: ['Deir el-Balah', 'Deir al Balah', 'Dair al-Balah', 'دير البلح'],
  },
  {
    name: 'Jabalia',
    precision: 'city',
    country: 'Palestine',
    at: [31.53, 34.48],
    ref: 'Wikipedia: Jabalia',
    aliases: ['Jabalya', 'جباليا'],
  },
  {
    name: 'Beit Lahia',
    precision: 'city',
    country: 'Palestine',
    at: [31.55, 34.5],
    ref: 'Wikipedia: Beit Lahia',
    aliases: ['Beit Lahiya', 'بيت لاهيا'],
  },
  {
    name: 'Beit Hanoun',
    precision: 'city',
    country: 'Palestine',
    at: [31.54, 34.54],
    ref: 'Wikipedia: Beit Hanoun',
    aliases: ['Beit Hanun', 'بيت حانون'],
  },
  // Israel, Lebanon and Syria
  {
    name: 'Sderot',
    precision: 'city',
    country: 'Israel',
    at: [31.52, 34.6],
    ref: 'Wikipedia: Sderot',
    aliases: ['שדרות'],
  },
  {
    name: 'Kiryat Shmona',
    precision: 'city',
    country: 'Israel',
    at: [33.21, 35.57],
    ref: 'Wikipedia: Kiryat Shmona',
    aliases: ['Qiryat Shemona', 'Kiryat Shemona', 'קריית שמונה'],
  },
  {
    name: 'Tyre',
    precision: 'city',
    country: 'Lebanon',
    at: [33.27, 35.2],
    ref: 'Wikipedia: Tyre',
    aliases: ['Sour', 'صور'],
  },
  {
    name: 'Nabatieh',
    precision: 'city',
    country: 'Lebanon',
    at: [33.38, 35.48],
    ref: 'Wikipedia: Nabatieh',
    aliases: ['Nabatiyeh', 'Nabatiye', 'النبطية'],
  },
  {
    name: 'Baalbek',
    precision: 'city',
    country: 'Lebanon',
    at: [34, 36.21],
    ref: 'Wikipedia: Baalbek',
    aliases: ['Baalbeck', 'بعلبك'],
  },
  {
    name: 'Daraa',
    precision: 'city',
    country: 'Syria',
    at: [32.62, 36.1],
    ref: 'Wikipedia: Daraa',
    aliases: ["Dara'a", 'Deraa', 'درعا'],
  },
  {
    name: 'Qamishli',
    precision: 'city',
    country: 'Syria',
    at: [37.05, 41.22],
    ref: 'Wikipedia: Qamishli',
    aliases: ['Qamishlo', 'Al Qamishli', 'القامشلي'],
  },
  {
    name: 'Raqqa',
    precision: 'city',
    country: 'Syria',
    at: [35.95, 39.01],
    ref: 'Wikipedia: Raqqa',
    aliases: ['Ar-Raqqa', 'Raqqah', 'الرقة'],
  },
  // Yemen
  {
    name: 'Marib',
    precision: 'city',
    country: 'Yemen',
    at: [15.46, 45.33],
    ref: 'Wikipedia: Marib',
    aliases: ["Ma'rib", 'مأرب'],
  },
  {
    name: 'Saada',
    precision: 'city',
    country: 'Yemen',
    at: [16.94, 43.76],
    ref: 'Wikipedia: Saada',
    aliases: ["Sa'dah", 'Saadah', 'صعدة'],
  },
  {
    name: 'Mokha',
    precision: 'city',
    country: 'Yemen',
    at: [13.32, 43.25],
    ref: 'Wikipedia: Mokha',
    aliases: ['Mocha', 'Al Mukha', 'المخا'],
  },
  // Ukraine
  {
    name: 'Bakhmut',
    precision: 'city',
    country: 'Ukraine',
    at: [48.59, 38],
    ref: 'Wikipedia: Bakhmut',
    aliases: ['Artemivsk', 'Бахмут'],
  },
  {
    name: 'Pokrovsk',
    precision: 'city',
    country: 'Ukraine',
    at: [48.28, 37.18],
    ref: 'Wikipedia: Pokrovsk',
    aliases: ['Покровск'],
  },
  {
    name: 'Kramatorsk',
    precision: 'city',
    country: 'Ukraine',
    at: [48.72, 37.56],
    ref: 'Wikipedia: Kramatorsk',
    aliases: ['Краматорск'],
  },
  {
    name: 'Sloviansk',
    precision: 'city',
    country: 'Ukraine',
    at: [48.85, 37.61],
    ref: 'Wikipedia: Sloviansk',
    aliases: ['Slavyansk', 'Slovyansk', 'Славянск'],
  },
  {
    name: 'Kostiantynivka',
    precision: 'city',
    country: 'Ukraine',
    at: [48.53, 37.7],
    ref: 'Wikipedia: Kostiantynivka',
    aliases: ['Kostyantynivka', 'Konstantinovka', 'Константиновка'],
  },
  {
    name: 'Toretsk',
    precision: 'city',
    country: 'Ukraine',
    at: [48.39, 37.85],
    ref: 'Wikipedia: Toretsk',
    aliases: ['Торецк'],
  },
  {
    name: 'Chasiv Yar',
    precision: 'city',
    country: 'Ukraine',
    at: [48.59, 37.84],
    ref: 'Wikipedia: Chasiv Yar',
    aliases: ['Chasov Yar', 'Часов Яр'],
  },
  {
    name: 'Avdiivka',
    precision: 'city',
    country: 'Ukraine',
    at: [48.14, 37.75],
    ref: 'Wikipedia: Avdiivka',
    aliases: ['Avdiyivka', 'Avdeevka', 'Авдеевка'],
  },
  {
    name: 'Kupiansk',
    precision: 'city',
    country: 'Ukraine',
    at: [49.71, 37.62],
    ref: 'Wikipedia: Kupiansk',
    aliases: ['Kupyansk', 'Купянск'],
  },
  {
    name: 'Enerhodar',
    precision: 'city',
    country: 'Ukraine',
    at: [47.5, 34.65],
    ref: 'Wikipedia: Enerhodar',
    aliases: ['Energodar', 'Энергодар'],
  },
  {
    name: 'Nikopol',
    precision: 'city',
    country: 'Ukraine',
    at: [47.57, 34.4],
    ref: 'Wikipedia: Nikopol',
    aliases: ['Нікополь'],
  },
  {
    name: 'Sumy',
    precision: 'city',
    country: 'Ukraine',
    at: [50.91, 34.8],
    ref: 'Wikipedia: Sumy',
    aliases: ['Сумы'],
  },
  // Sudan and Ethiopia
  {
    name: 'El Fasher',
    precision: 'city',
    country: 'Sudan',
    at: [13.63, 25.35],
    ref: 'Wikipedia: El Fasher',
    aliases: ['Al Fashir', 'Al-Fashir', 'El Fashir', 'الفاشر'],
  },
  {
    name: 'Kadugli',
    precision: 'city',
    country: 'Sudan',
    at: [11.02, 29.72],
    ref: 'Wikipedia: Kadugli',
    aliases: ['Kaduqli', 'كادقلي'],
  },
  {
    name: 'Geneina',
    precision: 'city',
    country: 'Sudan',
    at: [13.45, 22.45],
    ref: 'Wikipedia: Geneina',
    aliases: ['El Geneina', 'Al Junaynah', 'الجنينة'],
  },
  {
    name: 'Zalingei',
    precision: 'city',
    country: 'Sudan',
    at: [12.91, 23.47],
    ref: 'Wikipedia: Zalingei',
    aliases: ['Zalingi', 'زالنجي'],
  },
  {
    name: 'El Daein',
    precision: 'city',
    country: 'Sudan',
    at: [11.47, 26.13],
    ref: 'Wikipedia: El Daein',
    aliases: ['Ed Daein', 'Ad Daein', 'الضعين'],
  },
  {
    name: 'Dilling',
    precision: 'city',
    country: 'Sudan',
    at: [12.05, 29.65],
    ref: 'Wikipedia: Dilling',
    aliases: ['Ad Dalanj', 'الدلنج'],
  },
  {
    name: 'Babanusa',
    precision: 'city',
    country: 'Sudan',
    at: [11.33, 27.8],
    ref: 'Wikipedia: Babanusa',
    aliases: ['Babanousa', 'بابنوسة'],
  },
  {
    name: 'Mekelle',
    precision: 'city',
    country: 'Ethiopia',
    at: [13.5, 39.47],
    ref: 'Wikipedia: Mekelle',
    aliases: ["Mek'ele", 'Mekele'],
  },
  // Sahel and the Horn
  {
    name: 'Gao',
    precision: 'city',
    country: 'Mali',
    at: [16.27, -0.04],
    ref: 'Wikipedia: Gao',
  },
  {
    name: 'Timbuktu',
    precision: 'city',
    country: 'Mali',
    at: [16.77, -3.01],
    ref: 'Wikipedia: Timbuktu',
    aliases: ['Tombouctou'],
  },
  {
    name: 'Kidal',
    precision: 'city',
    country: 'Mali',
    at: [18.44, 1.41],
    ref: 'Wikipedia: Kidal',
  },
  {
    name: 'Menaka',
    precision: 'city',
    country: 'Mali',
    at: [15.92, 2.4],
    ref: 'Wikipedia: Menaka',
  },
  {
    name: 'Kismayo',
    precision: 'city',
    country: 'Somalia',
    at: [-0.36, 42.54],
    ref: 'Wikipedia: Kismayo',
    aliases: ['Kismaayo', 'Chisimayu'],
  },
  {
    name: 'Baidoa',
    precision: 'city',
    country: 'Somalia',
    at: [3.12, 43.65],
    ref: 'Wikipedia: Baidoa',
    aliases: ['Baydhabo', 'Baydhaba'],
  },
  // Central Africa and Asia
  {
    name: 'Goma',
    precision: 'city',
    country: 'Democratic Republic of the Congo',
    at: [-1.68, 29.22],
    ref: 'Wikipedia: Goma',
  },
  {
    name: 'Butembo',
    precision: 'city',
    country: 'Democratic Republic of the Congo',
    at: [0.13, 29.29],
    ref: 'Wikipedia: Butembo',
  },
  {
    name: 'Bunia',
    precision: 'city',
    country: 'Democratic Republic of the Congo',
    at: [1.57, 30.25],
    ref: 'Wikipedia: Bunia',
  },
  {
    name: 'Sittwe',
    precision: 'city',
    country: 'Myanmar',
    at: [20.15, 92.9],
    ref: 'Wikipedia: Sittwe',
    aliases: ['Akyab'],
  },
  {
    name: 'Lashio',
    precision: 'city',
    country: 'Myanmar',
    at: [22.94, 97.75],
    ref: 'Wikipedia: Lashio',
  },
  {
    name: 'Myawaddy',
    precision: 'city',
    country: 'Myanmar',
    at: [16.69, 98.51],
    ref: 'Wikipedia: Myawaddy',
  },
  {
    name: 'Stepanakert',
    precision: 'city',
    country: 'Azerbaijan',
    at: [39.82, 46.75],
    ref: 'Wikipedia: Stepanakert',
    aliases: ['Khankendi', 'Xankəndi'],
  },
  {
    name: 'Muzaffarabad',
    precision: 'city',
    country: 'Pakistan',
    at: [34.37, 73.47],
    ref: 'Wikipedia: Muzaffarabad',
  },
];

/**
 * The cities in each region or water row (a HOTSPOTS name), listed by
 * region to read; CITY_HOTSPOTS below is the map from city to region. The
 * name is the final row name of any row, Natural Earth's or a TOWNS row, so
 * Natural Earth's spellings stand ("Al-Ubayyid" is El Obeid).
 * buildWorldGazetteer throws on a name no row carries and on a region that
 * is not a region or water row, so an entry that goes stale fails the build.
 * Only a city inside the region is listed: Nikopol (Dnipropetrovsk Oblast)
 * and Kupiansk (Kharkiv Oblast) are not in Donbas.
 */
const CITIES_OF_HOTSPOT = {
  'West Bank': [
    'Hebron',
    'Jenin',
    'Nablus',
    'Tulkarm',
    'Ramallah',
    'Bethlehem',
    'Qalqilya',
    'Jericho',
    'Tubas',
  ],
  'Gaza Strip': [
    'Gaza City',
    'Khan Younis',
    'Rafah',
    'Deir al-Balah',
    'Jabalia',
    'Beit Lahia',
    'Beit Hanoun',
  ],
  Donbas: [
    'Donetsk',
    'Luhansk',
    'Mariupol',
    'Bakhmut',
    'Pokrovsk',
    'Kramatorsk',
    'Sloviansk',
    'Kostiantynivka',
    'Toretsk',
    'Chasiv Yar',
    'Avdiivka',
    'Makiivka',
    'Horlivka',
  ],
  Darfur: ['El Fasher', 'Nyala', 'Geneina', 'Zalingei', 'El Daein'],
  Kordofan: ['Kadugli', 'Al-Ubayyid', 'Dilling', 'Babanusa'],
  Crimea: ['Sevastopol', 'Simferopol'],
  'Zaporizhzhia Oblast': ['Zaporizhzhia', 'Enerhodar'],
  'Kherson Oblast': ['Kherson'],
  Tigray: ['Mekelle'],
  'Rakhine State': ['Sittwe'],
  'North Kivu': ['Goma', 'Beni', 'Butembo'],
  Kashmir: ['Srinagar', 'Muzaffarabad'],
  'Nagorno-Karabakh': ['Stepanakert'],
  Sahel: ['Gao', 'Timbuktu', 'Kidal', 'Menaka'],
  'Kurdistan Region': ['Erbil', 'Sulaymaniyah', 'Duhok'],
  'Anglophone Cameroon': ['Bamenda'],
  Balochistan: ['Quetta'],
};
const CITY_HOTSPOTS = {};
for (const [region, cities] of Object.entries(CITIES_OF_HOTSPOT))
  for (const city of cities) {
    if (city in CITY_HOTSPOTS)
      throw new Error(
        `${city} is in both ${CITY_HOTSPOTS[city]} and ${region}`,
      );
    CITY_HOTSPOTS[city] = region;
  }

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
    const renamed = PLACE_RENAMES.get(props.NE_ID);
    const name =
      renamed ?? CITY_NAMES[props.NAME] ?? props.NAME_EN ?? props.NAME;
    // Natural Earth lists a few cities twice.
    const dedupe = `${a3}:${normalizePlaceName(name)}:${Math.round(props.LATITUDE)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const spellings = strings(
      props.NAME,
      props.NAMEASCII,
      // A renamed row's English name belongs to another place.
      renamed ? null : props.NAME_EN,
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

/** The hand-written towns, as city rows of their country. */
function townRows(countries) {
  return TOWNS.map((town) => {
    const country = countries.find((row) => row.display === town.country);
    if (!country)
      throw new Error(`town ${town.name}: no country row ${town.country}`);
    return {
      kind: 'city',
      a3: country.a3,
      name: town.name,
      display: country.display,
      // Below every Natural Earth city, so the file lists them last.
      population: 0,
      lat: town.at[0],
      lon: town.at[1],
      precision: town.precision,
      aliases: [...(town.aliases || [])],
    };
  });
}

/**
 * Report each town spelled like a Natural Earth row and within
 * SAME_PLACE_KM of it: the threshold already brings the city in, so the
 * hand-written row is redundant (uniqueNames drops it).
 * @param {{name: string, lat: number, lon: number}[]} towns
 * @param {{name: string, aliases: string[], lat: number, lon: number}[]} rows
 * @returns {string[]}
 */
export function findDuplicateTowns(towns, rows) {
  const found = [];
  for (const town of towns) {
    const key = normalizePlaceName(town.name);
    const same = rows.find(
      (row) =>
        [row.name, ...row.aliases].some(
          (spelling) => normalizePlaceName(spelling) === key,
        ) && distanceKm(row, town) < SAME_PLACE_KM,
    );
    if (same) found.push(`${town.name}: same place as ${same.name}`);
  }
  return found;
}

/**
 * Set `hotspot` on the city rows named in `links` (city name → the name of
 * a region or water row). A name no city row carries, or a target that is
 * not a region or water row, is a stale entry: it throws.
 * @param {{name: string, kind: string, precision: string, hotspot?: string}[]} rows
 * @param {Record<string, string>} links
 */
export function linkCityHotspots(rows, links) {
  for (const [city, region] of Object.entries(links)) {
    const row = rows.find(
      (entry) =>
        ['city', 'capital'].includes(entry.kind) &&
        normalizePlaceName(entry.name) === normalizePlaceName(city),
    );
    if (!row) throw new Error(`CITY_HOTSPOTS: no city row named ${city}`);
    const target = rows.find(
      (entry) =>
        entry.kind === 'hotspot' &&
        normalizePlaceName(entry.name) === normalizePlaceName(region),
    );
    if (!target || !['region', 'water'].includes(target.precision))
      throw new Error(
        `CITY_HOTSPOTS: ${city} → ${region} is not a region or water row`,
      );
    row.hotspot = target.name;
  }
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
      (row.a3 === 'USA' || row.a3 === other?.a3 ? row.adm1 : null) ??
      row.display;
    log.qualified.push(`${row.name} → ${row.name}, ${qualifier}`);
    row.name = `${row.name}, ${qualifier}`;
  };
  // A bare name whose better-known namesake is not a row.
  const qualified = new Set();
  for (const row of rows) {
    const key = `${row.a3}:${row.name}`;
    if (!QUALIFY.has(key)) continue;
    qualified.add(key);
    const bareName = row.name;
    const bare = normalizePlaceName(bareName);
    qualify(row);
    log.ambiguous.push(
      `${row.name}: "${bareName}" (a better-known namesake: ${QUALIFY.get(key)})`,
    );
    row.aliases = row.aliases.filter(
      (alias) => normalizePlaceName(alias) !== bare,
    );
  }
  for (const key of QUALIFY.keys())
    if (!qualified.has(key)) throw new Error(`QUALIFY: no row ${key}`);
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
    ...(row.hotspot ? { hotspot: row.hotspot } : {}),
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
    duplicateTowns: [],
  };
  const countries = countryRows(ne.countries, log);
  const countriesByA3 = new Map(countries.map((row) => [row.a3, row]));
  const places = placeRows(ne.places, countriesByA3, log).sort(
    (a, b) => RANK[a.kind] - RANK[b.kind] || b.population - a.population,
  );
  // Towns come last, so a Natural Earth row of the same name wins.
  const towns = townRows(countries);
  log.duplicateTowns.push(...findDuplicateTowns(towns, places));
  const rows = uniqueNames(
    [...hotspotRows(ne.provinces), ...countries, ...places, ...towns],
    log,
  );
  linkCityHotspots(rows, CITY_HOTSPOTS);
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
