// Phase 5 fixture sources and acceptance against the actual globe and sheet.
const isoDate = '2026-11-08T12:00:00.000Z';
const lead = (id, country, role, name, extra = {}) => ({
  id,
  country,
  role,
  name,
  kind: 'person',
  source: 'wikidata',
  lastChecked: isoDate,
  wikidataUrl: 'https://www.wikidata.org/wiki/' + id,
  ...extra,
});
const accounts = {
  x: 'https://x.com/IndiaFixture',
  bluesky: 'https://bsky.app/profile/india-fixture.example',
  youtube: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
  website: 'https://example.org/public-office',
};
const actors = [
  lead('Q501', 'IND', 'head-of-state', 'India state fixture', {
    office: 'Fixture president',
    imageFile: 'State fixture.svg',
  }),
  lead('Q502', 'IND', 'head-of-government', 'India government fixture', {
    office: 'Fixture prime minister',
    imageFile: 'Government fixture.svg',
    accounts,
  }),
  lead('Q503', 'IND', 'foreign-minister', 'India foreign fixture'),
  lead('Q504', 'CHN', 'head-of-state', 'China state fixture'),
  lead('Q505', 'JPN', 'head-of-government', 'Japan government fixture'),
  lead('Q506', 'GBR', 'head-of-state', 'United Kingdom state fixture'),
  lead('Q507', 'KOS', 'head-of-state', 'Kosovo state fixture'),
];

function fixturePortrait(file, author, colour) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="38" height="48">' +
    '<rect width="38" height="48" rx="4" fill="' +
    colour +
    '"/><circle cx="19" cy="15" r="8" fill="#f5d7b6"/>' +
    '<path d="M5 45v-6a14 14 0 0 1 28 0v6z" fill="#1b2436"/></svg>';
  return {
    thumbnail: 'data:image/svg+xml,' + encodeURIComponent(svg),
    file: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file),
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    author,
  };
}

const fixture = (data, count, unit) => ({
  shouldCheck: ({ lastCheckedAt }) => !lastCheckedAt,
  fetchObservations: async () => ({ data, count, unit }),
});

export const fixtureAdapters = {
  wikidata: fixture(
    { actors, governments: { IND: 'Federal parliamentary republic' } },
    actors.length,
    'role',
  ),
  'wikimedia-commons': fixture(
    {
      portraits: {
        'State fixture.svg': fixturePortrait(
          'State fixture.svg',
          'State Fixture Artist',
          '#514b8c',
        ),
        'Government fixture.svg': fixturePortrait(
          'Government fixture.svg',
          'Government Fixture Artist',
          '#367786',
        ),
      },
    },
    2,
    'portrait',
  ),
  bluesky: fixture(
    {
      feeds: {
        [accounts.bluesky]: {
          posts: [
            {
              text: 'Fixture Bluesky address from the public office',
              url: 'https://bsky.app/profile/india-fixture.example/post/fixture',
              publishedAt: isoDate,
            },
          ],
        },
      },
    },
    1,
    'post',
  ),
  'youtube-rss': fixture({ feeds: {} }, 0, 'post'),
  'government-rss': fixture({ feeds: {} }, 0, 'post'),
  'actor-organizations': fixture(
    {
      organizations: {
        Q508: {
          id: 'Q508',
          name: 'India central bank fixture',
          kind: 'organization',
          role: 'central-bank',
          country: 'IND',
          reviewed: false,
          accounts: { website: 'https://example.org/bank' },
        },
      },
    },
    1,
    'organization',
  ),
};

