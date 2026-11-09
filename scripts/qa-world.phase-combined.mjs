const countries = [
  { iso3: 'IND', center: [82, 22], pick: [81.7, 21.2] },
  { iso3: 'JPN', center: [137, 35], pick: [138.3, 36.2] },
  { iso3: 'CHN', center: [104, 33], pick: [104, 33] },
];

const lenses = [
  ['condition', /^Condition$/],
  ['strength', /^Strength/],
  ['energy', /^Energy exposure$/],
  ['data-age', /^Data age$/],
  ['diplomacy', /^Diplomacy · /],
  ['ownership', /^Ownership$/],
];

export default async function captureCombinedLenses({
  assert,
  page,
  step,
  shot,
  text,
  report,
  camera,
  pickCountry,
  lens,
  toggleWorld,
  waitSettled,
  wait,
  desktop,
}) {
  await page.setViewport(desktop);
  await toggleWorld();
  await waitSettled(true);
  await page.waitForSelector('#world-lens-bar:not([hidden])', wait);
  const order = await page.$$eval(
    '#world-lens-bar [data-world-lens]',
    (buttons) => buttons.map(({ dataset }) => dataset.worldLens),
  );
  assert.deepEqual(
    order,
    lenses.map(([id]) => id),
  );
  report.matrix = [];

  for (const { iso3, center, pick } of countries) {
    await step(
      'Capture all six lenses with ' + iso3 + ' selected',
      async () => {
        await page.click(lens('condition'));
        await camera(...center, 9_000_000);
        await pickCountry(...pick, iso3);

        for (const [id, title] of lenses) {
          const reused = await page.$eval(lens(id), (button) => {
            const { scene } = window.__godsEyeView.viewer;
            const { solid, hatch } = window.worldQa;
            const rendered = new Promise((resolve) => {
              const remove = scene.postRender.addEventListener(() => {
                remove();
                resolve(
                  scene.groundPrimitives.contains(solid) &&
                    scene.groundPrimitives.contains(hatch),
                );
              });
            });
            button.click();
            scene.requestRender();
            return rendered;
          });
          assert.equal(reused, true, id + ' reused the country geometry');
          assert.equal(
            await page.$eval(lens(id), (button) =>
              button.getAttribute('aria-pressed'),
            ),
            'true',
          );
          assert.match(await text('#world-legend-title'), title);
          assert.equal(await text('#world-sheet-code'), iso3);
          const name = 'matrix-' + id + '-' + iso3.toLowerCase();
          await shot(name);
          report.matrix.push({ country: iso3, lens: id, file: name + '.png' });
        }
      },
    );
  }
}
