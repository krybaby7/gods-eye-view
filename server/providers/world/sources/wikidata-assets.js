import {
  assetCountryResolver,
  assetRow,
  createAssetAdapter,
  point,
} from './asset-common.js';
import { createWdqsClient } from './wdqs.js';

const source = 'wikidata-assets';
const BATCH_SIZE = 40;
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

function assetQuery(kind, selector, codes) {
  const hosts = codes
    ? 'VALUES ?iso { ' + codes.map((code) => '"' + code + '"').join(' ') + ' }'
    : '';
  // Start at the bounded facility class or port labels before joining country
  // and optional statements. Blazegraph's default plan timed out on this join.
  return `
    SELECT ?item ?kind ?itemLabel ?iso ?point ?operator ?operatorLabel ?operatorReference
           ?owner ?ownerLabel ?ownerIso ?ownerReference ?closed WHERE {
      hint:Query hint:optimizer "None" .
      {
        SELECT ?item ?iso ?point WHERE {
          ${selector}
          ?item wdt:P17 ?host.
          ?host wdt:P298 ?iso.
          ${hosts}
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
      Object.entries(binding ?? {}).map(([key, item]) => [key, item?.value]),
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
  async ({ registry, now, fetchImpl, data: previous }) => {
    const country = await assetCountryResolver(registry);
    const codes = [
      ...new Set(
        registry.countries
          .filter(
            ({ kind, dataIso3, iso3 }) =>
              kind !== 'disputed' && !dataIso3 && /^[A-Z]{3}$/.test(iso3),
          )
          .map(({ iso3 }) => iso3),
      ),
    ].sort();
    const chunks = [];
    for (let offset = 0; offset < codes.length; offset += BATCH_SIZE)
      chunks.push(codes.slice(offset, offset + BATCH_SIZE));
    const batches = selectors.flatMap(([kind, selector]) =>
      (kind === 'port' ? [null] : chunks).map((hosts) => ({
        kind,
        selector,
        hosts,
      })),
    );
    const query = createWdqsClient(fetchImpl, now);
    const bindings = [];
    const completed = new Set();
    const errors = [];
    let succeeded = 0;
    let retryAt;
    for (const { kind, selector, hosts } of batches) {
      try {
        const rows = await query(assetQuery(kind, selector, hosts));
        for (const row of rows) {
          if (
            row?.kind?.value === kind &&
            (!hosts || hosts.includes(row.iso?.value))
          )
            bindings.push(row);
        }
        for (const host of hosts ?? ['operators'])
          completed.add(kind + ':' + host);
        succeeded += 1;
      } catch (error) {
        errors.push(error.cause?.code ?? error.message);
        retryAt = error.retryAt;
        if (retryAt) break;
      }
    }
    const data = parseWikidataAssets(
      { results: { bindings } },
      { country, now },
    );
    const detail = `${succeeded} of ${batches.length} Wikidata asset batches completed.`;
    const error = errors.length
      ? detail + ' ' + [...new Set(errors)].join('; ')
      : undefined;
    if (!data.rows.length && !data.portOperators.length) {
      return {
        ...(retryAt && { data: { ...previous, retryAt } }),
        error:
          error ?? 'Wikidata returned no located facilities or port operators',
        detail,
      };
    }
    if (error) {
      const newIds = new Set(data.rows.map(({ id }) => id));
      data.rows.push(
        ...(previous?.rows ?? []).filter(
          ({ id, type, locatedIn }) =>
            !newIds.has(id) && !completed.has(type + ':' + locatedIn),
        ),
      );
      if (!completed.has('port:operators'))
        data.portOperators = previous?.portOperators ?? [];
    }
    return {
      data: { ...data, retryAt },
      count: data.rows.length,
      unit: 'facility',
      detail,
      error,
    };
  },
  14,
  { requestHost: 'query.wikidata.org' },
);
