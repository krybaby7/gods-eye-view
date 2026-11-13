import { frameDate, refreshedLabel, worldGauges } from './frameGauges.js';

/** Window width below which Today starts folded to its rail. */
export const FRAME_TODAY_OPEN_MIN_WIDTH = 1100;
/** At this width and below Today folds, and opens over the globe. */
export const FRAME_NARROW_QUERY = '(max-width: 720px)';
/**
 * Below this width Today (300 px) and the sheet (420 px) cannot both stand
 * beside a usable globe, which needs at least FRAME_GLOBE_MIN_WIDTH: opening
 * one folds the other.
 */
export const FRAME_GLOBE_MIN_WIDTH = 460;
export const FRAME_SHARED_QUERY = '(max-width: 1179px)';
/** Sheet tabs shown before "More ›" (the mock and Appendix D show four). */
export const FRAME_SHEET_TABS_SHOWN = 4;
export const FRAME_TODAY_STORAGE_KEY = 'gev.frame.today';
export const FRAME_PRESETS_STORAGE_KEY = 'gev.frame.presets';

function read(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {
    // A blocked store only loses the remembered choice.
  }
}

/**
 * The frame's own state: which columns are open, the top bar's date, turn and
 * gauges, and the bottom bar's ways in to layers, presets, zoom and voice.
 * Layout itself is CSS (frame.css) keyed on the body's attributes; every
 * change of layout asks the globe for a render, because an idle globe renders
 * only on request and its drawing area has just changed.
 *
 * @param {object} options
 * @param {Document} [options.document]
 * @param {Window} [options.window]
 * @param {Storage} [options.storage]
 * @param {(reason: string) => void} [options.requestRender]
 * @param {{getSnapshot: Function, subscribe: Function}} [options.world]
 * @param {() => Date} [options.now]
 */
