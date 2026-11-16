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
