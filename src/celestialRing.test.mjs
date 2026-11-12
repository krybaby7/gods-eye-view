// The optional sun and moon ring. Its keyhole geometry now lives in
// keyholeGeometry.js (tests in keyholeGeometry.test.mjs), so the ring can stay
// off, or later go, without touching detection or the layers that share it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ring from './celestialRing.js';

const SRC = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return /\.js$/.test(name) ? [absolute] : [];
  });
}

test('celestial ring is available only in Normal style', () => {
  assert.equal(ring.isCelestialRingStyleSupported('normal'), true);
  for (const style of ['retro', 'surveillance', 'thermal', 'anime', 'noir', 'snow']) {
    assert.equal(ring.isCelestialRingStyleSupported(style), false);
  }
});

test('the ring module no longer owns the shared keyhole geometry', () => {
  for (const name of [
    'getKeyholeGeometry',
    'keyholeLabelAlphaFromGeometry',
    'getKeyholeFadeTuning',
    'projectEarthDiscToViewport',
    'KEYHOLE_OUTER_RADIUS',
  ]) {
    assert.equal(Object.hasOwn(ring, name), false, `${name} belongs to keyholeGeometry.js`);
  }
});

test('only the ring and its composition import the ring module', () => {
  const importers = sourceFiles(SRC)
    .filter((file) => /from '[./]+celestialRing\.js'/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
    .sort();
  assert.deepEqual(importers, ['ui/composition.js']);
});
