/**
 * One-click camera transfer for layer-owned world targets.
 */
import * as Cesium from 'cesium';

export const WORLD_FOCUS_REQUEST_EVENT = 'gev:world-request-focus';
export const WORLD_CLICK_FOCUS_DURATION_SEC = 1.9;

export const WORLD_FOCUS_FRAMING = Object.freeze({
  vessel: Object.freeze({ radiusM: 150, rangeM: 1200, pitchDeg: -30 }),
  fire: Object.freeze({ radiusM: 400, rangeM: 3000, pitchDeg: -35 }),
  // A story's place is a city or region, not one object: a regional standoff.
  story: Object.freeze({ radiusM: 4000, rangeM: 90_000, pitchDeg: -55 }),
  // Frame theater: every located open story. The request carries the radius
  // that encloses them; these are its floor and nearest standoff.
  theater: Object.freeze({
    radiusM: 150_000,
    rangeM: 450_000,
    pitchDeg: -65,
    fitToRequest: true,
  }),
  // A hotspot bubble: the request carries the radius enclosing its stories;
  // capped so the flight always ends low enough for pins.
  hotspot: Object.freeze({
    radiusM: 600_000,
    rangeM: 1_800_000,
    pitchDeg: -65,
    fitToRequest: true,
    maxRadiusM: 1_000_000,
  }),
});
/**
 * Default largest sphere a fitted request may frame (a theater, not a
 * hemisphere). A kind may set a tighter `maxRadiusM`.
 */
const MAX_FIT_RADIUS_M = 3_000_000;
/** Standoff per metre of fitted radius, so the whole sphere stays in view. */
const FIT_RANGE_PER_RADIUS = 3;

/** Validate a layer-owned focus target before camera policy can release tracking. */
export function isValidWorldFocusTarget(detail) {
  if (!detail || !WORLD_FOCUS_FRAMING[detail.kind]) return false;
  if (!String(detail.id || '').trim()) return false;
  const { position } = detail;
  if (
    !position ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z)
  )
    return false;
  // Vessel, fire and story targets are surface-anchored Earth positions. Merely
  // finite coordinates near the ECEF origin cannot be flown to, and must be
  // rejected before the camera policy releases a current follow owner.
  const magnitude = Cesium.Cartesian3.magnitude(position);
  return (
    Number.isFinite(magnitude) &&
    magnitude >= Cesium.Ellipsoid.WGS84.minimumRadius * 0.95
  );
}

/** Announce a valid user-click focus request. */
export function requestWorldFocus(detail, eventTarget = globalThis.window) {
  if (!isValidWorldFocusTarget(detail)) return false;
  if (typeof eventTarget?.dispatchEvent !== 'function') return false;
  eventTarget.dispatchEvent(
    new CustomEvent(WORLD_FOCUS_REQUEST_EVENT, { detail }),
  );
  return true;
}

/** Register one listener and return an idempotent disposer. */
export function registerWorldFocusRequestListener(eventTarget, listener) {
  if (
    !eventTarget?.addEventListener ||
    !eventTarget?.removeEventListener ||
    typeof listener !== 'function'
  )
    return () => {};
  eventTarget.addEventListener(WORLD_FOCUS_REQUEST_EVENT, listener);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    eventTarget.removeEventListener(WORLD_FOCUS_REQUEST_EVENT, listener);
  };
}

/** Route a valid request through the UI-owned camera policy. */
export function routeWorldFocusRequest(event, runExplicitFocus, fly) {
  const detail = event?.detail;
  if (!isValidWorldFocusTarget(detail)) return false;
  if (typeof runExplicitFocus !== 'function' || typeof fly !== 'function')
    return false;
  return runExplicitFocus(detail, () => fly(detail));
}

/** Fly to a world target after ownership has been released. */
export function flyToWorldTarget(viewer, target = {}) {
  const camera = viewer?.camera;
  const framing = WORLD_FOCUS_FRAMING[target.kind];
  if (!camera || !framing || !isValidWorldFocusTarget(target)) return false;
  const heading = Number.isFinite(camera.heading) ? camera.heading : 0;
  const duration =
    target.durationSec > 0
      ? target.durationSec
      : WORLD_CLICK_FOCUS_DURATION_SEC;
  let { radiusM, rangeM } = framing;
  if (framing.fitToRequest && Number.isFinite(target.radiusM)) {
    const maxRadiusM = framing.maxRadiusM ?? MAX_FIT_RADIUS_M;
    radiusM = Math.min(maxRadiusM, Math.max(radiusM, target.radiusM));
    rangeM = Math.max(rangeM, radiusM * FIT_RANGE_PER_RADIUS);
  }
  camera.cancelFlight?.();
  camera.flyToBoundingSphere(
    new Cesium.BoundingSphere(target.position, radiusM),
    {
      offset: new Cesium.HeadingPitchRange(
        heading,
        Cesium.Math.toRadians(framing.pitchDeg),
        rangeM,
      ),
      duration,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    },
  );
  return true;
}
