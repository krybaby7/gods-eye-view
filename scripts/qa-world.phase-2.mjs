import {
  dependencyShares,
  readEnergyDependencies,
  readEnergyReference,
} from '../server/providers/world/dependencies.js';
import {
  buildPortWatch,
  shiftDay,
} from '../server/providers/world/sources/portwatch.js';

const useModel = process.argv.includes('--energy-model');
const hormuz = 'chokepoint6';
const dataTo = '2026-11-01';
const gate = {
  id: hormuz,
  name: 'Strait of Hormuz',
  coordinates: [56.48, 26.58],
};
const days = Array.from({ length: 400 }, (_, i) => ({
  id: hormuz,
  date: shiftDay(dataTo, i - 399),
  counts: { total: i >= 387 ? 3 : 60, tanker: i >= 387 ? 1 : 25 },
}));
const candidate = {
  id: 'synthetic-hormuz',
  name: 'Synthetic corroboration',
  from: '2026-10-01',
  to: null,
  gates: [hormuz],
};
const syntheticRows = [
  {
    id: 'fixture-japan',
    dependent: 'JPN',
    provider: 'SAU',
    kind: 'supply',
    item: 'crude oil',
    route: [hormuz],
    shares: dependencyShares({ crossing: 30, seaborne: 60, total: 100 }),
    period: '2024',
    bufferDays: null,
    method: 'fixture',
  },
  {
    id: 'fixture-india',
    dependent: 'IND',
    provider: 'SAU',
    kind: 'supply',
    item: 'crude oil',
    route: [hormuz],
    shares: dependencyShares({ crossing: 8, seaborne: 30, total: 80 }),
    period: '2024',
    bufferDays: null,
    method: 'fixture',
  },
];

function staticFixture(data) {
  return {
    shouldCheck: ({ lastCheckedAt }) => !lastCheckedAt,
    async fetchObservations() {
      return { data };
    },
  };
}

export const fixtureAdapters = {
  portwatch: {
    shouldCheck: () => true,
    async fetchObservations({ data }) {
      const checks = (data?.checks ?? 0) + 1;
      const events = checks >= 3 ? [candidate] : [];
      return {
        data: {
          ...buildPortWatch({ metadata: [gate], days, events, dataTo }),
          mode: 'fixture',
          checks,
        },
        count: days.length,
        unit: 'synthetic transit day',
      };
    },
  },
  fred: staticFixture({
    series: {
      MCOILBRENTEU: [{ month: '2026-10', value: 104 }],
      MCOILWTICO: [{ month: '2026-10', value: 101 }],
      PNGASEUUSDM: [{ month: '2026-09', value: 13.2 }],
    },
  }),
  'eia-chokepoints': staticFixture(await readEnergyReference()),
  'energy-dependencies': staticFixture(
    useModel
      ? await readEnergyDependencies()
      : { mode: 'fixture', rows: syntheticRows },
  ),
};

