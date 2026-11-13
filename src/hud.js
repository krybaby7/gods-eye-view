/**
 * @module hud
 * @description The map's status line: one quiet row of real readouts over the
 * Cesium canvas — the plain place name, coordinates, MGRS, altitude above mean
 * sea level and UTC time — with the selected vessel's AIS line above it.
 *
 * Roadmap item 1.1 took the costume off: there are no classification banners,
 * invented mission or sensor numbers, REC, orbit or band strips, brackets or
 * glow, and the place name comes from the built-in landmark catalogue rather
 * than a paid model call.
 *
 * The line auto-shows with the NVG, FLIR and CRT styles and is otherwise driven
 * by the Display HUD toggle. Layout names stay for links, scenes and recording:
 * Tactical and Operator show the whole line; Minimal drops altitude and vessel.
 */

import * as Cesium from 'cesium';
import { forward as toMGRS } from 'mgrs';
import { CITY_POIS } from './locations.js';
import { composePlaceName } from './hudLocality.js';
import {
  ellipsoidalToMslDisplayM,
  ensureGeoidReady,
  geoidHeight,
} from './data/geoid.js';
import { DEFAULT_HUD_LAYOUT, normalizeHudLayout } from './hudLayouts.js';
import {
  formatEyeAltitude,
  formatLatLon,
  formatUtcClock,
} from './hudFormat.js';

/** Text colour per shader mode, so the line stays legible under NVG/FLIR/CRT. */
const HUD_COLORS = {
  surveillance: '#a5ffa5',
  thermal: '#ffffff',
  retro: '#ffd68a',
  _default: '#e8eaed',
};

/** Shader modes that automatically show the status line. */
const MILITARY_STYLES = new Set(['retro', 'surveillance', 'thermal']);

/**
 * Cell size (degrees) for the ALT readout's geoid-undulation cache. N changes
 * by well under a metre across 0.01° (~1.1 km), so one lookup per cell keeps
 * the 4 Hz telemetry tick off the EGM96 grid without a visible step.
 */
const HUD_GEOID_CELL_DEG = 0.01;

/** Where the viewer's choice to show MGRS on the status line is kept. */
export const HUD_MGRS_STORAGE_KEY = 'gev.hud.mgrs';

