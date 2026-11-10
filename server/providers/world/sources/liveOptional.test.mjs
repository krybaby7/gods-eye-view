import assert from 'node:assert/strict';
import test from 'node:test';
import {
  optionalLiveSources,
  optionalLiveSourcesFromEnv,
} from './liveOptional.js';

const now = new Date('2026-11-09T00:00:00Z');
const registry = { countries: [{ iso3: 'IND', name: 'India' }] };
const context = { now, registry };

test('optional UCDP waits for country coverage in the completed month before clearing', async () => {
  const adapter = optionalLiveSources({
    candidate: {
      endpoint: 'https://api.ucdp.uu.se/candidate',
      token: 'fixture-token',
    },
  })['live-ucdp-token'];
  const load = (now, date, best, data) =>
    adapter.fetchObservations({
      ...context,
      now: new Date(now),
      data,
      fetchImpl: () =>
        Response.json({
          Result: [{ id: 1, country: 'India', date_start: date, best }],
        }),
    });
  const flagged = await load('2026-11-30', '2026-10-10', 25);
  assert.equal(flagged.data.flags.length, 1);
  const unpublished = await load('2026-12-01', '2026-10-10', 25, flagged.data);
  assert.deepEqual(unpublished.changes, []);
  assert.equal(unpublished.data.inactiveFlags[0].status, 'no-recent-data');
  const published = await load('2026-12-10', '2026-11-10', 1, unpublished.data);
  assert.equal(published.changes[0].action, 'cleared');
  assert.equal(published.data.inactiveFlags[0].status, 'cleared');
});

test('all optional feeds are dormant with default configuration', () => {
  const adapters = optionalLiveSources();
  assert.equal(Object.keys(adapters).length, 4);
  for (const adapter of Object.values(adapters))
    assert.equal(adapter.shouldCheck(context), false);
});

test('optional server configuration stays dormant by default and keeps credentials out of errors', async () => {
  const dormant = optionalLiveSourcesFromEnv({
    GEV_WORLD_IODA_LICENCE_APPROVED: '0',
    GEV_WORLD_ELECTIONGUIDE_ENDPOINT: 'https://example.org/elections/',
    GEV_WORLD_ELECTIONGUIDE_TOKEN: 'fixture-private',
  });
  assert(
    Object.values(dormant).every(
      (adapter) => !adapter.live && !adapter.shouldCheck(context),
    ),
  );
  const configured = optionalLiveSourcesFromEnv({
    GEV_WORLD_ELECTIONGUIDE_ENDPOINT:
      'https://www.electionguide.org/elections/?page=1',
    GEV_WORLD_ELECTIONGUIDE_TOKEN: 'fixture-private',
    GEV_WORLD_HDX_APP_IDENTIFIER: 'fixture-private',
    GEV_WORLD_IODA_LICENCE_APPROVED: '1',
    GEV_WORLD_UCDP_CANDIDATE_ENDPOINT: 'https://api.ucdp.uu.se/candidate',
    GEV_WORLD_UCDP_CANDIDATE_TOKEN: 'fixture-private',
  });
  assert(
    Object.values(configured).every(
      (adapter) => adapter.live && adapter.shouldCheck(context),
    ),
  );
  await assert.rejects(
    configured['live-electionguide'].fetchObservations({
      ...context,
      fetchImpl: async () => {
        throw new Error('fixture-private');
      },
    }),
    (error) => !error.message.includes('fixture-private'),
  );
});

