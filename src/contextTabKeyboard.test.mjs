import { customProperties, htmlNodes, resolveVars, rules, winners } from './testSupport/cssCascade.mjs';
import { readShellSource } from './testSupport/readShellSource.mjs';
import { expandApplicationHtml } from '../build/application-html.js';
import { readStylesheet } from './testSupport/readStylesheet.mjs';
import { _selectContextMode } from './ui/contextTransactions.js';
import { _syncContextModeButtons } from './ui/contextPresentation.js';
import { _initGlobalContextPanel } from './ui/contextBindings.js';
import { clearSelectedLayers } from './ui/contextActions.js';
import { readFileSync as readRadioSource } from 'node:fs';
const radioBindings = readRadioSource(new URL('./ui/radioBindings.js', import.meta.url), 'utf8');
const radioPresentation = readRadioSource(new URL('./ui/radioPresentation.js', import.meta.url), 'utf8');
const radioControlsSource = readRadioSource(new URL('./ui/radioControls.js', import.meta.url), 'utf8');
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = expandApplicationHtml(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
const ui = readShellSource();
const css = readStylesheet(new URL('../style.css', import.meta.url));

test('Context header and title resolve before the embedded Radio chrome', () => {
  const nodes = htmlNodes(html);
  const inContext = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent)
      if (parent.id === 'global-context-panel') return true;
    return false;
  };
  const contextNodes = nodes.filter(inContext);
  const header = contextNodes.find((node) => node.classes.has('panel-header'));
  const title = contextNodes.find((node) => node.classes.has('panel-title'));
  const radioDock = contextNodes.find((node) => node.id === 'context-radio-dock');
  assert.equal(header?.tag, 'header');
  assert.equal(title?.id, 'global-context-panel-title');
  assert.equal(title.parent, header);
  assert.equal(radioDock.parent, header);
});

test('Contacts and Space Missions both participate in the ordinary Tab sequence', () => {
  for (const id of ['global-context-flights-btn', 'global-context-missions-btn']) {
    const button = html.match(new RegExp(`<button id="${id}"[\\s\\S]*?</button>`));
    assert.ok(button, `${id} is missing`);
    assert.match(button[0], /role="tab"/);
    assert.match(button[0], /\bkit-seg-item\b/);
    assert.match(button[0], /tabindex="0"/);
  }

  const syncSource = _syncContextModeButtons.toString();
  assert.match(syncSource, /\[\s*this\._globalContextFlightsBtn,\s*this\._globalContextMissionsBtn,?\s*\]/);
  assert.match(syncSource, /button\.tabIndex = 0/);
  assert.doesNotMatch(syncSource, /tabIndex\s*=\s*[^;]*\?\s*-1/);
});

test('Context transition state preserves focus and Tab availability until settle', () => {
  const syncSource = _syncContextModeButtons.toString();

  const attributes = () => new Map();
  const makeButton = () => {
    const attrs = attributes();
    let disabled = false;
    const button = {
      attrs,
      tabIndex: -1,
      classList: { toggle() {} },
      setAttribute(name, value) { attrs.set(name, String(value)); },
      get disabled() { return disabled; },
      set disabled(value) {
        disabled = Boolean(value);
        // Model the browser behavior that exposed this regression: native
        // disabled drops focus immediately.
        if (disabled && globalThis.document?.activeElement === button) {
          globalThis.document.activeElement = null;
        }
      },
    };
    return button;
  };
  const contacts = makeButton();
  const missions = makeButton();
  const panel = { classList: { toggle() {} }, setAttribute() {} };
  const priorDocument = globalThis.document;
  globalThis.document = { activeElement: missions, getElementById: () => panel };
  const owner = {
    _globalContextPanel: panel,
    actions: { syncDetection() {}, scheduleLayout() {} },
    _contextMode: null,
    _contextModeChanging: true,
    _globalContextFlightsBtn: contacts,
    _globalContextMissionsBtn: missions,
    _contextModeStandby: {},
    _contextFlightsView: {},
    _contextMissionsView: {},
    cockpitView: { syncEntry() {} },
    _syncContactsDetection() {},
    _scheduleRightPanelLayout() {},
  };
  try {
    _syncContextModeButtons.call(owner);
    assert.equal(globalThis.document.activeElement, missions, 'busy sync retains focused Space Missions');
    for (const button of [contacts, missions]) {
      assert.equal(button.disabled, false);
      assert.equal(button.tabIndex, 0);
      assert.equal(button.attrs.get('aria-disabled'), 'true');
      assert.equal(button.attrs.get('aria-busy'), 'true');
    }

    owner._contextModeChanging = false;
    owner._contextMode = 'space-missions';
    _syncContextModeButtons.call(owner);
    assert.equal(globalThis.document.activeElement, missions, 'settled sync retains focused Space Missions');
    for (const button of [contacts, missions]) {
      assert.equal(button.disabled, false);
      assert.equal(button.tabIndex, 0);
      assert.equal(button.attrs.get('aria-disabled'), 'false');
      assert.equal(button.attrs.get('aria-busy'), 'false');
    }
  } finally {
    globalThis.document = priorDocument;
  }
});

