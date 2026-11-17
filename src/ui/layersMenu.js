import {
  announceMenuOpen,
  closeWhenAnotherOpens,
  requestMenuSection,
} from './menuSections.js';

/**
 * The bottom bar's Layers and Presets buttons, and the layers menu they open.
 *
 * The menu is the old layer list (#data-panel) floated above the bar. Its
 * open state stays the panel's own `collapsed` class, so voice, share links
 * and the panel disclosure keep opening and closing it; this module only
 * follows that state: the button reads as pressed, focus moves in and back
 * out, and Escape or a click outside closes it. The on count is the layer
 * list's (`data-on-count`, written by layerPanel.js from the layer manager).
 *
 * In the cockpit the bottom bar is not drawn, so the cockpit's own Layers
 * and Presets buttons (#cockpit-layers, #cockpit-presets) open the same two
 * menus. Outside the cockpit, the menu's foot links open sections of the top
 * bar's Menu. Both menus close when another menu opens (MENU_OPEN_EVENT).
 *
 * @param {object} options
 * @param {Document} options.document
 * @param {AbortSignal} options.signal Ends every listener.
 * @param {(MutationObserver|ResizeObserver)[]} options.observers Disconnected by the caller.
 * @returns {{close: Function, closePresets: Function, destroy: Function}}
 */
