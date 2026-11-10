import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function cacheFile(url) {
  return resolve(
    process.env.GEV_WORLD_FACT_ASSET_CACHE ?? '.gev-cache/world/downloads',
    createHash('sha256').update(url).digest('hex'),
  );
}

async function retainedAirportCounts(reference) {
  const csv = await readFile(cacheFile(reference.source));
  if (createHash('sha256').update(csv).digest('hex') !== reference.sha256)
    throw Object.assign(
      new Error('Cached CSV differs from the independently counted snapshot.'),
      { code: 'AIRPORT_REFERENCE_MISMATCH' },
    );
  return reference.counts;
}

async function countEvidence({ id, source, load, found, checkedOn, basis }) {
  try {
    const expected = await load();
    const codes = [
      ...new Set([...Object.keys(expected), ...Object.keys(found)]),
    ].sort();
    const differences = codes.flatMap((code) =>
      (expected[code] ?? 0) === (found[code] ?? 0)
        ? []
        : [{ code, publisher: expected[code] ?? 0, board: found[code] ?? 0 }],
    );
    const total = (counts) =>
      Object.values(counts).reduce((sum, count) => sum + count, 0);
    return {
      id,
      expected: {
        rows: total(expected),
        countryCodesWithRecords: Object.values(expected).filter(Boolean).length,
        countryCodesCompared: codes.length,
        basis,
      },
      found: {
        rows: total(found),
        publisherCountryCodes: Object.values(found).filter(Boolean).length,
        differences,
      },
      source,
      checkedOn,
      pass: differences.length === 0,
    };
  } catch (error) {
    const reason =
      error.code === 'ENOENT'
        ? 'Local publisher evidence file is unavailable. Set GEV_WORLD_FACT_ASSET_CACHE to the warm downloads directory.'
        : error.code === 'AIRPORT_REFERENCE_MISMATCH'
          ? error.message
          : null;
    return {
      id,
      expected: basis,
      found: error.message,
      source,
      checkedOn,
      pass: reason ? null : false,
      ...(reason && { reason }),
    };
  }
}

const named = [
  [
    'FIN',
    'olkiluoto',
    /olkiluoto/i,
    'wri-power',
    'https://www.tvo.fi/en/index/production/plantunits/ol1andol2.html',
  ],
  [
    'FIN',
    'loviisa',
    /loviisa/i,
    'wri-power',
    'https://www.fortum.com/energy-production/nuclear-power/plants/loviisa/history',
  ],
  [
    'FRA',
    'charles-de-gaulle',
    /charles de gaulle/i,
    'ourairports',
    'https://www.parisaeroport.fr/docs/default-source/passager-fichiers/preparer/pww/pww29.pdf',
  ],
  [
    'BRA',
    'guarulhos',
    /guarulhos/i,
    'ourairports',
    'https://www.gru.com.br/en/institutional/sobre-gru-airport/history',
  ],
  [
    'AUS',
    'sydney',
    /sydney kingsford smith/i,
    'ourairports',
    'https://www.airservicesaustralia.com/aip/current/ersa/FAC_YSSY_12JUN2025.pdf',
  ],
  [
    'KAZ',
    'astana',
    /astana|nursultan nazarbayev/i,
    'ourairports',
    'https://www.nn-airport.kz/?lang=en',
  ],
];

const ownershipSources = {
  CHN: 'https://www.olp.gr/en/investor-relations/company-profile',
  USA: 'https://www.sec.gov/Archives/edgar/data/50863/000005086326000011/intc-20251227.htm',
};

