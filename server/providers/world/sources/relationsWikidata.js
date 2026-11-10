import { readResponseJsonCapped } from '../../common/http.js';
import { makeRelation, relationResult } from '../relations.js';
import { fetchResponse } from './common.js';

const SPARQL = 'https://query.wikidata.org/sparql';
const Q463 = 'https://www.wikidata.org/wiki/Property:P463';
const Q530 = 'https://www.wikidata.org/wiki/Property:P530';
const CHECKED = '2026-11-09';
const blocs = {
  Q7184: [
    'NATO',
    'https://nato.int/en/about-us/organization/nato-member-countries',
    'ALB BEL BGR CAN HRV CZE DNK EST FIN FRA DEU GRC HUN ISL ITA LVA LTU LUX MNE NLD MKD NOR POL PRT ROU SVK SVN ESP SWE TUR GBR USA',
  ],
  Q458: [
    'EU',
    'https://european-union.europa.eu/principles-countries-history/eu-countries_en',
    'AUT BEL BGR HRV CYP CZE DNK EST FIN FRA DEU GRC HUN IRL ITA LVA LTU LUX MLT NLD POL PRT ROU SVK SVN ESP SWE',
  ],
  Q217172: [
    'GCC',
    'https://www.gcc-sg.org/en/AboutUs/MemberStates/Pages/default.aspx',
    'BHR KWT OMN QAT SAU ARE',
  ],
  Q243630: [
    'BRICS',
    'https://brics.br/en/about-the-brics',
    'BRA RUS IND CHN ZAF EGY ETH IRN ARE IDN',
  ],
  Q485207: [
    'SCO',
    'https://eng.sectsco.org/20260901/2493609.html',
    'BLR CHN IND IRN KAZ KGZ PAK RUS TJK UZB',
  ],
  Q318693: [
    'CSTO',
    'https://mkves.odkb-csto.org/en/states/',
    'ARM BLR KAZ KGZ RUS TJK',
  ],
  Q7768: [
    'ASEAN',
    'https://asean.org/member-states',
    'BRN KHM IDN LAO MYS MMR PHL SGP THA TLS VNM',
  ],
  Q121826282: [
    'OPEC+',
    'https://www.opec.org/pr-detail/585-10-december-2025.html',
    'DZA COG GNQ GAB IRN IRQ KWT LBY NGA SAU ARE VEN AZE BHR BRN KAZ MYS MEX OMN RUS SDN SSD',
  ],
  Q7795: [
    'OPEC',
    'https://www.opec.org/member-countries.html',
    'DZA COG GNQ GAB IRN IRQ KWT LBY NGA SAU ARE VEN',
  ],
  Q41550: [
    'OECD',
    'https://www.oecd.org/en/about/members-partners.html',
    'AUS AUT BEL CAN CHL COL CRI CZE DNK EST FIN FRA DEU GRC HUN ISL IRL ISR ITA JPN KOR LVA LTU LUX MEX NLD NZL NOR POL PRT SVK SVN ESP SWE CHE TUR GBR USA',
  ],
  Q19771: [
    'G20',
    'https://g20.org/',
    'ARG AUS BRA CAN CHN FRA DEU IND IDN ITA JPN MEX RUS SAU ZAF KOR TUR GBR USA',
  ],
  Q193272: [
    'ECOWAS',
    'https://www.ecowas.int/burkina-faso-mali-and-nigers-withdrawal-from-ecowas-is-now-a-reality/',
    'BEN CPV CIV GMB GHA GIN GNB LBR NGA SEN SLE TGO',
  ],
  Q4264: [
    'MERCOSUR',
    'https://www.mercosur.int/en/about-mercosur/countries',
    'ARG BOL BRA PRY URY VEN',
  ],
};

const qualifiers = `
  OPTIONAL { ?statement pqv:P580 [ wikibase:timeValue ?start; wikibase:timePrecision ?startPrecision ]. }
  OPTIONAL { ?statement pqv:P582 [ wikibase:timeValue ?end; wikibase:timePrecision ?endPrecision ]. }
`;
const queries = {
  blocs: `SELECT ?s ?iso ?item ?statement ?start ?startPrecision ?end ?endPrecision WHERE {
    VALUES ?item { ${Object.keys(blocs)
      .map((id) => 'wd:' + id)
      .join(' ')} }
    ?statement ps:P463 ?item; wikibase:rank ?rank.
    FILTER(?rank != wikibase:DeprecatedRank)
    ?s p:P463 ?statement; wdt:P298 ?iso.
    ${qualifiers}
  }`,
  diplomacy: `SELECT ?s ?iso ?other ?statement ?start ?startPrecision ?end ?endPrecision WHERE {
    ?s p:P530 ?statement; wdt:P298 ?iso.
    ?statement ps:P530/wdt:P298 ?other; wikibase:rank ?rank.
    FILTER(?rank != wikibase:DeprecatedRank && ?iso != ?other)
    ${qualifiers}
  }`,
};

function qualifier(binding, key) {
  const date = binding[key]?.value?.match(/^\+?(\d{4}-\d{2}-\d{2})/)?.[1];
  const precision = Number(binding[key + 'Precision']?.value);
  return date && precision >= 9
    ? date.slice(0, precision === 9 ? 4 : precision === 10 ? 7 : 10)
    : null;
}

