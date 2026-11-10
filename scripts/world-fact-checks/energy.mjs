import portTable from '../../public/world/curated/energy-ports.json' with { type: 'json' };
import { chokepointExposure } from '../../src/layers/world/energy.js';

const checkedOn = '2026-11-09';
const eiaChokepoints =
  'https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/';
const eiaHormuz = 'https://www.eia.gov/todayinenergy/detail.php?id=65504';
const eiaRussia =
  'https://www.eia.gov/international/content/analysis/countries_long/russia/';
const thaiStatistics =
  'https://eppo.d-gis.com/wp-content/uploads/2026/04/EnergyStatistics2025.pdf';
const lngReport = 'https://www.igu.org/igu-reports/2025-world-lng-report';
const beforeGapPct = {
  malacca: { oil: -18.9, lng: 3.2 },
  hormuz: { oil: 1.6, lng: -15.3 },
  suez: { oil: 62.6, lng: 328.5 },
  'bab-el-mandeb': { oil: 90.5, lng: null },
  'danish-straits': { oil: -87.9, lng: -55.4 },
  dardanelles: { oil: -6.3, lng: 362.2 },
  panama: { oil: 21.8 },
  'cape-of-good-hope': { oil: -64.6, lng: -79.4 },
};
// Archived observations from reviewed PR #19 head 92c3087a (fix round 3).
const round3Modelled = {
  malacca: { oil: 16.834, lng: 7.391 },
  hormuz: { oil: 15.543, lng: 9.562 },
  suez: { oil: 6.826, lng: 3.294 },
  'bab-el-mandeb': { oil: 6.549, lng: 2.184 },
  'danish-straits': { oil: 1.509, lng: 2.1 },
  dardanelles: { oil: 2.638, lng: 0.145 },
  panama: { oil: 3.438 },
  'cape-of-good-hope': { oil: 3.259, lng: 1.505 },
};
const naturalEarth =
  'https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/';
const cepii =
  'https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37';
const borderPairs = [
  'MYS/THA',
  'ARE/OMN',
  'ARE/SAU',
  'DEU/DNK',
  'CMR/GNQ',
  'GAB/GNQ',
];
const measuredPorts = portTable.rows.filter(
  ({ direction, share }) => direction === 'export' && share !== null,
);
const makeCheck = (id, expected, found, source, pass, date = checkedOn) => ({
  id: 'energy-' + id,
  expected,
  found: found ?? 'Unavailable',
  source,
  checkedOn: date,
  pass: Boolean(pass),
});
const checkedRound3 = '2026-11-10';
const checkedRound4 = '2026-11-10';

const cargoRegression = [
  {
    provider: 'IDN',
    dependent: 'CHN',
    code: '270119',
    declaredMt: '49.6',
    publishedMt: 30.8793,
  },
  {
    provider: 'MEX',
    dependent: 'USA',
    code: '271000',
    declaredMt: '10.7',
    publishedMt: 9.78427,
  },
  {
    provider: 'ARE',
    dependent: 'THA',
    code: '270900',
    declaredMt: '151.7',
    publishedMt: 86.9293,
    reestimate: true,
  },
];
const mainlandPorts = {
  FRA: [
    'Granville',
    'https://www.manche.fr/wp-content/uploads/2023/11/PRDT-GRANVILLE-2024-2029.pdf',
  ],
  PRT: ['Lisboa', 'https://www.portodelisboa.pt/pt/terminais'],
  AUS: [
    'Broome',
    'https://www.kimberleyports.wa.gov.au/awcontent/web/documents/rec221362-kpa-port-and-terminal-handbook-v8-0.pdf',
  ],
};

