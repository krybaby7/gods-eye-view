// The top bar's menu (roadmap 1.5): the original tools move into three
// panels opened from one button. Built on the real frame.html markup, with
// stand-ins for the original controls, each wired the way the app wires it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createFakeDocument } from '../testSupport/fakeDocument.mjs';
import {
  MENU_SECTIONS,
  MENU_SECTION_EVENT,
  createToolsMenu,
  openMenuSection,
} from './toolsMenu.js';
import { MENU_OPEN_EVENT } from './menuSections.js';
import { createGevActionRunner } from '../voice/gevActions.js';

const FRAME_HTML = readFileSync(
  new URL('./templates/frame.html', import.meta.url),
  'utf8',
);
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'path']);

/** Enough of an HTML parser for frame.html: tags, attributes, text. */
function appendHtml(document, parent, html) {
  const stack = [parent];
  const token =
    /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  for (const match of html.matchAll(token)) {
    const [, close, open, attrs, selfClose, text] = match;
    const top = stack.at(-1);
    if (close) stack.pop();
    else if (open) {
      const node = document.createElement(open);
      for (const [, name, value = ''] of (attrs || '').matchAll(
        /([\w:-]+)(?:="([^"]*)")?/g,
      )) {
        node.setAttribute(name, value);
        if (name.startsWith('data-'))
          node.dataset[
            name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())
          ] = value;
      }
      top.append(node);
      if (!selfClose && !VOID.has(open.toLowerCase())) stack.push(node);
    } else if (text && text.trim()) top.append(text.trim());
  }
}

function element(document, tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs))
    node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** The page as the menu finds it: the frame, then the original controls. */
