/**
 * Where the app's chrome sits on screen, for text Cesium draws on the globe.
 *
 * The World Board's country codes are billboards in the WebGL canvas, under
 * every panel. The panels are translucent glass, so a code under an open panel
 * showed through it and read as drawn across it. Stacking cannot fix that from
 * the canvas side; hiding a code while its box sits under chrome does.
 *
 * Measurement is throttled and only runs from a rendered frame, so a parked
 * camera costs nothing; the revision tells a caller when the chrome moved.
 */

/** Chrome a globe code must not show through. Rail panels are listed one by one. */
export const PANEL_COVER_SELECTORS = Object.freeze([
  '#title-bar',
  '#top-center-actions',
  '#left-panel-stack > [data-panel-id]',
  '#right-context-rail > [data-panel-id]',
  '.world-board-hud:not(#world-hover)',
  '#command-dock',
  '#globe-navigation',
  '#cesium-credits',
  '#intel-hud.active .hud-status',
  '#cockpit-context',
  '#cockpit-signal-stream',
]);

/** Minimum interval between two measurements of the chrome. */
export const PANEL_COVER_REFRESH_MS = 200;

/**
 * Whether a box centred on (x, y) with the given half-size overlaps any rect.
 * @param {number} x
 * @param {number} y
 * @param {{left:number,top:number,right:number,bottom:number}[]} rects
 * @param {number} [halfWidth=0]
 * @param {number} [halfHeight=0]
 * @returns {boolean}
 */
export function boxUnderRects(x, y, rects, halfWidth = 0, halfHeight = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  for (const rect of rects) {
    if (
      x + halfWidth > rect.left &&
      x - halfWidth < rect.right &&
      y + halfHeight > rect.top &&
      y - halfHeight < rect.bottom
    )
      return true;
  }
  return false;
}

function isShown(element) {
  if (!element || element.hidden) return false;
  if (typeof element.checkVisibility === 'function') {
    return (
      element.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
      }) !== false
    );
  }
  return true;
}

/**
 * @param {object} [options]
 * @param {Document} [options.documentRef]
 * @param {() => number} [options.now]
 * @param {number} [options.refreshMs]
 */
export function createPanelCover({
  documentRef = globalThis.document,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  refreshMs = PANEL_COVER_REFRESH_MS,
} = {}) {
  let rects = [];
  let signature = '';
  let revision = 0;
  let measuredAt = Number.NEGATIVE_INFINITY;

  function measure() {
    const next = [];
    for (const element of documentRef?.querySelectorAll?.(
      PANEL_COVER_SELECTORS.join(', '),
    ) || []) {
      if (!isShown(element)) continue;
      const rect = element.getBoundingClientRect?.();
      if (!rect || !(rect.width > 0) || !(rect.height > 0)) continue;
      next.push({
        left: rect.left,
        top: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
      });
    }
    const nextSignature = next
      .map((rect) => `${rect.left},${rect.top},${rect.right},${rect.bottom}`)
      .join(';');
    if (nextSignature !== signature) {
      signature = nextSignature;
      rects = next;
      revision++;
    }
  }

  return {
    /** Re-measure when due; returns a revision that changes when the chrome moved. */
    refresh() {
      const timestamp = now();
      if (timestamp - measuredAt >= refreshMs) {
        measuredAt = timestamp;
        measure();
      }
      return revision;
    },
    /** Whether a box centred on (x, y) sits under any measured chrome. */
    covers(x, y, halfWidth = 0, halfHeight = 0) {
      return boxUnderRects(x, y, rects, halfWidth, halfHeight);
    },
  };
}
