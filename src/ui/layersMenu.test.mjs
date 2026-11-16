// The layers menu as a person uses it: the bottom bar's Layers button opens
// and closes it, Escape and a press outside close it, focus goes in and comes
// back, the on count and "Switch all off" follow the layer list, and the
// Presets button opens its own small menu. The page is a small model: the
// panel disclosure toggles `collapsed` as panelChrome.js does, and attribute
// changes reach the observers as a browser's MutationObserver would report.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayersMenu } from './layersMenu.js';
import { toggleLayersMenu } from './layersMenuToggle.js';
import { MENU_OPEN_EVENT, MENU_SECTION_EVENT } from './menuSections.js';

const observers = [];
class FakeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    observers.push(this);
  }
  observe(node, { attributeFilter }) {
    this.targets.push({ node, attributeFilter });
  }
  disconnect() {
    this.targets = [];
  }
}
function notify(node, attribute) {
  for (const observer of observers)
    if (
      observer.targets.some(
        (target) =>
          target.node === node && target.attributeFilter.includes(attribute),
      )
    )
      observer.callback([]);
}

function page({ links = [] } = {}) {
  observers.length = 0;
  globalThis.MutationObserver = FakeObserver;
  const byId = new Map();
  const document = { activeElement: null };
  // The window takes a key first, in the capture phase, as a browser's does.
  const window = {};
  document.defaultView = window;
  const listeners = new Map();
  function on(target, type, callback, options = {}) {
    const key = `${type}`;
    const list = listeners.get(target) || new Map();
    listeners.set(target, list);
    if (!list.has(key)) list.set(key, []);
    const entry = { callback };
    list.get(key).push(entry);
    options.signal?.addEventListener('abort', () => {
      list.set(
        key,
        list.get(key).filter((other) => other !== entry),
      );
    });
  }
  function fire(target, type, extra = {}) {
    const event = {
      type,
      target,
      defaultPrevented: false,
      stopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      },
      ...extra,
    };
    // A click or press bubbles from its target to the page.
    const path = [window];
    for (let node = target; node; node = node.parent) path.push(node);
    if (type === 'keydown' || type === 'pointerdown' || type === 'click')
      path.push(document);
    for (const node of path)
      for (const entry of listeners.get(node)?.get(type) || []) {
        if (event.stopped) return event;
        entry.callback(event);
      }
    return event;
  }
  function element(id, parent, { classes = [], dataset = {} } = {}) {
    const node = {
      id,
      parent,
      get parentNode() {
        return this.parent;
      },
      nextSibling: null,
      append(child) {
        child.parent = node;
      },
      insertBefore(child) {
        child.parent = node;
      },
      hidden: false,
      dataset: { ...dataset },
      attributes: new Map(),
      setAttribute(name, value) {
        this.attributes.set(name, String(value));
      },
      getAttribute(name) {
        return this.attributes.get(name) ?? null;
      },
      addEventListener(type, callback, options) {
        on(node, type, callback, options);
      },
      contains(other) {
        for (let up = other; up; up = up.parent) if (up === node) return true;
        return false;
      },
      closest(selector) {
        const match = /^\[data-opens-panel\]$/.test(selector);
        for (let up = node; up; up = up.parent)
          if (match && up.dataset?.opensPanel) return up;
        return null;
      },
      querySelector() {
        return null;
      },
      focus() {
        document.activeElement = node;
      },
      click() {
        fire(node, 'click');
      },
    };
    const names = new Set(classes);
    node.classList = {
      contains: (name) => names.has(name),
      add(name) {
        names.add(name);
        notify(node, 'class');
      },
      remove(name) {
        names.delete(name);
        notify(node, 'class');
      },
      toggle(name, force) {
        if (force ?? !names.has(name)) names.add(name);
        else names.delete(name);
        notify(node, 'class');
      },
    };
    if (id) byId.set(id, node);
    return node;
  }
  document.body = element('', null);
  document.addEventListener = (type, callback, options) =>
    on(document, type, callback, options);
  document.getElementById = (id) => byId.get(id) ?? null;
  window.addEventListener = (type, callback, options) =>
    on(window, type, callback, options);
  // Announcements and section requests are dispatched on the document.
  const announced = [];
  document.dispatchEvent = (event) => {
    announced.push(event);
    for (const entry of listeners.get(document)?.get(event.type) || [])
      entry.callback(event);
    return true;
  };

  const bar = element('frame-bottom', document.body);
  const button = element('frame-layers', bar);
  element('frame-layers-count', button);
  const presetsButton = element('frame-presets', bar);
  const presets = element('frame-presets-menu', bar);
  const firstPreset = element('preset-one', presets);
  presets.querySelector = (selector) =>
    selector === 'button' ? firstPreset : null;
  const menu = element('data-panel', document.body, {
    classes: ['layers-menu', 'collapsed'],
  });
  const head = element('', menu);
  element('layers-menu-count', head);
  const clear = element('clear-selected-layers', head);
  const close = element('layers-menu-close', head);
  // The panel's own disclosure, as panelChrome.js binds it.
  const disclosure = element('', head);
  disclosure.addEventListener('click', () =>
    menu.classList.toggle('collapsed'),
  );
  menu.querySelector = (selector) =>
    selector === '[data-collapse-target="data-panel"]' ? disclosure : null;
  const list = element('data-toggles', menu);
  const searchRow = element('', list, {
    dataset: { opensPanel: 'searches-panel' },
  });
  const searchName = element('', searchRow);
  const globe = element('cesiumContainer', document.body);
  // The cockpit's own chrome, drawn only in the cockpit.
  const cockpit = element('view-switcher', document.body);
  const cockpitLayers = element('cockpit-layers', cockpit);
  const cockpitPresets = element('cockpit-presets', cockpit);
  // The top bar's Menu items the foot links lead to, and the links.
  const items = Object.fromEntries(
    links.map((section) => [
      section,
      element(`frame-menu-item-${section}`, document.body),
    ]),
  );
  const foot = element('', menu);
  const footLinks = ['sources', 'display', 'tools'].map((section) =>
    element('', foot, { dataset: { menuSection: section } }),
  );
  menu.querySelectorAll = (selector) =>
    selector === '[data-menu-section]' ? footLinks : [];

  const controller = new AbortController();
  const made = [];
  const menuApi = createLayersMenu({
    document,
    signal: controller.signal,
    observers: made,
  });
  return {
    document,
    button,
    presetsButton,
    presets,
    firstPreset,
    menu,
    clear,
    close,
    list,
    searchRow,
    searchName,
    globe,
    cockpitLayers,
    cockpitPresets,
    items,
    footLinks,
    announced,
    bar,
    window,
    controller,
    menuApi,
    node: (id) => byId.get(id),
    fire,
    isOpen: () => !menu.classList.contains('collapsed'),
    setOnCount(count) {
      list.dataset.onCount = String(count);
      notify(list, 'data-on-count');
    },
  };
}