function page({ omit = [], news = undefined, keySetup = 'ready' } = {}) {
  const document = createFakeDocument();
  appendHtml(document, document.body, FRAME_HTML);
  const used = [];
  const control = (id, tag = 'div', attrs = {}) => {
    if (omit.includes(id)) return null;
    const node = element(document, tag, { id, ...attrs });
    node.addEventListener('click', () => used.push(id));
    return node;
  };
  const dock = element(document, 'div', { id: 'command-dock' });
  const rail = element(document, 'div', { id: 'right-panel-stack' });
  const nav = element(document, 'div', { id: 'map-chrome' });
  document.body.append(dock, rail, nav);
  const location = control('location-bar', 'div', {
    class: 'panel-collapsible collapsed',
  });
  const styles = control('control-panel', 'div', {
    class: 'panel-collapsible collapsed',
  });
  if (location) dock.append(location);
  if (styles) dock.append(styles);
  const scenes = control('scene-panel', 'div', {
    class: 'panel-collapsible collapsed',
  });
  const toggles = control('pp-toggles');
  const drawGroup = element(document, 'div', { class: 'pp-toggle-group' });
  const draw = control('draw-toggle', 'button');
  if (draw) drawGroup.append(draw);
  const share = control('share-btn', 'button');
  for (const node of [toggles, drawGroup, scenes, share])
    if (node) rail.append(node);
  const globeNav = control('globe-navigation');
  if (globeNav) nav.append(globeNav);

  if (keySetup) {
    const chip = control('key-setup-chip', 'button');
    const dialog = element(document, 'aside', { id: 'key-setup' });
    if (keySetup === 'ready') dialog.dataset.keySetupReady = 'true';
    document.body.append(chip, dialog);
  }

  const situation = element(document, 'section', {
    id: 'situation-panel',
    class: 'collapsed',
  });
  const expand = element(document, 'button', {
    'data-collapse-target': 'situation-panel',
  });
  expand.addEventListener('click', () =>
    situation.classList.toggle('collapsed'),
  );
  situation.append(expand);
  document.body.append(situation);

  const calls = [];
  let state = { enabled: false, error: null };
  const subscribers = new Set();
  const newsModule =
    news === undefined
      ? {
          getSnapshot: () => state,
          subscribe(fn) {
            subscribers.add(fn);
            return () => subscribers.delete(fn);
          },
          refresh() {
            calls.push(['refresh']);
          },
        }
      : news;
  const dataManager = {
    async setEnabled(id, on, options) {
      calls.push(['setEnabled', id, on, options]);
      state = { ...state, enabled: on };
      for (const fn of subscribers) fn(state);
      return true;
    },
  };
  const menu = createToolsMenu({ document, dataManager, news: newsModule });
  const byId = (id) => document.getElementById(id);
  const key = (target, name) => {
    const event = {
      type: 'keydown',
      key: name,
      target,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    target.dispatchEvent(event);
    return event;
  };
  return { document, menu, byId, key, used, calls, dock, rail, nav, situation };
}

const panelOf = (node) => node.closest('[data-menu-section-panel]');

test('the menu button opens a list that the keyboard can walk and close', () => {
  const { document, menu, byId, key } = page();
  const button = byId('frame-menu');
  const list = byId('frame-menu-list');
  assert.equal(list.hidden, true);
  button.click();
  assert.equal(list.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, byId('frame-menu-item-sources'));
  key(list, 'ArrowDown');
  assert.equal(document.activeElement, byId('frame-menu-item-display'));
  key(list, 'End');
  assert.equal(document.activeElement, byId('frame-menu-item-tools'));
  key(list, 'ArrowDown');
  assert.equal(document.activeElement, byId('frame-menu-item-sources'));
  key(list, 'ArrowUp');
  assert.equal(document.activeElement, byId('frame-menu-item-tools'));
  key(list, 'Escape');
  assert.equal(list.hidden, true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, button, 'focus returns to the button');

  button.click();
  document.dispatchEvent({
    type: 'pointerdown',
    target: byId('frame-menu-item-tools'),
  });
  assert.equal(list.hidden, false, 'a press inside the menu keeps it open');
  document.dispatchEvent({ type: 'pointerdown', target: document.body });
  assert.equal(list.hidden, true, 'a press outside closes it');
  button.click();
  button.click();
  assert.equal(list.hidden, true, 'the button closes its own list');
  menu.destroy();
});

test('each entry opens its panel; the close button and Escape close it and return focus', () => {
  const { document, menu, byId, key } = page();
  const button = byId('frame-menu');
  for (const name of MENU_SECTIONS) {
    button.click();
    byId(`frame-menu-item-${name}`).click();
    const panel = byId(`frame-menu-${name}`);
    assert.equal(byId('frame-menu-list').hidden, true);
    assert.equal(panel.hidden, false, `${name} opens`);
    assert.equal(document.activeElement, panel);
    for (const other of MENU_SECTIONS.filter((n) => n !== name))
      assert.equal(
        byId(`frame-menu-${other}`).hidden,
        true,
        `only ${name} is open`,
      );
  }
  const tools = byId('frame-menu-tools');
  tools.querySelector('[data-menu-close="true"]').click();
  assert.equal(tools.hidden, true);
  assert.equal(document.activeElement, button);

  menu.open('display');
  const display = byId('frame-menu-display');
  const search = element(document, 'input', { type: 'search' });
  search.value = 'Lagos';
  display.append(search);
  const own = key(search, 'Escape');
  assert.equal(
    display.hidden,
    false,
    'Escape in a filled field stays with the field',
  );
  assert.equal(own.defaultPrevented, false);
  key(display, 'Escape');
  assert.equal(display.hidden, true);
  assert.equal(document.activeElement, button);
  menu.destroy();
});

test('every original control lands in its section, open, and still does its own job', () => {
  const { menu, byId, used } = page();
  const expected = {
    'control-panel': 'display',
    'pp-toggles': 'display',
    'location-bar': 'tools',
    'globe-navigation': 'tools',
    'draw-toggle': 'tools',
    'scene-panel': 'tools',
    'share-btn': 'tools',
  };
  for (const [id, section] of Object.entries(expected)) {
    const node = byId(id);
    assert.equal(
      panelOf(node)?.dataset.menuSectionPanel,
      section,
      `${id} is in ${section}`,
    );
    node.click();
  }
  assert.deepEqual(
    used,
    Object.keys(expected),
    'each control keeps its own wiring',
  );
  for (const id of ['control-panel', 'location-bar', 'scene-panel']) {
    assert.equal(
      byId(id).classList.contains('collapsed'),
      false,
      `${id} is open`,
    );
    assert.ok(
      Object.hasOwn(byId(id).dataset, 'panelFixed'),
      `${id} is pinned open`,
    );
  }
  assert.equal(byId('frame-group-share').hidden, false);
  menu.destroy();
});

test('a control this build lacks leaves no empty heading, and an empty section no entry', () => {
  const { menu, byId } = page({
    omit: ['share-btn', 'control-panel', 'pp-toggles'],
  });
  assert.equal(byId('frame-group-share').hidden, true);
  assert.equal(byId('frame-group-place').hidden, false);
  assert.equal(byId('frame-menu-item-display').hidden, true);
  assert.equal(menu.open('display'), false);
  assert.equal(byId('frame-menu-display').hidden, true);
  menu.destroy();
});

test('the War Monitor switch drives the layer, offers the panel, and never refreshes', async () => {
  const { document, menu, byId, calls, situation } = page();
  const toggle = byId('frame-war-switch');
  const openPanel = byId('frame-war-open');
  assert.equal(toggle.checked, false);
  assert.equal(
    openPanel.hidden,
    true,
    'no panel to offer while the layer is off',
  );

  toggle.checked = true;
  toggle.dispatchEvent({ type: 'change' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [['setEnabled', 'news', true, { origin: 'user' }]]);
  assert.equal(toggle.checked, true);
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.equal(openPanel.hidden, false);

  menu.open('sources');
  const sources = byId('frame-menu-sources');
  assert.equal(sources.hidden, false);
  openPanel.click();
  assert.equal(
    situation.classList.contains('collapsed'),
    false,
    'the panel opens',
  );
  assert.equal(
    sources.hidden,
    true,
    'the menu panel closes so it does not cover the War Monitor panel',
  );
  assert.equal(
    document.activeElement,
    situation.querySelector('[data-collapse-target="situation-panel"]'),
    'focus moves to the opened panel, not back to the menu button',
  );
  openPanel.click();
  assert.equal(
    situation.classList.contains('collapsed'),
    false,
    'and stays open',
  );

  toggle.checked = false;
  toggle.dispatchEvent({ type: 'change' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), [
    'setEnabled',
    'news',
    false,
    { origin: 'user' },
  ]);
  assert.equal(openPanel.hidden, true);
  assert.ok(
    !calls.some(([name]) => name === 'refresh'),
    'Refresh is never pressed',
  );
  menu.destroy();
});

test('without the War Monitor the switch is off and says why', () => {
  const { menu, byId } = page({ news: null });
  assert.equal(byId('frame-war-switch').disabled, true);
  assert.equal(byId('frame-war-note').hidden, false);
  assert.match(byId('frame-war-note').textContent, /not part of this build/);
  assert.equal(byId('frame-war-open').hidden, true);
  menu.destroy();
});

test('provider keys open the key setup dialog where the server offers it, and say so where not', () => {
  const ready = page();
  assert.equal(ready.byId('frame-keys-open').hidden, false);
  ready.byId('frame-keys-open').click();
  assert.deepEqual(ready.used, ['key-setup-chip'], 'the chip opens the dialog');
  ready.menu.destroy();

  const absent = page({ keySetup: null });
  assert.equal(absent.byId('frame-keys-open').hidden, true);
  assert.match(
    absent.byId('frame-keys-note').textContent,
    /only by the development server/,
  );
  absent.menu.destroy();

  const pending = page({ keySetup: 'pending' });
  assert.equal(pending.byId('frame-keys-open').hidden, true);
  assert.match(pending.byId('frame-keys-note').textContent, /^Checking/);
  pending.menu.destroy();
});

test('the key note follows a keys dialog that is put into the page later', () => {
  // A stand-in observer: the test calls every live one, as the browser would
  // after the dialog is appended and after it becomes ready.
  const observers = new Set();
  const previous = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      observers.add(this);
    }
    disconnect() {
      observers.delete(this);
    }
  };
  const notify = () => {
    for (const observer of [...observers]) observer.callback([]);
  };
  try {
    const { document, menu, byId } = page({ keySetup: null });
    assert.match(
      byId('frame-keys-note').textContent,
      /only by the development server/,
    );
    const chip = element(document, 'button', { id: 'key-setup-chip' });
    const dialog = element(document, 'aside', { id: 'key-setup' });
    document.body.append(chip, dialog);
    notify();
    assert.match(byId('frame-keys-note').textContent, /^Checking/);
    assert.equal(byId('frame-keys-open').hidden, true);
    dialog.dataset.keySetupReady = 'true';
    notify();
    assert.match(
      byId('frame-keys-note').textContent,
      /^Add or change the keys/,
    );
    assert.equal(byId('frame-keys-open').hidden, false);
    menu.destroy();
    assert.equal(observers.size, 0, 'every observer is let go on destroy');
  } finally {
    if (previous === undefined) delete globalThis.MutationObserver;
    else globalThis.MutationObserver = previous;
  }
});