export function createLayersMenu({ document, signal, observers }) {
  const find = (id) => document.getElementById(id);
  const button = find('frame-layers');
  const menu = find('data-panel');
  const buttonCount = find('frame-layers-count');
  const headCount = find('layers-menu-count');
  const clear = find('clear-selected-layers');
  const close = find('layers-menu-close');
  const list = find('data-toggles');
  const presetsButton = find('frame-presets');
  const presets = find('frame-presets-menu');
  const cockpitLayers = find('cockpit-layers');
  const cockpitPresets = find('cockpit-presets');
  const inCockpit = () =>
    Boolean(document.body?.classList?.contains('cockpit-mode'));
  /** The button focus returns to: the cockpit's own while in the cockpit. */
  const home = (frameButton, cockpitButton) =>
    inCockpit() && cockpitButton && !cockpitButton.hidden
      ? cockpitButton
      : frameButton;
  const watch = (node, attributeFilter, callback, options) => {
    if (!node || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(callback);
    observer.observe(node, { attributes: true, attributeFilter, ...options });
    observers.push(observer);
  };
  const listen = (node, type, callback, capture = false) =>
    node?.addEventListener?.(type, callback, { signal, capture });
  const pressed = (node, open) =>
    node?.setAttribute?.('aria-expanded', String(open));
  const within = (target, ...nodes) =>
    nodes.some((node) => node?.contains?.(target));

  // ── Presets: a small menu of the eight group presets ──
  const presetsOpen = () => Boolean(presets && !presets.hidden);
  // The Presets menu lives in the bottom bar, which the cockpit does not
  // draw; opened there, the same element moves to the body until it closes.
  const presetsHome = presets
    ? { parent: presets.parentNode, next: presets.nextSibling }
    : null;
  function placePresets(open) {
    if (!presetsHome?.parent || !document.body) return;
    if (open && inCockpit()) {
      if (presets.parentNode !== document.body) document.body.append(presets);
    } else if (presets.parentNode !== presetsHome.parent) {
      const next = presetsHome.next;
      presetsHome.parent.insertBefore(
        presets,
        next && next.parentNode === presetsHome.parent ? next : null,
      );
    }
  }
  function setPresets(open, { focus = false } = {}) {
    if (!presets) return;
    placePresets(open);
    presets.hidden = !open;
    pressed(presetsButton, open);
    pressed(cockpitPresets, open);
    if (!open) return;
    announceMenuOpen(document, 'presets');
    if (focus) presets.querySelector('button')?.focus?.();
  }
  function closePresets({ focus = false } = {}) {
    if (!presetsOpen()) return;
    const inside = presets.contains(document.activeElement);
    const back = home(presetsButton, cockpitPresets);
    setPresets(false);
    if (focus || inside) back?.focus?.();
  }
  function togglePresets() {
    if (presetsOpen()) closePresets();
    else {
      closeMenu();
      setPresets(true, { focus: true });
    }
  }
  if (presets) {
    setPresets(false);
    listen(presetsButton, 'click', togglePresets);
    listen(cockpitPresets, 'click', togglePresets);
  } else {
    if (presetsButton) presetsButton.hidden = true;
    if (cockpitPresets) cockpitPresets.hidden = true;
  }

  // ── The layers menu ──
  const isOpen = () => Boolean(menu && !menu.classList.contains('collapsed'));
  const disclosure = () =>
    menu?.querySelector('[data-collapse-target="data-panel"]');
  /** Opens or closes through the panel's own disclosure, as before. */
  const toggle = () => disclosure()?.click();
  function closeMenu() {
    if (isOpen()) toggle();
  }
  if (!button || !menu) {
    if (button) button.hidden = true;
    if (cockpitLayers) cockpitLayers.hidden = true;
    return { close() {}, closePresets, destroy() {} };
  }

  // Measure the rail independently of its visibility so covered panels can
  // reappear as soon as the popup moves or shrinks away from them.
  const rail = find('right-context-rail');
  let covered = new Set();
  const coveredAttribute = 'data-layers-obscured';
  function syncRail() {
    if (!rail) return;
    const open = isOpen();
    if (!open && covered.size === 0) return;
    const next = new Set();
    if (
      open &&
      !menu.hidden &&
      !inCockpit() &&
      menu.checkVisibility?.({
        opacityProperty: true,
        visibilityProperty: true,
      }) !== false
    ) {
      const box = menu.getBoundingClientRect();
      if (box.width && box.height) {
        for (const panel of rail.children) {
          if (!panel.dataset.panelId || panel.hidden) continue;
          const rect = panel.getBoundingClientRect();
          if (
            rect.width &&
            rect.height &&
            rect.left < box.right &&
            rect.right > box.left &&
            rect.top < box.bottom &&
            rect.bottom > box.top
          )
            next.add(panel);
        }
      }
    }
    for (const panel of covered)
      if (!next.has(panel)) panel.removeAttribute(coveredAttribute);
    for (const panel of next)
      if (!covered.has(panel)) panel.setAttribute(coveredAttribute, '');
    covered = next;
  }
  if (rail) {
    const resize =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(syncRail)
        : null;
    function observeRailSizes() {
      if (!resize) return;
      resize.disconnect();
      resize.observe(menu);
      resize.observe(rail);
      for (const panel of rail.children)
        if (panel.dataset.panelId) resize.observe(panel);
    }
    if (resize) {
      observers.push(resize);
      observeRailSizes();
    }
    watch(
      rail,
      ['class', 'hidden', 'style'],
      (records) => {
        if (
          records.some(
            ({ type, target }) => type === 'childList' && target === rail,
          )
        )
          observeRailSizes();
        if (
          records.some(
            ({ target }) => target === rail || target.parentElement === rail,
          )
        )
          syncRail();
      },
      { childList: true, subtree: true },
    );
    watch(document.body, ['data-today', 'data-sheet'], syncRail);
    listen(document.defaultView, 'resize', syncRail);
    listen(rail, 'transitionend', syncRail);
    listen(rail, 'transitioncancel', syncRail);
    syncRail();
  }

  // The section links show only where the top bar's Menu offers the section.
  const links = [...(menu.querySelectorAll?.('[data-menu-section]') ?? [])];
  function syncLinks() {
    const cockpit = inCockpit();
    for (const link of links) {
      const item = find(`frame-menu-item-${link.dataset.menuSection}`);
      link.hidden = cockpit || !item || Boolean(item.hidden);
    }
  }

  let wasOpen = isOpen();
  function syncOpen() {
    const open = isOpen();
    pressed(button, open);
    pressed(cockpitLayers, open);
    syncRail();
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) {
      closePresets();
      syncLinks();
      announceMenuOpen(document, 'layers');
      menu.focus?.({ preventScroll: true });
      return;
    }
    // Focus that was in the menu, or fell to the page when it closed, goes
    // back to the button that opened it.
    const active = document.activeElement;
    if (!active || active === document.body || menu.contains(active))
      home(button, cockpitLayers)?.focus?.();
  }
  pressed(button, wasOpen);
  pressed(cockpitLayers, wasOpen);
  syncLinks();
  watch(menu, ['class', 'hidden', 'style'], syncOpen);
  // The frame's Menu is hidden in the cockpit. Leaving also puts both
  // menus back in their closed state at the bottom bar.
  let wasCockpit = inCockpit();
  watch(document.body, ['class'], () => {
    const cockpit = inCockpit();
    syncRail();
    if (cockpit === wasCockpit) return;
    wasCockpit = cockpit;
    syncLinks();
    closePresets();
    if (!cockpit) closeMenu();
  });

  function syncCount() {
    const count = Number(list?.dataset.onCount) || 0;
    if (headCount) headCount.textContent = `${count} on.`;
    if (buttonCount) {
      buttonCount.hidden = count === 0;
      buttonCount.textContent = String(count);
    }
    button.setAttribute(
      'aria-label',
      count ? `Layers, ${count} on` : 'Layers, none on',
    );
    if (clear) clear.hidden = count === 0;
  }
  syncCount();
  watch(list, ['data-on-count'], syncCount);

  listen(button, 'click', toggle);
  listen(cockpitLayers, 'click', toggle);
  listen(close, 'click', closeMenu);
  // Escape closes only the open menu. It is taken first, on the window in
  // the capture phase, so the cockpit (which exits on Escape) and a tracked
  // aircraft (which is let go) never see it while one of these menus is open.
  listen(
    document.defaultView ?? document,
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!presetsOpen() && !isOpen()) return;
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      if (presetsOpen()) {
        closePresets({ focus: true });
        return;
      }
      const back = home(button, cockpitLayers);
      closeMenu();
      back?.focus?.();
    },
    true,
  );
  // A press outside closes either menu; its own buttons toggle it instead.
  listen(document, 'pointerdown', (event) => {
    const target = event.target;
    if (
      presetsOpen() &&
      !within(target, presets, presetsButton, cockpitPresets)
    )
      closePresets();
    if (isOpen() && !within(target, menu, button, cockpitLayers)) closeMenu();
  });
  // One menu at a time: another menu opening closes both of these.
  closeWhenAnotherOpens(
    document,
    ['layers', 'presets'],
    () => {
      closePresets();
      closeMenu();
    },
    signal,
  );
  // The foot's links open a section of the top bar's Menu: this menu closes
  // first, and the opened panel takes focus.
  for (const link of links)
    listen(link, 'click', () => {
      if (inCockpit() || link.hidden) return;
      closeMenu();
      requestMenuSection(document, link.dataset.menuSection, button);
    });
  // Opening the Search layers panel from its row (a row that is off; the row
  // has already handled the click) closes the menu, so the panel is not
  // under it. Switching that row off leaves the menu open.
  listen(menu, 'click', (event) => {
    const row = event.target?.closest?.('[data-opens-panel]');
    if (row && !row.classList.contains('on')) closeMenu();
  });

  return {
    close: closeMenu,
    closePresets,
    destroy() {
      for (const panel of covered) panel.removeAttribute(coveredAttribute);
      covered.clear();
      if (presets) {
        presets.hidden = true;
        placePresets(false);
      }
      pressed(presetsButton, false);
      pressed(cockpitPresets, false);
    },
  };
}
