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
const expectedDraftFloor = 10;
const makeCheck = (id, expected, found, source, pass) => ({
  id: 'energy-' + id,
  expected,
  found: found ?? 'Unavailable',
  source,
  checkedOn,
  pass: Boolean(pass),
});

export default async function checkEnergy({ board, getDetail }) {
  const model = board?.features?.['energy-dependencies'];
  const [thailand, taiwan, india, global] = await Promise.all([
    getDetail('THA', 'energy'),
    getDetail('TWN', 'energy'),
    getDetail('IND', 'energy'),
    getDetail(null, 'energy'),
  ]);
  const hormuz = chokepointExposure(board ?? {}, 'chokepoint6');
  const top = hormuz
    .slice(0, 4)
    .map(({ dependent }) => dependent)
    .sort();
  const expectedTop = ['CHN', 'IND', 'JPN', 'KOR'];
  const gates = new Set(
    Object.values(model?.energyExposure ?? {})
      .flat()
      .map(({ gate }) => gate),
  );
  // This is a model consistency check. Checking every displayed dependent
  // also covers exporters outside a hand-picked list.
  const rankedVolumes = [...gates].flatMap((gate) =>
    chokepointExposure(board, gate)
      .slice(0, 10)
      .map((row, index) => ({
        gate,
        rank: index + 1,
        country: row.dependent,
        mainProduct: row.item,
        volume: row.volume,
      })),
  );
  const trivial = rankedVolumes.filter(
    ({ volume }) =>
      volume?.unit !== 'PJ/year' ||
      !Number.isFinite(volume?.value) ||
      volume.value < expectedDraftFloor,
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
      `Every displayed top-ten gate dependent has at least ${expectedDraftFloor} PJ/year of modelled transit under the existing draft floor`,
      {
        draftFloor: model?.minorImporterFloor,
        checked: rankedVolumes.length,
        trivial,
        rankedVolumes,
      },
      'World Board fix-round-2 brief §3, draft model consistency check',
      rankedVolumes.length > 0 &&
        model?.minorImporterFloor === expectedDraftFloor &&
        trivial.length === 0,
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
  for (const row of global?.calibration ?? []) {
    const before = beforeGapPct[row.routeId]?.[row.commodity];
    const { routeId, commodity, modelled, published, unit, gapPct, note } = row;
    const found = {
      beforeGapPct: before,
      afterGapPct: gapPct,
      modelled,
      published,
      unit,
      ...(note && { note }),
    };
    let expected = 'Published and modelled 2024 values present';
    let pass =
      Number.isFinite(modelled) &&
      Number.isFinite(published) &&
      before !== undefined;
    if (routeId === 'hormuz' || routeId === 'malacca') {
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
        eiaChokepoints,
        pass,
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
