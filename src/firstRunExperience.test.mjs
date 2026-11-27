import fs from 'node:fs';
import crypto from 'node:crypto';
import { GEV_REALTIME_TOOLS } from '../server/providers/openai/tools.js';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIRST_RUN_STORAGE_KEY,
  initFirstRunExperience,
  shouldShowFirstRun,
} from './firstRunExperience.js';
import {
  createFakeDocument,
  createFakeStorage,
} from './testSupport/fakeDocument.mjs';

function fixture({
  storage = createFakeStorage(),
  sessionStorageRef = createFakeStorage(),
  search = '',
  hasShareState = false,
  preopened = null,
} = {}) {
  const documentRef = createFakeDocument();
  const make = (tag, parent, attrs = {}) => {
    const element = documentRef.createElement(tag);
    for (const [name, value] of Object.entries(attrs))
      element.setAttribute(name, value);
    parent.append(element);
    return element;
  };
  const menu = make('button', documentRef.body, { id: 'frame-menu' });
  menu.isConnected = true;
  const replay = make('button', documentRef.body, {
    id: 'frame-menu-item-tour',
    hidden: '',
  });
  const root = make('aside', documentRef.body, {
    id: 'first-run-launcher',
    role: 'dialog',
    hidden: '',
  });
  const title = make('h2', root, { id: 'first-run-title' });
  make('p', root, { id: 'first-run-description' });
  const progress = make('p', root, { id: 'first-run-progress', hidden: '' });
  const back = make('button', root, { 'data-first-run-back': '' });
  const next = make('button', root, { 'data-first-run-next': '' });
  const skip = make('button', root, { 'data-first-run-skip': '' });
  menu.focus();
  const otherDialog = preopened ? make('aside', documentRef.body, preopened) : null;
  const otherFocus = otherDialog ? make('button', otherDialog) : null;
  otherFocus?.focus();
  const tour = initFirstRunExperience({
    styleManager: { hasShareState },
    storage,
    sessionStorageRef,
    documentRef,
    location: { search },
  });
  return {
    root,
    tour,
    documentRef,
    storage,
    sessionStorageRef,
    title,
    progress,
    menu,
    otherDialog,
    otherFocus,
    replay,
    back,
    next,
    skip,
  };
}

test('skipping the initial welcome remembers the choice across browser sessions', () => {
  const f = fixture();
  assert.equal(f.root.hidden, false);
  assert.equal(f.documentRef.activeElement, f.next);
  assert.equal(f.progress.hidden, true);
  f.skip.click();
  assert.equal(f.root.hidden, true);
  assert.equal(f.documentRef.activeElement, f.menu);
  assert.equal(f.storage.getItem(FIRST_RUN_STORAGE_KEY), 'seen');
  const newSession = fixture({ storage: f.storage });
  assert.equal(newSession.root.hidden, true);
  assert.equal(newSession.replay.hidden, false);
});

test('the tour has four reachable steps, Back works, and Finish remembers it', () => {
  const f = fixture();
  f.next.click();
  assert.equal(f.documentRef.activeElement, f.title);
  assert.ok(f.back.hidden);
  const shown = [f.title.textContent];
  f.next.click();
  shown.push(f.title.textContent);
  f.back.click();
  assert.equal(f.title.textContent, shown[0]);
  f.next.click();
  assert.equal(f.title.textContent, shown[1]);
  f.next.click();
  shown.push(f.title.textContent);
  f.next.click();
  shown.push(f.title.textContent);
  assert.equal(new Set(shown).size, 4);
  assert.equal(f.progress.textContent, '4 of 4');
  assert.equal(f.next.textContent, 'Finish');
  assert.equal(f.storage.getItem(FIRST_RUN_STORAGE_KEY), null);
  f.next.click();
  assert.equal(f.storage.getItem(FIRST_RUN_STORAGE_KEY), 'seen');
  assert.ok(f.root.hidden);
});

