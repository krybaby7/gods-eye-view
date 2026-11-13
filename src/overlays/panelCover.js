/**
 * Where the app's chrome sits over the globe, for text Cesium draws on it.
 *
 * The World Board's country codes are billboards in the WebGL canvas, under
 * every panel. In the frame (roadmap 1.2) the canvas is inset to the globe
 * region, so the bars, Today and the sheet can no longer have a code under
 * them; what still floats over the globe (the layer list, the right rail, the
 * dock, the navigation buttons, the status line) is measured here, and a code
 * whose box sits under it is hidden rather than read through it.
 *
 * Rects are kept in the canvas's own coordinates, the space Cesium's window
 * coordinates use, so a globe region that does not start at the window's
 * corner still lines up. Measurement is throttled and runs from a rendered
 * frame; `watch` asks for that frame when the chrome or the globe region
 * changes size, so a layout change re-culls even under a parked camera.
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

/** The element whose box is the canvas: window coordinates start at its corner. */
export const PANEL_COVER_CANVAS_ID = 'cesiumContainer';

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
 * @param {Window} [options.windowRef]
 * @param {() => number} [options.now]
 * @param {number} [options.refreshMs]
 */
export function createPanelCover({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  refreshMs = PANEL_COVER_REFRESH_MS,
} = {}) {
  let rects = [];
  let signature = '';
  let revision = 0;
  let measuredAt = Number.NEGATIVE_INFINITY;
  let resizeObserver = null;
  const observed = new Set();

  function observe(element) {
    if (!resizeObserver || !element || observed.has(element)) return;
    observed.add(element);
    resizeObserver.observe(element);
  }

  function measure() {
    const canvas = documentRef?.getElementById?.(PANEL_COVER_CANVAS_ID);
    const origin = canvas?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    observe(canvas);
    const next = [];
    for (const element of documentRef?.querySelectorAll?.(
      PANEL_COVER_SELECTORS.join(', '),
    ) || []) {
      observe(element);
      if (!isShown(element)) continue;
      const rect = element.getBoundingClientRect?.();
      if (!rect || !(rect.width > 0) || !(rect.height > 0)) continue;
      const left = rect.left - origin.left;
      const top = rect.top - origin.top;
      next.push({
        left,
        top,
        right: left + rect.width,
        bottom: top + rect.height,
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

  function invalidate() {
    measuredAt = Number.NEGATIVE_INFINITY;
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
    /** Measure on the next refresh, whatever the throttle says. */
    invalidate,
    /** Whether a box centred on (x, y), in canvas pixels, sits under any measured chrome. */
    covers(x, y, halfWidth = 0, halfHeight = 0) {
      return boxUnderRects(x, y, rects, halfWidth, halfHeight);
    },
    /**
     * Call `onChange` (to ask the idle globe for a frame) whenever the chrome
     * or the globe region changes size or the window resizes, until `signal`
     * aborts. Panels found later are observed as they are measured.
     */
    watch(onChange, signal) {
      if (signal?.aborted) return;
      const changed = () => {
        invalidate();
        onChange?.();
      };
      const Observer = globalThis.ResizeObserver;
      if (typeof Observer === 'function') {
        resizeObserver = new Observer(changed);
        measure();
      }
      windowRef?.addEventListener?.('resize', changed, { signal });
      signal?.addEventListener?.(
        'abort',
        () => {
          resizeObserver?.disconnect();
          resizeObserver = null;
          observed.clear();
        },
        { once: true },
      );
    },
  };
}