test('the Layers button opens the menu, reads as pressed, and moves focus in', () => {
  const p = page();
  assert.equal(p.isOpen(), false);
  assert.equal(p.button.getAttribute('aria-expanded'), 'false');
  p.button.focus();
  p.button.click();
  assert.equal(p.isOpen(), true);
  assert.equal(p.button.getAttribute('aria-expanded'), 'true');
  assert.equal(p.document.activeElement, p.menu);
  p.button.click();
  assert.equal(p.isOpen(), false);
  assert.equal(p.button.getAttribute('aria-expanded'), 'false');
  assert.equal(p.document.activeElement, p.button);
});

test('the close button and Escape close the menu and give focus back', () => {
  const p = page();
  p.button.click();
  p.close.focus();
  p.close.click();
  assert.equal(p.isOpen(), false);
  assert.equal(p.document.activeElement, p.button);

  p.button.click();
  p.clear.focus();
  const escape = p.fire(p.clear, 'keydown', { key: 'Escape' });
  assert.equal(p.isOpen(), false);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(p.document.activeElement, p.button);

  // Escape with nothing open is left to the rest of the page.
  const idle = p.fire(p.document.body, 'keydown', { key: 'Escape' });
  assert.equal(idle.defaultPrevented, false);
});

test('a press outside closes the menu; a press inside or on its button does not', () => {
  const p = page();
  p.button.click();
  p.fire(p.list, 'pointerdown');
  assert.equal(p.isOpen(), true, 'a press inside keeps it open');
  p.fire(p.button, 'pointerdown');
  assert.equal(p.isOpen(), true, 'its own button toggles on click instead');
  p.fire(p.globe, 'pointerdown');
  assert.equal(p.isOpen(), false);
});

