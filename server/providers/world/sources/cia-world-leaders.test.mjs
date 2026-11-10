import assert from 'node:assert/strict';
import test from 'node:test';

const now = new Date('2026-11-10T09:00:00Z');

test('uses the listing order of plain titles even when a candidate has an earlier compound title', async () => {
  const { mergeOfficeholders } = await import('../officeholders.js');
  const leaders = [
    { title: 'Min. of Foreign Affairs & Trade', name: 'Second Holder' },
    { title: 'Min. of Foreign Affairs', name: 'First Holder' },
    { title: 'Min. of Foreign Affairs', name: 'Second Holder' },
  ];
  const cia = await actorsOf(
    page('Argentina', '2026-08-06', leaders),
    'argentina',
  );
  const [actor] = mergeOfficeholders([], cia, now);
  assert.equal(actor.name, 'First Holder');
  assert.equal(actor.ambiguity.alternatives[0].name, 'Second Holder');
});

test('a CIA confirmation refreshes a matching collective member without replacing their Wikidata identity', async () => {
  const { mergeOfficeholders } = await import('../officeholders.js');
  const role = 'head-of-state';
  const wd = wikidata('AND', 'Emmanuel Macron', 'Q1', '2017-05-14', {
    role,
    lastChecked: '2025-08-01T09:00:00Z',
  });
  const cia = {
    ...wd,
    id: 'cia-1',
    name: 'Emmanuel Jean-Michel Macron',
    source: 'cia-world-leaders',
    asOf: '2026-09-10',
  };
  const [actor] = mergeOfficeholders([wd], [cia], now);
  assert.equal(actor.id, 'Q1');
  assert.equal(actor.name, 'Emmanuel Macron');
  assert.equal(actor.stale, false);
  assert.equal(actor.otherEvidence[0].asOf, '2026-09-10');
});

test('preserves the CIA spelling and corroborates a cited multi-edit transliteration', async () => {
  const { parseCiaPage, resolveCiaPage } =
    await import('./cia-world-leaders.js');
  const { mergeOfficeholders } = await import('../officeholders.js');
  const raw = page('Israel', '2026-08-06', [
    { name: 'Binyamin NETANYAHU', title: 'Prime Min.' },
  ]);
  const [cia] = resolveCiaPage(parseCiaPage(raw, 'israel'), {
    countries: [{ iso3: 'ISR', name: 'Israel' }],
  });
  const wd = wikidata('ISR', 'Benjamin Netanyahu', 'Q43723', '2022-12-29', {
    role: 'head-of-government',
  });
  const [actor] = mergeOfficeholders([wd], [cia], now);
  assert.equal(cia.name, 'Binyamin Netanyahu');
  assert.equal(actor.name, 'Benjamin Netanyahu');
  assert.equal(actor.id, 'Q43723');
  assert.equal(actor.disagreement, undefined);
  assert.equal(actor.otherEvidence[0].name, 'Binyamin Netanyahu');
});

test('corroborates abbreviated and one-edit names while retaining Wikidata identity', async () => {
  const { mergeOfficeholders } = await import('../officeholders.js');
  for (const [wdName, ciaName] of [
    ['Vladimir Putin', 'Vladimir Vladimirovich Putin'],
    ['Droupadi Murmu', 'Drupadi Murmu'],
    ['Felipe VI of Spain', 'Felipe VI'],
    ['José Sánchez', 'Sanchez Jose'],
  ]) {
    const wd = wikidata('ARG', wdName, 'Q1', '2020-01-01', {
      lastChecked: '2025-01-01T09:30:00Z',
    });
    const cia = {
      ...wd,
      id: 'cia-1',
      name: ciaName,
      source: 'cia-world-leaders',
      asOf: '2026-08-01',
    };
    const [actor] = mergeOfficeholders([wd], [cia], now);
    assert.equal(actor.name, wdName);
    assert.equal(actor.id, 'Q1');
    assert.equal(actor.imageFile, 'portrait.jpg');
    assert.equal(actor.accounts.x, 'https://x.com/official');
    assert.equal(actor.disagreement, undefined);
    assert.equal(actor.stale, false);
    assert.equal(actor.otherEvidence[0].asOf, '2026-08-01');
  }
});

