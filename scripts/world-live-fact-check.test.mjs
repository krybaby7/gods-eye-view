import test from 'node:test';
import assert from 'node:assert/strict';
import live from './world-fact-checks/live.mjs';

test('GDELT board proof fails honestly without a current sample and retains old flag status', async () => {
  const rows = await live({
    board: {
      features: {
        'live-gdelt': {
          lastGoodAt: null,
          sampledFiles: 0,
          flags: [
            {
              iso3: 'CAN',
              status: 'no recent data',
              sourceDomains: ['example.org'],
            },
          ],
        },
      },
    },
  });
  const actual = rows.find(({ id }) => id === 'live-gdelt-api');
  assert.ok(actual);
  assert.equal(actual.pass, false);
  assert.equal(actual.found.flags[0].status, 'no recent data');
  assert.deepEqual(actual.found.flags[0].sourceDomains, ['example.org']);
});

test('GDELT API proof rejects an expired qualifying flag and a one-report flagged country', async () => {
  const now = new Date();
  const old = new Date(+now - 73 * 3600_000).toISOString();
  const fresh = now.toISOString();
  const flag = {
    iso3: 'CAN',
    slot: 'C2',
    status: 'active',
    date: old,
    periodStart: old,
    eventCount: 5,
    sourceDomains: ['a.test', 'b.test', 'c.test'],
    sourceUrls: ['https://a.test/', 'https://b.test/', 'https://c.test/'],
    evidence: 'news-derived, low confidence',
  };
  const board = {
    features: {
      'live-gdelt': {
        lastGoodAt: fresh,
        sampledFiles: 1,
        flags: [flag],
        batches: [{ date: fresh, events: [['1', 'CAN']] }],
      },
    },
  };
  let proof = (await live({ board })).find(({ id }) => id === 'live-gdelt-api');
  assert.equal(proof.pass, false);
  flag.date = flag.periodStart = fresh;
  proof = (await live({ board })).find(({ id }) => id === 'live-gdelt-api');
  assert.equal(proof.found.namedCountrySampleCounts.CAN, 1);
  assert.equal(proof.pass, false);
});
