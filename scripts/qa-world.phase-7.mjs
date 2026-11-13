// Words for numbers and the Overview tab (roadmap 2.1 and 2.2).
export default async function phase7({
  assert,
  page,
  step,
  shot,
  text,
  camera,
  pickCountry,
  tab,
  slot,
  toggleWorld,
  waitSettled,
}) {
  const selectedTab = () =>
    page.$eval('[data-world-tab][aria-selected="true"]', (node) =>
      node.getAttribute('data-world-tab'),
    );
  const lines = () =>
    page.$$eval('[data-world-overview]', (nodes) =>
      nodes.map((node) => ({
        id: node.dataset.worldOverview,
        target: node.dataset.worldOverviewTarget ?? null,
        button: node.tagName === 'BUTTON',
        text: node.textContent.trim(),
      })),
    );

  await step(
    'A selected country opens on the Overview with six lines',
    async () => {
      // Phase 6 ends with the board switched off.
      const on = await page.evaluate(() =>
        window.__godsEyeView?.dataManager?.isEffectivelyEnabled('world'),
      );
      if (!on) await toggleWorld();
      await waitSettled(true);
      await camera(104, 33, 8_000_000);
      await pickCountry(104, 33, 'CHN');
      await camera(82, 22, 9_000_000);
      await pickCountry(81.7, 21.2, 'IND');
      assert.equal(
        await page.$eval('#world-sheet-tabs [data-world-tab]', (node) =>
          node.getAttribute('data-world-tab'),
        ),
        'overview',
      );
      assert.equal(await selectedTab(), 'overview');
      const overview = await lines();
      assert.deepEqual(
        overview.map(({ id }) => id),
        [
          'condition',
          'leadership',
          'standouts',
          'alerts',
          'relations',
          'dependency',
        ],
      );
      const byId = Object.fromEntries(overview.map((line) => [line.id, line]));
      assert.equal(byId.condition.target, 'condition');
      assert.equal(byId.leadership.target, 'people');
      assert.equal(byId.relations.target, 'relations');
      assert.equal(byId.dependency.target, 'exposure');
      assert.ok(overview.every(({ button }) => button));
      assert.equal(
        await page.$$eval('.world-overview-bar', (nodes) => nodes.length),
        6,
      );
      assert.match(
        byId.condition.text,
        /Weakest bar: Government, (very weak|weak) at \d+\. 5 of 6 bars have a figure\./,
      );
      assert.match(byId.condition.text, /Societal cooperation\s*Unknown/);
      assert.match(
        byId.leadership.text,
        /India government fixture, head of government.*India state fixture, head of state/s,
      );
      assert.match(byId.standouts.text, /Strongest: .+ Weakest: .+/s);
      assert.match(
        byId.standouts.text,
        /No area has two stored periods yet, so none is picked as moving fastest\./,
      );
      // Phase 6 ends with its GDACS and FX flags cleared.
      assert.match(
        byId.alerts.text,
        /^Alerts\s*No current alerts for this country in the loaded sources\./,
      );
      // The phase 2 fixture: 8 of India's 80 units of energy imports.
      assert.match(
        byId.dependency.text,
        /About 10% of India's energy imports come from Saudi Arabia\.\s*Synthetic fixture data/,
      );
      await shot('india-overview');
    },
  );

  await step(
    'Each Overview line opens the tab that holds its detail',
    async () => {
      for (const [id, target] of [
        ['leadership', 'people'],
        ['relations', 'relations'],
        ['dependency', 'exposure'],
        ['condition', 'condition'],
      ]) {
        await page.click(tab('overview'));
        await page.click(`[data-world-overview="${id}"]`);
        assert.equal(await selectedTab(), target);
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.getAttribute('data-world-tab'),
          ),
          target,
        );
      }
    },
  );

  await step(
    'A Condition row shows its band word and opens to the world, its past and why',
    async () => {
      await page.click(tab('condition'));
      const row = await page.$eval(slot('C1'), (node) => ({
        band: node.querySelector('.world-row-band')?.textContent,
        score: node.querySelector('.world-row-score').textContent,
        detail: node.querySelector('.world-detail').textContent,
      }));
      assert.match(row.band, /^(Very weak|Weak|Midrange|Solid|Strong)$/);
      assert.match(row.score, /^\d+ \/ 100$/);
      assert.match(row.detail, /2024 · World Bank · stale/);
      await page.click(slot('C1'));
      const why = await text('#world-why-C1');
      assert.match(
        why,
        /Political stability and absence of violence was \d+ in 2024, now stale; on the board's scale 0 or less scores 0 and 100 or more scores 100\./,
      );
      assert.match(
        why,
        /Against the world.*than \d+ of the \d+ other (country|countries) with a figure\./s,
      );
      assert.match(
        why,
        /Against its own past\s*Earlier years are not stored yet, so no trend is drawn\./,
      );
      assert.match(why, /Why this number/);
      assert.ok(await page.$('#world-why-C1 .world-words-strip i'));
      const unknown = await page.$eval(slot('C6'), (node) => ({
        band: node.querySelector('.world-row-band'),
        hatched: node
          .querySelector('.world-score-track')
          .classList.contains('world-hatch'),
      }));
      assert.equal(unknown.band, null);
      assert.equal(unknown.hatched, true);
      await page.click(slot('C6'));
      const unknownWhy = await text('#world-why-C6');
      assert.match(
        unknownWhy,
        /No published value is held for political polarisation, so the bar is hatched and is not counted as low\./,
      );
      assert.match(
        unknownWhy,
        /Unknown here, so it is not ranked against other countries\./,
      );
      assert.match(unknownWhy, /Unknown now, so no trend is drawn\./);
      const forecast = await page.$eval(slot('C5'), (node) => ({
        detail: node.querySelector('.world-detail').textContent,
        dashed: node
          .querySelector('.world-score-track')
          .classList.contains('world-claim-dashed'),
      }));
      assert.match(forecast.detail, /2026 · IMF DataMapper · forecast/);
      assert.equal(forecast.dashed, true);
      await shot('india-condition-words');
    },
  );
}