test('optional adapters parse licensed fixtures through their own explicit configuration', async () => {
  const adapters = optionalLiveSources({
    electionguide: {
      endpoint: 'https://www.electionguide.org/api/elections/',
      token: 'fixture-token',
    },
    hdx: { appIdentifier: 'fixture+id/=' },
    ioda: { licenceApproved: true },
    candidate: {
      endpoint: 'https://ucdpapi.pcr.uu.se/api/gedeventscandidate/26.0.10',
      token: 'fixture-token',
    },
  });
  const fixtures = {
    'live-electionguide': {
      results: [{ country_iso3: 'IND', election_date: '2026-11-21' }],
    },
    'live-ioda': {
      data: [
        {
          entityType: 'country',
          entityCode: 'IN',
          time: 1794181800,
          duration: 7200,
        },
      ],
    },
    'live-ucdp-token': {
      Result: [
        { id: 1, country: 'India', date_start: '2026-10-10', best: 24 },
        { id: 2, country: 'India', date_start: '2026-10-10', best: 1 },
        { id: 2, country: 'India', date_start: '2026-10-10', best: 1 },
      ],
    },
  };
  const expected = {
    'live-electionguide': 'Election within 30 days',
    'live-hdx': 'IPC Phase 4+',
    'live-ioda': 'Country-level internet outage signal',
    'live-ucdp-token': 'UCDP Candidate recorded fatalities',
  };
  for (const [id, adapter] of Object.entries(adapters)) {
    assert.equal(adapter.shouldCheck(context), true, id);
    const result = await adapter.fetchObservations({
      ...context,
      fetchImpl: async (url, options) => {
        if (id === 'live-hdx') {
          const { pathname, searchParams } = new URL(url);
          assert(
            [
              '/api/v2/food-security-nutrition-poverty/food-security',
              '/api/v2/food-security-nutrition-poverty/food-prices-market-monitor',
            ].includes(pathname),
          );
          assert.equal(searchParams.get('app_identifier'), 'fixture+id/=');
          assert.equal(searchParams.get('start_date'), '2026-05-13');
          assert.equal(searchParams.get('output_format'), 'json');
          assert.equal(options.redirect, 'error');
          assert.equal(
            options.headers?.['X-HDX-HAPI-APP-IDENTIFIER'],
            undefined,
          );
          return Response.json({
            data: pathname.endsWith('/food-security')
              ? [
                  {
                    location_code: 'IND',
                    ipc_phase: '4',
                    population_in_phase: 2500,
                    reference_period_start: '2026-11-01',
                    reference_period_end: '2026-12-01',
                  },
                ]
              : [
                  {
                    location_code: 'IND',
                    market_code: 'M01',
                    commodity_code: 'rice',
                    currency_code: 'INR',
                    unit: 'kg',
                    price_type: 'Retail',
                    price: 10,
                    reference_period_start: '2026-07-01',
                  },
                  {
                    location_code: 'IND',
                    market_code: 'M01',
                    commodity_code: 'rice',
                    currency_code: 'INR',
                    unit: 'kg',
                    price_type: 'Retail',
                    price: 15,
                    reference_period_start: '2026-10-01',
                  },
                ],
          });
        }
        if (id === 'live-ioda') {
          return Response.json({
            data: [
              {
                entityType: 'country',
                entityCode: 'IN',
                time: +now / 1000 - 3600,
                duration: 7200,
              },
            ],
          });
        }
        return Response.json(fixtures[id]);
      },
    });
    assert(
      result.data.flags.some(({ label }) => label.includes(expected[id])),
      id,
    );
    if (id === 'live-hdx')
      assert(
        result.data.flags.some(({ label }) => label.includes('market price')),
      );
    assert.equal(result.observations, undefined);
  }
});

test('HAPI suppresses an identifier echoed by a transport or malformed response', async () => {
  const appIdentifier = 'fixture+id/=';
  const adapter = optionalLiveSources({ hdx: { appIdentifier } })['live-hdx'];
  for (const fetchImpl of [
    async (url) => {
      throw new Error(url);
    },
    async () => new Response(appIdentifier),
  ]) {
    await assert.rejects(
      adapter.fetchObservations({ ...context, fetchImpl }),
      (error) => {
        assert.doesNotMatch(error.message, /fixture|app_identifier/i);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});
