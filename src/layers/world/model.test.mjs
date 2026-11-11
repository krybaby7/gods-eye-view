import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boardMapMode,
  lensValue,
  renderShapeIds,
  scoreColor,
  worldPickId,
} from './model.js';

test('board zoom uses the hotspot dead band', () => {
  assert.equal(boardMapMode(3_500_001, 'detail'), 'board');
  assert.equal(boardMapMode(3_250_000, 'board'), 'board');
  assert.equal(boardMapMode(3_250_000, 'detail'), 'detail');
  assert.equal(boardMapMode(2_999_999, 'board'), 'detail');
  assert.equal(boardMapMode(NaN, 'board'), 'board');
});

test('three lenses read their own values and preserve a score of zero', () => {
  const country = {
    kind: 'state',
    condition: { score: 0 },
    slots: { S2: { score: 38 } },
    dataAge: 2022,
  };
  assert.equal(lensValue(country, 'condition', 'S2', 2026), 0);
  assert.equal(lensValue(country, 'strength', 'S2', 2026), 38);
  assert.equal(lensValue(country, 'strength', 'S3', 2026), null);
  assert.equal(lensValue(country, 'data-age', 'S2', 2026), 50);
  assert.equal(lensValue({ ...country, kind: 'disputed' }, 'condition'), null);
  assert.equal(lensValue(null, 'condition'), null);
});

test('the ramp retains its fixed stops and interpolates between them', () => {
  assert.deepEqual(scoreColor(0), [194, 65, 12]);
  assert.deepEqual(scoreColor(25), [240, 140, 58]);
  assert.deepEqual(scoreColor(50), [217, 197, 143]);
  assert.deepEqual(scoreColor(75), [74, 168, 216]);
  assert.deepEqual(scoreColor(100), [29, 111, 209]);
  assert.deepEqual(scoreColor(12.5), [217, 103, 35]);
});

test('all board picks route to a country rather than a polygon part', () => {
  assert.equal(worldPickId('world:GBR:SCT:0'), 'GBR');
  assert.equal(worldPickId('world:GBR:label'), 'GBR');
  assert.equal(worldPickId('news:GBR'), null);
});

test('a complete UK outline replaces its overlapping constituent outlines', () => {
  assert.deepEqual(
    renderShapeIds({
      iso3: 'GBR',
      shapeIds: ['GBR', 'SCT', 'WLS', 'ENG', 'NIR'],
    }),
    ['GBR'],
  );
  assert.deepEqual(renderShapeIds({ iso3: 'GBR', shapeIds: ['SCT', 'WLS'] }), [
    'SCT',
    'WLS',
  ]);
  assert.deepEqual(renderShapeIds({ iso3: 'PSE', shapeIds: ['PSX'] }), ['PSX']);
});
