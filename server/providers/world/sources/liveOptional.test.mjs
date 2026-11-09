import assert from 'node:assert/strict';
import test from 'node:test';
import { optionalLiveSources } from './liveOptional.js';

const now = new Date('2026-11-09T00:00:00Z');
const registry = { countries: [{ iso3: 'IND', name: 'India' }] };
const context = { now, registry };

test('all optional feeds are dormant with default configuration', () => {
  const adapters = optionalLiveSources();
  assert.equal(Object.keys(adapters).length, 4);
  for (const adapter of Object.values(adapters))
    assert.equal(adapter.shouldCheck(context), false);
});

test('optional adapters parse licensed fixtures through their own explicit configuration', async () => {
  const adapters = optionalLiveSources({
    electionguide: {
      endpoint: 'https://www.electionguide.org/api/elections/',
      token: 'fixture-token',
    },
    hdx: { appIdentifier: 'fixture-identifier' },
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
      Result: [{ id: 1, country: 'India', date_start: '2026-10-10', best: 5 }],
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
          assert.equal(
            options.headers['X-HDX-HAPI-APP-IDENTIFIER'],
            'fixture-identifier',
          );
          return Response.json({
            data: new URL(url).pathname.endsWith('/food-security')
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