test('one-token, repeated-token, and short typos cannot join different people', async () => {
  const { mergeOfficeholders } = await import('../officeholders.js');
  for (const [wdName, ciaName] of [
    ['Norodom Sihamoni', 'Sihamoni'],
    ['Peter Brown', 'Peter Peter'],
    ['Wang Yi', 'Yang Yi'],
    ['John Doe', 'Jane Doe'],
  ]) {
    const wd = wikidata('ARG', wdName, 'Q1', '2020-01-01');
    const cia = {
      ...wd,
      id: 'cia-1',
      name: ciaName,
      source: 'cia-world-leaders',
      asOf: '2026-08-01',
    };
    const [actor] = mergeOfficeholders([wd], [cia], now);
    assert.equal(actor.name, ciaName);
    assert.equal(actor.disagreement.name, wdName);
  }
});

test('uses the Wikidata read date for confirmation and the start date to resolve a disagreement', async () => {
  const { mergeOfficeholders } = await import('../officeholders.js');
  const old = wikidata('ARG', 'Previous Holder', 'Q1', '2020-01-01', {
    lastChecked: '2026-11-09T12:30:00Z',
  });
  const [fresh] = mergeOfficeholders([old], [], now);
  assert.equal(fresh.asOf, '2026-11-09');
  assert.equal(fresh.since, '2020-01-01');
  assert.equal(fresh.stale, false);
  const cia = {
    ...old,
    id: 'cia-1',
    name: 'Next Holder',
    source: 'cia-world-leaders',
    asOf: '2025-03-01',
  };
  const [actor] = mergeOfficeholders([old], [cia], now);
  assert.equal(actor.name, 'Next Holder');
  assert.equal(actor.stale, true);
  assert.equal(actor.disagreement.asOf, '2026-11-09');
});

test('excludes junior titles and prefers a plain primary title, then listing order', async () => {
  const { mergeOfficeholders } = await import('../officeholders.js');
  const leaders = [
    { title: 'Deputy Prime Minister', name: 'Junior Executive' },
    { title: 'Min. of State for Foreign Affairs', name: 'Junior Foreign' },
    { title: 'Dep. Min. of Defense', name: 'Junior Defense' },
    { title: 'Min. of Trade & Foreign Affairs', name: 'Trade First' },
    {
      title: 'Min. of Foreign Affairs & Intl. Cooperation',
      name: 'Foreign First',
    },
    { title: 'Min. of Foreign Affairs', name: 'Plain Foreign' },
    {
      title: 'Pres. of the Council of Ministers & Parliamentary Relations',
      name: 'Relations Secretary',
    },
    { title: 'Prime Min.', name: 'Listed First' },
    { title: 'Prime Minister', name: 'Listed Second' },
  ];
  const cia = await actorsOf(
    page('Bangladesh', '2026-08-06', leaders),
    'bangladesh',
  );
  assert.deepEqual(
    cia.map(({ name }) => name),
    ['Listed First', 'Listed Second', 'Foreign First', 'Plain Foreign'],
  );
  const wd = wikidata('BGD', 'Previous Executive', 'Q1', '2020-01-01', {
    role: 'head-of-government',
  });
  const merged = mergeOfficeholders([wd], cia, now);
  const head = merged.find(({ role }) => role === 'head-of-government');
  assert.equal(head.name, 'Listed First');
  assert.deepEqual(
    head.ambiguity.alternatives.map(({ name }) => name),
    ['Listed Second'],
  );
  const minister = merged.find(({ role }) => role === 'foreign-minister');
  assert.equal(minister.name, 'Plain Foreign');
  assert.equal(minister.ambiguity, undefined);
});

test('CIA name casing preserves middle regnal numerals and Gaelic capitals', async () => {
  const leaders = [
    { title: 'King', name: 'Carl XVI GUSTAF' },
    { title: 'Min. of Defense', name: 'David J. MCGUINTY' },
    { title: 'Min. of Foreign Affairs', name: 'Heath MACDONALD' },
  ];
  const cia = await actorsOf(
    page('Bangladesh', '2026-08-06', leaders),
    'bangladesh',
  );
  assert.deepEqual(
    cia.map(({ name }) => name),
    ['Carl XVI Gustaf', 'Heath MacDonald', 'David J. McGuinty'],
  );
});

