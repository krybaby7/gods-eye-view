/**
 * The sections of the top bar's menu (src/ui/toolsMenu.js), for other parts
 * of the app that link to one, such as the foot of the layers menu.
 *
 * To open a section, either import `openMenuSection` from toolsMenu.js, or
 * dispatch the event on `document`, which needs no import of the menu:
 *
 *   document.dispatchEvent(
 *     new CustomEvent(MENU_SECTION_EVENT, { detail: { section: 'display' } }),
 *   );
 *
 * - `sources`: data sources and keys (provider keys, the War Monitor).
 * - `display`: visual presets, map source, render quality and display options.
 * - `tools`: scenes, recording, drawing, the share link, going to a place,
 *   the view controls and the navigation help.
 */
export const MENU_SECTIONS = Object.freeze(['sources', 'display', 'tools']);

/** The CustomEvent, dispatched on `document`, that opens a section. */
export const MENU_SECTION_EVENT = 'gev:open-menu-section';

/**
 * One menu at a time (piece 1.4): the layers menu, the Presets menu, the top
 * bar's Menu list and its panels, the sheet's More menu and the legend's
 * popover. A menu that opens dispatches this event on `document` with
 * `detail.menu` naming itself, before it moves focus; every other menu closes
 * on it without moving focus.
 */
export const MENU_OPEN_EVENT = 'gev:menu-open';

/** A CustomEvent where the document has one; a plain event in a test. */
function menuEvent(document, type, detail) {
  const Custom = document?.defaultView?.CustomEvent;
  return typeof Custom === 'function'
    ? new Custom(type, { detail })
    : { type, detail };
}

/** Says that `menu` is opening, so every other menu closes. */
export function announceMenuOpen(document, menu) {
  document?.dispatchEvent?.(menuEvent(document, MENU_OPEN_EVENT, { menu }));
}

/**
 * Calls `close` whenever a menu other than `menu` opens.
 * @param {Document} document
 * @param {string|string[]} menu the name, or names, this caller announces
 * @param {Function} close
 * @param {AbortSignal} [signal]
 */
export function closeWhenAnotherOpens(document, menu, close, signal) {
  const own = [menu].flat();
  document?.addEventListener?.(
    MENU_OPEN_EVENT,
    (event) => {
      if (!own.includes(event?.detail?.menu)) close(event?.detail?.menu);
    },
    signal ? { signal } : undefined,
  );
}

/** Opens a section of the top bar's menu with an optional focus return target. */
export function requestMenuSection(document, section, returnFocus) {
  document?.dispatchEvent?.(
    menuEvent(document, MENU_SECTION_EVENT, { section, returnFocus }),
  );
}
