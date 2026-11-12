import * as Cesium from 'cesium';

/**
 * Shared screen-space keyhole geometry: the circle every keyhole-aligned overlay,
 * detection fade and full-globe test agrees on, plus the Earth-disc projection
 * those tests use. It lives apart from the optional sun and moon ring so the ring
 * can stay off, or later go, without touching detection or the layers.
 */

/** Outer edge of the existing NVG/FLIR keyhole in normalized shader space. */
export const KEYHOLE_OUTER_RADIUS = 1.05;
/** Clearance required before entering the visible state. */
export const GLOBE_ENTER_CLEARANCE_PX = 24;
/** Clearance below which the overlay leaves the visible state. */
export const GLOBE_EXIT_CLEARANCE_PX = 12;
/** Minimum stable length of a celestial direction projected into the camera plane. */
export const CELESTIAL_PLANE_EPSILON = 0.045;
/** Responsive radial fade band used by every keyhole-aligned text overlay —
 * this is the Detection FADE (label/card fading), NOT the scope-mask feather
 * in scopeMask.js. 0.07 since the 2026-08-24 owner final lock (was 0.16). */
export const KEYHOLE_LABEL_FEATHER_RATIO = 0.07;
export const KEYHOLE_LABEL_FEATHER_MAX_RATIO = 0.4;
/**
 * First-run OUTSIDE opacity for keyhole-aligned world overlays.
 *
 * 0.01 since 2026-08-24 (owner final lock; 0.03 on 08-23, 0.05 before). Keep in lockstep with
 * `#detection-opacity-slider`'s markup value AND readout in index.html,
 * `_detectionOutsideOpacityPct` in sharelink.js,
 * `GLOBAL_POST_DEFAULTS.detectionOutsideOpacityPct` in ui.js, and
 * `AIRCRAFT_BRACKET_FLOOR_ANCHOR` in detectionPolicy.js — a fresh boot applies
 * no restore, so those literals ARE the first-run state. NOT the `ko` PARSE
 * fallback, which stays at 5 on purpose: a link predating that field was
 * authored when 5 was what its author saw. Pinned in reasonableDefaults.test.mjs.
 */
export const KEYHOLE_OUTSIDE_OPACITY_DEFAULT = 0.01;

const TAU = Math.PI * 2;

let keyholeFadeRatio = KEYHOLE_LABEL_FEATHER_RATIO;
let keyholeOutsideOpacity = KEYHOLE_OUTSIDE_OPACITY_DEFAULT;

/** Clamp a number to an inclusive range. */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Update the shared fade distance and outside-opacity floor. */
export function setKeyholeFadeTuning({ fadeRatio, outsideOpacity } = {}) {
  if (Number.isFinite(fadeRatio)) {
    keyholeFadeRatio = clamp(fadeRatio, 0, KEYHOLE_LABEL_FEATHER_MAX_RATIO);
  }
  if (Number.isFinite(outsideOpacity)) {
    keyholeOutsideOpacity = clamp(outsideOpacity, 0, 1);
  }
  return getKeyholeFadeTuning();
}

/** Read the current normalized keyhole fade settings. */
export function getKeyholeFadeTuning() {
  return { fadeRatio: keyholeFadeRatio, outsideOpacity: keyholeOutsideOpacity };
}

/** Return the single shared screen-space keyhole circle and label feather. */
export function getKeyholeGeometry(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) {
    return { centerX: 0, centerY: 0, radius: 0, featherPx: 0 };
  }
  const radius = h * 0.5 * KEYHOLE_OUTER_RADIUS;
  return {
    centerX: w * 0.5,
    centerY: h * 0.5,
    radius,
    featherPx: radius * keyholeFadeRatio,
  };
}

/**
 * Compute the radial opacity for a callout's visual center. Text remains fully
 * opaque inside the keyhole and fades linearly to the configured outside-opacity
 * floor through a band derived from the live keyhole radius.
 */
export function keyholeLabelAlpha(labelX, labelY, width, height) {
  return keyholeLabelAlphaFromGeometry(
    labelX,
    labelY,
    getKeyholeGeometry(width, height),
  );
}

/** Compute keyhole opacity from geometry already cached by a hot render loop. */
export function keyholeLabelAlphaFromGeometry(labelX, labelY, geometry) {
  if (
    !geometry ||
    !(geometry.radius > 0) ||
    !Number.isFinite(labelX) ||
    !Number.isFinite(labelY)
  )
    return 0;
  const feather = geometry.featherPx;
  const distance = Math.hypot(
    labelX - geometry.centerX,
    labelY - geometry.centerY,
  );
  if (distance <= geometry.radius) return 1;
  if (!(feather > 0) || distance >= geometry.radius + feather)
    return keyholeOutsideOpacity;
  const progress = clamp((distance - geometry.radius) / feather, 0, 1);
  return 1 - (1 - keyholeOutsideOpacity) * progress;
}

