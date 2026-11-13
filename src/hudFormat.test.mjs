// The status line's readouts in the mock's form (roadmap Appendix D), and the
// carry that keeps a minute from ever printing as 60.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatDegreesMinutes,
  formatEyeAltitude,
  formatLatLon,
  formatUtcClock,
} from './hudFormat.js';

test('coordinates read in degrees and minutes, as the mock writes them', () => {
  assert.equal(formatLatLon(22, 80), "22°00'N 080°00'E");
  assert.equal(formatLatLon(-33.8568, 151.2153), "33°51'S 151°13'E");
  assert.equal(formatLatLon(51.5072, -0.1275), "51°30'N 000°08'W");
  assert.equal(formatDegreesMinutes(NaN, 'lat'), '');
});

test('a value just under the next degree carries instead of printing 60', () => {
  assert.equal(formatDegreesMinutes(29.9999, 'lat'), "30°00'N");
  assert.equal(formatDegreesMinutes(-0.99999, 'lon'), "001°00'W");
  assert.equal(formatDegreesMinutes(179.99999, 'lon'), "180°00'E");
  for (let i = 0; i < 2000; i += 1) {
    const value = -180 + i * 0.18 + 0.0083;
    assert.doesNotMatch(formatDegreesMinutes(value, 'lon'), /°60'/);
  }
});

test('a hair west of the meridian that rounds to zero is not a negative zero', () => {
  assert.equal(formatDegreesMinutes(-0.001, 'lon'), "000°00'E");
});

test('eye altitude reads in kilometres from 1 km up, grouped like the mock', () => {
  assert.equal(formatEyeAltitude(9_000_000), 'Eye altitude 9,000 km');
  assert.equal(formatEyeAltitude(12_345), 'Eye altitude 12 km');
  assert.equal(formatEyeAltitude(999.4), 'Eye altitude 999 m');
  assert.equal(formatEyeAltitude(999.6), 'Eye altitude 1 km');
  assert.equal(formatEyeAltitude(-15), 'Eye altitude -15 m');
  assert.equal(formatEyeAltitude(NaN), '');
});

test('the clock is hours and minutes in UTC', () => {
  assert.equal(formatUtcClock(new Date('2026-11-13T18:02:59Z')), '18:02 UTC');
  assert.equal(formatUtcClock(new Date('2026-11-13T00:00:00Z')), '00:00 UTC');
  assert.equal(formatUtcClock(new Date(NaN)), '');
});