export default async function checkEnergy({ board, getDetail }) {
  const model = board?.features?.['energy-dependencies'];
  const [thailand, taiwan, india, global, denmark, ...ports] =
    await Promise.all(
      ['THA', 'TWN', 'IND', null, 'DNK', ...Object.keys(mainlandPorts)].map(
        (country) => getDetail(country, 'energy'),
      ),
    );
  const hormuz = chokepointExposure(board ?? {}, 'chokepoint6');
  const top = hormuz
    .slice(0, 4)
    .map(({ dependent }) => dependent)
    .sort();
  const expectedTop = ['CHN', 'IND', 'JPN', 'KOR'];
  const totalByGate = new Map();
  for (const { gate, volume } of Object.values(
    model?.energyExposure ?? {},
  ).flat()) {
    if (volume?.unit !== 'PJ/year' || !Number.isFinite(volume.value)) continue;
    totalByGate.set(gate, (totalByGate.get(gate) ?? 0) + volume.value);
  }
  const rankedVolumes = [...totalByGate].flatMap(([gate, gateTotal]) =>
    chokepointExposure(board, gate)
      .slice(0, 10)
      .map((row, index) => ({
        gate,
        rank: index + 1,
        country: row.dependent,
        mainProduct: row.item,
        volume: row.volume,
        gateTotal: Number(gateTotal.toFixed(3)),
        transitShare:
          gateTotal > 0 && row.volume?.unit === 'PJ/year'
            ? row.volume.value / gateTotal
            : null,
      })),
  );
  const trivial = rankedVolumes.filter(
    ({ transitShare }) => !Number.isFinite(transitShare) || transitShare < 0.01,
  );
  const thaiMt = thailand?.importTonnes?.['crude oil'] / 1e6;
  const thaiExpectedMt = (971_025 * 366) / 7.33 / 1e6;
  const taiwanProducts = ['crude oil', 'lng', 'coal'].filter(
    (item) => taiwan?.importTonnes?.[item] > 0,
  );
  const russianCrude = india?.rows?.find(
    ({ provider, dependent, item }) =>
      provider === 'RUS' && dependent === 'IND' && item === 'crude oil',
  );
  const splits = russianCrude?.portSplits ?? [];
  const baltic = splits.filter(({ ports }) =>
    ['Primorsk', 'Ust-Luga'].includes(ports[0]),
  );
  const blackSea = splits.filter(({ ports }) =>
    ['Novorossiysk', 'CPC Marine Terminal'].includes(ports[0]),
  );
  const dardanellesShare = blackSea.reduce((sum, { share }) => sum + share, 0);
  const audit = global?.routeAudit;
  const kozminoShare = splits.reduce(
    (sum, { ports, share }) => (ports[0] === 'Kozmino' ? sum + share : sum),
    0,
  );
  const portAllocations = global?.allocationAudit?.ports;
  const portRows = measuredPorts.map(
    ({ iso, product, port, share, sourceUrl }) => {
      const row = portAllocations?.find(
        ({ provider, item, port: name }) =>
          provider === iso && item === product && name === port,
      );
      const targetTonnes = share * row?.basisTonnes;
      const allocatedTonnes = row?.allocatedTonnes;
      const gapPct =
        targetTonnes > 0 ? 100 * (allocatedTonnes / targetTonnes - 1) : null;
      return {
        iso,
        product,
        port,
        expectedShare: share,
        targetTonnes,
        allocatedTonnes,
        gapPct,
        sourceUrl,
      };
    },
  );
  const sakhalinMt =
    portAllocations?.find(({ port }) => port === 'Prigorodnoye')
      ?.allocatedTonnes / 1e6;
  const borderAudit = global?.allocationAudit?.borders;
  const uaeSaudi = global?.allocationAudit?.uaeSaudiRefinedProducts;
  const danishCrude = denmark?.exposure?.find(
    ({ gate, item }) => gate === 'chokepoint10' && item === 'crude oil',
  );
  const denmarkShare = danishCrude?.shares?.all;
  const result = [
    makeCheck(
      'hormuz-dependents',
      expectedTop,
      top,
      eiaHormuz,
      JSON.stringify(top) === JSON.stringify(expectedTop),
    ),
    makeCheck(
      'trivial-exporter-imports',
      'Each displayed top-ten dependent carries at least 1% of the total modelled transit at that chokepoint, measured in PJ/year',
      { checked: rankedVolumes.length, trivial, rankedVolumes },
      'World Board fix-round-3 brief, model consistency check',
      rankedVolumes.length > 0 && trivial.length === 0,
      checkedRound3,
    ),
    makeCheck(
      'arctic-and-kiel',
      '0 Arctic cross-basin routes and 0 Kiel Canal routes',
      audit,
      eiaChokepoints,
      audit?.assessed > 0 && audit.arcticShortcuts === 0 && audit.kiel === 0,
    ),
    makeCheck(
      'thailand-crude',
      `Within 25% of ${thaiExpectedMt.toFixed(2)} Mt (DOEB 971,025 b/d, 2024)`,
      Number.isFinite(thaiMt) ? `${thaiMt.toFixed(2)} Mt` : null,
      thaiStatistics,
      Math.abs(thaiMt / thaiExpectedMt - 1) <= 0.25,
    ),
    makeCheck(
      'taiwan-products',
      ['crude oil', 'lng', 'coal'],
      taiwanProducts,
      [
        lngReport,
        'https://www.cpc.com.tw/en/cp.aspx?n=2610',
        'https://www.gem.wiki/Coal_terminals',
      ],
      taiwanProducts.length === 3,
    ),
    makeCheck(
      'russian-baltic-routes',
      'Baltic routes to India cross the Danish Straits and avoid the Dardanelles',
      baltic,
      eiaRussia,
      baltic.length > 0 &&
        baltic.every(
          ({ gates }) =>
            gates.includes('chokepoint10') &&
            !gates.includes('eia-dardanelles'),
        ),
    ),
    makeCheck(
      'national-port-shares',
      'Every sourced export terminal within 2% of the national share target (zero-share terminals receive zero tonnes)',
      portRows,
      [...new Set(measuredPorts.map(({ sourceUrl }) => sourceUrl))],
      portRows.every(({ allocatedTonnes, expectedShare, gapPct }) =>
        expectedShare === 0
          ? allocatedTonnes === 0
          : Number.isFinite(gapPct) && Math.abs(gapPct) <= 2,
      ),
      checkedRound4,
    ),
    makeCheck(
      'india-kozmino-crude',
      'Under 20% of Russia-to-India crude allocated to Kozmino',
      splits.length ? { share: kozminoShare } : null,
      [eiaRussia, 'World Board fix-round-4 brief'],
      splits.length > 0 && kozminoShare < 0.2,
      checkedRound4,
    ),
    makeCheck(
      'sakhalin-lng',
      'Within 25% of EIA’s 9.7 Mt (473 Bcf, 2024)',
      Number.isFinite(sakhalinMt) ? { mt: sakhalinMt } : null,
      eiaRussia,
      Math.abs(sakhalinMt / 9.7 - 1) <= 0.25,
      checkedRound4,
    ),
    makeCheck(
      'land-borders',
      Object.fromEntries(borderPairs.map((pair) => [pair, true])),
      borderAudit,
      naturalEarth,
      borderPairs.every((pair) => borderAudit?.[pair] === true),
      checkedRound4,
    ),
    makeCheck(
      'uae-saudi-refined-products',
      'BACI refined products travel by land between the UAE and Saudi Arabia',
      uaeSaudi,
      [naturalEarth, cepii],
      uaeSaudi?.tonnes > 0 && uaeSaudi.route?.mode === 'land',
      checkedRound4,
    ),
    makeCheck(
      'denmark-danish-straits-crude',
      'Within 1 percentage point of the reviewed round 2 share (near zero)',
      danishCrude,
      [eiaChokepoints, 'World Board review 3, Energy (PR #19)'],
      denmark?.importTonnes?.['crude oil'] > 0 && (denmarkShare ?? 0) <= 0.01,
      checkedRound4,
    ),
    makeCheck(
      'india-russian-crude-routes',
      'Only the Russian Black Sea port shares on this dyad cross the Dardanelles',
      {
        dardanellesShare: russianCrude?.gateShares?.['eia-dardanelles'],
        blackSea,
      },
      eiaRussia,
      blackSea.length > 0 &&
        Math.abs(
          russianCrude.gateShares?.['eia-dardanelles'] - dardanellesShare,
        ) < 0.00001 &&
        blackSea.every(({ gates }) => gates.includes('eia-dardanelles')),
    ),
  ];
  for (const {
    provider,
    dependent,
    code,
    declaredMt,
    publishedMt,
    reestimate,
  } of cargoRegression) {
    const cargo = global?.quantityAudit?.cargoes?.find(
      (row) =>
        row.provider === provider &&
        row.dependent === dependent &&
        row.code === code,
    );
    const modelMt = cargo?.tonnes / 1e6;
    result.push(
      makeCheck(
        `cargo-${provider.toLowerCase()}-${dependent.toLowerCase()}-${code}`,
        reestimate
          ? `Screen ${declaredMt} Mt in BACI to about 25 Mt using the median price`
          : `Retain the ${declaredMt} Mt BACI quantity`,
        {
          declaredMt: cargo?.declaredTonnes / 1e6,
          modelMt,
          quantityReestimated: cargo?.quantityReestimated,
          context: `The import reporter published ${publishedMt} Mt via UN Comtrade. The BACI regression expectation is from the independent round 3 review.`,
        },
        `https://wits.worldbank.org/trade/comtrade/en/country/${dependent}/year/2024/tradeflow/Imports/partner/ALL/product/${code}`,
        (cargo?.declaredTonnes / 1e6).toFixed(1) === declaredMt &&
          (reestimate
            ? cargo.quantityReestimated && modelMt > 24 && modelMt < 27
            : !cargo.quantityReestimated &&
              cargo.tonnes === cargo.declaredTonnes),
        checkedRound3,
      ),
    );
  }
  for (const [index, [country, [expectedPort, source]]] of Object.entries(
    mainlandPorts,
  ).entries()) {
    const detail = ports[index];
    const importPorts = Object.fromEntries(
      [
        ...Map.groupBy(
          (detail?.rows ?? []).filter(({ dependent }) => dependent === country),
          ({ item }) => item,
        ),
      ].map(([item, rows]) => [
        item,
        [
          ...new Set(
            rows.map(({ id }) => detail.routePorts?.[id]?.[1]).filter(Boolean),
          ),
        ].sort(),
      ]),
    );
    result.push(
      makeCheck(
        `mainland-import-port-${country.toLowerCase()}`,
        `${expectedPort}, a verified mainland location, as the representative crude fallback`,
        importPorts,
        source,
        importPorts['crude oil']?.length === 1 &&
          importPorts['crude oil'][0] === expectedPort,
        checkedRound3,
      ),
    );
  }
  for (const row of global?.calibration ?? []) {
    const before = beforeGapPct[row.routeId]?.[row.commodity];
    const {
      routeId,
      commodity,
      modelled,
      published,
      unit,
      gapPct,
      note,
      dataNote,
    } = row;
    const beforeModelled = round3Modelled[routeId]?.[commodity];
    const found = {
      originalGapPct: before,
      beforeModelled,
      beforeGapPct:
        published > 0
          ? Number((100 * (beforeModelled / published - 1)).toFixed(1))
          : null,
      afterGapPct: gapPct,
      modelled,
      published,
      unit,
      ...(note && { note }),
      ...(dataNote && { dataNote: dataNote.text }),
    };
    let expected = 'Published and modelled 2024 values present';
    let pass =
      Number.isFinite(modelled) &&
      Number.isFinite(published) &&
      Number.isFinite(beforeModelled) &&
      before !== undefined;
    if (routeId === 'malacca' && commodity === 'lng') {
      expected = 'Absolute calibration gap at most 10%';
      pass &&= Math.abs(gapPct) <= 10;
    } else if (routeId === 'danish-straits' && commodity === 'oil') {
      expected = 'Absolute calibration gap no worse than round 2 (40.9%)';
      pass &&= Math.abs(gapPct) <= 40.9;
    } else if (routeId === 'hormuz' || routeId === 'malacca') {
      expected = 'Absolute calibration gap at most 25%';
      pass &&= Math.abs(gapPct) <= 25;
    } else if (routeId === 'danish-straits' || routeId === 'dardanelles') {
      expected = 'Absolute calibration gap smaller than the previous model';
      pass &&= Math.abs(gapPct) < Math.abs(before);
    } else if (
      ['suez', 'bab-el-mandeb', 'cape-of-good-hope'].includes(routeId)
    ) {
      expected = 'shortest route, before the Red Sea diversions';
      pass &&= note === expected;
    }
    result.push(
      makeCheck(
        `calibration-${routeId}-${commodity}`,
        expected,
        found,
        dataNote ? [eiaChokepoints, dataNote.sourceUrl] : eiaChokepoints,
        pass,
        checkedRound4,
      ),
    );
  }
  result.push(
    makeCheck(
      'calibration-coverage',
      15,
      global?.calibration?.length,
      eiaChokepoints,
      global?.calibration?.length === 15,
    ),
  );
  return result;
}
