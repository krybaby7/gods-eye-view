import { readCuratedAssets } from '../server/providers/world/assets.js';
import { ownerColor } from '../src/layers/world/assets.js';

const fabId = 'asset_fixture-cn-fab';
const unknownSiteId = 'asset_fixture-cn-missing-site';
const clusterId = 'cluster:global:DEU:port';
const syntheticSource = 'https://example.test/asset-evidence';
const point = (lon, lat) => ({ type: 'Point', coordinates: [lon, lat] });

function fixtureAsset(id, type, name, locatedIn, geometry, extra = {}) {
  return {
    id,
    type,
    name,
    locatedIn,
    geometry,
    jurisdiction: locatedIn,
    status: 'operating',
    source: 'wikidata-assets',
    sourceUrl: syntheticSource,
    licence: 'CC0',
    lastVerified: '2026-11-09',
    owners: [],
    operator: null,
    canInterrupt: [],
    statusDetail: 'Synthetic fixture for globe verification.',
    ...extra,
  };
}

const ports = [
  fixtureAsset(
    'asset_fixture-north-port',
    'port',
    'Fixture North Port',
    'DEU',
    point(10.7, 54),
  ),
  fixtureAsset(
    'asset_fixture-west-port',
    'port',
    'Fixture West Port',
    'DEU',
    point(8.45, 53.6),
  ),
];
const fab = fixtureAsset(
  fabId,
  'fab',
  'Fixture German Fab',
  'DEU',
  point(11.6, 49.4),
  {
    operator: 'Fixture operator',
    owners: [
      {
        actor: 'Verified Industrial Holdings',
        country: 'CHN',
        share: 0.7,
        verified: true,
        sourceUrl: syntheticSource,
      },
    ],
  },
);
const unknownSite = fixtureAsset(
  unknownSiteId,
  'fab',
  'Fixture Fab with Unknown Site',
  'JPN',
  null,
  { owners: fab.owners },
);
const curated = await readCuratedAssets();
function staticFixture(data) {
  return {
    shouldCheck: ({ lastCheckedAt }) => !lastCheckedAt,
    async fetchObservations() {
      return { data };
    },
  };
}

export const fixtureAdapters = {
  'wri-power': staticFixture({
    rows: [
      fixtureAsset(
        'asset_fixture-french-plant',
        'power_plant',
        'Fixture Historical Power Plant',
        'FRA',
        point(6.4, 48),
        {
          source: 'wri-power',
          licence: 'CC BY 4.0',
          historical: true,
          sourceVersion: 'v1.3.0 (2021 historical inventory)',
          status: 'unknown',
        },
      ),
    ],
  }),
  'wikidata-assets': staticFixture({
    rows: [fab, unknownSite],
    portOperators: [],
  }),
  'nga-ports': staticFixture({
    rows: ports.map((port) => ({ ...port, source: 'nga-ports' })),
  }),
  ourairports: staticFixture({ rows: [] }),
  'curated-assets': staticFixture({
    ...curated,
    rows: curated.rows
      .filter(({ name }) =>
        ['Fab 24', 'PLA Support Base in Djibouti', 'Camp Lemonnier'].includes(
          name,
        ),
      )
      .map((asset) =>
        asset.name === 'Fab 24' ? { ...asset, geometry: null } : asset,
      ),
  }),
};

