// The top bar's gauges: code owns the numbers, a gauge whose data is not held
// is left out (never zero), and each one names its period and source.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeAlerts,
  dayLabel,
  formatChange,
  frameDate,
  monthLabel,
  refreshedLabel,
  worldGauges,
} from './frameGauges.js';

test('dates read the way the mock writes them', () => {
  assert.equal(frameDate(new Date(2026, 10, 13)), 'Fri 13 Nov 2026');
  assert.equal(frameDate(new Date(NaN)), '');
  assert.equal(monthLabel('2026-10'), 'Oct 2026');
  assert.equal(monthLabel('2026-13'), null);
  assert.equal(dayLabel('2026-11-11T23:30:00Z'), '11 Nov');
  assert.equal(dayLabel(undefined), null);
  assert.equal(
    refreshedLabel({ endedAt: '2026-11-11T18:00:00Z' }),
    'Refreshed 11 Nov',
  );
  assert.equal(refreshedLabel(null), null);
});

test('changes carry a sign and a true minus', () => {
  assert.equal(formatChange(8.64), '+8.6%');
  assert.equal(formatChange(-1.26), '−1.3%');
  assert.equal(formatChange(0.01), '0.0%');
  assert.equal(formatChange(NaN), null);
});

test('an empty board shows no gauges at all', () => {
  assert.deepEqual(worldGauges(null), []);
  assert.deepEqual(worldGauges({ features: {} }), []);
});

test('oil shows the last month, its source, and a change only between adjacent months', () => {
  const [oil] = worldGauges({
    features: {
      fred: {
        series: {
          MCOILBRENTEU: [
            { month: '2026-09', value: 100 },
            { month: '2026-10', value: 108.6 },
          ],
        },
      },
    },
  });
  assert.equal(oil.id, 'oil');
  assert.equal(oil.value, '$108.60');
  assert.equal(oil.change, '+8.6%');
  assert.equal(oil.caption, 'Brent crude · Oct 2026 · FRED');
  const [gap] = worldGauges({
    features: {
      fred: {
        series: {
          MCOILBRENTEU: [
            { month: '2026-07', value: 100 },
            { month: '2026-10', value: 108.6 },
          ],
        },
      },
    },
  });
  assert.equal(gap.change, null, 'a gap in the months is no monthly change');
});

test('food reads the FAO banner with its month', () => {
  const [food] = worldGauges({
    features: {
      'live-fao': { banner: { date: '2026-10', value: 127.44, change: -0.4 } },
    },
  });
  assert.equal(food.value, '127.4');
  assert.equal(food.change, '−0.4%');
  assert.equal(food.caption, 'Food price index · Oct 2026 · FAO');
});

test('alerts count live flags not cleared, and are unknown without a live feed', () => {
  const turn = { endedAt: '2026-11-11T18:00:00Z' };
  assert.deepEqual(
    worldGauges({ turn, features: { fred: { flags: [{ iso3: 'FRA' }] } } }),
    [],
    'no live feed on record: the count is unknown, so not shown',
  );
  const features = {
    'live-a': {
      flags: [
        { iso3: 'SDN' },
        { iso3: 'SDN' },
        { iso3: 'MLI', status: 'cleared' },
        { iso3: 'YEM', sourceId: 'live-ucdp-saved' },
        { iso3: 'UKR', sourceId: 'live-ucdp-saved', recordedDeaths: 3 },
      ],
    },
  };
  assert.equal(activeAlerts(features).length, 3);
  const [alerts] = worldGauges({ turn, features });
  assert.equal(alerts.value, '3');
  assert.equal(alerts.caption, 'in 2 countries · 11 Nov');
  assert.deepEqual(
    worldGauges({ features }),
    [],
    'no turn, no date, not shown',
  );
});
