/**
 * @module hudLocality
 * @description The plain place name on the HUD status line — either
 * "NEAR <landmark>" or the coarse region.
 *
 * Split out of `hud.js` purely so it is unit-testable: `hud.js` pulls in the `mgrs`
 * CommonJS package, which Vite resolves but plain Node cannot import by named export.
 */

/**
 * Maximum distance to a curated POI that still reads as "NEAR" it.
 *
 * The 2026-08-20 QA hunt found the HUD announcing NEAR SACRE-COEUR (PARIS) 2470KM
 * while parked over Moscow, and NEAR LINCOLN MEMORIAL 962KM over Chicago — the old
 * bound was 2,500 km, roughly a continent. The POI catalogue only covers eight
 * cities, so anywhere else on Earth matched whichever landmark happened to be
 * closest and reported an absurd distance as if it were a locality.
 *
 * 150 km is metro scale: a camera over San Francisco still reads NEAR ALCATRAZ, a
 * camera over DC still reads NEAR its monuments, and Chicago (962 km from the
 * nearest catalogued POI) correctly falls through to the SECTOR readout that
 * already worked for Honolulu and Rio.
 */
export const NEAR_POI_MAX_KM = 150;

/**
 * Plain place name for the status line: `NEAR <POI> (<CITY>)` within the bound
 * (inclusive), otherwise the coarse region. The coordinates sit beside it on
 * the same line, so the old `SECTOR <lat> <lon>` fallback would only repeat them.
 *
 * @param {{poi: string, city: string, distKm: number}|null|undefined} nearest
 *   Closest catalogued POI with its great-circle distance, or null.
 * @param {string} region Coarse region label for the camera position.
 * @returns {string}
 */
export function composePlaceName(nearest, region) {
  const distKm = Number(nearest?.distKm);
  if (nearest && Number.isFinite(distKm) && distKm <= NEAR_POI_MAX_KM) {
    return `NEAR ${String(nearest.poi).toUpperCase()} (${String(nearest.city).toUpperCase()})`;
  }
  return String(region || '');
}
