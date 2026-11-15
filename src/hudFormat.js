/**
 * @module hudFormat
 * @description The status line's readouts in the mock's form (roadmap
 * Appendix D): "22°00'N 080°00'E", the figure of "Eye altitude 9,000 km"
 * and the figure of "18:02 UTC". The words beside the figures are the status
 * line's own, set in the sans face (monospace is for figures and codes only).
 * Pure, so the rounding and its carry can be tested without a globe.
 */

/**
 * Degrees and whole minutes, rounded once on total minutes so a value just
 * under the next degree carries ("29°59.7'" reads "30°00'", never "29°60'").
 * @param {number} decimal - Coordinate in decimal degrees.
 * @param {'lat'|'lon'} axis - Latitude pads degrees to 2 digits, longitude to 3.
 * @returns {string} For example `22°00'N` or `080°00'E`; '' when not a number.
 */
export function formatDegreesMinutes(decimal, axis) {
  if (!Number.isFinite(decimal)) return '';
  const totalMinutes = Math.round(Math.abs(decimal) * 60);
  const degrees = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const positive = totalMinutes === 0 || decimal >= 0;
  const hemisphere =
    axis === 'lat' ? (positive ? 'N' : 'S') : positive ? 'E' : 'W';
  const width = axis === 'lon' ? 3 : 2;
  return `${String(degrees).padStart(width, '0')}°${String(minutes).padStart(2, '0')}'${hemisphere}`;
}

/** "22°00'N 080°00'E" for a camera subpoint. */
export function formatLatLon(latDeg, lonDeg) {
  return `${formatDegreesMinutes(latDeg, 'lat')} ${formatDegreesMinutes(lonDeg, 'lon')}`;
}

const GROUPED = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/**
 * The figure of "Eye altitude 9,000 km" ("9,000 km") from metres above mean
 * sea level: whole kilometres
 * from 1 km up, whole metres below.
 * @param {number} metres
 * @returns {string} '' when not a number.
 */
export function formatEyeAltitude(metres) {
  if (!Number.isFinite(metres)) return '';
  const rounded = Math.round(metres);
  return Math.abs(rounded) >= 1000
    ? `${GROUPED.format(Math.round(metres / 1000))} km`
    : `${GROUPED.format(rounded)} m`;
}

/** "18:02", the figure of "18:02 UTC", for a date. */
export function formatUtcClock(date) {
  if (!(date instanceof Date) || Number.isNaN(+date)) return '';
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
