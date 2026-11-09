function row(id, type, to, extra = {}) {
  return {
    id,
    type,
    from: 'IND',
    to,
    detail: 'Fixture evidence',
    sources: ['https://example.org/relation-evidence'],
    dateChecked: '2026-11-09',
    reviewed: false,
    ...extra,
  };
}

export const fixtureAdapters = {
  'relations-curated': {
    shouldCheck: ({ lastCheckedAt }) => !lastCheckedAt,
    fetchObservations: async () => ({
      data: {
        relations: [
          row('fixture-war', 'current_armed_conflict', 'PAK', {
            events: [
              {
                id: 'fixture',
                a: 'IND',
                b: 'PAK',
                date: new Date().toISOString().slice(0, 10),
                sourceUrl: 'https://ucdp.uu.se/',
              },
            ],
          }),
          row('fixture-history', 'armed_conflict', 'PAK', { period: '2025' }),
          row('fixture-alliance', 'alliance', 'GBR', {
            conditions: 'Fixture defence condition',
          }),
          row('fixture-collective', 'alliance', 'FIX', {
            from: 'FIX',
            participants: ['IND', 'GBR', 'AUS'],
            instrument: 'Fixture collective treaty',
          }),
          row('fixture-rival', 'rivalry', 'CHN'),
          row('fixture-bloc', 'bloc_membership', 'SCO'),
          row('fixture-sanctions-out', 'sanctions', 'PRK', {
            directed: true,
            scope: 'state',
          }),
          row('fixture-sanctions-in', 'sanctions', 'IND', {
            from: 'USA',
            directed: true,
            scope: 'persons',
            programme: 'Fixture targeted sanctions',
          }),
        ],
      },
    }),
  },
  'relations-voting': {
    shouldCheck: ({ lastCheckedAt }) => !lastCheckedAt,
    fetchObservations: async () => ({
      data: {
        relations: [
          row('fixture-vote', 'un_alignment', 'CHN', {
            agreement: 0.3,
            session: 79,
            period: '2024',
          }),
        ],
      },
    }),
  },
};

export default async function phase3({
  assert,
  page,
  step,
  shot,
  text,
  camera,
  toggleWorld,
  waitSettled,
  pickCountry,
  lens,
  wait,
}) {
  await step(
    'India diplomacy shows classes, relation lines and source evidence',
    async () => {
      if (!(await page.$(lens('diplomacy'))))
        assert.fail('Diplomacy lens missing');
      if (await page.$eval('#world-legend', (node) => node.hidden))
        await toggleWorld();
      await waitSettled(true);
      await camera(75, 26, 10_000_000);
      await pickCountry(81.7, 21.2, 'IND');
      await page.click(lens('diplomacy'));
      await page.waitForFunction(() => {
        const { solid } = window.worldQa;
        const china = solid.getGeometryInstanceAttributes('world:CHN:CHN:0');
        const pakistan = solid.getGeometryInstanceAttributes('world:PAK:PAK:0');
        return (
          china.show[0] &&
          pakistan.show[0] &&
          Array.from(china.color).slice(0, 3).join(',') === '178,94,197' &&
          Array.from(pakistan.color).slice(0, 3).join(',') === '219,71,79'
        );
      }, wait);
      assert.equal(await text('#world-legend-title'), 'Diplomacy · India');
      assert.match(await text('#world-legend'), /Unknown or disputed/i);
      assert.deepEqual(
        await page.$$eval('#world-legend-stops span', (nodes) =>
          nodes.map((node) => node.textContent),
        ),
        ['At war', 'Sanctions', 'Ally', 'Rival', 'Partner', 'Neutral'],
      );
      await page.waitForFunction(() => {
        const { viewer } = window.__godsEyeView;
        const items = viewer.scene.primitives;
        const collections = Array.from({ length: items.length }, (_, i) =>
          items.get(i),
        );
        const lines = collections.flatMap((entry) =>
          entry instanceof window.worldQa.C.PolylineCollection
            ? Array.from({ length: entry.length }, (_, i) => entry.get(i))
            : [],
        );
        return (
          lines.find((line) => line.id === 'world-card:relation:fixture-war')
            ?.material.uniforms.dashPattern === 3855 &&
          lines.find(
            (line) => line.id === 'world-card:relation:fixture-alliance',
          )?.material.uniforms.dashPattern === 255
        );
      }, wait);
      await page.click('#world-tab-relations');
      await page.waitForSelector('[data-world-relation="fixture-vote"]', wait);
      for (const label of [
        'Allies',
        'Blocs',
        'Rivals',
        'Current armed conflict',
        'Armed conflict in 2025',
        'Sanctions imposed',
        'Sanctions received',
      ]) {
        assert.match(await text('#world-sheet-content'), new RegExp(label));
      }
      assert.match(
        await text('[data-world-relation="fixture-vote"]'),
        /UN voting closeness: 30.0%.*2024/,
      );
      assert.match(
        await text('[data-world-relation="fixture-sanctions-in"]'),
        /Sanctions on persons in India/,
      );
      assert.match(
        await text('[data-world-relation="fixture-collective"]'),
        /Fixture collective treaty.*United Kingdom.*Australia/s,
      );
      await shot('india-diplomacy');
      const hit = await page.waitForFunction(() => {
        const { scene } = window.__godsEyeView.viewer;
        const { C } = window.worldQa;
        const groups = scene.primitives;
        const lines = Array.from({ length: groups.length }, (_, i) =>
          groups.get(i),
        ).flatMap((group) =>
          group instanceof C.PolylineCollection
            ? Array.from({ length: group.length }, (_, i) => group.get(i))
            : [],
        );
        const war = lines.find(
          (line) => line.id === 'world-card:relation:fixture-war',
        );
        for (const location of war?.positions.slice(5, -5) ?? []) {
          const position = C.SceneTransforms.worldToWindowCoordinates(
            scene,
            location,
          );
          if (position && scene.pick(position, 1, 1)?.id === war.id)
            return { x: position.x, y: position.y };
        }
        return false;
      }, wait);
      const position = await hit.jsonValue();
      await page.mouse.click(position.x, position.y);
      await page.waitForSelector('#world-card-content:not([hidden])');
      assert.match(
        await text('#world-card-content'),
        /Armed conflict|armed conflict/,
      );
      await page.click('#world-sheet-close');
      await page.click('[data-world-relation="fixture-alliance"]');
      assert.match(
        await text('#world-card-content'),
        /Fixture defence condition/,
      );
      assert.match(
        await text('#world-card-content'),
        /Draft, not yet reviewed/i,
      );
      assert.match(
        await text('#world-card-content'),
        /at war through sanctions, ally, rival, partner and neutral.*past 90 days/s,
      );
      assert.equal(
        await page.$eval('#world-card-content a', (node) => node.href),
        'https://example.org/relation-evidence',
      );
      await shot('india-relation-card');
    },
  );
}
