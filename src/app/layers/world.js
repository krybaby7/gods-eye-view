import { createWorldLayer } from '../../layers/world/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as render from '../../renderGovernor.js';
import { createPanelCover } from '../../overlays/panelCover.js';

export function createApplicationWorld(options) {
  return createWorldLayer({
    ...options,
    services: { picking, render, cover: createPanelCover() },
  });
}