test('a returning visitor can replay from Menu and exit with Escape', () => {
  const f = fixture({ storage: createFakeStorage({ [FIRST_RUN_STORAGE_KEY]: 'seen' }) });
  assert.ok(f.root.hidden);
  f.replay.click();
  assert.equal(f.root.hidden, false);
  assert.equal(f.progress.textContent, '1 of 4');
  let claimed = false;
  f.documentRef.dispatchEvent({
    type: 'keydown',
    key: 'Escape',
    preventDefault: () => { claimed = true; },
    stopPropagation() {},
  });
  assert.equal(claimed, true);
  assert.ok(f.root.hidden);
  assert.equal(f.documentRef.activeElement, f.menu);
});

test('an already open provider or attribution dialog keeps focus until it closes', () => {
  for (const preopened of [
    { role: 'dialog', id: 'key-setup' },
    { class: 'cesium-credit-lightbox' },
  ]) {
    const f = fixture({ preopened });
    assert.equal(f.documentRef.activeElement, f.otherFocus);
    assert.equal(f.root.hidden, true);
    assert.equal(f.storage.getItem(FIRST_RUN_STORAGE_KEY), null);
    f.otherDialog.remove();
    f.menu.focus();
    f.documentRef.dispatchEvent({ type: 'focusin' });
    assert.equal(f.root.hidden, false);
    assert.equal(f.documentRef.activeElement, f.next);
  }
});

test('Escape is left to an overlay covering an already open tour', () => {
  const f = fixture();
  const overlay = f.documentRef.createElement('section');
  f.documentRef.body.append(overlay);
  f.root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
  f.documentRef.elementFromPoint = () => overlay;
  let claimed = false;
  f.documentRef.dispatchEvent({
    type: 'keydown',
    key: 'Escape',
    preventDefault: () => { claimed = true; },
    stopPropagation() {},
  });
  assert.equal(claimed, false);
  assert.equal(f.root.hidden, false);
  assert.equal(f.storage.getItem(FIRST_RUN_STORAGE_KEY), null);
});

test('legacy suppression still gets the updated introduction once', () => {
  assert.equal(
    shouldShowFirstRun({
      storage: createFakeStorage({ 'gev:first-run-mission:v1': 'suppressed' }),
      sessionStorageRef: createFakeStorage(),
      location: { search: '' },
    }),
    true,
  );
});

test('explicit welcome URL flags work while shares and embeds suppress auto-show', () => {
  const storage = createFakeStorage({ [FIRST_RUN_STORAGE_KEY]: 'seen' });
  assert.equal(fixture({ storage, search: '?welcome=1' }).root.hidden, false);
  assert.equal(fixture({ search: '?welcome=0' }).root.hidden, true);
  assert.equal(fixture({ search: '?welcome=1', hasShareState: true }).root.hidden, true);
  assert.equal(fixture({ search: '?welcome=1&embed=1' }).root.hidden, true);
});

test('storage denial leaves Skip usable and suppresses the rest of the tab session', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const first = fixture({ storage: blocked });
  assert.equal(first.root.hidden, false);
  first.skip.click();
  assert.equal(first.root.hidden, true);
  const reload = fixture({ storage: blocked, sessionStorageRef: first.sessionStorageRef });
  assert.equal(reload.root.hidden, true);
});

test('teardown unwires keyboard and replay without recording a dismissal', () => {
  const f = fixture();
  f.tour.destroy();
  assert.equal(f.documentRef.listenerCount('keydown'), 0);
  f.replay.click();
  assert.ok(f.root.hidden);
  assert.equal(f.storage.getItem(FIRST_RUN_STORAGE_KEY), null);
});