test('opening the menu some other way (voice, a share link) is followed too', () => {
  const p = page();
  p.menu.classList.remove('collapsed');
  assert.equal(p.button.getAttribute('aria-expanded'), 'true');
  p.menu.classList.add('collapsed');
  assert.equal(p.button.getAttribute('aria-expanded'), 'false');
});

test('the on count reaches the head, the button and Switch all off', () => {
  const p = page();
  const count = p.node('frame-layers-count');
  const head = p.node('layers-menu-count');
  assert.equal(head.textContent, '0 on.');
  assert.equal(count.hidden, true);
  assert.equal(p.clear.hidden, true, 'nothing to switch off');
  assert.equal(p.button.getAttribute('aria-label'), 'Layers, none on');

  p.setOnCount(3);
  assert.equal(head.textContent, '3 on.');
  assert.equal(count.hidden, false);
  assert.equal(count.textContent, '3');
  assert.equal(p.clear.hidden, false);
  assert.equal(p.button.getAttribute('aria-label'), 'Layers, 3 on');

  p.setOnCount(0);
  assert.equal(count.hidden, true);
  assert.equal(p.clear.hidden, true);
});

test('opening the Search layers panel from its row closes the menu', () => {
  const p = page();
  p.button.click();
  p.searchRow.classList.add('on');
  p.searchName.click();
  assert.equal(p.isOpen(), true, 'switching the row off keeps the menu');
  p.searchRow.classList.remove('on');
  p.searchName.click();
  assert.equal(p.isOpen(), false, 'opening its panel closes the menu');
});

test('Presets opens its own menu, closing the layers menu, and Escape shuts it first', () => {
  const p = page();
  assert.equal(p.presets.hidden, true);
  p.button.click();
  p.presetsButton.click();
  assert.equal(p.presets.hidden, false);
  assert.equal(p.presetsButton.getAttribute('aria-expanded'), 'true');
  assert.equal(p.isOpen(), false, 'one menu at a time');
  assert.equal(p.document.activeElement, p.firstPreset);

  p.fire(p.firstPreset, 'keydown', { key: 'Escape' });
  assert.equal(p.presets.hidden, true);
  assert.equal(p.document.activeElement, p.presetsButton);

  p.presetsButton.click();
  p.fire(p.globe, 'pointerdown');
  assert.equal(p.presets.hidden, true, 'a press outside shuts it');

  p.presetsButton.click();
  p.button.click();
  assert.equal(p.presets.hidden, true, 'opening the layers menu shuts it');
  assert.equal(p.isOpen(), true);
});

test('after destroy, nothing is listened to and the Presets menu is shut', () => {
  const p = page();
  p.presetsButton.click();
  p.menuApi.destroy();
  p.controller.abort();
  assert.equal(p.presets.hidden, true);
  assert.equal(p.presetsButton.getAttribute('aria-expanded'), 'false');
  p.button.click();
  assert.equal(p.isOpen(), false);
});

test('the foot links show only for sections the Menu offers, and each closes the menu and asks for its section', () => {
  const p = page({ links: ['sources', 'display'] });
  p.button.click();
  const [sources, display, tools] = p.footLinks;
  assert.equal(sources.hidden, false);
  assert.equal(display.hidden, false);
  assert.equal(tools.hidden, true, 'no Menu item, no link that does nothing');
  p.items.display.hidden = true;
  p.button.click();
  p.button.click();
  assert.equal(display.hidden, true, 'a hidden Menu item hides its link');

  p.announced.length = 0;
  sources.click();
  assert.equal(p.isOpen(), false, 'the layers menu closes first');
  const request = p.announced.find(
    (event) => event.type === MENU_SECTION_EVENT,
  );
  assert.deepEqual(request?.detail, { section: 'sources' });
});

