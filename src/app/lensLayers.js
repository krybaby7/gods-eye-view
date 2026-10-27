import { layerKeyRequirementTooltip } from '../ui/layerPanel.js';

/** Adapt the existing catalog and lifecycle reads without probing or storing layer state. */
export function lensLayerSnapshots(manager, catalog) {
  return manager.getAll().map((layer) => {
    const availability = catalog.getSourceAvailability?.(layer.id);
    const stats = layer.stats || {};
    return {
      ...layer,
      enabled: manager.isEffectivelyEnabled(layer.id),
      available:
        availability?.available !== false &&
        stats.sourceUnavailable !== true &&
        stats.keyRequired !== true,
      reason:
        availability?.reason ||
        (stats.sourceUnavailable ? stats.error : '') ||
        layerKeyRequirementTooltip(layer),
    };
  });
}
