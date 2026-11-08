import { newsMapMode } from '../news/hotspots.js';

const RAMP = [
  [194, 65, 12],
  [240, 140, 58],
  [217, 197, 143],
  [74, 168, 216],
  [29, 111, 209],
];

export function boardMapMode(height, previous) {
  const mode = newsMapMode(height, previous === 'board' ? 'bubbles' : 'pins');
  return mode === 'bubbles' ? 'board' : 'detail';
}

export function lensValue(country, lens, area, year) {
  if (!country || country.kind === 'disputed') return null;
  if (lens === 'strength') return country.slots?.[area]?.score ?? null;
  if (lens === 'data-age') {
    if (!Number.isFinite(country.dataAge)) return null;
    return 100 * (1 - Math.min(8, Math.max(0, year - country.dataAge)) / 8);
  }
  return country.condition?.score ?? null;
}

export function scoreColor(score) {
  const position = Math.max(0, Math.min(100, score)) / 25;
  const index = Math.min(RAMP.length - 2, Math.floor(position));
  return RAMP[index].map((value, channel) =>
    Math.round(value + (RAMP[index + 1][channel] - value) * (position - index)),
  );
}

export function worldPickId(id) {
  return /^world:([A-Z]{3}):/.exec(id || '')?.[1] ?? null;
}

/** The pack includes the whole UK as well as its four overlapping parts. */
export function renderShapeIds({ iso3, shapeIds }) {
  return iso3 === 'GBR' && shapeIds.includes('GBR') ? ['GBR'] : shapeIds;
}