export default async function phase4({
  assert,
  page,
  step,
  shot,
  text,
  camera,
  pickCountry,
  lens,
  tab,
  wait,
}) {
  const assetId = (id) => 'world-card:asset:' + id;

  async function pickAsset(id) {
    const handle = await page.waitForFunction(
      (pickId) => {
        const { C } = window.worldQa;
        const { scene } = window.__godsEyeView.viewer;
        for (let i = 0; i < scene.primitives.length; i++) {
          const group = scene.primitives.get(i);
          if (!(group instanceof C.BillboardCollection) || !group.show)
            continue;
          for (let j = 0; j < group.length; j++) {
            const marker = group.get(j);
            if (marker.id !== pickId) continue;
            const screen = C.SceneTransforms.worldToWindowCoordinates(
              scene,
              marker.position,
            );
            if (!screen || scene.pick(screen, 1, 1)?.id !== pickId) {
              scene.requestRender();
              continue;
            }
            const rect = scene.canvas.getBoundingClientRect();
            return { x: screen.x + rect.left, y: screen.y + rect.top };
          }
        }
        return false;
      },
      wait,
      assetId(id),
    );
    const { x, y } = await handle.jsonValue();
    await handle.dispose();
    await page.mouse.click(x, y);
    await page.waitForSelector(
      '#world-card-content [data-world-asset="' + id + '"]',
    );
  }

  async function clickAssetList(name) {
    await page.waitForFunction(
      (name) =>
        [...document.querySelectorAll('.world-asset-select')].some(
          (button) => button.textContent === name,
        ),
      wait,
      name,
    );
    await page.evaluate(
      (name) =>
        [...document.querySelectorAll('.world-asset-select')]
          .find((button) => button.textContent === name)
          .click(),
      name,
    );
  }

  await step(
    'Globe zoom draws and opens a grouped port marker at a source point',
    async () => {
      await camera(10.7, 54, 11_000_000);
      await pickAsset(clusterId);
      const coordinates = await page.evaluate((pickId) => {
        const { C } = window.worldQa;
        const { scene } = window.__godsEyeView.viewer;
        for (let i = 0; i < scene.primitives.length; i++) {
          const group = scene.primitives.get(i);
          if (!(group instanceof C.BillboardCollection)) continue;
          for (let j = 0; j < group.length; j++) {
            const marker = group.get(j);
            if (marker.id !== pickId) continue;
            const point = C.Cartographic.fromCartesian(marker.position);
            return [
              C.Math.toDegrees(point.longitude),
              C.Math.toDegrees(point.latitude),
            ];
          }
        }
        return null;
      }, assetId(clusterId));
      assert.ok(
        Math.abs(coordinates[0] - 10.7) < 1e-8 &&
          Math.abs(coordinates[1] - 54) < 1e-8,
      );
      assert.match(
        await text('#world-card-content'),
        /Port cluster.*Fixture North Port.*Fixture West Port/s,
      );
      await shot('phase4-port-cluster');
      await page.click('#world-sheet-close');
    },
  );

  await step(
    'Selecting China lights the verified foreign host, a real owner ring, and a real return line',
    async () => {
      await page.click(lens('ownership'));
      assert.equal(await text('#world-legend-title'), 'Ownership');
      await camera(104, 33, 8_000_000);
      await pickCountry(104, 33, 'CHN');
      await page.click(tab('assets'));
      assert.match(
        await text('#world-sheet-content'),
        /Verified assets owned abroad.*Fixture German Fab/s,
      );
      assert.match(
        await text('#world-sheet-extra'),
        /Nuclear-armed · early 2026.*Draft, not yet reviewed/s,
      );
      await page.waitForFunction(() => {
        const { solid, hatch } = window.worldQa;
        return (
          solid.getGeometryInstanceAttributes('world:DEU:DEU:0')?.show[0] &&
          hatch.getGeometryInstanceAttributes('world:IND:IND:0')?.show[0]
        );
      }, wait);
      await camera(11.6, 49.4, 9_000_000);
      await page.waitForFunction(
        ({ pickId, approximateId, color }) => {
          const { C } = window.worldQa;
          const { primitives } = window.__godsEyeView.viewer.scene;
          const expected = C.Color.fromCssColorString(color).withAlpha(0.8);
          let ring = false;
          let line = false;
          let approximateMarker = false;
          let approximateLine = false;
          for (let i = 0; i < primitives.length; i++) {
            const group = primitives.get(i);
            if (
              !group.show ||
              !(
                group instanceof C.BillboardCollection ||
                group instanceof C.PolylineCollection
              )
            )
              continue;
            for (let j = 0; j < group.length; j++) {
              const marker = group.get(j);
              if (marker.id === approximateId) {
                approximateMarker ||= marker.image?.endsWith(':approximate');
                approximateLine ||= marker.material?.type === 'PolylineDash';
              }
              if (marker.id !== pickId) continue;
              ring ||= Boolean(marker.image?.includes('owner-CHN:focus'));
              line ||= Boolean(
                marker.positions?.length > 2 &&
                C.Color.equals(marker.material.uniforms.color, expected),
              );
            }
          }
          return ring && line && approximateMarker && approximateLine;
        },
        wait,
        {
          pickId: assetId(fabId),
          approximateId: assetId(unknownSiteId),
          color: ownerColor('CHN'),
        },
      );
      await shot('phase4-ownership');
      await pickAsset(fabId);
      assert.match(
        await text('#world-card-content'),
        /Legal owner.*Verified Industrial Holdings · CHN · 70%.*Operator.*Fixture operator.*Status.*Operating.*Licence.*CC0/s,
      );
      assert.ok(
        await page.$('#world-card-content a[href="' + syntheticSource + '"]'),
      );
      await shot('phase4-verified-asset-card');
      await page.click('#world-sheet-close');
    },
  );

  await step(
    'Draft military presence and geometry-free fab remain listed with separate provenance',
    async () => {
      await page.click(tab('assets'));
      assert.match(
        await text('#world-sheet-content'),
        /Military presence abroad.*PLA Support Base in Djibouti/s,
      );
      await clickAssetList('PLA Support Base in Djibouti');
      assert.match(
        await text('#world-card-content'),
        /Draft, not yet reviewed.*Host location.*Djibouti.*Legal owner.*Unknown.*Sending military.*China/s,
      );
      await page.click('#world-sheet-close');
      await camera(10.3, 51, 7_500_000);
      await pickCountry(10.3, 51, 'DEU');
      await page.click(tab('assets'));
      await clickAssetList('Fab 24');
      assert.match(
        await text('#world-card-content'),
        /Draft, not yet reviewed.*Legal owner.*Unknown.*Map location.*Exact site unknown.*Reported group affiliation.*TSMC/s,
      );
      assert.ok(
        await page.$('#world-card-content a[href*="investor.tsmc.com"]'),
      );
      await shot('phase4-draft-fab-card');
      await page.click('#world-sheet-close');
      await page.click('#world-sheet-close');
      await page.click(lens('condition'));
      await camera(82, 22, 9_000_000);
    },
  );
}