test('CIA keeps cached pages and stops after three consecutive failed attempts', async () => {
  const { fetchObservations } = await import('./cia-world-leaders.js');
  const entries = ['one', 'two', 'three', 'four', 'five'].map((slug) => ({
    slug,
    country: slug,
  }));
  const requests = [];
  const data = {
    directory: { checkedAt: now.toISOString(), entries },
    pages: { one: { retained: true } },
  };
  const result = await fetchObservations({
    now,
    data,
    pause: async () => {},
    fetchImpl: async (url) => {
      requests.push(url);
      return new Response(null, { status: 500 });
    },
  });
  assert.equal(requests.length, 3);
  assert.equal(result.data.report.attemptedPages, 3);
  assert.deepEqual(result.data.pages.one, { retained: true });
  assert.equal(result.data.attempted.four, undefined);
});

test('CIA does not start another request after its run budget expires', async () => {
  const { fetchObservations } = await import('./cia-world-leaders.js');
  const entries = ['one', 'two'].map((slug) => ({ slug, country: slug }));
  let elapsed = 0;
  let calls = 0;
  const result = await fetchObservations({
    now,
    data: { directory: { checkedAt: now.toISOString(), entries } },
    monotonic: () => elapsed,
    pause: async () => {
      elapsed += 250_000;
    },
    fetchImpl: async () => {
      calls++;
      return Response.json(page('one', '2026-08-06', []));
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.count, 1);
  assert.equal(result.data.attempted.two, undefined);
});
const registry = {
  countries: [
    { iso3: 'ARG', name: 'Argentina' },
    { iso3: 'BGD', name: 'Bangladesh' },
    { iso3: 'KOR', name: 'South Korea' },
  ],
};
const indexPath =
  '/resources/world-leaders/page-data/foreign-governments/page-data.json';
const countryPath = (slug) =>
  indexPath.replace('page-data.json', slug + '/page-data.json');
const page = (country, date_updated, leaders) => ({
  result: { data: { page: { country, date_updated, leaders } } },
});
const argentina = page('Argentina', '2026-08-06 14:01:17', [
  { title: 'Pres.', name: 'Javier MILEI' },
  { title: 'Vice Pres.', name: 'Victoria VILLARRUEL' },
  {
    title: 'Min. of Foreign Affairs, Intl. Trade, & Worship',
    name: 'Pablo QUIRNO',
  },
  { title: 'Min. of Defense', name: 'Carlos PRESTI' },
]);
const bangladesh = page('Bangladesh', '2026-08-31 16:24:39', [
  { title: 'Min. of Foreign Affairs', name: 'Khalilur RAHMAN' },
  { title: 'Min. of Defense', name: '' },
]);
const southKorea = page('Korea, South', '2026-07-15 16:24:39', [
  { title: 'Min. of Foreign Affairs', name: 'CHO Hyun' },
]);
const makeFetch = (requests, bodies) => async (url) => {
  const path = new URL(url).pathname;
  requests.push(path);
  assert.ok(Object.hasOwn(bodies, path), path);
  return Response.json(bodies[path]);
};
const actorsOf = async (body, slug) => {
  const { parseCiaPage, resolveCiaPage } =
    await import('./cia-world-leaders.js');
  return resolveCiaPage(parseCiaPage(body, slug), registry);
};
const wikidata = (country, name, id, since, other = {}) => ({
  country,
  name,
  id,
  role: 'foreign-minister',
  since,
  lastChecked: '2026-11-10T06:00:00Z',
  source: 'wikidata',
  imageFile: 'portrait.jpg',
  accounts: { x: 'https://x.com/official' },
  ...other,
});

test('discovers the government list from Gatsby JSON and fetches each country once each week', async () => {
  const { fetchObservations } = await import('./cia-world-leaders.js');
  const requests = [];
  const pauses = [];
  let clock = 0;
  const options = {
    registry,
    now,
    pause: async (ms) => {
      pauses.push(ms);
      clock += ms;
    },
    monotonic: () => clock,
    fetchImpl: makeFetch(requests, {
      [indexPath]: { staticQueryHashes: ['3338022342'] },
      '/resources/world-leaders/page-data/sq/d/3338022342.json': {
        data: {
          leaders: {
            nodes: [
              { country: 'Argentina' },
              { country: 'Bangladesh' },
              { country: 'Korea, South' },
              { country: 'Argentina' },
            ],
          },
        },
      },
      [countryPath('argentina')]: argentina,
      [countryPath('bangladesh')]: bangladesh,
      [countryPath('korea-south')]: southKorea,
    }),
  };
  const first = await fetchObservations(options);
  assert.equal(first.error, undefined);
  assert.equal(first.count, 3);
  assert.equal(requests.length, 5);
  assert.equal(pauses.length, 4);
  assert.ok(pauses.every((ms) => ms > 0));
  await fetchObservations({
    ...options,
    data: first.data,
    now: new Date('2026-11-16T09:00:00Z'),
  });
  assert.equal(requests.length, 5);
  assert.equal(first.data.attempted.argentina, '2026-11-10T09:00:00.600Z');
  const indexRefresh = await fetchObservations({
    ...options,
    data: first.data,
    now: new Date('2026-11-17T09:00:00Z'),
  });
  assert.equal(requests.length, 7);
  await fetchObservations({
    ...options,
    data: indexRefresh.data,
    now: new Date('2026-11-17T09:00:02Z'),
  });
  assert.equal(requests.length, 10);
});

test('maps dated CIA titles and aliases to the appropriate country and office', async () => {
  const arg = await actorsOf(argentina, 'argentina');
  assert.deepEqual(
    arg.map(({ role, name }) => [role, name]),
    [
      ['head-of-state', 'Javier Milei'],
      ['head-of-government', 'Javier Milei'],
      ['foreign-minister', 'Pablo Quirno'],
      ['defence-minister', 'Carlos Presti'],
    ],
  );
  assert.equal(arg[0].asOf, '2026-08-06');
  assert.deepEqual(
    (await actorsOf(bangladesh, 'bangladesh')).map(({ role }) => role),
    ['foreign-minister'],
  );
  assert.equal((await actorsOf(southKorea, 'korea-south'))[0].country, 'KOR');
});

test('selects by evidence date and attaches identity only for matching country and office', async () => {
  const { mergeOfficeholders } = await import('../officeholders.js');
  const cia = [
    ...(await actorsOf(argentina, 'argentina')),
    ...(await actorsOf(southKorea, 'korea-south')),
  ];
  const old = wikidata('ARG', 'Gerardo Werthein', 'Q1', '2025-01-01', {
    lastChecked: '2025-01-01T06:00:00Z',
  });
  const newer = wikidata('KOR', 'Cho Hyun', 'Q2', '2026-08-01');
  const wrongOffice = wikidata('ARG', 'Pablo Quirno', 'Q3', '2026-07-01', {
    role: 'defence-minister',
  });
  const merged = mergeOfficeholders([old, newer, wrongOffice], cia, now);
  const arg = merged.find(
    ({ country, role }) => country === 'ARG' && role === 'foreign-minister',
  );
  assert.equal(arg.name, 'Pablo Quirno');
  assert.equal(arg.source, 'cia-world-leaders');
  assert.equal(arg.imageFile, undefined);
  assert.equal(arg.disagreement.name, 'Gerardo Werthein');
  const kor = merged.find(({ country }) => country === 'KOR');
  assert.equal(kor.id, 'Q2');
  assert.equal(kor.source, 'wikidata');
  assert.equal(kor.asOf, '2026-11-10');
  assert.equal(kor.since, '2026-08-01');
  assert.equal(kor.disagreement, undefined);
  const [ciaWins] = mergeOfficeholders(
    [newer],
    [{ ...cia.at(-1), asOf: '2026-10-10' }],
    now,
  );
  assert.equal(ciaWins.id, 'Q2');
  assert.equal(ciaWins.source, 'wikidata');
  assert.equal(ciaWins.otherEvidence[0].asOf, '2026-10-10');
  assert.equal(ciaWins.imageFile, 'portrait.jpg');
  assert.equal(ciaWins.accounts.x, 'https://x.com/official');
  const [oldOnly] = mergeOfficeholders([old], [], now);
  assert.equal(oldOnly.stale, true);
});
test('CIA surname casing preserves a Roman regnal suffix', async () => {
  const cia = page('Argentina', '2026-08-06 14:01:17', [
    { name: 'Charles WINDSOR III', title: 'King' },
  ]);
  const [actor] = await actorsOf(cia, 'argentina');
  assert.equal(actor.name, 'Charles Windsor III');
});
test('CIA maps the Swiss ministries without mislabeling the chancellor or rotating chair', async () => {
  const { parseCiaPage, resolveCiaPage } =
    await import('./cia-world-leaders.js');
  const actual = page('Switzerland', '2025-04-30 00:00:00', [
    { name: 'Karin KELLER-SUTTER', title: 'Pres., Swiss Confederation' },
    { name: 'Viktor ROSSI', title: 'Federal Chancellor' },
    {
      name: 'Ignazio CASSIS',
      title: 'Chief, Federal Dept. of Foreign Affairs',
    },
    {
      name: 'Martin PFISTER',
      title: 'Chief, Federal Dept. of Defense, Civil Protection, & Sport',
    },
  ]);
  const actors = resolveCiaPage(parseCiaPage(actual, 'switzerland'), {
    countries: [{ name: 'Switzerland', iso3: 'CHE' }],
  });
  assert.deepEqual(
    actors.map(({ role, name }) => [role, name]),
    [
      ['foreign-minister', 'Ignazio Cassis'],
      ['defence-minister', 'Martin Pfister'],
    ],
  );
});

test('CIA handles federal presidents and cabinet secretaries without matching junior portfolios', async () => {
  const actual = page('Argentina', '2026-08-06 14:01:17', [
    { name: 'Frank-Walter STEINMEIER', title: 'Fed. Pres.' },
    {
      name: 'David LAMMY',
      title: 'Sec. of State for Foreign, Commonwealth, & Development Affairs',
    },
    { name: 'John HEALEY', title: 'Sec. of State for Defense' },
    { name: 'Other HOLDER', title: 'Min. of Defense Production' },
  ]);
  const actors = await actorsOf(actual, 'argentina');
  assert.deepEqual(
    actors.map(({ role, name }) => [role, name]),
    [
      ['head-of-state', 'Frank-Walter Steinmeier'],
      ['foreign-minister', 'David Lammy'],
      ['defence-minister', 'John Healey'],
    ],
  );
});
test('newer partial San Marino evidence survives a complete stale CIA pair', async () => {
  const { mergeOfficeholders } = await import('../officeholders.js');
  const wd = [
    {
      country: 'SMR',
      role: 'head-of-state',
      name: 'Gerardo Giovagnoli',
      source: 'official',
      since: '2026-10-01',
      id: 'verified-Giovagnoli',
    },
  ];
  const cia = ['Alessandro Cardelli', 'Mirko Dolcini'].map((name) => ({
    country: 'SMR',
    role: 'head-of-state',
    source: 'cia-world-leaders',
    asOf: '2021-03-11',
    name,
  }));
  assert.deepEqual(
    mergeOfficeholders(wd, cia, now).map(({ name }) => name),
    ['Gerardo Giovagnoli'],
  );
});

test('maps captured ministry titles and excludes the distinct defence personnel office', async () => {
  const { parseCiaPage, resolveCiaPage } =
    await import('./cia-world-leaders.js');
  const examples = [
    [
      'AUS',
      'Australia',
      'Richard MARLES',
      'Min. for Defense',
      'defence-minister',
    ],
    ['AUS', 'Australia', 'Matt KEOGH', 'Min. for Defense Personnel', null],
    [
      'FRA',
      'France',
      'Catherine VAUTRIN',
      'Min. of the Armies & Veterans',
      'defence-minister',
    ],
    [
      'KEN',
      'Kenya',
      'Musalia MUDAVADI',
      'Cabinet Sec. for Foreign and Diaspora Affairs',
      'foreign-minister',
    ],
    [
      'KEN',
      'Kenya',
      'Soipan TUYA',
      'Cabinet Sec. for Defense',
      'defence-minister',
    ],
    [
      'ZAF',
      'South Africa',
      'Ronald LAMOLA',
      'Min. of Intl. Relations & Cooperation',
      'foreign-minister',
    ],
    [
      'SMR',
      'San Marino',
      'Luca BECCARI',
      'State Sec. for Foreign Affairs',
      'foreign-minister',
    ],
    [
      'AUT',
      'Austria',
      'Beate MEINL-REISINGER',
      'Min. for European & International Affairs',
      'foreign-minister',
    ],
    [
      'BIH',
      'Bosnia and Herzegovina',
      'Borjana KRIŠTO',
      'Chmn., Council of Ministers',
      'head-of-government',
    ],
    [
      'BIH',
      'Bosnia and Herzegovina',
      'Željka CVIJANOVIĆ',
      'Presidency Member (Serb)',
      'head-of-state',
    ],
    ['AND', 'Andorra', 'Xavier ESPOT', 'Head of Govt.', 'head-of-government'],
  ];
  for (const [iso3, country, name, title, role] of examples) {
    const actors = resolveCiaPage(
      parseCiaPage(page(country, '2025-10-01', [{ name, title }]), 'fixture'),
      { countries: [{ iso3, name: country }] },
    );
    assert.deepEqual(
      actors.map((actor) => actor.role),
      role ? [role] : [],
      title,
    );
  }
});
test('an executive presidency maps both roles for cited constitutional systems', async () => {
  const { parseCiaPage, resolveCiaPage } =
    await import('./cia-world-leaders.js');
  for (const [iso3, country, title] of [
    ['IDN', 'Indonesia', 'Pres.'],
    ['KEN', 'Kenya', 'Pres.'],
    ['ZAF', 'South Africa', 'Pres.'],
    ['MMR', 'Burma', 'President'],
  ]) {
    const actors = resolveCiaPage(
      parseCiaPage(
        page(country, '2026-10-13', [{ name: 'Sample EXECUTIVE', title }]),
        'fixture',
      ),
      { countries: [{ iso3, name: country }] },
    );
    assert.deepEqual(
      actors.map(({ role }) => role),
      ['head-of-state', 'head-of-government'],
      country,
    );
    assert.ok(
      actors.every(({ draft }) => /^https:\/\//.test(draft)),
      country,
    );
  }
});
test('verified Philippine and Ghana appointments supersede captured older CIA evidence until expiry', async () => {
  const { mergeOfficeholders, officialOfficeEvidence } =
    await import('../officeholders.js');
  const registry = { countries: [{ iso3: 'GHA' }, { iso3: 'PHL' }] };
  const cia = [
    {
      country: 'GHA',
      role: 'defence-minister',
      name: 'Cassiel Ato Baah Forson',
      asOf: '2025-12-15',
      source: 'cia-world-leaders',
    },
    {
      country: 'PHL',
      role: 'foreign-minister',
      name: 'Enrique Manalo',
      asOf: '2024-10-09',
      source: 'cia-world-leaders',
    },
  ];
  const shown = mergeOfficeholders(
    [],
    cia,
    now,
    [],
    officialOfficeEvidence(registry, now),
  );
  assert.deepEqual(
    shown.map(({ name }) => name),
    ['Kenneth Gilbert Adjei', 'Ma. Theresa P. Lazaro'],
  );
  assert.deepEqual(
    shown.map(({ disagreement }) => disagreement.name),
    cia.map(({ name }) => name),
  );
  assert.deepEqual(
    officialOfficeEvidence(registry, new Date('2027-02-10')),
    [],
  );
  assert.ok(
    shown.every(
      ({ reviewed, sourceUrl }) =>
        reviewed === false && /^https:\/\//.test(sourceUrl),
    ),
  );
});
test('official role records distinguish agreeing provenance from a competing holder', async () => {
  const { mergeOfficeholders } = await import('../officeholders.js');
  const role = 'foreign-minister';
  const wd = wikidata('JPN', 'Toshimitsu Motegi', 'Q1655453', '2025-10-21');
  const cia = {
    id: 'cia-jpn-iwaya',
    country: 'JPN',
    role,
    name: 'Iwaya Takeshi',
    source: 'cia-world-leaders',
    asOf: '2025-05-23',
  };
  const official = {
    id: 'official-jpn-foreign-minister',
    country: 'JPN',
    role,
    name: 'Motegi Toshimitsu',
    source: 'official',
    asOf: '2026-11-09',
  };
  const [mixed] = mergeOfficeholders([wd], [cia], now, [], [official]);
  assert.equal(mixed.disagreement.name, 'Iwaya Takeshi');
  assert.deepEqual(
    mixed.otherEvidence.map(({ name, agrees }) => [name, agrees]),
    [
      ['Iwaya Takeshi', false],
      ['Toshimitsu Motegi', true],
    ],
  );
  const [agrees] = mergeOfficeholders(
    [wd],
    [{ ...cia, name: 'Motegi Toshimitsu' }],
    now,
    [],
    [official],
  );
  assert.equal(agrees.disagreement, undefined);
  assert.ok(agrees.otherEvidence.every(({ agrees }) => agrees));
});
