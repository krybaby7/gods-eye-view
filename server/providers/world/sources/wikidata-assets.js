import { readResponseJsonCapped } from '../../common/http.js';
import {
  assetCountryResolver,
  assetRow,
  createAssetAdapter,
  point,
} from './asset-common.js';

const source = 'wikidata-assets';
const endpoint = 'https://query.wikidata.org/sparql';
const portCandidates = [
  'Port of Rotterdam',
  'Port of Singapore',
  'Port of Antwerp-Bruges',
  'Port of Hamburg',
  'Port of Los Angeles',
  'Port of Long Beach',
  'Port of Hong Kong',
  'Port of Shanghai',
  'Port of Piraeus',
];
const selectors = [
  ['nuclear_plant', '?item wdt:P31 wd:Q134447.'],
  ['spaceport', '?item wdt:P31 wd:Q194188.'],
  [
    'port',
    'VALUES ?portName { ' +
      portCandidates.map((name) => JSON.stringify(name) + '@en').join(' ') +
      ' } ?item rdfs:label ?portName; wdt:P137 ?portOperator.',
  ],
];

function assetQuery(kind, selector) {
  return `
    SELECT ?item ?kind ?itemLabel ?iso ?point ?operator ?operatorLabel ?operatorReference
           ?owner ?ownerLabel ?ownerIso ?ownerReference ?closed WHERE {
      {
        SELECT ?item ?iso ?point WHERE {
          ${selector}
          ?item wdt:P17 ?host.
          ?host wdt:P298 ?iso.
          OPTIONAL { ?item wdt:P625 ?point. }
        }
      }
      BIND("${kind}" AS ?kind)
      OPTIONAL {
        ?item p:P137 ?operatorStatement.
        ?operatorStatement a wikibase:BestRank; ps:P137 ?operator.
        FILTER NOT EXISTS { ?operatorStatement pq:P582 ?operatorEnd. }
        OPTIONAL { ?operatorStatement prov:wasDerivedFrom/pr:P854 ?operatorReference. }
      }
      OPTIONAL {
        ?item p:P127 ?ownerStatement.
        ?ownerStatement a wikibase:BestRank; ps:P127 ?owner.
        FILTER NOT EXISTS { ?ownerStatement pq:P582 ?ownerEnd. }
        OPTIONAL { ?owner wdt:P298 ?ownerIso. }
        OPTIONAL { ?ownerStatement prov:wasDerivedFrom/pr:P854 ?ownerReference. }
      }
      OPTIONAL { ?item wdt:P576 ?closed. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
  `;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function coordinate(wkt) {
  const match = /^Point\(([-.\d]+) ([-.\d]+)\)$/.exec(wkt ?? '');
  return match ? point(match[1], match[2]) : null;
}

export function parseWikidataAssets(payload, { country, now }) {
  if (!Array.isArray(payload?.results?.bindings))
    throw new Error('Unexpected Wikidata asset response');
  const groups = new Map();
  for (const binding of payload.results.bindings) {
    const values = Object.fromEntries(
      Object.entries(binding).map(([key, item]) => [key, item.value]),
    );
    const id = /^https?:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d*)$/.exec(
      values.item ?? '',
    )?.[1];
    if (!id || !['nuclear_plant', 'spaceport', 'port'].includes(values.kind))
      continue;
    const key = values.kind + ':' + id;
    if (!groups.has(key)) groups.set(key, { id, kind: values.kind, items: [] });
    groups.get(key).items.push(values);
  }
  const rows = [];
  const portOperators = [];
  for (const { id, kind, items } of groups.values()) {
    const sourceUrl = 'https://www.wikidata.org/wiki/' + id;
    const name = unique(items.map((item) => item.itemLabel))[0] ?? id;
    const countries = unique(items.map((item) => country(item.iso)));
    if (countries.length !== 1) continue;
    const [locatedIn] = countries;
    const locations = unique(
      items
        .filter((item) => country(item.iso) === locatedIn)
        .map((item) => item.point),
    );
    const geometry = locations.length === 1 ? coordinate(locations[0]) : null;
    const operators = unique(items.map((item) => item.operatorLabel));
    const operator = operators.length ? operators.join(', ') : null;
    if (kind === 'port') {
      if (operators.length === 1 && geometry) {
        portOperators.push({
          name,
          iso3: locatedIn,
          coordinates: geometry.coordinates,
          operator,
          sourceUrl,
          referenceUrl:
            unique(items.map((item) => item.operatorReference))[0] ?? null,
        });
      }
      continue;
    }
    const owners = [];
    for (const ownerId of unique(items.map((item) => item.owner))) {
      const statements = items.filter((item) => item.owner === ownerId);
      const ownerCountries = unique(
        statements.map((item) => country(item.ownerIso)),
      );
      const ownerCountry =
        ownerCountries.length === 1 ? ownerCountries[0] : null;
      const ownershipSource =
        statements.find((item) =>
          /^https?:\/\//i.test(item.ownerReference ?? ''),
        )?.ownerReference ?? null;
      owners.push({
        actor: unique(statements.map((item) => item.ownerLabel))[0] ?? ownerId,
        country: ownerCountry,
        share: null,
        sourceUrl: ownershipSource,
        verified: Boolean(ownerCountry && ownershipSource),
      });
    }
    rows.push(
      assetRow({
        id: 'asset_wd-' + id,
        type: kind,
        name,
        locatedIn,
        geometry,
        source,
        sourceUrl,
        licence: 'CC0',
        now,
        owners,
        operator,
        operatorSourceUrl: operator ? sourceUrl : null,
        status: items.some((item) => Date.parse(item.closed) <= +now)
          ? 'closed'
          : 'unknown',
        statusDetail:
          'Wikidata facility record. A missing closure date does not establish operating status.',
      }),
    );
  }
  return { rows, portOperators };
}

export const wikidataAssets = createAssetAdapter(
  async ({ registry, now, request }) => {
    const country = await assetCountryResolver(registry);
    const bindings = [];
    for (const [kind, selector] of selectors) {
      const url =
        endpoint + '?query=' + encodeURIComponent(assetQuery(kind, selector));
      const payload = await request(url, 8_000_000, readResponseJsonCapped, {
        Accept: 'application/sparql-results+json',
      });
      if (!Array.isArray(payload?.results?.bindings))
        throw new Error('Unexpected Wikidata asset response');
      if (kind !== 'port' && !payload.results.bindings.length)
        throw new Error('Empty Wikidata ' + kind + ' results');
      for (const binding of payload.results.bindings) bindings.push(binding);
    }
    const data = parseWikidataAssets(
      { results: { bindings } },
      { country, now },
    );
    if (!data.rows.length)
      throw new Error(
        'Wikidata returned no located nuclear plants or launch sites',
      );
    return { data, count: data.rows.length, unit: 'facility' };
  },
  14,
);