test('the DISPLAY rail starts collapsed on a first run, and a stored choice wins', () => {
  const ui = fs.readFileSync(new URL('./ui/panelPositionControls.js', import.meta.url), 'utf8');
  // The rail opened by default to advertise HUD / DETECT / 3D. Those default ON
  // now, so it was opening to offer controls for things already happening —
  // while competing with the mission card for the one first impression there is.
  assert.match(
    ui,
    /if \(panelId === 'pp-toggles' && stored === null\) collapsed = true;/,
    'first run must leave DISPLAY collapsed',
  );
  // The first-run default may only apply when NOTHING is stored: a visitor who
  // opened the rail keeps it open, and one who closed it keeps it closed.
  const block = ui.slice(ui.indexOf('stored = localStorage.getItem(this._panelCollapseStorageKey(panelId))'));
  const guard = block.slice(0, block.indexOf('panelEl.classList.toggle'));
  assert.match(guard, /if \(stored === '1'\) collapsed = true;/);
  assert.match(guard, /if \(stored === '0'\) collapsed = false;/);
  assert.ok(
    guard.indexOf("stored === '0'") < guard.indexOf('pp-toggles'),
    'the stored-state reads must come before the first-run default',
  );
});

// ── Voice: instruction-only, tool schema unchanged ─────────────────────

test('existing named voice views retain their Realtime tool schema', () => {
  // Analyst layers and the separate satellite-pass tool deliberately extend the schema.
  // Canonical serialization pins every tool name, description, property and
  // ordering while allowing source formatting. Derived from the unchanged
  // release schema before formatting (the previous source-byte pin passed).
  const legacyTools = structuredClone(GEV_REALTIME_TOOLS);
  const hudLayout = legacyTools.find((tool) => tool.name === 'set_hud').parameters.properties.layout;
  assert.deepEqual(hudLayout.enum, ['tactical', 'operator', 'minimal']);
  const block = JSON.stringify(legacyTools);
  // Re-derived for the voice layer manifest (generated layer enums, alias and
  // field hints), point-and-ask's pointer/referent arguments and the prompt
  // consolidation (shorter analyst, annotate_map and ISS wording), plus the
  // referent-only track_entity alternative (kept out of the model-facing
  // schema, which may not carry top-level anyOf), and Contacts requested-radius
  // list descriptions; the missions still ride existing tools.
  // Street Level adds toggle enum values and the generated alias hint.
  // The war monitor adds the news layer to the generated enums and hints,
  // the Situation panel to set_panel_open and the refresh_news tool.
  // Search Layers adds the Searches entries and ask_globe.
  // World Board adds its layer enum values and alias.
  assert.equal(block.length, 31144, 'serialized tool schema length drifted');
  assert.equal(
    crypto.createHash('sha256').update(block).digest('hex'),
    '1d5263cf8ed96aeb7ccd01e7c81df0b07300191fb0f7f0cecb4d08fbf55a67ed',
    'the first-run missions must ride EXISTING tools: no schema edit, no cache bust',
  );
  const instructions = fs.readFileSync(new URL('../server/providers/openai/instructions.js', import.meta.url), 'utf8');

  // ...and the mapping that makes them reachable by voice is one instruction
  // string, whose rollback is deleting that string. Anchored to a LIVE array
  // entry — a quote at the start of its own line — so commenting the paragraph
  // out reads as the removal it is, not as a passing substring match.
  assert.match(
    instructions,
    /\n\s+'NAMED VIEWS are shorthand/,
    'the mission mapping must be an active instruction entry, not commented out',
  );
  const mapping = instructions.slice(instructions.indexOf('NAMED VIEWS are shorthand'));
  const paragraph = mapping.slice(0, mapping.indexOf("',\n"));
  for (const layerId of [
    'local-datacenters', 'local-dams', 'telegeography-submarine-cables', 'local-firms', 'earthquakes',
  ]) {
    assert.ok(paragraph.includes(layerId), `mapping must name the existing ${layerId} enum value`);
  }
  assert.ok(paragraph.includes('zoom_to_globe'));
  assert.ok(paragraph.includes('set_layer_visibility'));
});