export function createFrame({
  document = globalThis.document,
  window = globalThis.window,
  storage = globalThis.localStorage,
  requestRender = () => {},
  world = null,
  now = () => new Date(),
} = {}) {
  const body = document.body;
  const find = (id) => document.getElementById(id);
  const events = new AbortController();
  const { signal } = events;
  const observers = [];
  const timers = [];
  let unsubscribe = null;

  const layout = (reason) => requestRender(`frame-${reason}`);

  body.classList.add('gev-frame');

  // ── Today and its rail ──
  const today = find('frame-today');
  const fold = find('frame-today-fold');
  const open = find('frame-today-open');
  function setToday(state, { persist = false, focus = false } = {}) {
    const folded = state === 'folded';
    body.dataset.today = folded ? 'folded' : 'open';
    fold?.setAttribute('aria-expanded', String(!folded));
    open?.setAttribute('aria-expanded', String(!folded));
    if (persist) write(storage, FRAME_TODAY_STORAGE_KEY, body.dataset.today);
    if (focus) (folded ? open : fold)?.focus();
    layout('today');
  }
  const savedToday = read(storage, FRAME_TODAY_STORAGE_KEY);
  setToday(
    savedToday === 'open' || savedToday === 'folded'
      ? savedToday
      : (window?.innerWidth ?? 0) >= FRAME_TODAY_OPEN_MIN_WIDTH
        ? 'open'
        : 'folded',
  );
  // A window that is, or becomes, phone-narrow folds Today, whatever was
  // remembered: an open column would squeeze the globe to nothing. Below the
  // shared width Today and the sheet take turns. Neither fold is remembered,
  // so a wide window later still gets the viewer's choice.
  const narrow = window?.matchMedia?.(FRAME_NARROW_QUERY);
  const shared = window?.matchMedia?.(FRAME_SHARED_QUERY);
  const sheetOpen = () => body.dataset.sheet === 'open';
  function keepGlobe() {
    if (body.dataset.today !== 'open') return;
    if (narrow?.matches || (shared?.matches && sheetOpen())) setToday('folded');
  }
  for (const query of [narrow, shared])
    query?.addEventListener?.('change', keepGlobe, { signal });
  fold?.addEventListener(
    'click',
    () => setToday('folded', { persist: true, focus: true }),
    { signal },
  );
  open?.addEventListener(
    'click',
    () => {
      // Opening Today where both cannot fit closes the sheet.
      if (shared?.matches && sheetOpen()) find('world-sheet-close')?.click();
      setToday('open', { persist: true, focus: true });
    },
    { signal },
  );

  // ── The sheet: open while the board shows something in it ──
  const sheet = find('world-character-sheet');
  function syncSheet() {
    const next = sheet && !sheet.hidden ? 'open' : 'closed';
    if (body.dataset.sheet === next) return;
    body.dataset.sheet = next;
    // Opening the sheet where both cannot fit folds Today.
    if (next === 'open') keepGlobe();
    layout('sheet');
  }
  syncSheet();
  keepGlobe();
  if (sheet && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(syncSheet);
    observer.observe(sheet, { attributes: true, attributeFilter: ['hidden'] });
    observers.push(observer);
  }

  // ── The sheet's tabs: the first few, the rest under "More ›" ──
  // The board decides which tabs exist and in what order; the frame only
  // decides how many show before More (the mock's four).
  const tabList = find('world-sheet-tabs');
  const more = find('frame-sheet-more');
  const moreMenu = find('frame-sheet-more-menu');
  function setMoreOpen(state) {
    if (!more || !moreMenu) return;
    more.setAttribute('aria-expanded', String(state));
    moreMenu.hidden = !state;
  }
  function syncTabs() {
    if (!tabList || !more || !moreMenu) return;
    const all = [...tabList.children].filter(
      (node) => node.getAttribute?.('role') === 'tab',
    );
    const rest = all.slice(FRAME_SHEET_TABS_SHOWN);
    all.forEach((node, i) => {
      const hide = i >= FRAME_SHEET_TABS_SHOWN;
      if (node.hidden !== hide) node.hidden = hide;
    });
    more.hidden = rest.length === 0;
    const chosen = rest.find(
      (node) => node.getAttribute('aria-selected') === 'true',
    );
    // A chosen tab under More names the button, so the choice stays visible.
    more.textContent = `${chosen ? chosen.textContent : 'More'} ›`;
    more.dataset.selected = String(Boolean(chosen));
    moreMenu.replaceChildren(
      ...rest.map((tab) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.textContent = tab.textContent;
        item.dataset.frameTab = tab.dataset.worldTab ?? tab.id;
        if (tab === chosen) item.setAttribute('aria-current', 'true');
        item.addEventListener('click', () => {
          setMoreOpen(false);
          tab.click();
          more.focus();
        });
        return item;
      }),
    );
    if (!rest.length) setMoreOpen(false);
  }
  setMoreOpen(false);
  syncTabs();
  if (tabList && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(syncTabs);
    observer.observe(tabList, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    });
    observers.push(observer);
  }
  more?.addEventListener(
    'click',
    () => {
      const opening = moreMenu?.hidden ?? false;
      setMoreOpen(opening);
      if (opening) moreMenu.querySelector('button')?.focus();
    },
    { signal },
  );
  moreMenu?.addEventListener(
    'keydown',
    (event) => {
      const items = [...moreMenu.querySelectorAll('button')];
      const at = items.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        setMoreOpen(false);
        more.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(at + step + items.length) % items.length]?.focus();
      } else return;
    },
    { signal },
  );
  document.addEventListener?.(
    'pointerdown',
    (event) => {
      if (
        moreMenu &&
        !moreMenu.hidden &&
        !more.parentElement?.contains(event.target)
      )
        setMoreOpen(false);
    },
    { signal },
  );

  // A resize, a media query or a mode that gives the globe the whole window
  // changes the canvas without passing through the setters above.
  if (typeof ResizeObserver !== 'undefined') {
    const globe = find('cesiumContainer');
    if (globe) {
      const observer = new ResizeObserver(() => layout('resize'));
      observer.observe(globe);
      observers.push(observer);
    }
    const credits = find('cesium-credits');
    if (credits) {
      const observer = new ResizeObserver(() => {
        const width = Math.ceil(credits.getBoundingClientRect().width);
        body.style.setProperty('--frame-credits-width', `${width}px`);
      });
      observer.observe(credits);
      observers.push(observer);
    }
  }

  // ── Top bar: the date, the turn and the gauges ──
  const date = find('frame-date');
  function tickDate() {
    if (date) date.textContent = frameDate(now());
  }
  tickDate();
  timers.push(setInterval(tickDate, 60_000));

  const boardStatus = find('frame-board-status');
  const refreshed = find('frame-refreshed');
  const refresh = find('world-refresh');
  const gauges = find('frame-gauges');
  let previousTurn;
  let previousFeatures;
  function gaugeNode(gauge) {
    const node = document.createElement('div');
    node.className = 'frame-gauge';
    node.dataset.gauge = gauge.id;
    node.title = gauge.title;
    const main = document.createElement('span');
    main.className = 'frame-gauge-main';
    const value = document.createElement('span');
    value.className = 'frame-figure';
    value.textContent = gauge.value;
    main.append(`${gauge.label} `, value);
    if (gauge.change) {
      const change = document.createElement('span');
      change.className = 'frame-figure frame-change';
      change.textContent = gauge.change;
      main.append(' ', change);
    }
    const caption = document.createElement('span');
    caption.className = 'frame-gauge-caption';
    caption.textContent = gauge.caption;
    node.append(main, caption);
    return node;
  }
  function renderWorld() {
    const snapshot = world?.getSnapshot?.() ?? {};
    const enabled = Boolean(snapshot.enabled);
    if (boardStatus) boardStatus.hidden = !enabled;
    if (refresh) refresh.hidden = !enabled;
    if (snapshot.turn !== previousTurn) {
      const label = refreshedLabel(snapshot.turn);
      if (refreshed) {
        refreshed.textContent = label ?? '';
        refreshed.hidden = !label;
      }
    }
    if (
      snapshot.features !== previousFeatures ||
      snapshot.turn !== previousTurn
    ) {
      const items = enabled ? worldGauges(snapshot) : [];
      gauges?.replaceChildren(...items.map(gaugeNode));
      if (gauges) gauges.hidden = !items.length;
    }
    if (gauges && !enabled && !gauges.hidden) {
      gauges.replaceChildren();
      gauges.hidden = true;
    }
    previousTurn = snapshot.turn;
    previousFeatures = snapshot.features;
  }
  if (world) {
    unsubscribe = world.subscribe(renderWorld);
    renderWorld();
  }

  const top = find('frame-top');
  const turn = find('world-turn');
  const turnChanges = find('world-turn-changes');
  top?.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !turnChanges || turnChanges.hidden) return;
      turn?.click();
      turn?.focus();
      event.stopPropagation();
    },
    { signal },
  );

  // ── Bottom bar: ways in to the layers, the presets, zoom and voice ──
  const layersButton = find('frame-layers');
  const dataPanel = find('data-panel');
  function syncLayers() {
    layersButton?.setAttribute(
      'aria-expanded',
      String(Boolean(dataPanel && !dataPanel.classList.contains('collapsed'))),
    );
  }
  if (layersButton && dataPanel) {
    syncLayers();
    layersButton.addEventListener(
      'click',
      () =>
        dataPanel.querySelector('[data-collapse-target="data-panel"]')?.click(),
      { signal },
    );
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(syncLayers);
      observer.observe(dataPanel, {
        attributes: true,
        attributeFilter: ['class'],
      });
      observers.push(observer);
    }
  } else if (layersButton) layersButton.hidden = true;

  const presetsButton = find('frame-presets');
  const presets = find('lens-bar');
  function setPresets(shown, { persist = false } = {}) {
    if (!presets) return;
    presets.hidden = !shown;
    presetsButton?.setAttribute('aria-expanded', String(shown));
    if (persist)
      write(storage, FRAME_PRESETS_STORAGE_KEY, shown ? 'shown' : 'hidden');
  }
  if (presetsButton && presets) {
    setPresets(read(storage, FRAME_PRESETS_STORAGE_KEY) !== 'hidden');
    presetsButton.addEventListener(
      'click',
      () => setPresets(presets.hidden, { persist: true }),
      { signal },
    );
  } else if (presetsButton) presetsButton.hidden = true;

  for (const [id, target] of [
    ['frame-zoom-out', 'zoom-map-out'],
    ['frame-zoom-in', 'zoom-map-in'],
  ]) {
    find(id)?.addEventListener('click', () => find(target)?.click(), {
      signal,
    });
  }

  const voice = find('frame-voice');
  const voiceButton = find('gev-voice-button');
  const voiceRoot = find('gev-voice-control');
  if (voice && voiceButton) {
    voice.hidden = false;
    const syncVoice = () => {
      const status = voiceRoot?.dataset.status ?? 'idle';
      voice.setAttribute(
        'aria-pressed',
        String(!['idle', 'off', 'error'].includes(status)),
      );
    };
    syncVoice();
    voice.addEventListener('click', () => voiceButton.click(), { signal });
    if (voiceRoot && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(syncVoice);
      observer.observe(voiceRoot, {
        attributes: true,
        attributeFilter: ['data-status'],
      });
      observers.push(observer);
    }
  }

  return {
    /** Fold Today away or open it again, as the fold and open buttons do. */
    setToday: (state) => setToday(state, { persist: true }),
    destroy() {
      events.abort();
      unsubscribe?.();
      for (const observer of observers) observer.disconnect();
      for (const timer of timers) clearInterval(timer);
      presets?.removeAttribute('hidden');
      body.classList.remove('gev-frame');
      delete body.dataset.today;
      delete body.dataset.sheet;
      body.style.removeProperty('--frame-credits-width');
      layout('destroy');
    },
  };
}
