// Phase 1 acceptance checks. The runner owns browser setup and teardown.
export default async function phase1({
  assert,
  page,
  world,
  report,
  step,
  shot,
  text,
  camera,
  toggleWorld,
  waitSettled,
  readGeometry,
  checkHatchPixels,
  changeLens,
  pickCountry,
  checkRows,
  layout,
  frameLayout,
  lens,
  area,
  slot,
  wait,
  desktop,
}) {
  await step(
    'Enable World Board and persist the automatic first turn',
    async () => {
      await toggleWorld();
      await page.waitForSelector('#world-progress:not([hidden])', {
        visible: true,
      });
      await waitSettled(true);
      await camera(82, 22, 9_000_000);
      await page.waitForFunction(() => {
        const viewer = window.__godsEyeView?.viewer;
        if (!viewer || !window.worldQa) return false;
        const ground = viewer.scene.groundPrimitives;
        const batches = Array.from({ length: ground.length }, (_, i) =>
          ground.get(i),
        );
        const hatch = batches.find(
          (p) => p.appearance?.material?.type === 'GevWorldHatch',
        );
        const solid = batches.find(
          (p) =>
            p !== hatch &&
            p.ready &&
            p.getGeometryInstanceAttributes?.('world:IND:IND:0')?.color,
        );
        if (
          !solid ||
          !hatch?.ready ||
          !solid.getGeometryInstanceAttributes('world:IND:IND:0').show[0]
        )
          return false;
        Object.assign(window.worldQa, { solid, hatch });
        return document.querySelector('#world-turn')?.textContent === 'Turn 1';
      }, wait);
      const saved = await world.store.read();
      assert.deepEqual(
        saved.turns.map(({ number }) => number),
        [1],
      );
      assert.equal(saved.board.countries.KOS.slots.C1.observation.iso3, 'XKX');
      assert.equal(saved.board.countries.KOS.slots.C4.observation.iso3, 'UVK');
      assert.equal(Math.round(saved.board.countries.CHN.condition.score), 56);
      assert.equal(await text('#world-legend-title'), 'Condition');
      assert.equal(
        await page.$eval(lens('condition'), (node) =>
          node.getAttribute('aria-pressed'),
        ),
        'true',
      );
      await page.click('#world-turn');
      assert.match(
        await text('#world-turn-changes'),
        /World Bank loaded \d+ observations/,
      );
      await page.click('#world-turn');
      await shot('condition');
    },
  );

  await step(
    'Unknown and disputed fills use the visible Cesium hatch batch',
    async () => {
      const geometry = await readGeometry();
      assert.deepEqual(geometry.batchesShown, [true, true]);
      for (const id of ['IND', 'CHN', 'GBR', 'KOS']) {
        assert.equal(geometry.countries[id].fill, true, id);
        assert.equal(geometry.countries[id].hatch, false, id);
      }
      for (const id of ['PAK', 'SAH']) {
        assert.equal(geometry.countries[id].fill, false, id);
        assert.equal(geometry.countries[id].hatch, true, id);
      }
      assert.ok(geometry.hatchAlpha > 0);
      await camera(-13, 25, 5_000_000);
      await shot('disputed-hatching');
      await camera(82, 22, 9_000_000);
      await checkHatchPixels('disputed-hatching.png');
    },
    { fatal: false },
  );

  await step(
    'All lenses recolour the same geometry and update the legend',
    async () => {
      await changeLens(lens('strength'), 'Strength · Economy');
      assert.equal(
        await page.$$eval('[data-world-area]', (nodes) => nodes.length),
        12,
      );
      await changeLens(area('S3'), 'Strength · Government');
      await changeLens(lens('data-age'), 'Data age');
      assert.match(await text('#world-legend'), /8\+ years old.*Current year/s);
      await shot('data-age');
      await changeLens(lens('condition'), 'Condition');
    },
  );

  await step(
    'Pick India and verify Condition, Strength and the score explanation',
    async () => {
      await pickCountry(81.7, 21.2, 'IND');
      assert.equal(await text('#world-sheet-name'), 'India');
      assert.match(await text('#world-hover'), /Weakest bar.*24 \/ 100.*2024/s);
      assert.match(await text('#world-coverage'), /17 of 18.*2026-11-08/);
      assert.match(await text('#world-hp-label'), /Weakest bar.*24 \/ 100/);
      const condition = await checkRows('condition', {
        C1: 24,
        C2: 67,
        C3: 82,
        C4: 86,
        C5: 58,
        C6: null,
      });
      assert.deepEqual(condition[0].flags, ['Weakest', 'Stale']);
      assert.deepEqual(condition[5].flags, ['Unknown']);
      await page.click(slot('C1'));
      const why = await text('#world-why-C1');
      assert.match(why, /GOV_WGI_PV\.SC.*2024.*Raw value\s*24/s);
      assert.match(
        why,
        /100 × clip\(\(x − 0\) ÷ \(100 − 0\), 0, 1\).*Draft anchors/s,
      );
      assert.match(
        await page.$eval('#world-why-C1 a', (a) => a.href),
        /^https:\/\//,
      );
      await shot('india-condition-why');
      const strength = await checkRows('strength', {
        S1: 86,
        S2: 63,
        S3: 64,
        S4: 66,
        S5: 52,
        S6: 50,
        S7: 34,
        S8: 77,
        S9: 68,
        S10: 56,
        S11: 25,
        S12: 60,
      });
      assert.ok(strength[10].flags.includes('Low conf.'));
      await shot('india-strength');
    },
  );

  await step('Picking Scotland selects the whole UK group', async () => {
    await camera(-3.8, 56.5, 5_000_000);
    await pickCountry(-3.8, 56.5, 'GBR');
    assert.equal(await text('#world-sheet-name'), 'United Kingdom');
    const board = await world.snapshot();
    assert.deepEqual(
      [
        ...board.countryIndex.find(({ iso3 }) => iso3 === 'GBR').shapeIds,
      ].sort(),
      ['ENG', 'GBR', 'NIR', 'SCT', 'WLS'],
    );
    await shot('uk-selected-from-scotland');
    await camera(82, 22, 9_000_000);
    await pickCountry(81.7, 21.2, 'IND');
  });

  await step(
    'Refresh writes turn 2 and shows its code-generated change list',
    async () => {
      await page.click('#world-refresh');
      await page.waitForFunction(
        () => document.querySelector('#world-turn')?.textContent === 'Turn 2',
        wait,
      );
      const saved = await world.store.read();
      assert.deepEqual(
        saved.turns.map(({ number }) => number),
        [1, 2],
      );
      const [change] = saved.turns[1].changes;
      assert.equal(saved.turns[1].changes.length, 1);
      assert.equal(change.iso3, 'IND');
      assert.match(change.text, /C1 24\/100 → 37\/100, value 24 → 37/);
      assert.equal(await text('#world-since-turn li'), change.text);
      await page.click('#world-turn');
      assert.equal(await text('#world-turn-changes li'), change.text);
      await shot('turn-2');
      await page.click('#world-turn');
      assert.equal(report.transport.refreshes, 1);
    },
  );

  await step(
    'Zoom hides the fills and returning restores the original batches',
    async () => {
      await camera(82, 22, 2_500_000);
      await page.waitForFunction(
        () => !window.worldQa.solid.show && !window.worldQa.hatch.show,
        wait,
      );
      assert.equal((await readGeometry()).hatchAlpha, 0);
      await shot('zoom-detail');
      await camera(82, 22, 9_000_000);
      await page.waitForFunction(() => {
        const { solid, hatch } = window.worldQa;
        return (
          solid.show &&
          hatch.show &&
          solid.getGeometryInstanceAttributes('world:IND:IND:0').color[3] ===
            140
        );
      }, wait);
      assert.ok((await readGeometry()).hatchAlpha > 0);
    },
  );

  await step(
    'HUD keeps controls clear on desktop and narrow screens',
    async () => {
      await page.click(lens('strength'));
      await layout(1440, 900);
      await layout(1280, 800);
      await layout(390, 844);
      await page.setViewport(desktop);
    },
  );

  await step(
    'The frame’s regions and the original panels do not overlap at three window sizes',
    async () => {
      const today = () => page.evaluate(() => document.body.dataset.today);
      const setToday = async (state) => {
        if ((await today()) === state) return;
        await page.click(
          state === 'open' ? '#frame-today-open' : '#frame-today-fold',
        );
        await page.waitForFunction(
          (state) => document.body.dataset.today === state,
          wait,
          state,
        );
      };
      const before = await today();
      const legendFailures = [];
      try {
        // India is selected, so the sheet is open.
        for (const [width, height] of [
          [1280, 720],
          [1440, 900],
          [1920, 1080],
        ]) {
          await page.setViewport({ width, height, deviceScaleFactor: 1 });
          await setToday('open');
          await frameLayout(width, height, 'today-open-sheet-open');
          await setToday('folded');
          await frameLayout(width, height, 'today-folded-sheet-open');
          // Each lens's legend, whole, in the full-width bottom bar.
          const pressed = await page.$eval(
            '#world-lens-bar [aria-pressed="true"]',
            (node) => node.dataset.worldLens,
          );
          const lensIds = await page.$$eval(
            '#world-lens-bar [data-world-lens]',
            (nodes) => nodes.map((node) => node.dataset.worldLens),
          );
          try {
            for (const id of lensIds) {
              await page.click(lens(id));
              await page.waitForFunction(
                (selector) =>
                  document
                    .querySelector(selector)
                    ?.getAttribute('aria-pressed') === 'true',
                wait,
                lens(id),
              );
              // Every lens is measured at every size before the step fails.
              try {
                await frameLayout(width, height, `legend-${id}`);
              } catch (error) {
                legendFailures.push(error.message);
              }
            }
          } finally {
            await page.click(lens(pressed));
          }
        }
        await page.click('#world-sheet-close');
        await page.waitForFunction(
          () => document.body.dataset.sheet === 'closed',
          wait,
        );
        await setToday('open');
        await frameLayout(1280, 720, 'today-open-sheet-closed');
        assert.deepEqual(legendFailures, []);
      } finally {
        // Leave the page as the next steps expect it, pass or fail.
        await page.setViewport(desktop);
        await setToday(before);
        if ((await page.evaluate(() => document.body.dataset.sheet)) !== 'open')
          await pickCountry(81.7, 21.2, 'IND');
      }
    },
    // A layout failure is reported without stopping the board's other checks.
    { fatal: false },
  );

  await step(
    'Disable and re-enable without extra turns or new geometry',
    async () => {
      await toggleWorld();
      await waitSettled(false);
      await page.waitForFunction(
        () =>
          document.querySelector('#world-lens-bar').hidden &&
          document.querySelector('#world-legend').hidden &&
          document.querySelector('#world-character-sheet').hidden &&
          !window.worldQa.solid.show &&
          !window.worldQa.hatch.show,
        wait,
      );
      // Refresh and the turn pill go with the board: nothing dead is shown.
      assert.deepEqual(
        await page.$$eval('#world-refresh, #world-turn', (nodes) =>
          nodes
            .filter((node) => node.getClientRects().length > 0)
            .map((node) => node.id),
        ),
        [],
      );
      await shot('layer-off');
      await toggleWorld();
      await waitSettled(true);
      await camera(82, 22, 9_000_000);
      await page.waitForFunction(
        () =>
          !document.querySelector('#world-lens-bar').hidden &&
          window.worldQa.solid.show &&
          window.worldQa.hatch.show,
        wait,
      );
      assert.deepEqual(
        (await world.store.read()).turns.map(({ number }) => number),
        [1, 2],
      );
      assert.deepEqual(report.errors, []);
    },
  );
}
