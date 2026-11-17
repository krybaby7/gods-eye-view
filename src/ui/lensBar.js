import { LENSES } from '../lenses/catalog.js';
import { lensStatus, planLensClick } from '../lenses/rules.js';
import { layerFeedState } from '../data/feedState.js';

/** A preset's state in words, for its title and label. */
const STATUS_WORDS = Object.freeze({
  on: 'on',
  off: 'off',
  partial: 'partly on',
  unavailable: 'not available',
});

const set = (node, key, value) => {
  if (node[key] !== value) node[key] = value;
};
const attribute = (node, key, value) => {
  if (node.getAttribute(key) !== value) node.setAttribute(key, value);
};

function layerDescription(id, byId) {
  const layer = byId.get(id);
  const name = layer?.name || id;
  if (!layer || layer.available === false)
    return `${name}: not available — ${layer?.reason || 'Data source unavailable'}`;
  const state = layer.enabled ? layerFeedState(layer.stats) : 'off';
  return `${name}: ${state === 'nominal' ? 'on' : state}`;
}

/**
 * Which presets are still switching, shared by every bar that switches the
 * same layers (the layers menu's chips and the Presets menu), so that a preset
 * busy in one reads as busy in the other.
 */
export function createPresetBusy() {
  const pending = new Map();
  const listeners = new Set();
  return {
    has: (lensId) => (pending.get(lensId) || 0) > 0,
    add(lensId, delta) {
      const next = (pending.get(lensId) || 0) + delta;
      if (next > 0) pending.set(lensId, next);
      else pending.delete(lensId);
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Topic buttons over supplied layer snapshots; lifecycle and persistence stay with the caller. */
export function createLensBar({
  container,
  getLayers,
  setEnabled,
  subscribeActivity,
  lenses = LENSES,
  busy: pending = createPresetBusy(),
  onLayout = () => {},
} = {}) {
  const row = container?.querySelector('.lens-buttons');
  if (!row) return { click: async () => [], refresh() {}, destroy() {} };

  const document = container.ownerDocument;
  const buttonClasses =
    container.id === 'frame-presets-menu'
      ? 'lens-button kit-btn quiet'
      : 'lens-button kit-chip pick';
  const buttons = new Map();
  let destroyed = false;

  for (const lens of lenses) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = buttonClasses;
    button.dataset.lensId = lens.id;
    button.setAttribute('aria-keyshortcuts', `Shift+${lens.hotkey}`);
    const icon = document.createElement('span');
    icon.className = 'lens-icon';
    icon.textContent = lens.icon;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'lens-label';
    label.textContent = lens.label;
    const count = document.createElement('span');
    count.className = 'lens-count';
    count.setAttribute('aria-hidden', 'true');
    button.append(icon, label, count);
    const onClick = () => {
      void click(lens.id);
    };
    button.addEventListener('click', onClick);
    row.appendChild(button);
    buttons.set(lens.id, { button, count, onClick });
  }

  function refresh() {
    if (destroyed) return;
    const layers = getLayers();
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    for (const lens of lenses) {
      const { status, enabledCount, availableCount } = lensStatus(lens, layers);
      const { button, count } = buttons.get(lens.id);
      const busy = pending.has(lens.id);
      const details = lens.layerIds.map((id) => layerDescription(id, byId));
      set(
        button,
        'className',
        `${buttonClasses} is-${status}${busy ? ' is-busy' : ''}`,
      );
      set(button, 'disabled', status === 'unavailable');
      set(
        button,
        'title',
        `${lens.label} · Shift+${lens.hotkey}\n${details.join('\n')}`,
      );
      set(count, 'textContent', `${enabledCount}/${availableCount}`);
      set(count, 'hidden', status !== 'partial');
      if (button.dataset.status !== status) button.dataset.status = status;
      attribute(
        button,
        'aria-pressed',
        status === 'partial' ? 'mixed' : String(status === 'on'),
      );
      attribute(button, 'aria-busy', String(busy));
      attribute(
        button,
        'aria-label',
        `${lens.label}: ${STATUS_WORDS[status] || status}, ${enabledCount} of ${availableCount} available layers on. ${details.join('. ')}`,
      );
    }
  }

  async function click(lensId) {
    if (destroyed) return [];
    const lens = lenses.find(({ id }) => id === lensId);
    if (!lens) return [];
    const changes = planLensClick(lens, lenses, getLayers());
    if (!changes.length) return [];
    pending.add(lensId, 1);
    // Issue the complete batch before yielding. A second click then sees every
    // new effective intent and reverses it even while the first batch is busy.
    const work = changes.map(({ layerId, enabled }) => {
      try {
        return Promise.resolve(
          setEnabled(layerId, enabled, { origin: 'user' }),
        );
      } catch (error) {
        return Promise.reject(error);
      }
    });
    refresh();
    const results = await Promise.allSettled(work);
    pending.add(lensId, -1);
    return results;
  }

  const unsubscribe = subscribeActivity?.(refresh);
  // A change of busy state, from this bar or another sharing it, redraws.
  const unsubscribeBusy = pending.subscribe(refresh);
  refresh();
  onLayout();
  return {
    click,
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      unsubscribeBusy();
      for (const { button, onClick } of buttons.values()) {
        button.removeEventListener('click', onClick);
        button.remove();
      }
      buttons.clear();
    },
  };
}
