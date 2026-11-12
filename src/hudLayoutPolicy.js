/** Browser-free layout vocabulary shared by UI, share links and server-side voice tools. */
export const HUD_LAYOUTS = Object.freeze(['tactical', 'operator', 'minimal']);

/** Canonical HUD layout, and the fallback for unknown or retired names such as `cyber`. */
export const DEFAULT_HUD_LAYOUT = 'tactical';

const HUD_LAYOUT_SET = new Set(HUD_LAYOUTS);

/** @param {unknown} value */
export function isHudLayout(value) {
  return HUD_LAYOUT_SET.has(String(value ?? '').toLowerCase());
}

/** @param {unknown} value */
export function normalizeHudLayout(value) {
  const normalized = String(value ?? '').toLowerCase();
  return isHudLayout(normalized) ? normalized : DEFAULT_HUD_LAYOUT;
}