test('other parts of the app open a section by import or by event', () => {
  const { document, menu, byId } = page();
  assert.equal(MENU_SECTION_EVENT, 'gev:open-menu-section');
  assert.equal(openMenuSection('display'), true);
  assert.equal(byId('frame-menu-display').hidden, false);
  assert.equal(
    openMenuSection('settings'),
    false,
    'an unknown name opens nothing',
  );

  document.dispatchEvent({
    type: MENU_SECTION_EVENT,
    detail: { section: 'tools' },
  });
  assert.equal(byId('frame-menu-tools').hidden, false);
  assert.equal(byId('frame-menu-display').hidden, true);
  document.dispatchEvent({
    type: MENU_SECTION_EVENT,
    detail: { section: 'none', only: 'display' },
  });
  assert.equal(
    byId('frame-menu-tools').hidden,
    false,
    'closing another section leaves this one',
  );
  document.dispatchEvent({
    type: MENU_SECTION_EVENT,
    detail: { section: 'none' },
  });
  assert.equal(byId('frame-menu-tools').hidden, true);
  menu.destroy();
  assert.equal(openMenuSection('tools'), false, 'no menu, nothing opens');
});

test('a press outside closes an open panel, but not a press on the globe or in a dialog', () => {
  const { document, menu, byId, dock } = page({ keySetup: false });
  const globe = element(document, 'div', { id: 'cesiumContainer' });
  const dialog = element(document, 'dialog');
  const keys = element(document, 'aside', { id: 'key-setup', role: 'dialog' });
  const closeKeys = element(document, 'button');
  keys.append(closeKeys);
  document.body.append(globe, dialog, keys);
  menu.open('display');
  const display = byId('frame-menu-display');
  document.dispatchEvent({ type: 'pointerdown', target: display });
  assert.equal(display.hidden, false, 'a press inside keeps it');
  document.dispatchEvent({ type: 'pointerdown', target: globe });
  assert.equal(display.hidden, false, 'the globe stays usable for picking');
  document.dispatchEvent({ type: 'pointerdown', target: dialog });
  assert.equal(display.hidden, false);
  document.dispatchEvent({ type: 'pointerdown', target: closeKeys });
  assert.equal(display.hidden, false, 'key setup keeps the opener available');
  document.dispatchEvent({ type: 'pointerdown', target: dock });
  assert.equal(display.hidden, true, 'a press elsewhere closes it');
  menu.destroy();
});

