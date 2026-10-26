function availableLayers(lens, layers) {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  return lens.layerIds
    .map((id) => byId.get(id))
    .filter((layer) => layer && layer.available !== false);
}

/** Read a lens from supplied layer snapshots, whose enabled flags are effective intent. */
export function lensStatus(lens, layers) {
  const available = availableLayers(lens, layers);
  const availableCount = available.length;
  const enabledCount = available.filter(
    (layer) => layer.enabled === true,
  ).length;
  const status = !availableCount
    ? 'unavailable'
    : enabledCount === availableCount
      ? 'on'
      : enabledCount
        ? 'partial'
        : 'off';
  return { status, enabledCount, availableCount };
}

/** Plan one click from a single snapshot; only other fully-on lenses protect shared layers. */
export function planLensClick(lens, lenses, layers) {
  const { status } = lensStatus(lens, layers);
  if (status === 'unavailable') return [];
  const available = availableLayers(lens, layers);
  if (status !== 'on') {
    return available
      .filter((layer) => layer.enabled !== true)
      .map(({ id }) => ({ layerId: id, enabled: true }));
  }

  const protectedLayers = new Set(
    lenses
      .filter((other) => other.id !== lens.id)
      .filter((other) => lensStatus(other, layers).status === 'on')
      .flatMap((other) => other.layerIds),
  );
  return available
    .filter((layer) => !protectedLayers.has(layer.id))
    .map(({ id }) => ({ layerId: id, enabled: false }));
}
