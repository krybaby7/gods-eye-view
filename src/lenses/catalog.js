import { LAYER_GROUPS, presetLayerIds } from './groups.js';

function lens(id, label, icon, hotkey, layerIds) {
  return Object.freeze({
    id,
    label,
    icon,
    hotkey,
    layerIds: Object.freeze(layerIds),
  });
}

/**
 * Presets over the existing layer catalog, one per group of the Layers menu;
 * no state is stored here. A preset switches its whole group.
 */
export const LENSES = Object.freeze(
  LAYER_GROUPS.filter((entry) => entry.preset).map((entry) =>
    lens(
      entry.id,
      entry.label,
      entry.icon,
      entry.hotkey,
      presetLayerIds(entry),
    ),
  ),
);