/** Normalize an angle to [0, 2π). */
export function normalizeAngle(angle) {
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/** Return the shortest unsigned distance between two circular angles. */
export function circularAngleDistance(a, b) {
  const delta = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(delta, TAU - delta);
}
/**
 * Resolve a screen-space direction angle. Canvas Y grows downward, so camera-up
 * is inverted. When the celestial vector points almost directly into/out of the
 * camera, retain the prior stable bearing and fade the marker.
 *
 * @param {number} rightComponent - Dot(direction, camera.rightWC).
 * @param {number} upComponent - Dot(direction, camera.upWC).
 * @param {number} lastAngle - Previous stable angle in radians.
 * @returns {{angle:number, opacity:number, stable:boolean}}
 */
export function celestialScreenAngle(
  rightComponent,
  upComponent,
  lastAngle = 0,
) {
  const planeLength = Math.hypot(rightComponent, upComponent);
  if (!Number.isFinite(planeLength) || planeLength < CELESTIAL_PLANE_EPSILON) {
    return {
      angle: normalizeAngle(Number.isFinite(lastAngle) ? lastAngle : 0),
      opacity: clamp(planeLength / CELESTIAL_PLANE_EPSILON, 0, 1),
      stable: false,
    };
  }
  return {
    angle: normalizeAngle(Math.atan2(-upComponent, rightComponent)),
    opacity: clamp((planeLength - CELESTIAL_PLANE_EPSILON) / 0.16, 0.28, 1),
    stable: true,
  };
}

/**
 * Test whether a projected Earth disc is completely inside the shared keyhole.
 * The different enter/exit clearances provide hysteresis while zooming.
 *
 * @param {object} geometry
 * @param {number} geometry.earthCenterX
 * @param {number} geometry.earthCenterY
 * @param {number} geometry.earthRadius
 * @param {number} geometry.keyholeCenterX
 * @param {number} geometry.keyholeCenterY
 * @param {number} geometry.keyholeRadius
 * @param {boolean} wasVisible
 * @returns {boolean}
 */
export function isFullGlobeInsideKeyhole(geometry, wasVisible = false) {
  const {
    earthCenterX,
    earthCenterY,
    earthRadius,
    keyholeCenterX,
    keyholeCenterY,
    keyholeRadius,
  } = geometry || {};
  const values = [
    earthCenterX,
    earthCenterY,
    earthRadius,
    keyholeCenterX,
    keyholeCenterY,
    keyholeRadius,
  ];
  if (!values.every(Number.isFinite) || earthRadius <= 0 || keyholeRadius <= 0)
    return false;
  const offset = Math.hypot(
    earthCenterX - keyholeCenterX,
    earthCenterY - keyholeCenterY,
  );
  const clearance = keyholeRadius - (offset + earthRadius);
  return (
    clearance >=
    (wasVisible ? GLOBE_EXIT_CLEARANCE_PX : GLOBE_ENTER_CLEARANCE_PX)
  );
}

/** Return the Earth-disc radius in CSS pixels for a perspective camera. */
export function earthDiscScreenRadius(cameraDistance, viewportHeight, fovy) {
  const earthRadiusM = Cesium.Ellipsoid.WGS84.maximumRadius;
  if (
    !Number.isFinite(cameraDistance) ||
    cameraDistance <= earthRadiusM ||
    !(viewportHeight > 0) ||
    !Number.isFinite(fovy) ||
    fovy <= 0 ||
    fovy >= Math.PI
  )
    return null;
  const angularRadius = Math.asin(clamp(earthRadiusM / cameraDistance, 0, 1));
  const radius =
    (viewportHeight * 0.5 * Math.tan(angularRadius)) / Math.tan(fovy * 0.5);
  return Number.isFinite(radius) && radius > 0 ? radius : null;
}

/**
 * Project the visible Earth disc into viewport coordinates.
 * Shared by full-globe UI treatments that must agree on visual containment.
 *
 * @param {object} viewer - Cesium Viewer-like object.
 * @param {number} width - Viewport width in CSS pixels.
 * @param {number} height - Viewport height in CSS pixels.
 * @param {object} [scratchCenter] - Reusable Cesium Cartesian2 result.
 * @param {object} [scratchToCenter] - Reusable Cesium Cartesian3 result.
 * @returns {object|null}
 */
export function projectEarthDiscToViewport(
  viewer,
  width,
  height,
  scratchCenter = undefined,
  scratchToCenter = undefined,
) {
  const camera = viewer?.camera;
  const scene = viewer?.scene;
  if (!camera || !scene || !(width > 0) || !(height > 0)) return null;

  const distance = Cesium.Cartesian3.magnitude(camera.positionWC);
  if (
    !Number.isFinite(distance) ||
    distance <= Cesium.Ellipsoid.WGS84.maximumRadius
  )
    return null;

  const toCenter = Cesium.Cartesian3.negate(
    camera.positionWC,
    scratchToCenter || new Cesium.Cartesian3(),
  );
  if (Cesium.Cartesian3.dot(camera.directionWC, toCenter) <= 0) return null;

  const center = Cesium.SceneTransforms.worldToWindowCoordinates(
    scene,
    Cesium.Cartesian3.ZERO,
    scratchCenter,
  );
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y))
    return null;

  const earthRadius = earthDiscScreenRadius(
    distance,
    height,
    camera.frustum?.fovy,
  );
  if (!earthRadius) return null;

  const keyhole = getKeyholeGeometry(width, height);
  return {
    earthCenterX: center.x,
    earthCenterY: center.y,
    earthRadius,
    keyholeCenterX: keyhole.centerX,
    keyholeCenterY: keyhole.centerY,
    keyholeRadius: keyhole.radius,
  };
}