export default async function phase2({
  assert,
  page,
  world,
  step,
  shot,
  text,
  camera,
  changeLens,
  pickCountry,
  lens,
  tab,
  wait,
}) {
  if (useModel) {
    await step(
      '2024 BACI model colours most importers and gives Japan and India real exposure',
      async () => {
        await changeLens(lens('energy'), 'Energy exposure');
        assert.match(await text('#world-legend'), /2024 BACI.*all imports/s);
        const { board } = await world.store.read();
        const model = board.features['energy-dependencies'];
        const importers = Object.keys(model.exposure);
        assert.ok(importers.length > model.coverage.importers / 2);
        await page.waitForFunction(() => {
          const { solid } = window.worldQa;
          return ['JPN', 'IND'].every(
            (iso) =>
              solid.getGeometryInstanceAttributes(
                'world:' + iso + ':' + iso + ':0',
              )?.show[0],
          );
        }, wait);
        for (const [iso, lon, lat] of [
          ['JPN', 138.3, 36.2],
          ['IND', 81.7, 21.2],
        ]) {
          await camera(lon, lat, 7_500_000);
          await pickCountry(lon, lat, iso);
          await page.click(tab('exposure'));
          await page.click('#world-sheet-content details summary');
          const content = await text('#world-sheet-content');
          assert.match(
            content,
            /Modelled from 2024 BACI trade.*Not a published statistic/s,
          );
          assert.match(
            content,
            /Share of seaborne imports.*Share of all imports.*Seaborne imports denominator.*All imports denominator/s,
          );
          assert.match(
            content,
            /Why this number.*Representative ports.*shortest maritime paths/s,
          );
          assert.ok(
            model.exposure[iso].some(
              ({ gate, item, shares }) =>
                gate === hormuz && item === 'crude oil' && shares.all > 0,
            ),
          );
          await shot('phase2-model-' + iso.toLowerCase() + '-exposure');
          await page.click('#world-sheet-close');
        }
        await page.click(lens('condition'));
        await camera(82, 22, 9_000_000);
      },
    );
    return;
  }

  const gaugeImage = (id, prefix) =>
    page.waitForFunction(
      ({ id, prefix }) => {
        const { C } = window.worldQa;
        const { primitives } = window.__godsEyeView.viewer.scene;
        for (let i = 0; i < primitives.length; i++) {
          const collection = primitives.get(i);
          if (
            !collection.show ||
            !(collection instanceof C.BillboardCollection)
          )
            continue;
          for (let j = 0; j < collection.length; j++) {
            const marker = collection.get(j);
            if (
              marker.id === 'world-card:chokepoint:' + id &&
              marker.image?.startsWith(prefix)
            )
              return true;
          }
        }
        return false;
      },
      wait,
      { id, prefix },
    );
  const findPolyline = (found) =>
    page.waitForFunction(
      (expected) => {
        const { C } = window.worldQa;
        const { primitives } = window.__godsEyeView.viewer.scene;
        let present = false;
        for (let i = 0; i < primitives.length; i++) {
          const collection = primitives.get(i);
          if (!collection.show || !(collection instanceof C.PolylineCollection))
            continue;
          for (let j = 0; j < (collection.length ?? 0); j++) {
            if (collection.get(j)?.id === 'world-card:chokepoint:chokepoint6')
              present = true;
          }
        }
        return present === expected;
      },
      wait,
      found,
    );

  await step(
    'Energy lens recolours known fixture countries and hatches unknowns',
    async () => {
      await changeLens(lens('energy'), 'Energy exposure');
      assert.match(
        await text('#world-legend'),
        /Synthetic fixture.*all imports/s,
      );
      await page.waitForFunction(() => {
        const { solid, hatch } = window.worldQa;
        return (
          solid.getGeometryInstanceAttributes('world:JPN:JPN:0')?.show[0] &&
          hatch.getGeometryInstanceAttributes('world:CHN:CHN:0')?.show[0]
        );
      }, wait);
      await pickCountry(81.7, 21.2, 'IND');
      await page.click(tab('exposure'));
      assert.match(
        await text('#world-sheet-content'),
        /Net energy imports.*33% · 2024/s,
      );
    },
  );

  await step(
    'Japan exposure shows both denominators and clears its selected route line',
    async () => {
      await camera(137, 35, 7_500_000);
      await pickCountry(138.3, 36.2, 'JPN');
      await page.click(tab('exposure'));
      const content = await text('#world-sheet-content');
      assert.match(
        content,
        /Share of seaborne imports50%.*Share of all imports30%/s,
      );
      assert.match(
        content,
        /Monthly energy prices.*Brent.*104 USD\/barrel · 2026-10/s,
      );
      await findPolyline(true);
      await shot('phase2-japan-exposure');
      await page.click('#world-sheet-close');
      await findPolyline(false);
    },
  );

  await step(
    'Picking Hormuz opens its chart, dated traffic, history and ranked dependents',
    async () => {
      await camera(56.48, 26.58, 7_000_000);
      const point = await page.waitForFunction(() => {
        const { C } = window.worldQa;
        const { scene } = window.__godsEyeView.viewer;
        const windowPoint = C.SceneTransforms.worldToWindowCoordinates(
          scene,
          C.Cartesian3.fromDegrees(56.48, 26.58, 25_000),
        );
        if (
          !windowPoint ||
          scene.pick(windowPoint, 1, 1)?.id !==
            'world-card:chokepoint:chokepoint6'
        ) {
          scene.requestRender();
          return false;
        }
        const { left, top } = scene.canvas.getBoundingClientRect();
        return { x: windowPoint.x + left, y: windowPoint.y + top };
      }, wait);
      const { x, y } = await point.jsonValue();
      await point.dispose();
      await page.mouse.click(x, y);
      await page.waitForSelector(
        '[data-world-chokepoint="chokepoint6"] .world-energy-chart path',
      );
      const content = await text('#world-card-content');
      assert.match(
        content,
        /reduced.*Data to 2026-11-01.*Status history.*EIA structural flows.*2025-H1.*Draft, not yet reviewed.*Ranked dependents.*Japan.*India/s,
      );
      assert.ok(
        await page.$eval('.world-energy-chart path', (path) =>
          path.getAttribute('d').includes('L'),
        ),
      );
      assert.match(content, /EIA route alternatives.*4.7 million/s);
      await gaugeImage(hormuz, 'reduced');
      await gaugeImage('chokepoint2', 'unknown');
      await shot('phase2-hormuz-reduced');
    },
  );

  await step(
    'Open corroboration changes Hormuz from reduced to disrupted on Refresh',
    async () => {
      await page.click('#world-refresh');
      await page.waitForSelector(
        '[data-world-chokepoint="chokepoint6"] [data-status="disrupted"]',
      );
      // The UI can receive updated feature data before the refresh turn reaches disk.
      await world.whenIdle();
      const data = (await world.store.read()).board.features.portwatch;
      assert.equal(
        data.gates.find(({ id }) => id === hormuz).status,
        'disrupted',
      );
      await gaugeImage(hormuz, 'disrupted');
      assert.match(
        await text('#world-card-content'),
        /Open corroboration.*Synthetic corroboration/s,
      );
      await shot('phase2-hormuz-disrupted');
      await page.click('#world-sheet-close');
      await camera(48, 24, 7_000_000);
      await pickCountry(45.8, 23.3, 'SAU');
      await page.click(tab('leverage'));
      assert.match(
        await text('#world-sheet-content'),
        /Leverage.*Japan.*India/s,
      );
      await page.click('#world-sheet-close');
      await page.click(lens('condition'));
      await camera(82, 22, 9_000_000);
    },
  );
}
