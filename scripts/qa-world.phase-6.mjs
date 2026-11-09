import { gdacs } from '../server/providers/world/sources/liveDisasters.js';
import { fao, fx } from '../server/providers/world/sources/livePrices.js';

const red =
  '<rss><channel><item><pubDate>Sun, 08 Nov 2026 09:00:00 GMT</pubDate><gdacs:alertlevel>Red</gdacs:alertlevel><gdacs:eventtype>FL</gdacs:eventtype><gdacs:eventid>100</gdacs:eventid><gdacs:iso3>IND</gdacs:iso3><gdacs:population value="12000" /></item></channel></rss>';
const orange = red.replace('>Red<', '>Orange<');
const fixtureRates = (rate) => [
  { base: 'USD', quote: 'INR', date: '2026-10-09', rate: 80 },
  { base: 'USD', quote: 'INR', date: '2026-11-08', rate },
];
function fixture(adapter, response) {
  return {
    live: true,
    shouldCheck: () => true,
    async fetchObservations(context) {
      const calls = (context.data?.fixtureCalls ?? 0) + 1;
      const result = await adapter.fetchObservations({
        ...context,
        fetchImpl: async () => response(calls),
      });
      return { ...result, data: { ...result.data, fixtureCalls: calls } };
    },
  };
}

export const fixtureAdapters = {
  'live-gdacs': fixture(
    gdacs,
    (calls) => new Response(calls === 2 ? red : orange),
  ),
  'live-fx': fixture(fx, (calls) =>
    Response.json(fixtureRates(calls === 2 ? 100 : 82)),
  ),
  'live-fao': fixture(
    fao,
    () => new Response('Date,Food Price Index\n2026-09,124.0\n2026-10,127.1'),
  ),
};

export default async function phase6({
  assert,
  page,
  world,
  step,
  shot,
  text,
  camera,
  toggleWorld,
  waitSettled,
  pickCountry,
}) {
  await step(
    'Dated GDACS and FX flags clear without changing Condition scores',
    async () => {
      await camera(82, 22, 9_000_000);
      await pickCountry(81.7, 21.2, 'IND');
      await page.click('#world-tab-condition');
      const sourceRow = (slot) =>
        '.world-slot:has([data-world-slot="' + slot + '"])';
      assert.match(
        await text(sourceRow('C3')),
        /Red GDACS flood alert.*12,000 people exposed.*2026-11-08/s,
      );
      assert.match(
        await text(sourceRow('C5')),
        /INR down 20%.*Frankfurter.*2026-11-08/s,
      );
      assert.match(await text('#world-hover'), /GDACS.*2026-11-08/s);
      assert.match(
        await text('#world-live-fao'),
        /127.1.*up 2.5%.*FAO.*2026-10/s,
      );
      await page.click('.world-live-evidence summary');
      assert.match(
        await page.$eval('.world-live-evidence a', (link) => link.href),
        /^https:\/\//,
      );
      const before = await world.snapshot();
      assert.equal(before.turn.number, 2);
      assert.equal(
        before.turn.changes.filter(
          ({ kind, action }) => kind === 'condition-flag' && action === 'set',
        ).length,
        2,
      );
      await shot('india-live-condition-flags');
      await page.click('#world-refresh');
      await waitSettled(true);
      const after = await world.snapshot();
      assert.equal(after.turn.number, 3);
      assert.equal(
        after.turn.changes.filter(
          ({ kind, action }) =>
            kind === 'condition-flag' && action === 'cleared',
        ).length,
        2,
      );
      for (const slot of ['C3', 'C5']) {
        assert.equal(
          after.countries.IND.slots[slot].score,
          before.countries.IND.slots[slot].score,
        );
      }
      assert.doesNotMatch(await text(sourceRow('C3')), /Red GDACS/i);
      assert.doesNotMatch(await text(sourceRow('C5')), /INR down/i);
      await shot('india-live-flags-cleared');
      await toggleWorld();
      await waitSettled(false);
      assert.equal(await page.$('#world-live-fao'), null);
    },
  );
}
