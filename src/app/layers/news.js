import { createNewsLayer } from '../../layers/news/index.js';
import * as context from '../../data/contextStore.js';
import * as picking from '../../data/pickRegistry.js';
import * as render from '../../renderGovernor.js';
import * as overlays from '../../overlays/worldOverlay.js';
import * as focus from '../../worldFocus.js';

/** Bind the war monitor feed to the application scene service owners. */
export function createApplicationNews(options) {
  return createNewsLayer({
    ...options,
    services: { context, picking, focus, render },
    overlayHost: options.overlayHost ?? {
      setEntries: overlays.setOverlayEntries,
      setVisible: overlays.setOverlaySourceVisible,
      clearSource: overlays.clearOverlaySource,
      hitTest: overlays.hitTestWorldOverlay,
    },
  });
}
