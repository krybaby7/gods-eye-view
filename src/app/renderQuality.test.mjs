import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRenderQuality, installRenderQuality } from './renderQuality.js';

function fixture(devicePixelRatio = 2) {
  const listeners = new Map();
  const queries = [];
  let destroyed = false;
  let resizeCalls = 0;
  let renderCalls = 0;
  const windowRef = {
    devicePixelRatio,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type) {
      for (const listener of [...(listeners.get(type) || [])]) listener();
    },
    matchMedia(media) {
      const handlers = new Set();
      const query = {
        media,
        addEventListener(type, listener) {
          assert.equal(type, 'change');
          handlers.add(listener);
        },
        removeEventListener(type, listener) {
          assert.equal(type, 'change');
          handlers.delete(listener);
        },
        emit() {
          for (const listener of [...handlers]) listener();
        },
        get listenerCount() {
          return handlers.size;
        },
      };
      queries.push(query);
      return query;
    },
  };
  const viewer = {
    useBrowserRecommendedResolution: true,
    resolutionScale: 0.75,
    isDestroyed: () => destroyed,
    resize() {
      assert.equal(destroyed, false);
      resizeCalls++;
    },
    scene: {
      requestRender() {
        assert.equal(destroyed, false);
        renderCalls++;
      },
    },
  };
  return {
    viewer,
    windowRef,
    listeners,
    queries,
    destroy: () => {
      destroyed = true;
    },
    get resizeCalls() {
      return resizeCalls;
    },
    get renderCalls() {
      return renderCalls;
    },
  };
}

for (const dpr of [1, 2, 3]) {
  test(`standard quality uses CSS pixels on DPR ${dpr}`, () => {
    const f = fixture(dpr);
    assert.equal(applyRenderQuality(f.viewer, 'standard', dpr), 1);
    assert.equal(f.viewer.useBrowserRecommendedResolution, true);
    assert.equal(f.viewer.resolutionScale, 1);
    assert.equal(f.resizeCalls, 1);
    assert.equal(f.renderCalls, 1);
  });

  test(`sharp quality uses device pixels capped at 2x on DPR ${dpr}`, () => {
    const f = fixture(dpr);
    assert.equal(applyRenderQuality(f.viewer, 'sharp', dpr), Math.min(dpr, 2));
    assert.equal(f.viewer.useBrowserRecommendedResolution, false);
    assert.equal(f.viewer.resolutionScale, Math.min(1, 2 / dpr));
    // Cesium multiplies DPR by resolutionScale in device-pixel mode.
    assert.equal(dpr * f.viewer.resolutionScale, Math.min(dpr, 2));
  });
}

test('sharp quality safely falls back to CSS pixels for invalid DPR', () => {
  for (const dpr of [undefined, null, 0, -1, NaN, Infinity, '2']) {
    const f = fixture(dpr);
    assert.equal(applyRenderQuality(f.viewer, 'sharp', dpr), 1);
    assert.equal(f.viewer.useBrowserRecommendedResolution, true);
    assert.equal(f.viewer.resolutionScale, 1);
  }
});

test('unknown quality is rejected before mutating viewer properties', () => {
  const f = fixture();
  assert.throws(() => applyRenderQuality(f.viewer, 'ultra', 2), /quality/i);
  assert.equal(f.viewer.useBrowserRecommendedResolution, true);
  assert.equal(f.viewer.resolutionScale, 0.75);
  assert.equal(f.resizeCalls, 0);
});

test('quality can switch at runtime and starts sharp by default', () => {
  const f = fixture(3);
  const quality = installRenderQuality(f.viewer, { windowRef: f.windowRef });
  assert.equal(quality.getQuality(), 'sharp');
  assert.equal(f.viewer.resolutionScale, 2 / 3);
  quality.setQuality('standard');
  assert.equal(quality.getQuality(), 'standard');
  assert.equal(f.viewer.useBrowserRecommendedResolution, true);
  assert.equal(f.viewer.resolutionScale, 1);
  quality.setQuality('sharp');
  assert.equal(quality.getQuality(), 'sharp');
  assert.equal(f.viewer.useBrowserRecommendedResolution, false);
  assert.equal(f.viewer.resolutionScale, 2 / 3);
  quality.dispose();
});