test('Context activation and Clear All never native-disable tabs and guard repeated clicks', () => {
  const init = _initGlobalContextPanel.toString();
  const select = _selectContextMode.toString();
  const clear = clearSelectedLayers.toString();
  assert.equal((init.match(/if \(\s*this\.destroyed\s*\|\|\s*this\._contextModeChanging\s*\|\|\s*this\._clearSelectedLayersPromise\s*\)\s*return;/g) || []).length, 2);
  assert.doesNotMatch(select, /_globalContext(?:Flights|Missions)Btn\.disabled\s*=\s*true/);
  assert.doesNotMatch(clear, /_globalContext(?:Flights|Missions)Btn\.disabled\s*=\s*true/);
});

test('Context tablist retains Left, Right, Home, and End keyboard navigation', () => {
  const initSource = _initGlobalContextPanel.toString();
  assert.match(initSource, /event\.key === 'ArrowRight'/);
  assert.match(initSource, /event\.key === 'ArrowLeft'/);
  assert.match(initSource, /event\.key === 'Home'/);
  assert.match(initSource, /event\.key === 'End'/);
  assert.match(initSource, /contextTabs\[nextIndex\]\.focus\(\{ preventScroll: true \}\)/);
  assert.match(initSource, /contextTabs\[nextIndex\]\.click\(\)/);
});

test('Context tabs draw a visible keyboard-focus outline including active tabs', () => {
  const list = rules(css);
  const vars = customProperties(list);
  for (const id of ['global-context-flights-btn', 'global-context-missions-btn']) {
    const tab = htmlNodes(html).find((node) => node.id === id);
    assert.ok(tab, `${id} exists`);
    for (const active of [false, true]) {
      if (active) {
        tab.classes.add('active');
        tab.attrs.set('aria-selected', 'true');
      }
      const style = winners(tab, list, { outline: ['outline'], 'outline-offset': ['outline-offset'] });
      assert.equal(resolveVars(style.outline.decl.value, vars), `2px solid ${vars.get('--text-1')}`);
      assert.equal(style['outline-offset'].decl.value, '-3px');
    }
  }
});

test('Context async action buttons remain focused while busy', () => {
  const init = _initGlobalContextPanel.toString();
  const radio = radioBindings.slice(radioBindings.indexOf('const toggleRadio = async (trigger) => {'), radioBindings.indexOf('this.listen(this._contextRadioToggleBtn,'));
  const radioSync = radioPresentation.slice(0, radioPresentation.indexOf('if (this._radioFilter)'));
  const clear = clearSelectedLayers.toString();

  assert.match(init, /button\.getAttribute\('aria-busy'\) === 'true'/);
  assert.doesNotMatch(init, /button\.disabled\s*=\s*true/);
  assert.match(radio, /trigger\.getAttribute\('aria-busy'\) === 'true'/);
  assert.doesNotMatch(radio, /trigger\.disabled\s*=\s*true/);
  for (const name of ['_radioEnableBtn', '_contextRadioMiniEnableBtn', '_cockpitRadioEnableBtn']) {
    assert.match(radioSync, new RegExp(`${name}\\.disabled = false`));
  }
  assert.doesNotMatch(clear, /_clearSelectedLayersBtn\.disabled\s*=\s*true/);
  assert.match(clear, /this\.setClearBusy\(true\)/);
  const control = readFileSync(new URL('./ui/clearLayersControl.js', import.meta.url), 'utf8');
  assert.match(control, /button\.setAttribute\('aria-busy', String\(busy\)\)/);
  assert.doesNotMatch(control, /button\.disabled\s*=/);
});

test('Switch all off keeps World and the War Monitor on and counts only listed layers in its toast', async () => {
  const toasts = [];
  let options = null;
  let result = null;
  const host = {
    destroyed: false,
    _contextModeGeneration: 0,
    _userFacingContextNotificationTokens: new Set(),
    _syncContextModeButtons() {},
    setClearBusy() {},
    showToast: (text) => toasts.push(text),
    _dataManager: {
      async clearSelectedLayers(given) {
        options = given;
        return result;
      },
    },
  };
  const targetIds = ['military-awareness', 'flights'];
  result = { targetIds, items: [], clearedIds: targetIds, notClearedIds: [] };
  await clearSelectedLayers.call(host);
  assert.deepEqual([...options.keepIds], ['world', 'news']);
  assert.deepEqual(toasts, ['Cleared 1 data layer']);

  // A layer with no row that stays on is not counted as one the list failed
  // to clear; a listed one is.
  toasts.length = 0;
  result = {
    targetIds: ['military-awareness', 'flights', 'traffic'],
    items: [],
    clearedIds: ['flights'],
    notClearedIds: ['military-awareness', 'traffic'],
  };
  await clearSelectedLayers.call(host);
  assert.deepEqual(toasts, ['1 data layer could not be cleared']);
  toasts.length = 0;
  result = {
    targetIds: ['military-awareness', 'flights'],
    items: [],
    clearedIds: ['flights'],
    notClearedIds: ['military-awareness'],
  };
  await clearSelectedLayers.call(host);
  assert.deepEqual(toasts, ['Cleared 1 data layer']);
});
