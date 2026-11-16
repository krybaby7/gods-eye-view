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
 * @param {object} options
 * @param {Document} options.document
 * @param {AbortSignal} options.signal Ends every listener.
 * @param {MutationObserver[]} options.observers Disconnected by the caller.
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
  const watch = (node, attributeFilter, callback) => {
    if (!node || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(callback);
    observer.observe(node, { attributes: true, attributeFilter });
    observers.push(observer);
  };
  const listen = (node, type, callback) =>
    node?.addEventListener?.(type, callback, { signal });

  // ── Presets: a small menu of the eight group presets ──
  const presetsOpen = () => Boolean(presets && !presets.hidden);
  function setPresets(open, { focus = false } = {}) {
    if (!presets) return;
    presets.hidden = !open;
    presetsButton?.setAttribute('aria-expanded', String(open));
    if (open && focus) presets.querySelector('button')?.focus?.();
  }
  function closePresets({ focus = false } = {}) {
    if (!presetsOpen()) return;
    const inside = presets.contains(document.activeElement);
    setPresets(false);
    if (focus || inside) presetsButton?.focus?.();
  }
  if (presetsButton && presets) {
    setPresets(false);
    listen(presetsButton, 'click', () => {
      if (presetsOpen()) closePresets();
      else {
        closeMenu();
        setPresets(true, { focus: true });
      }
    });
  } else if (presetsButton) presetsButton.hidden = true;

  // ── The layers menu ──
  if (!button || !menu) {
    if (button) button.hidden = true;
    return { close() {}, closePresets, destroy() {} };
  }
  const isOpen = () => !menu.classList.contains('collapsed');
  const disclosure = () =>
    menu.querySelector('[data-collapse-target="data-panel"]');
  /** Opens or closes through the panel's own disclosure, as before. */
  const toggle = () => disclosure()?.click();
  function closeMenu() {
    if (isOpen()) toggle();
  }

  let wasOpen = isOpen();
  function syncOpen() {
    const open = isOpen();
    button.setAttribute('aria-expanded', String(open));
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) {
      closePresets();
      menu.focus?.({ preventScroll: true });
      return;
    }
    // Focus that was in the menu, or fell to the page when it closed, goes
    // back to the button that opened it.
    const active = document.activeElement;
    if (!active || active === document.body || menu.contains(active))
      button.focus?.();
  }
  button.setAttribute('aria-expanded', String(wasOpen));
  watch(menu, ['class'], syncOpen);

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
  listen(close, 'click', closeMenu);
  listen(document, 'keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (presetsOpen()) {
      event.preventDefault?.();
      closePresets({ focus: true });
    } else if (isOpen()) {
      event.preventDefault?.();
      closeMenu();
      button.focus?.();
    }
  });
  // A press outside closes either menu; its own button toggles it instead.
  listen(document, 'pointerdown', (event) => {
    const target = event.target;
    if (
      presetsOpen() &&
      !presets.contains(target) &&
      !presetsButton.contains(target)
    )
      closePresets();
    if (isOpen() && !menu.contains(target) && !button.contains(target))
      closeMenu();
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
      if (presets) presets.hidden = true;
      presetsButton?.setAttribute('aria-expanded', 'false');
    },
  };
}