function diplomaticDetail({ start, end }) {
  return start || end
    ? 'Diplomatic relation asserted by Wikidata with date qualifiers.'
    : 'Undated diplomatic relation asserted by Wikidata.';
}

export function wikidataRelations(
  kind,
  bindings,
  countryIds,
  now = new Date(),
) {
  const supported = new Set(countryIds);
  const aliases = { XKX: 'KOS' };
  const result = new Map();
  const put = (row) => {
    const previous = result.get(row.id);
    if (!previous || (!previous.start && row.start)) result.set(row.id, row);
  };

  for (const binding of bindings) {
    const from = aliases[binding.iso.value] ?? binding.iso.value;
    if (!supported.has(from)) continue;
    const start = qualifier(binding, 'start');
    const end = qualifier(binding, 'end');
    const source = binding.s.value
      .replace(/^http:/, 'https:')
      .replace('/entity/', '/wiki/');
    if (kind === 'blocs') {
      const qid = binding.item.value.split('/').at(-1);
      if (!blocs[qid]) continue;
      const [to, official, members] = blocs[qid];
      if (!end && members && !members.split(' ').includes(from)) continue;
      put(
        makeRelation({
          id: 'rel_bloc_' + qid + '_' + from + (end ? '_' + end : ''),
          type: 'bloc_membership',
          directed: true,
          from,
          to,
          start,
          end,
          detail:
            from === 'ARM' && to === 'CSTO'
              ? 'Treaty party. Armenia declared its participation frozen.'
              : from === 'VEN' && to === 'MERCOSUR'
                ? 'State Party. Venezuela is suspended.'
                : 'Bloc membership or documented participation.',
          sources: [source, official],
        }),
      );
    } else {
      const other = aliases[binding.other.value] ?? binding.other.value;
      if (!supported.has(other) || from === other) continue;
      const [a, b] = [from, other].sort();
      put(
        makeRelation({
          id: 'rel_diplomatic_' + a + '_' + b + (end ? '_' + end : ''),
          type: 'diplomatic_relation',
          from: a,
          to: b,
          start,
          end,
          detail: diplomaticDetail({ start, end }),
          sources: [source, Q530],
          evidence: 'wikidata-assertion',
          dateChecked: now.toISOString().slice(0, 10),
        }),
      );
    }
  }

  if (kind === 'blocs') {
    for (const [qid, [to, official, members]] of Object.entries(blocs)) {
      for (const from of members?.split(' ') ?? []) {
        const id = 'rel_bloc_' + qid + '_' + from;
        if (!supported.has(from) || result.has(id)) continue;
        put(
          makeRelation({
            id,
            type: 'bloc_membership',
            directed: true,
            from,
            to,
            detail:
              to === 'OPEC+'
                ? 'Participant in the OPEC and non-OPEC Declaration of Cooperation.'
                : from === 'VEN' && to === 'MERCOSUR'
                  ? 'State Party. Venezuela is suspended.'
                  : 'Bloc membership confirmed in the official participant list.',
            sources: [official, Q463],
            dateChecked: CHECKED,
            reviewed: false,
          }),
        );
      }
    }
  }
  return [...result.values()];
}

function weeklyDue({ data, lastCheckedAt, now }) {
  const checked = Date.parse(lastCheckedAt);
  return !data || !Number.isFinite(checked) || +now - checked >= 604_800_000;
}

function adapter(kind) {
  const name =
    kind === 'blocs' ? 'Wikidata blocs' : 'Wikidata diplomatic links';
  return {
    version: kind === 'diplomacy' ? 3 : 2,
    requestHost: new URL(SPARQL).hostname,
    shouldCheck(context) {
      return context.rederive || weeklyDue(context);
    },
    async fetchObservations({
      fetchImpl,
      registry,
      data,
      now,
      rederive,
      lastCheckedAt,
    }) {
      if (
        kind === 'diplomacy' &&
        rederive &&
        Array.isArray(data?.relations) &&
        !weeklyDue({ data, now, lastCheckedAt })
      ) {
        const rows = data.relations.map((row) => ({
          ...row,
          detail: diplomaticDetail(row),
        }));
        return { ...relationResult(rows, data, name), checkedRelease: false };
      }
      const signal = AbortSignal.timeout(50_000);
      const url = new URL(SPARQL);
      url.searchParams.set('query', queries[kind]);
      url.searchParams.set('format', 'json');
      const response = await fetchResponse(fetchImpl, url.href, signal);
      const payload = await readResponseJsonCapped(
        response,
        20_000_000,
        signal,
      );
      const bindings = payload.results?.bindings;
      if (!Array.isArray(bindings) || !bindings.length)
        throw new Error('No Wikidata bindings returned for ' + kind);
      const rows = wikidataRelations(
        kind,
        bindings,
        registry.countries.map(({ iso3 }) => iso3),
        now,
      );
      return relationResult(rows, data, name);
    },
  };
}

export const blocAdapter = adapter('blocs');
export const diplomacyAdapter = adapter('diplomacy');
