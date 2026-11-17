// The F key's way to the layers menu (src/ui/layersMenu.js), kept apart so
// the display bindings need not import the menu.

/** Modes whose styles do not draw the layers menu (recording, clean, embed). */
const MODES_WITHOUT_MENU = Object.freeze(['recording-mode', 'ui-clean-view']);

/**
 * Opens or closes the layers menu through its own disclosure, as the Layers
 * buttons do (the F key). Does nothing in a mode that does not draw it.
 * @param {Document} document
 * @returns {boolean} whether the menu was toggled
 */
export function toggleLayersMenu(document) {
  const classes = document?.body?.classList;
  if (MODES_WITHOUT_MENU.some((name) => classes?.contains?.(name)))
    return false;
  const disclosure = document
    ?.getElementById?.('data-panel')
    ?.querySelector?.('[data-collapse-target="data-panel"]');
  if (!disclosure) return false;
  disclosure.click();
  return true;
}