function readMgrsSetting() {
  try {
    return globalThis.localStorage?.getItem(HUD_MGRS_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Flattened list of all city POIs for nearest-point lookups. */
const NEARBY_POINTS = Object.values(CITY_POIS).flatMap((city) =>
  city.pois.map((poi) => ({
    city: city.name,
    poi: poi.name,
    lat: poi.lat,
    lon: poi.lon,
  })),
);

/** One-line status readout rendered over the Cesium canvas. */
export class IntelHUD {
  /**
   * @param {Cesium.Viewer} viewer - The Cesium Viewer instance used for
   *   camera telemetry and coordinate derivation.
   */
  constructor(viewer) {
    this.viewer = viewer;
    this._visible = false;
    this._autoMode = true; // auto show/hide based on style
    this._currentStyle = 'normal';
    this._el = null;
    this._variant = DEFAULT_HUD_LAYOUT;
    this._updateInterval = null;
    this._timestampInterval = null;
    this._latestMetrics = null;
    // ALT readout datum: the camera height Cesium reports is ELLIPSOIDAL, the
    // number a viewer reads is MSL. N comes from the same lazy ~2.7 MB EGM96
    // chunk the flight layers use — requested on the first telemetry tick of a
    // VISIBLE HUD, never at construction, so a hidden HUD costs nothing — and
    // cached per coarse cell. Until it resolves, or if it never does,
    // `ellipsoidalToMslDisplayM` passes the raw height straight through.
    this._geoidRequested = false;
    this._geoidReady = false;
    this._geoidCellKey = null;
    this._geoidN = null;
    // The 250 ms tick only runs while visible; a long camera flight must not
    // leave the previous place on screen once it settles.
    this._onCameraMoveEnd = () => {
      if (this._visible) this._updateCameraData();
    };

    this._buildDOM();
    this.viewer.camera.moveEnd.addEventListener(this._onCameraMoveEnd);
    this._startTimers();
  }

  /** Build the status line inside the existing `#intel-hud` element. */
  _buildDOM() {
    this._el = document.getElementById('intel-hud');
    if (!this._el) return;

    this._el.innerHTML = `
      <div class="hud-status">
        <div id="hud-ais-vessel" class="hud-ais-vessel">AIS: --</div>
        <div class="hud-status-line">
          <span id="hud-place" class="hud-place"></span>
          <span id="hud-latlon"></span>
          <span id="hud-mgrs" hidden>MGRS: ---</span>
          <span id="hud-alt"></span>
          <span id="hud-time"></span>
        </div>
      </div>
    `;
    this._el.dataset.variant = this._variant;

    // MGRS is optional on the status line (roadmap Appendix A): off unless
    // the viewer turned it on in Display, and remembered.
    const toggle = document.getElementById('hud-mgrs-toggle');
    toggle?.addEventListener('click', () => this.setMgrsVisible(!this._mgrs));
    this.setMgrsVisible(readMgrsSetting(), { persist: false });
  }

  /**
   * Show or hide the MGRS reference on the status line.
   * @param {boolean} visible
   * @param {{persist?: boolean}} [options]
   */
  setMgrsVisible(visible, { persist = true } = {}) {
    this._mgrs = Boolean(visible);
    const span = document.getElementById('hud-mgrs');
    if (span) span.hidden = !this._mgrs;
    const toggle = document.getElementById('hud-mgrs-toggle');
    toggle?.setAttribute('aria-pressed', String(this._mgrs));
    toggle?.classList.toggle('active', this._mgrs);
    if (persist) {
      try {
        globalThis.localStorage?.setItem(
          HUD_MGRS_STORAGE_KEY,
          this._mgrs ? 'on' : 'off',
        );
      } catch {
        /* the choice lasts for this visit */
      }
    }
    if (this._mgrs && this._visible) this._updateCameraData();
  }

  /** Start the clock and the camera telemetry tick; both stop in {@link destroy}. */
  _startTimers() {
    this._timestampInterval = setInterval(() => {
      if (this._visible) this._updateTime();
    }, 1000);
    this._updateInterval = setInterval(() => {
      if (!this._visible) return;
      this._updateCameraData();
    }, 250);
  }

  /** Show the current time as "18:02 UTC". */
  _updateTime() {
    const el = document.getElementById('hud-time');
    if (el) el.textContent = formatUtcClock(new Date());
  }

  /**
   * Geoid undulation N at the camera subpoint, memoized per coarse cell.
   * @param {number} latDeg - Camera latitude in decimal degrees.
   * @param {number} lonDeg - Camera longitude in decimal degrees.
   * @returns {number|null} N in metres, or null while the grid is unavailable.
   */
  _geoidUndulationM(latDeg, lonDeg) {
    if (!this._geoidReady) {
      if (!this._geoidRequested) {
        this._geoidRequested = true;
        ensureGeoidReady()
          .then(() => {
            this._geoidReady = true;
          })
          .catch(() => {
            /* readout falls back to the uncorrected height */
          });
      }
      return null;
    }
    const key = `${Math.round(latDeg / HUD_GEOID_CELL_DEG)}:${Math.round(lonDeg / HUD_GEOID_CELL_DEG)}`;
    if (key !== this._geoidCellKey) {
      try {
        this._geoidN = geoidHeight(latDeg, lonDeg);
      } catch {
        this._geoidN = null;
      }
      this._geoidCellKey = key;
    }
    return Number.isFinite(this._geoidN) ? this._geoidN : null;
  }

  /** Derive the camera readouts and push them to the status line. */
  _updateCameraData() {
    const cartographic = this.viewer.camera.positionCartographic;
    if (!cartographic) return;

    const lonDeg = Cesium.Math.toDegrees(cartographic.longitude);
    const latDeg = Cesium.Math.toDegrees(cartographic.latitude);
    const altM = cartographic.height;

    const mgrsEl = this._mgrs ? document.getElementById('hud-mgrs') : null;
    if (mgrsEl) {
      try {
        // 4 = 10 m precision. Format: 18SUJ23370716 → 18S UJ 2337 0716
        mgrsEl.textContent = `MGRS: ${this._formatMGRS(toMGRS([lonDeg, latDeg], 4))}`;
      } catch {
        mgrsEl.textContent = 'MGRS: ---';
      }
    }

    const llEl = document.getElementById('hud-latlon');
    if (llEl) llEl.textContent = formatLatLon(latDeg, lonDeg);

    // Altitude — reported as height above MEAN SEA LEVEL. `altM` is the raw
    // ellipsoidal camera height, which reads far below zero wherever the geoid
    // sits under the ellipsoid: a cockpit parked on the SFO deck (N ≈ -32 m)
    // showed "ALT: -15m", and JFK "ALT: -18m". Subtracting N restores the
    // number a viewer expects without touching the camera or any render path.
    const altEl = document.getElementById('hud-alt');
    const geoidN = this._geoidUndulationM(latDeg, lonDeg);
    const altMslM = ellipsoidalToMslDisplayM(altM, geoidN);
    if (altEl) altEl.textContent = formatEyeAltitude(altMslM);

    this._latestMetrics = { latDeg, lonDeg, altM, altMslM };

    const placeEl = document.getElementById('hud-place');
    if (placeEl) {
      placeEl.textContent = composePlaceName(
        this._nearestKnownPoint(latDeg, lonDeg),
        this._regionLabel(latDeg, lonDeg),
      );
    }
    this._updateTime();
  }

  /**
   * Insert spaces into a raw MGRS string for human-readable display.
   * @param {string} mgrs - Raw MGRS string, e.g. `"18SUJ23370716"`.
   * @returns {string} Formatted string, e.g. `"18S UJ 2337 0716"`.
   */
  _formatMGRS(mgrs) {
    // Regex captures: grid zone designator (1-2 digits + band letter),
    // 100km square ID (2 letters), numeric easting+northing (split in half).
    const match = mgrs.match(/^(\d{1,2}[A-Z])\s*([A-Z]{2})\s*(\d+)$/);
    if (!match) return mgrs;
    const [, zone, square, coords] = match;
    const half = coords.length / 2;
    const easting = coords.slice(0, half);
    const northing = coords.slice(half);
    return `${zone} ${square} ${easting} ${northing}`;
  }

  /**
   * Return a coarse geographic region label based on lat/lon bounding boxes.
   * @param {number} lat - Latitude in decimal degrees.
   * @param {number} lon - Longitude in decimal degrees.
   * @returns {string} Region name (e.g. `"EUROPE"`, `"NORTHERN OCEANIC GRID"`).
   */
  _regionLabel(lat, lon) {
    if (lat > 72) return 'ARCTIC';
    if (lat < -60) return 'ANTARCTIC';
    if (lat >= 5 && lat <= 83 && lon >= -170 && lon <= -50)
      return 'NORTH AMERICA';
    if (lat >= -60 && lat <= 15 && lon >= -90 && lon <= -30)
      return 'SOUTH AMERICA';
    if (lat >= 34 && lat <= 72 && lon >= -25 && lon <= 45) return 'EUROPE';
    if (lat >= -35 && lat <= 38 && lon >= -20 && lon <= 55) return 'AFRICA';
    if (lat >= 5 && lat <= 80 && lon >= 45 && lon <= 180) return 'ASIA';
    if (lat >= -50 && lat <= 5 && lon >= 110 && lon <= 180) return 'OCEANIA';
    return lat >= 0 ? 'NORTHERN OCEANIC GRID' : 'SOUTHERN OCEANIC GRID';
  }

  /**
   * Compute the great-circle distance between two geographic points
   * using the Haversine formula.
   * @returns {number} Distance in kilometers.
   */
  _haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => Cesium.Math.toRadians(deg);
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Find the closest known POI to the given coordinates.
   * @returns {{ city: string, poi: string, lat: number, lon: number, distKm: number }|null}
   */
  _nearestKnownPoint(latDeg, lonDeg) {
    let best = null;
    for (const point of NEARBY_POINTS) {
      const distKm = this._haversineKm(latDeg, lonDeg, point.lat, point.lon);
      if (!best || distKm < best.distKm) {
        best = { ...point, distKm };
      }
    }
    return best;
  }

  // ── Public API ──────────────────────────

  /**
   * React to a shader-style change: set the line's text colour and, in auto
   * mode, show it for NVG, FLIR and CRT.
   * @param {string} styleName - Active style key.
   */
  onStyleChange(styleName) {
    this._currentStyle = styleName;
    this._el?.style.setProperty(
      '--hud-color',
      HUD_COLORS[styleName] || HUD_COLORS._default,
    );
    if (this._autoMode) {
      if (MILITARY_STYLES.has(styleName)) this.show();
      else this.hide();
    }
  }

  /** Make the HUD visible and immediately refresh all readouts. */
  show() {
    this._visible = true;
    if (this._el) this._el.classList.add('active');
    this._updateCameraData();
  }

  /** Hide the HUD overlay. */
  hide() {
    this._visible = false;
    if (this._el) this._el.classList.remove('active');
  }

  /** Toggle HUD visibility and disable auto-mode (user override). */
  toggle() {
    this._autoMode = false;
    if (this._visible) this.hide();
    else this.show();
  }

  /**
   * Explicit HUD mode control for scene/recording playback.
   * @param {'auto'|'on'|'off'} mode - `'auto'` re-enables style-driven
   *   show/hide; `'on'`/`'off'` force visibility and disable auto-mode.
   */
  setMode(mode) {
    if (mode === 'auto') {
      this._autoMode = true;
      this.onStyleChange(this._currentStyle);
      return;
    }

    this._autoMode = false;
    if (mode === 'on') this.show();
    else this.hide();
  }

  /**
   * Switch the HUD layout. Unknown names, including the retired `cyber`,
   * fall back to the default layout.
   * @param {string} variantName - One of `'tactical'`, `'operator'`, `'minimal'`.
   */
  setVariant(variantName) {
    this._variant = normalizeHudLayout(variantName);
    if (this._el) this._el.dataset.variant = this._variant;
  }

  /** @returns {string} The current HUD layout variant name. */
  getVariant() {
    return this._variant;
  }

  /**
   * @returns {'auto'|'on'|'off'} Current HUD mode — `'auto'` when style-driven
   *   show/hide is active, otherwise the explicit visibility override.
   */
  getMode() {
    if (this._autoMode) return 'auto';
    return this._visible ? 'on' : 'off';
  }

  /** @returns {boolean} Whether the HUD is currently visible. */
  get visible() {
    return this._visible;
  }

  /** Tear down all running intervals. Call when discarding the HUD instance. */
  destroy() {
    clearInterval(this._updateInterval);
    clearInterval(this._timestampInterval);
    this.viewer.camera.moveEnd.removeEventListener(this._onCameraMoveEnd);
  }
}
