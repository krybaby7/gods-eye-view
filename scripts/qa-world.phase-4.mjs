import { readCuratedAssets } from '../server/providers/world/assets.js';
import { ownerColor } from '../src/layers/world/assets.js';

const piraeusId = 'asset_piraeus-port-authority';
const closedId = 'asset_fixture-closed-plant';
const presenceId = 'asset_chn-dji-pla-support-base-in-djibouti';
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
    rows: [
      fixtureAsset(
        closedId,
        'nuclear_plant',
        'Fixture Closed Plant',
        'IND',
        null,
        {
          status: 'closed',
          owners: [
            {
              actor: 'Fixture company',
              country: 'CHN',
              role: 'owner',
              countryLabel: 'Registered jurisdiction',
              sourceUrl: syntheticSource,
              verified: true,
            },
          ],
        },
      ),
    ],
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
        [
          'Fab 24',
          'Port of Piraeus',
          'PLA Support Base in Djibouti',
          'Camp Lemonnier',
        ].includes(name),
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
  selectTab,
  wait,
}) {
  const assetId = (id) => 'world-card:asset:' + id;

  async function pickAsset(id, hintHost) {
    const handle = await page.waitForFunction(
      ({ pickId, hintHost }) => {
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
            if (screen && hintHost) {
              screen.x += marker.pixelOffset.x;
              screen.y += marker.pixelOffset.y;
            }
            if (
              !screen ||
              scene.pick(screen, 1, 1)?.id !== pickId ||
              (hintHost &&
                !scene
                  .drillPick(screen, undefined, 1, 1)
                  .some(({ id }) =>
                    id?.startsWith?.('world:' + hintHost + ':'),
                  ))
            ) {
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
      { pickId: hintHost ? 'world-hint:asset:' + id : assetId(id), hintHost },
    );
    const { x, y } = await handle.jsonValue();
    await handle.dispose();
    await page.mouse.click(x, y);
    await page.waitForSelector(
      '#world-card-content [data-world-asset="' +
        id +
        '"] :is(h3, .world-asset-details)',
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
    'Condition hides markers at board height and shows them below 2,000 km',
    async () => {
      function visibleAssetCount() {
        const { C } = window.worldQa;
        const { primitives } = window.__godsEyeView.viewer.scene;
        let count = 0;
        for (let i = 0; i < primitives.length; i++) {
          const group = primitives.get(i);
          if (!(group instanceof C.BillboardCollection) || !group.show)
            continue;
          for (let j = 0; j < group.length; j++) {
            if (/^world-(?:card|hint):asset:/.test(group.get(j).id)) count++;
          }
        }
        return count;
      }
      await page.click(lens('condition'));
      await camera(10.7, 54, 11_000_000);
      assert.equal(await page.evaluate(visibleAssetCount), 0);
      await camera(10.7, 54, 1_900_000);
      const started = Date.now();
      while ((await page.evaluate(visibleAssetCount)) === 0) {
        assert.ok(
          Date.now() - started < 10_000,
          'Assets remain hidden at detail height',
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    },
  );

  await step(
    'Ownership clusters a selected country’s ports at a real member',
    async () => {
      await page.click(lens('ownership'));
      await camera(10.7, 54, 11_000_000);
      await pickCountry(10.3, 51, 'DEU');
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
      await page.click('#world-sheet-close');
    },
  );

  await step(
    'Selecting China lights the documented Piraeus investment and Djibouti presence',
    async () => {
      await page.click(lens('ownership'));
      assert.equal(await text('#world-legend-title'), 'Ownership');
      await camera(104, 33, 8_000_000);
      await pickCountry(104, 33, 'CHN');
      await selectTab('assets');
      await page.waitForSelector('#world-sheet-content .world-asset-section');
      assert.match(
        await text('#world-sheet-content'),
        /Sourced ownership and operators abroad.*Port of Piraeus/s,
      );
      assert.match(
        await text('#world-sheet-extra'),
        /Nuclear-armed · early 2026.*Draft, not yet reviewed/s,
      );
      await page.waitForFunction(() => {
        const { solid, hatch } = window.worldQa;
        return (
          solid.getGeometryInstanceAttributes('world:GRC:GRC:0')?.show[0] &&
          hatch.getGeometryInstanceAttributes('world:JPN:JPN:0')?.show[0]
        );
      }, wait);
      await camera(23.636127, 37.941896, 9_000_000);
      await page.waitForFunction(
        ({ pickId, approximateId, color }) => {
          const { C } = window.worldQa;
          const { primitives } = window.__godsEyeView.viewer.scene;
          const expected = C.Color.fromCssColorString(color).withAlpha(0.45);
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
              if (marker.id === 'world-hint:asset:' + approximateId) {
                approximateMarker ||= marker.image?.includes(':approximate:');
              }
              if (marker.id === 'world-card:asset:' + approximateId) {
                approximateLine ||=
                  marker.material?.type === 'PolylineDash' &&
                  marker.material.uniforms.color.alpha === 0.45;
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
          pickId: assetId(piraeusId),
          approximateId: presenceId,
          color: ownerColor('CHN'),
        },
      );
      await shot('phase4-ownership');
      await pickAsset(piraeusId);
      assert.match(
        await text('#world-card-content'),
        /Draft, not yet reviewed.*Sourced owner or operator.*COSCO.*Controlling group’s jurisdiction CHN.*67%.*Operator.*Piraeus Port Authority/s,
      );
      assert.ok(await page.$('#world-card-content a[href*="olp.gr"]'));
      await shot('phase4-verified-asset-card');
      await page.click('#world-sheet-close');
      assert.match(
        await text('#world-sheet-content'),
        /Fixture Closed Plant.*Closed/s,
      );
      await camera(82, 23, 7_000_000);
      await pickAsset(closedId, 'IND');
      assert.equal(
        await page.evaluate(
          () =>
            window.__godsEyeView.dataManager.layers
              .get('world')
              .module.getSnapshot().selected,
        ),
        'CHN',
      );
      assert.match(
        await text('#world-card-content'),
        /Fixture Closed Plant.*Registered jurisdiction CHN/s,
      );
      await shot('phase4-closed-asset-hint');
      await page.click('#world-sheet-close');
    },
  );

  await step(
    'Draft military presence and geometry-free fab remain listed with separate provenance',
    async () => {
      await selectTab('assets');
      await page.waitForSelector('#world-sheet-content .world-asset-section');
      assert.match(
        await text('#world-sheet-content'),
        /Military presence abroad.*PLA Support Base in Djibouti/s,
      );
      await clickAssetList('PLA Support Base in Djibouti');
      await page.waitForSelector('#world-card-content .world-asset-details');
      assert.match(
        await text('#world-card-content'),
        /Draft, not yet reviewed.*Host location.*Djibouti.*Sending military.*China/s,
      );
      await page.click('#world-sheet-close');
      await camera(10.3, 51, 7_500_000);
      await pickCountry(10.3, 51, 'DEU');
      await selectTab('assets');
      await clickAssetList('Fab 24');
      await page.waitForSelector('#world-card-content .world-asset-details');
      assert.match(
        await text('#world-card-content'),
        /Draft, not yet reviewed.*Sourced owner or operator.*TSMC.*Map location.*Exact site unknown/s,
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
