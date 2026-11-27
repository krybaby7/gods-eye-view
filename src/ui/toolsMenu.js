import {
  MENU_OPEN_EVENT,
  MENU_SECTIONS,
  MENU_SECTION_EVENT,
  announceMenuOpen,
} from './menuSections.js';

export { MENU_SECTIONS, MENU_SECTION_EVENT };

/**
 * What each section holds, in order: the slot it fills (an element in
 * frame.html, `frame-slot-<name>`) and how to find the original control.
 * The controls keep their markup, ids and wiring; only their place changes.
 */
const SLOTS = Object.freeze({
  display: [
    ['styles', (find) => find('control-panel')],
    ['options', (find) => find('pp-toggles')],
  ],
  tools: [
    ['place', (find) => find('location-bar')],
    ['view', (find) => find('globe-navigation')],
    ['draw', (find) => find('draw-toggle')?.parentNode ?? null],
    ['scenes', (find) => find('scene-panel')],
    ['share', (find) => find('share-btn')],
  ],
});

const KEYS_PENDING = 'Checking whether this server offers key setup.';
const KEYS_ABSENT =
  'Key setup is offered only by the development server; this server does not offer it.';
const KEYS_READY =
  'Add or change the keys that switch on more feeds, and see the search agents and the War Monitor settings.';
const WAR_ABSENT = 'The War Monitor is not part of this build.';

let active = null;

/**
 * Opens one section of the top bar's menu, as if the viewer had chosen it.
 * @param {string} name one of MENU_SECTIONS
 * @returns {boolean} whether a menu is there and the section opened
 */
export function openMenuSection(name) {
  return active ? active.open(name) : false;
}

/**
 * The top bar's menu (roadmap 1.5): the original app's tools, out of the way
 * of the globe. A three-line button opens a short list; each entry opens a
 * floating panel that holds the original controls, moved there whole.
 * Panels open only when chosen and close by their close button, Escape or a
 * click outside, but not on a click on the globe, so drawing and picking
 * places still work while one is open. Like every menu, the list and the
 * panels close when another menu opens (MENU_OPEN_EVENT).
 *
 * @param {object} options
 * @param {Document} [options.document]
 * @param {{setEnabled: Function}} [options.dataManager]
 * @param {{getSnapshot: Function, subscribe: Function}} [options.news]
 */