export default async function phase5({
  assert,
  page,
  report,
  step,
  shot,
  text,
  camera,
  pickCountry,
  tab,
  wait,
}) {
  await step(
    'India shows two attributed leadership portraits and the People directory',
    async () => {
      await camera(82, 22, 9_000_000);
      await pickCountry(81.7, 21.2, 'IND');
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('.world-person-leader img')].length ===
            2 &&
          [...document.querySelectorAll('.world-person-leader img')].every(
            ({ complete, naturalWidth }) => complete && naturalWidth > 0,
          ),
        wait,
      );
      assert.match(
        await text('.world-people-government'),
        /Federal parliamentary republic/,
      );
      const state = '[data-world-leader="head-of-state"]';
      const government = '[data-world-leader="head-of-government"]';
      assert.match(
        await text(state),
        /Head of state.*India state fixture.*State Fixture Artist.*CC BY 4.0/s,
      );
      assert.match(
        await text(government),
        /Head of government.*India government fixture.*Government Fixture Artist.*CC BY 4.0/s,
      );
      await page.click(tab('people'));
      assert.match(
        await text('.world-people-tab'),
        /India foreign fixture.*Unavailable roles.*Defence minister/s,
      );
      assert.match(
        await text('.world-people-tab'),
        /India central bank fixture.*Draft, not yet reviewed/s,
      );
      assert.deepEqual(
        await page.$$eval('.world-people-tab a.world-person-account', (links) =>
          links.map(({ href }) => href).filter((url) => !url.endsWith('/bank')),
        ),
        Object.values(accounts),
      );
      assert.match(await text('.world-people-tab'), /Fixture Bluesky address/);
      await shot('people-india');
    },
  );

  await step(
    'Clicking the globe portrait opens the actor card and only consent inserts X',
    async () => {
      const pick = await page.waitForFunction(
        (id) => {
          const { scene } = window.__godsEyeView.viewer;
          const { C } = window.worldQa;
          for (let i = 0; i < scene.primitives.length; i++) {
            const collection = scene.primitives.get(i);
            if (!(collection instanceof C.BillboardCollection)) continue;
            for (let j = 0; j < collection.length; j++) {
              const item = collection.get(j);
              if (item.id !== id || !collection.show || !item.show) continue;
              const windowPoint = item.computeScreenSpacePosition(scene);
              if (!windowPoint || scene.pick(windowPoint, 1, 1)?.id !== id)
                continue;
              const bounds = scene.canvas.getBoundingClientRect();
              const x = Math.round(bounds.left + windowPoint.x);
              const y = Math.round(bounds.top + windowPoint.y);
              if (document.elementFromPoint(x, y) === scene.canvas)
                return { x, y };
            }
          }
          scene.requestRender();
          return false;
        },
        wait,
        'world-card:actor:Q502',
      );
      const { x, y } = await pick.jsonValue();
      await pick.dispose();
      await page.mouse.click(x, y);
      await page.waitForSelector('[data-world-actor="Q502"]', {
        visible: true,
      });
      assert.match(
        await text('.world-actor-card'),
        /Fixture prime minister.*Government Fixture Artist.*CC BY 4.0.*Bluesky.*Fixture Bluesky address/s,
      );
      assert.match(
        await text('.world-person-x'),
        /may require signing in to X/i,
      );
      assert.equal(await page.$('.world-person-x-frame'), null);
      assert.equal(await page.$('script[src*="platform.twitter.com"]'), null);
      assert.equal(
        report.transport.suppressedHosts.includes('platform.twitter.com'),
        false,
      );
      await shot('actor-india');
      const widgetRequest = page.waitForRequest(
        (request) =>
          request.url() === 'https://platform.twitter.com/widgets.js',
        wait,
      );
      await page.click('.world-person-x button');
      await widgetRequest;
      const frame = await page.$eval(
        '.world-person-x-frame',
        ({ srcdoc, sandbox }) => ({
          srcdoc,
          sandbox: [...sandbox],
        }),
      );
      assert.match(
        frame.srcdoc,
        /twitter-timeline.*https:\/\/x\.com\/IndiaFixture.*https:\/\/platform\.twitter\.com\/widgets\.js/,
      );
      assert.equal(frame.sandbox.includes('allow-same-origin'), false);
      await page.click('#world-sheet-close');
      assert.equal(await page.$('.world-person-x-frame'), null);
      assert.equal(await page.$('script[src*="platform.twitter.com"]'), null);
    },
  );
}
