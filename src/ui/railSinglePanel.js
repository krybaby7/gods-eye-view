/**
 * One panel open at a time in a rail.
 *
 * The rule came from the retired Cyber skin, which kept its right rail to a
 * single open panel. It only ever applied under Cyber, so the default rail does
 * not use it: `RIGHT_RAIL_SINGLE_PANEL` stays false and the module waits here,
 * tested, for the board-first frame to decide whether to switch it on.
 */

/** Whether the right rail keeps a single open panel. Off: the default rail never did. */
export const RIGHT_RAIL_SINGLE_PANEL = false;

/**
 * Marks a panel this rule closed, as distinct from one the user closed, so the
 * saved preference survives and the panel reopens if the rule is lifted.
 */
export const SINGLE_PANEL_COLLAPSED_CLASS = 'single-panel-collapsed';

/**
 * Normalise a rail during layout. With the rule on, every open panel but one is
 * closed: the most recently opened panel, else the one holding focus, else the
 * first. With the rule off, panels this rule closed are reopened.
 * @param {object} options
 * @param {HTMLElement[]} options.panels Rail panels in order.
 * @param {boolean} options.enabled Whether the rule applies.
 * @param {string|null} [options.preferredPanelId] Most recently opened panel.
 * @param {Element|null} [options.activeElement] Current keyboard focus.
 * @param {(panel: HTMLElement) => void} options.onCollapse Sync disclosure chrome.
 * @returns {HTMLElement|null} The panel left open, when the rule applies.
 */
export function applySinglePanelRule({
  panels,
  enabled,
  preferredPanelId = null,
  activeElement = null,
  onCollapse,
}) {
  if (!enabled) {
    for (const panel of panels) {
      if (!panel.classList.contains(SINGLE_PANEL_COLLAPSED_CLASS)) continue;
      panel.classList.remove('collapsed', SINGLE_PANEL_COLLAPSED_CLASS);
      onCollapse(panel);
    }
    return null;
  }
  const expanded = panels.filter(
    (panel) => !panel.classList.contains('collapsed'),
  );
  const owner =
    expanded.find((panel) => panel.id === preferredPanelId) ||
    expanded.find((panel) => activeElement && panel.contains(activeElement)) ||
    expanded[0] ||
    null;
  for (const panel of expanded) {
    if (panel === owner) continue;
    panel.classList.add('collapsed', SINGLE_PANEL_COLLAPSED_CLASS);
    onCollapse(panel);
  }
  return owner;
}

/**
 * Panels to close when a user opens `panel`: its docked, visible siblings. A
 * floating window sits outside the rule both ways.
 * @param {HTMLElement} panel Panel being opened.
 * @param {HTMLElement|null} rail Rail the rule governs.
 * @returns {HTMLElement[]}
 */
export function singlePanelPeersToClose(panel, rail) {
  if (!rail || panel?.parentElement !== rail) return [];
  if (panel.classList.contains('panel-floating')) return [];
  return [...rail.children].filter(
    (peer) =>
      peer !== panel &&
      peer.matches('[data-panel-id]') &&
      !peer.classList.contains('panel-floating') &&
      !peer.hidden,
  );
}