test('one menu at a time: the Menu announces itself and closes when another opens', () => {
  const { document, menu, byId } = page();
  const heard = [];
  document.addEventListener(MENU_OPEN_EVENT, (event) =>
    heard.push(event.detail.menu),
  );
  byId('frame-menu').click();
  assert.deepEqual(heard, ['menu']);
  document.dispatchEvent({ type: MENU_OPEN_EVENT, detail: { menu: 'layers' } });
  assert.equal(byId('frame-menu-list').hidden, true);
  menu.open('sources');
  document.dispatchEvent({ type: MENU_OPEN_EVENT, detail: { menu: 'menu' } });
  assert.equal(byId('frame-menu-sources').hidden, false, 'its own is ignored');
  document.dispatchEvent({ type: MENU_OPEN_EVENT, detail: { menu: 'legend' } });
  assert.equal(byId('frame-menu-sources').hidden, true);
  menu.destroy();
});

test('voice panel commands open and close a moved panel through its section', async () => {
  const { document, menu, byId } = page();
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const run = createGevActionRunner({
      viewer: {
        camera: { moveEnd: { addEventListener() {} } },
        clock: { onTick: { addEventListener() {} } },
        scene: { canvas: { addEventListener() {}, removeEventListener() {} } },
      },
      styleManager: {
        setPanelCollapsed() {
          throw new Error('a moved panel has no fold of its own');
        },
      },
      dataManager: {},
    });
    const opened = await run('set_panel_open', {
      panelId: 'location-bar',
      open: true,
    });
    assert.equal(opened.ok, true);
    assert.equal(byId('frame-menu-tools').hidden, false);
    await run('set_panel_open', { panelId: 'control-panel', open: false });
    assert.equal(
      byId('frame-menu-tools').hidden,
      false,
      'closing Display leaves Tools',
    );
    await run('set_panel_open', { panelId: 'location-bar', open: false });
    assert.equal(byId('frame-menu-tools').hidden, true);
  } finally {
    globalThis.document = previous;
    menu.destroy();
  }
});