test('one menu at a time: each announces itself, and another menu opening closes both', () => {
  const p = page();
  p.button.click();
  assert.deepEqual(
    p.announced.filter((e) => e.type === MENU_OPEN_EVENT).map((e) => e.detail),
    [{ menu: 'layers' }],
  );
  p.document.dispatchEvent({
    type: MENU_OPEN_EVENT,
    detail: { menu: 'legend' },
  });
  assert.equal(p.isOpen(), false, 'the legend opening closes the layers menu');

  p.presetsButton.click();
  assert.deepEqual(p.announced.at(-1).detail, { menu: 'presets' });
  p.document.dispatchEvent({ type: MENU_OPEN_EVENT, detail: { menu: 'menu' } });
  assert.equal(p.presets.hidden, true, 'the top bar Menu closes Presets');
});

test('Escape is taken on the window first, so nothing behind the menu sees it', () => {
  const p = page();
  let behind = 0;
  p.document.addEventListener('keydown', () => behind++);
  p.button.click();
  const escape = p.fire(p.menu, 'keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.stopped, true);
  assert.equal(behind, 0, 'the cockpit and tracking never see it');
  assert.equal(p.isOpen(), false);
  p.fire(p.menu, 'keydown', { key: 'Escape' });
  assert.equal(behind, 1, 'with nothing open, Escape passes on');
});

test('in the cockpit its Layers and Presets buttons open the same menus, and focus returns to them', () => {
  const p = page();
  p.document.body.classList.add('cockpit-mode');
  p.cockpitLayers.focus();
  p.cockpitLayers.click();
  assert.equal(p.isOpen(), true, 'the same #data-panel opens');
  assert.equal(p.cockpitLayers.getAttribute('aria-expanded'), 'true');
  p.fire(p.cockpitLayers, 'pointerdown');
  assert.equal(p.isOpen(), true, 'its own button is not outside');
  p.fire(p.menu, 'keydown', { key: 'Escape' });
  assert.equal(p.isOpen(), false);
  assert.equal(p.document.activeElement, p.cockpitLayers);

  p.cockpitPresets.click();
  assert.equal(p.presets.hidden, false);
  assert.equal(p.cockpitPresets.getAttribute('aria-expanded'), 'true');
  assert.equal(
    p.presets.parent,
    p.document.body,
    'the bottom bar is not drawn in the cockpit, so the menu moves to the body',
  );
  p.fire(p.globe, 'pointerdown');
  assert.equal(p.presets.hidden, true, 'a press outside shuts it');
  assert.equal(p.presets.parent, p.bar, 'and it goes back home');

  p.cockpitPresets.click();
  p.document.body.classList.remove('cockpit-mode');
  assert.equal(p.presets.hidden, true, 'leaving the cockpit shuts it');
  assert.equal(p.presets.parent, p.bar);
});

test('outside the cockpit Presets stays in the bottom bar', () => {
  const p = page();
  p.presetsButton.click();
  assert.equal(p.presets.parent, p.bar);
});

test('F toggles the menu through its disclosure, but not where the menu is not drawn', () => {
  const p = page();
  assert.equal(toggleLayersMenu(p.document), true);
  assert.equal(p.isOpen(), true);
  assert.equal(toggleLayersMenu(p.document), true);
  assert.equal(p.isOpen(), false);
  p.document.body.classList.add('cockpit-mode');
  assert.equal(toggleLayersMenu(p.document), true, 'the cockpit draws it');
  assert.equal(p.isOpen(), true);
  toggleLayersMenu(p.document);
  for (const mode of ['recording-mode', 'ui-clean-view']) {
    p.document.body.classList.add(mode);
    assert.equal(toggleLayersMenu(p.document), false, mode);
    assert.equal(p.isOpen(), false);
    p.document.body.classList.remove(mode);
  }
});
