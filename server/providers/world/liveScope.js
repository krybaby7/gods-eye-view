export function liveSourceFromRequest(url) {
  return new URLSearchParams(url?.split('?')[1]).get('source');
}

export function sourcesForWorldTurn(sources, adapters, liveSource) {
  if (liveSource === null) return sources;
  if (
    !Object.hasOwn(adapters, liveSource) ||
    adapters[liveSource]?.live !== true
  ) {
    return [];
  }
  return sources.filter(({ id }) => id === liveSource);
}
