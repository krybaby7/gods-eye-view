import { LENSES } from '../lenses/catalog.js';
import { lensStatus, planLensClick } from '../lenses/rules.js';
import { layerFeedState } from '../data/feedState.js';

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
    return `${name}: UNAVAILABLE — ${layer?.reason || 'Data source unavailable'}`;
  const state = layer.enabled ? layerFeedState(layer.stats) : 'off';
  return `${name}: ${state === 'nominal' ? 'ON' : state.toUpperCase()}`;
}

/** Topic buttons over supplied layer snapshots; lifecycle and persistence stay with the caller. */
export function createLensBar({
  container,
  getLayers,
  setEnabled,
  subscribeActivity,
  lenses = LENSES,
  onLayout = () => {},
} = {}) {
  const row = container?.querySelector('.lens-buttons');
  if (!row) return { click: async () => [], refresh() {}, destroy() {} };

  const document = container.ownerDocument;
  const buttons = new Map();
  const pending = new Map();
  let destroyed = false;

  for (const lens of lenses) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lens-button panel-surface-control';
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
      const busy = (pending.get(lens.id) || 0) > 0;
      const details = lens.layerIds.map((id) => layerDescription(id, byId));
      set(
        button,
        'className',
        `lens-button panel-surface-control is-${status}${busy ? ' is-busy' : ''}`,
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
        `${lens.label}: ${status.toUpperCase()}, ${enabledCount} of ${availableCount} available layers on. ${details.join('. ')}`,
      );
    }
  }

  async function click(lensId) {
    if (destroyed) return [];
    const lens = lenses.find(({ id }) => id === lensId);
    if (!lens) return [];
    const changes = planLensClick(lens, lenses, getLayers());
    if (!changes.length) return [];
    pending.set(lensId, (pending.get(lensId) || 0) + 1);
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
    pending.set(lensId, pending.get(lensId) - 1);
    refresh();
    return results;
  }

  const unsubscribe = subscribeActivity?.(refresh);
  refresh();
  onLayout();
  return {
    click,
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      for (const { button, onClick } of buttons.values()) {
        button.removeEventListener('click', onClick);
        button.remove();
      }
      buttons.clear();
    },
  };
}