test('destroy puts every control back where it was and removes its listeners', () => {
  const { document, menu, byId, dock, rail, nav } = page();
  menu.destroy();
  assert.deepEqual(
    dock.children.map((node) => node.id),
    ['location-bar', 'control-panel'],
  );
  assert.deepEqual(
    rail.children.map((node) => node.id || node.className),
    ['pp-toggles', 'pp-toggle-group', 'scene-panel', 'share-btn'],
  );
  assert.equal(byId('draw-toggle').parentNode.className, 'pp-toggle-group');
  assert.equal(nav.children[0].id, 'globe-navigation');
  for (const id of ['location-bar', 'control-panel', 'scene-panel']) {
    assert.equal(
      byId(id).classList.contains('collapsed'),
      true,
      `${id} folds again`,
    );
    assert.equal(Object.hasOwn(byId(id).dataset, 'panelFixed'), false);
  }
  assert.equal(document.listenerCount(MENU_SECTION_EVENT), 0);
  assert.equal(document.listenerCount('pointerdown'), 0);
  byId('frame-menu').click();
  assert.equal(byId('frame-menu-list').hidden, true, 'the button is inert');
});

test('a section opened from Layers returns focus to Layers, then resets its return target', () => {
  const { document, menu, byId, key } = page();
  const layers = byId('frame-layers');
  document.dispatchEvent({
    type: MENU_SECTION_EVENT,
    detail: { section: 'display', returnFocus: layers },
  });
  key(byId('frame-menu-display'), 'Escape');
  assert.equal(document.activeElement?.id, 'frame-layers');
  byId('frame-menu').click();
  byId('frame-menu-item-tools').click();
  key(byId('frame-menu-tools'), 'Escape');
  assert.equal(document.activeElement, byId('frame-menu'));
  menu.destroy();
});