export function createToolsMenu({
  document = globalThis.document,
  dataManager = null,
  news = null,
} = {}) {
  const find = (id) => document.getElementById(id);
  const button = find('frame-menu');
  const list = find('frame-menu-list');
  if (!button || !list) return { open: () => false, close() {}, destroy() {} };

  const listeners = [];
  const listen = (target, type, handler, capture = false) => {
    if (!target) return;
    target.addEventListener(type, handler, capture);
    listeners.push(() => target.removeEventListener(type, handler, capture));
  };
  const cleanups = [];
  const moved = [];

  const items = MENU_SECTIONS.map((name) => find(`frame-menu-item-${name}`));
  const tour = find('frame-menu-item-tour');
  const panels = Object.fromEntries(
    MENU_SECTIONS.map((name) => [name, find(`frame-menu-${name}`)]),
  );
  let openName = null;
  let panelReturnFocus = button;

  // ── Move the original controls into their slots ──
  for (const [section, slots] of Object.entries(SLOTS)) {
    let filled = 0;
    for (const [slotName, locate] of slots) {
      const slot = find(`frame-slot-${slotName}`);
      const group = find(`frame-group-${slotName}`) ?? slot;
      const node = locate(find);
      if (!slot) continue;
      // An absent control leaves no empty heading behind (decision 32).
      if (group) group.hidden = !node;
      if (!node) continue;
      filled += 1;
      moved.push({
        node,
        parent: node.parentNode,
        next: node.nextSibling,
        collapsed: node.classList?.contains('collapsed') ?? false,
      });
      slot.append(node);
      fixOpen(node);
    }
    // A section with nothing in it has no entry.
    const item = find(`frame-menu-item-${section}`);
    if (item && filled === 0) item.hidden = true;
  }

  /**
   * A moved panel stays open: its own collapse and hover disclosure belong to
   * the dock it left. `data-panel-fixed` tells the panel chrome to leave it.
   */
  function fixOpen(node) {
    if (!node.classList?.contains('panel-collapsible')) return;
    node.classList.remove('collapsed');
    node.dataset.panelFixed = '';
    // Cockpit entry and its exit set the class directly, not through the
    // panel chrome; inside the menu a panel has no collapsed state.
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      if (node.classList.contains('collapsed'))
        node.classList.remove('collapsed');
    });
    observer.observe(node, { attributes: true, attributeFilter: ['class'] });
    cleanups.push(() => observer.disconnect());
  }

  // ── The list ──
  const enabledItems = () =>
    [...items, tour].filter((item) => item && !item.hidden);
  function setListOpen(state, { focus = false } = {}) {
    list.hidden = !state;
    button.setAttribute('aria-expanded', String(state));
    if (state) {
      announceMenuOpen(document, 'menu');
      enabledItems()[0]?.focus();
    } else if (focus) button.focus();
  }

  listen(button, 'click', () => {
    if (!list.hidden) {
      setListOpen(false);
      return;
    }
    close();
    setListOpen(true);
  });
  listen(list, 'keydown', (event) => {
    const choices = enabledItems();
    const at = choices.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault?.();
      setListOpen(false, { focus: true });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault?.();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      choices[(at + step + choices.length) % choices.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault?.();
      (event.key === 'Home' ? choices[0] : choices.at(-1))?.focus();
    } else if (event.key === 'Tab') {
      setListOpen(false);
    }
  });
  MENU_SECTIONS.forEach((name, index) =>
    listen(items[index], 'click', () => {
      setListOpen(false);
      open(name);
    }),
  );
  listen(tour, 'click', () => setListOpen(false, { focus: true }));
  listen(document, 'pointerdown', (event) => {
    if (list.hidden) return;
    const host = button.parentNode;
    if (host?.contains?.(event.target)) return;
    setListOpen(false);
  });

  // ── The section panels ──
  function open(name, { returnFocus = button } = {}) {
    const panel = panels[name];
    const index = MENU_SECTIONS.indexOf(name);
    if (!panel || index < 0 || items[index]?.hidden) return false;
    setListOpen(false);
    for (const [other, node] of Object.entries(panels))
      if (node && other !== name) node.hidden = true;
    panel.hidden = false;
    openName = name;
    panelReturnFocus = returnFocus;
    announceMenuOpen(document, 'menu');
    panel.focus();
    return true;
  }
  function close({ focus = false } = {}) {
    if (!openName) return;
    const panel = panels[openName];
    const back = panelReturnFocus;
    openName = null;
    panelReturnFocus = button;
    if (panel) panel.hidden = true;
    if (focus) back.focus();
  }
  for (const panel of Object.values(panels)) {
    if (!panel) continue;
    for (const closer of panel.querySelectorAll('[data-menu-close="true"]'))
      listen(closer, 'click', () => close({ focus: true }));
    // Capture: a moved panel's own Escape handler (panelDisclosure.js) stops
    // the key from bubbling, and its collapse is a no-op for a fixed panel.
    listen(
      panel,
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        const target = event.target;
        // Escape in a text field that holds text belongs to that field.
        if (target && target !== panel && isOwnEscape(target)) return;
        event.preventDefault?.();
        close({ focus: true });
      },
      true,
    );
  }

  // A press outside an open panel closes it, except on the globe (drawing,
  // picking a place) or in a dialog a panel's control opened (the keys).
  listen(document, 'pointerdown', (event) => {
    const panel = openName ? panels[openName] : null;
    const target = event.target;
    if (!panel || panel.contains(target)) return;
    if (button.parentNode?.contains?.(target)) return;
    const onGlobe = ['cesiumContainer', 'world-overlay-root'].some((id) =>
      find(id)?.contains?.(target),
    );
    if (
      onGlobe ||
      target?.closest?.('dialog') ||
      find('key-setup')?.contains(target)
    )
      return;
    close();
  });
  // One menu at a time: another menu opening closes the list and the panel.
  listen(document, MENU_OPEN_EVENT, (event) => {
    if (event?.detail?.menu === 'menu') return;
    if (!list.hidden) setListOpen(false);
    close();
  });

  listen(document, MENU_SECTION_EVENT, (event) => {
    const name = event?.detail?.section;
    const only = event?.detail?.only;
    if (name === null || name === 'none') {
      // `only`: close that section if it is the one open, and nothing else.
      if (!only || only === openName) close();
    } else open(name, { returnFocus: event?.detail?.returnFocus });
  });

  // ── Data sources and keys ──
  setUpKeys();
  setUpWarMonitor();

  function setUpKeys() {
    const note = find('frame-keys-note');
    const openKeys = find('frame-keys-open');
    if (!note || !openKeys) return;
    // Writes only on a change: a page-wide observer below would otherwise
    // see its own write and call this again without end.
    function sync() {
      const dialog = find('key-setup');
      const chip = find('key-setup-chip');
      const ready =
        Boolean(dialog && chip) && dialog.dataset?.keySetupReady === 'true';
      const words =
        !dialog || !chip ? KEYS_ABSENT : ready ? KEYS_READY : KEYS_PENDING;
      if (note.textContent !== words) note.textContent = words;
      if (openKeys.hidden !== !ready) openKeys.hidden = !ready;
    }
    sync();
    listen(openKeys, 'click', () => {
      // The chip owns opening the dialog (src/keySetup.js); it stays hidden.
      find('key-setup-chip')?.click();
    });
    if (typeof MutationObserver === 'undefined') return;
    // The note follows the dialog: its readiness, and the dialog itself
    // when it is put into the page after the menu was set up.
    let watched = null;
    const readiness = new MutationObserver(sync);
    cleanups.push(() => readiness.disconnect());
    let arrival = null;
    function watch() {
      const dialog = find('key-setup');
      if (dialog && dialog !== watched) {
        watched = dialog;
        readiness.observe(dialog, {
          attributes: true,
          attributeFilter: ['data-key-setup-ready'],
        });
        if (dialog.parentNode)
          readiness.observe(dialog.parentNode, { childList: true });
      }
      if (dialog && find('key-setup-chip')) {
        arrival?.disconnect();
        arrival = null;
      }
    }
    watch();
    const root = document.body ?? document.documentElement;
    if (root && !(watched && find('key-setup-chip'))) {
      arrival = new MutationObserver(() => {
        watch();
        sync();
      });
      arrival.observe(root, { childList: true, subtree: true });
      cleanups.push(() => arrival?.disconnect());
    }
  }

  function setUpWarMonitor() {
    const toggle = find('frame-war-switch');
    const note = find('frame-war-note');
    const openPanel = find('frame-war-open');
    if (!toggle) return;
    if (!news || typeof dataManager?.setEnabled !== 'function') {
      toggle.disabled = true;
      toggle.checked = false;
      if (note) {
        note.textContent = WAR_ABSENT;
        note.hidden = false;
      }
      if (openPanel) openPanel.hidden = true;
      return;
    }
    let pending = false;
    let failure = '';
    function sync() {
      const snapshot = news.getSnapshot?.() ?? {};
      const enabled = Boolean(snapshot.enabled);
      toggle.checked = enabled;
      toggle.setAttribute('aria-checked', String(enabled));
      toggle.disabled = pending;
      if (openPanel) openPanel.hidden = !enabled;
      const message = failure || (snapshot.error ? String(snapshot.error) : '');
      if (note) {
        note.textContent = message;
        note.hidden = !message;
      }
    }
    listen(toggle, 'change', async () => {
      const want = Boolean(toggle.checked);
      pending = true;
      failure = '';
      sync();
      toggle.checked = want;
      try {
        await dataManager.setEnabled('news', want, { origin: 'user' });
      } catch (error) {
        failure = `The War Monitor layer could not be ${want ? 'shown' : 'hidden'}: ${error?.message ?? error}`;
      } finally {
        pending = false;
        sync();
      }
    });
    listen(openPanel, 'click', () => {
      // The menu's panel floats above the right rail, where the War Monitor
      // panel opens, so it closes first; focus goes to the opened panel.
      close();
      // The panel's own expand control opens it; this never presses Refresh.
      const panel = find('situation-panel');
      const expand = panel?.querySelector(
        '[data-collapse-target="situation-panel"]',
      );
      if (panel?.classList?.contains('collapsed')) expand?.click();
      panel?.scrollIntoView?.({ block: 'nearest' });
      expand?.focus?.();
    });
    const unsubscribe = news.subscribe?.(sync);
    if (typeof unsubscribe === 'function') cleanups.push(unsubscribe);
    sync();
  }

  const instance = {
    open,
    close: () => close(),
    destroy() {
      for (const remove of listeners.splice(0)) remove();
      for (const cleanup of cleanups.splice(0)) cleanup();
      for (const { node, parent, next, collapsed } of moved
        .splice(0)
        .reverse()) {
        if (node.dataset && Object.hasOwn(node.dataset, 'panelFixed')) {
          delete node.dataset.panelFixed;
          if (collapsed) node.classList.add('collapsed');
        }
        if (!parent) continue;
        parent.insertBefore(
          node,
          next && next.parentNode === parent ? next : null,
        );
      }
      if (active === instance) active = null;
    },
  };
  active = instance;
  return instance;
}

function isOwnEscape(target) {
  const tag = String(target.tagName || '').toUpperCase();
  const textual =
    tag === 'TEXTAREA' ||
    (tag === 'INPUT' &&
      /^(text|search|)$/.test(String(target.getAttribute?.('type') ?? '')));
  return textual && String(target.value ?? '') !== '';
}