test('resize reapplies the DPR cap and requests an updated render', () => {
  const f = fixture(2);
  const quality = installRenderQuality(f.viewer, { windowRef: f.windowRef });
  f.windowRef.devicePixelRatio = 3;
  f.windowRef.emit('resize');
  assert.equal(f.viewer.resolutionScale, 2 / 3);
  assert.equal(f.resizeCalls, 2);
  assert.equal(f.renderCalls, 2);
  f.windowRef.devicePixelRatio = 1;
  f.windowRef.emit('resize');
  assert.equal(f.viewer.resolutionScale, 1);
  quality.dispose();
});

test('DPR media changes reapply the cap without a window resize and rearm the watcher', () => {
  const f = fixture(2);
  const quality = installRenderQuality(f.viewer, { windowRef: f.windowRef });
  assert.equal(f.queries.length, 1);
  const first = f.queries.at(-1);
  assert.equal(first.media, '(resolution: 2dppx)');
  assert.equal(first.listenerCount, 1);
  f.windowRef.devicePixelRatio = 3;
  first.emit();
  assert.equal(f.viewer.resolutionScale, 2 / 3);
  assert.equal(first.listenerCount, 0);
  assert.equal(f.queries.at(-1).media, '(resolution: 3dppx)');
  assert.equal(f.queries.at(-1).listenerCount, 1);
  quality.dispose();
});

test('disposal removes listeners, restores original live settings, and prevents later writes', () => {
  const f = fixture(3);
  const quality = installRenderQuality(f.viewer, { windowRef: f.windowRef });
  assert.equal(f.listeners.get('resize')?.size, 1);
  quality.dispose();
  quality.dispose();
  assert.equal(f.listeners.get('resize').size, 0);
  assert.ok(f.queries.every((query) => query.listenerCount === 0));
  assert.equal(f.viewer.useBrowserRecommendedResolution, true);
  assert.equal(f.viewer.resolutionScale, 0.75);
  const renders = f.renderCalls;
  f.windowRef.devicePixelRatio = 1;
  f.windowRef.emit('resize');
  f.queries[0].emit();
  quality.setQuality('standard');
  assert.equal(f.viewer.resolutionScale, 0.75);
  assert.equal(f.renderCalls, renders);
});

test('disposal preserves later external render configuration', () => {
  const f = fixture(3);
  const quality = installRenderQuality(f.viewer, { windowRef: f.windowRef });
  f.viewer.resolutionScale = 0.5;
  quality.dispose();
  assert.equal(f.viewer.useBrowserRecommendedResolution, false);
  assert.equal(f.viewer.resolutionScale, 0.5);
});

test('resize and disposal avoid touching a destroyed viewer', () => {
  const f = fixture();
  const quality = installRenderQuality(f.viewer, { windowRef: f.windowRef });
  assert.equal(f.queries.length, 1);
  const renders = f.renderCalls;
  f.destroy();
  f.windowRef.devicePixelRatio = 3;
  f.windowRef.emit('resize');
  f.queries[0].emit();
  quality.setQuality('standard');
  quality.dispose();
  assert.equal(f.renderCalls, renders);
  assert.equal(f.viewer.resolutionScale, 1);
  assert.equal(f.listeners.get('resize').size, 0);
  assert.ok(f.queries.every((query) => query.listenerCount === 0));
});

test('quality works without matchMedia or browser globals', () => {
  const f = fixture();
  delete f.windowRef.matchMedia;
  const quality = installRenderQuality(f.viewer, { windowRef: f.windowRef });
  assert.equal(f.viewer.useBrowserRecommendedResolution, false);
  quality.dispose();
  const headless = installRenderQuality(f.viewer, { windowRef: undefined });
  assert.equal(f.viewer.useBrowserRecommendedResolution, true);
  assert.equal(f.viewer.resolutionScale, 1);
  headless.dispose();
});

test('a failed DPR media query still leaves resize updates available', () => {
  const f = fixture(2);
  f.windowRef.matchMedia = () => {
    throw new Error('unsupported resolution query');
  };
  const quality = installRenderQuality(f.viewer, { windowRef: f.windowRef });
  assert.equal(f.viewer.resolutionScale, 1);
  f.windowRef.devicePixelRatio = 3;
  f.windowRef.emit('resize');
  assert.equal(f.viewer.resolutionScale, 2 / 3);
  quality.dispose();
});
