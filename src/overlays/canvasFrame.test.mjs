// Canvas and window pixels: since the frame the globe's canvas is inset, so a
// Cesium point must gain the canvas's left and top to be a window point, and
// lose them the other way.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  canvasClientX,
  canvasFraction,
  canvasRect,
  canvasToClient,
  clientToCanvas,
} from './canvasFrame.js';

// Today open (340) and the top bar (52): the canvas the frame leaves at 1440.
const scene = {
  canvas: {
    clientWidth: 1100,
    clientHeight: 796,
    getBoundingClientRect: () => ({
      left: 340,
      top: 52,
      width: 1100,
      height: 796,
    }),
  },
};

test('the rectangle is the canvas in window pixels, and the origin without one', () => {
  assert.deepEqual(canvasRect(scene), {
    left: 340,
    top: 52,
    width: 1100,
    height: 796,
  });
  assert.deepEqual(canvasRect(null), { left: 0, top: 0, width: 0, height: 0 });
});

test('canvas and window points convert both ways', () => {
  assert.deepEqual(canvasToClient(scene, { x: 10, y: 20 }), { x: 350, y: 72 });
  assert.deepEqual(clientToCanvas(scene, 350, 72), { x: 10, y: 20 });
  assert.deepEqual(canvasToClient({}, { x: 10, y: 20 }), { x: 10, y: 20 });
});

test('the fraction across the canvas starts at its left edge, not the window’s', () => {
  assert.equal(canvasFraction(scene, 340), 0);
  assert.equal(canvasFraction(scene, 890), 0.5);
  assert.equal(canvasFraction(scene, 1440), 1);
  assert.equal(canvasClientX(scene, 0.5), 890);
  assert.equal(canvasFraction({ canvas: { clientWidth: 0 } }, 10), null);
  assert.equal(canvasFraction(scene, NaN), null);
});

test('it is a leaf: it imports nothing', () => {
  const source = readFileSync(new URL('./canvasFrame.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);
});
