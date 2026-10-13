function validateQuality(quality) {
  if (quality !== 'standard' && quality !== 'sharp')
    throw new TypeError('Render quality must be standard or sharp');
}

function isDestroyed(viewer) {
  return typeof viewer.isDestroyed === 'function' && viewer.isDestroyed();
}

function refreshViewer(viewer) {
  viewer.resize?.();
  viewer.scene?.requestRender?.();
}

/** Apply CSS-pixel or bounded device-pixel rendering and return its pixel ratio. */
export function applyRenderQuality(
  viewer,
  quality,
  devicePixelRatio = globalThis.window?.devicePixelRatio,
) {
  validateQuality(quality);
  if (!viewer || typeof viewer !== 'object')
    throw new TypeError('A Cesium viewer is required');
  if (isDestroyed(viewer)) return;
  const useDevicePixels =
    quality === 'sharp' &&
    Number.isFinite(devicePixelRatio) &&
    devicePixelRatio > 0;
  // Cesium already multiplies resolutionScale by DPR in device-pixel mode.
  viewer.resolutionScale = useDevicePixels
    ? Math.min(1, 2 / devicePixelRatio)
    : 1;
  viewer.useBrowserRecommendedResolution = !useDevicePixels;
  refreshViewer(viewer);
  return useDevicePixels ? Math.min(devicePixelRatio, 2) : 1;
}

/** Apply quality now and on DPR changes; return runtime controls and a disposer. */
export function installRenderQuality(
  viewer,
  { quality = 'sharp', windowRef = globalThis.window } = {},
) {
  validateQuality(quality);
  if (!viewer || typeof viewer !== 'object')
    throw new TypeError('A Cesium viewer is required');
  const original = {
    recommended: viewer.useBrowserRecommendedResolution,
    scale: viewer.resolutionScale,
  };
  let currentQuality = quality;
  let active = true;
  let lastApplied;
  let watchedDpr;
  let removeDprListener = () => {};

  const watchDpr = () => {
    const dpr = windowRef?.devicePixelRatio;
    if (watchedDpr === dpr) return;
    removeDprListener();
    removeDprListener = () => {};
    watchedDpr = dpr;
    if (!Number.isFinite(dpr) || dpr <= 0 || !windowRef?.matchMedia) return;
    try {
      const query = windowRef.matchMedia(`(resolution: ${dpr}dppx)`);
      query.addEventListener('change', update);
      removeDprListener = () => query.removeEventListener('change', update);
    } catch {
      // Window resize still updates the cap where resolution queries fail.
    }
  };
  const update = () => {
    if (!active || isDestroyed(viewer)) return;
    applyRenderQuality(viewer, currentQuality, windowRef?.devicePixelRatio);
    lastApplied = {
      recommended: viewer.useBrowserRecommendedResolution,
      scale: viewer.resolutionScale,
    };
    watchDpr();
  };
  update();
  windowRef?.addEventListener?.('resize', update);

  return {
    getQuality: () => currentQuality,
    setQuality(nextQuality) {
      if (!active) return;
      validateQuality(nextQuality);
      currentQuality = nextQuality;
      update();
    },
    dispose() {
      if (!active) return;
      active = false;
      windowRef?.removeEventListener?.('resize', update);
      removeDprListener();
      if (
        !isDestroyed(viewer) &&
        lastApplied &&
        viewer.useBrowserRecommendedResolution === lastApplied.recommended &&
        viewer.resolutionScale === lastApplied.scale
      ) {
        viewer.resolutionScale = original.scale;
        viewer.useBrowserRecommendedResolution = original.recommended;
        refreshViewer(viewer);
      }
    },
  };
}