export default async function assets({ board, getDetail }) {
  const [wriSummary, airports] = await Promise.all(
    ['wri-country-counts', 'ourairports-country-counts'].map(async (name) =>
      JSON.parse(
        await readFile(
          new URL('./fixtures/' + name + '.json', import.meta.url),
          'utf8',
        ),
      ),
    ),
  );
  const airportCounts =
    board?.features?.ourairports?.countsBySourceCountry ?? {};
  const listing = airports.publisherListings;
  const sample = Object.fromEntries(
    Object.keys(listing.counts).map((code) => [code, airportCounts[code] ?? 0]),
  );
  const rows = await Promise.all([
    countEvidence({
      id: 'assets-counts-wri-power',
      source: wriSummary.source,
      load: () => wriSummary.counts,
      found: board?.features?.['wri-power']?.countsBySourceCountry ?? {},
      checkedOn: wriSummary.checkedOn,
      basis: 'Separately published WRI country summary for v1.3.0',
    }),
    countEvidence({
      id: 'assets-airport-cache-diagnostic',
      source: airports.retainedCsv.source,
      load: () => retainedAirportCounts(airports.retainedCsv),
      found: airportCounts,
      checkedOn: airports.checkedOn,
      basis:
        'Worldwide ingest diagnostic from an independent Python CSV recount of the pinned publisher input snapshot',
    }),
    countEvidence({
      id: 'assets-counts-ourairports',
      source: listing.source,
      load: () => listing.counts,
      found: sample,
      checkedOn: airports.checkedOn,
      basis:
        'Large-airport markers in complete publisher listings filtered to airline destinations for 11 country or territory codes',
    }),
  ]);
  const wikidataAssets = board?.features?.['wikidata-assets'];
  const wikidata = wikidataAssets?.rows;
  const ports = wikidataAssets?.portAttribution;
  const query = board?.turn?.sources?.find(
    ({ id }) => id === 'wikidata-assets',
  );
  const verified = (role) =>
    (wikidata ?? []).filter(({ owners }) =>
      owners?.some(
        (owner) => owner.verified && owner.country && owner.role === role,
      ),
    ).length;
  const withVerifiedOwner = verified('owner');
  const withVerifiedOperator = verified('operator');
  rows.push({
    id: 'assets-wikidata-owner-query',
    expected:
      'A fresh Wikidata facility query with verified P127 owner or P137 operator country attributions.',
    found: {
      facilities: wikidata?.length ?? 0,
      withVerifiedOwner,
      withVerifiedOperator,
      withEither: (wikidata ?? []).filter(({ owners }) =>
        owners?.some(({ verified, country }) => verified && country),
      ).length,
      portMatches: ports?.matched,
      portsWithVerifiedAttribution: ports?.verified,
      status: query?.status,
      batches: query?.detail,
    },
    source: 'https://query.wikidata.org/',
    pass:
      Array.isArray(wikidata) && query?.checked
        ? withVerifiedOwner + withVerifiedOperator + (ports?.verified ?? 0) > 0
        : null,
    ...(!(Array.isArray(wikidata) && query?.checked) && {
      reason: 'No Wikidata asset check was recorded for this turn.',
    }),
  });
  if (board?.features?.['curated-assets']) {
    for (const [country, label, pattern, sourceId, source] of named) {
      const detail = await getDetail(country, 'assets');
      const asset = detail?.rows?.find(
        (row) =>
          row.source === sourceId &&
          row.locatedIn === country &&
          pattern.test(row.name),
      );
      rows.push({
        id: 'assets-named-' + label,
        expected: country + ' ' + label,
        found: asset ? { name: asset.name, id: asset.id } : 'Missing',
        source,
        pass: Boolean(asset),
      });
    }
    for (const country of ['CHN', 'USA']) {
      const detail = await getDetail(country, 'assets');
      const foreign = (detail?.rows ?? []).filter(
        (row) => row.locatedIn !== country,
      );
      const ownership = foreign.flatMap((row) => {
        const owner = row.owners?.find(
          (owner) =>
            owner.country === country && owner.verified && owner.sourceUrl,
        );
        return owner
          ? [
              {
                id: row.id,
                name: row.name,
                host: row.locatedIn,
                role: owner.role,
                status: row.status ?? 'unknown',
                actor: owner.actor,
                evidence: owner.sourceUrl,
              },
            ]
          : [];
      });
      const presence = foreign.filter(
        (row) =>
          row.sendingCountry === country &&
          row.status === 'operating' &&
          row.sourceUrl,
      );
      const required =
        country === 'CHN'
          ? ['asset_piraeus-port-authority', 'asset_hambantota-port-concession']
          : ['asset_intel-fab-34'];
      const missing = required.filter(
        (id) => !ownership.some((row) => row.id === id),
      );
      if (
        country === 'CHN' &&
        !presence.some(
          (row) => row.id === 'asset_chn-dji-pla-support-base-in-djibouti',
        )
      )
        missing.push('asset_chn-dji-pla-support-base-in-djibouti');
      rows.push({
        id: 'assets-ownership-' + country.toLowerCase(),
        expected:
          'At least five sourced foreign asset relationships, with named examples and military presence recorded separately.',
        found: {
          sourcedRelationships: ownership.length,
          documentedPresence: presence.length,
          examples: ownership.slice(0, 5),
          djiboutiPresence:
            country === 'CHN'
              ? presence.find(
                  (row) =>
                    row.id === 'asset_chn-dji-pla-support-base-in-djibouti',
                )?.sourceUrl
              : undefined,
          missing,
        },
        source: ownershipSources[country],
        pass: ownership.length >= 5 && missing.length === 0,
      });
    }
  } else {
    rows.push({
      id: 'assets-detail-available',
      expected: 'Curated assets and country detail',
      found: 'Curated assets missing from the board',
      source: 'public/world/curated',
      pass: false,
    });
  }
  const checkedOn = new Date().toISOString().slice(0, 10);
  return rows.map((row) => ({ ...row, checkedOn: row.checkedOn ?? checkedOn }));
}
