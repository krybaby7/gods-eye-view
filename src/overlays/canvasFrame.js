/**
 * @module canvasFrame
 * @description Where the globe's canvas sits in the window. Since the frame
 * (roadmap 1.2) the canvas no longer fills the window: it is inset by the top
 * bar, Today and the sheet. Cesium works in canvas pixels (picking, window
 * coordinates, the imagery split), while pointer events and fixed elements
 * work in window pixels; these converters are the one place the two meet.
 *
 * A leaf: it imports nothing and reads only the scene it is given.
 */

/**
 * The canvas rectangle in window pixels. Without a canvas it is the origin,
 * so the converters pass values through unchanged.
 * @param {{canvas?: HTMLCanvasElement}} scene
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function canvasRect(scene) {
  const canvas = scene?.canvas;
  const rect = canvas?.getBoundingClientRect?.();
  const width = Number(canvas?.clientWidth) || Number(rect?.width) || 0;
  const height = Number(canvas?.clientHeight) || Number(rect?.height) || 0;
  return {
    left: Number(rect?.left) || 0,
    top: Number(rect?.top) || 0,
    width,
    height,
  };
}

/** A canvas point (Cesium's window coordinates) in window pixels. */
export function canvasToClient(scene, point) {
  const { left, top } = canvasRect(scene);
  return { x: point.x + left, y: point.y + top };
}

/** A window point (a pointer event's clientX and clientY) in canvas pixels. */
export function clientToCanvas(scene, clientX, clientY) {
  const { left, top } = canvasRect(scene);
  return { x: clientX - left, y: clientY - top };
}

/**
 * How far across the canvas a window x is, 0 at its left edge and 1 at its
 * right, unclamped. Null when the canvas has no width.
 */
export function canvasFraction(scene, clientX) {
  const { left, width } = canvasRect(scene);
  if (!(width > 0) || !Number.isFinite(Number(clientX))) return null;
  return (Number(clientX) - left) / width;
}

/** The window x of a fraction across the canvas: the inverse of canvasFraction. */
export function canvasClientX(scene, fraction) {
  const { left, width } = canvasRect(scene);
  return left + fraction * width;
}
