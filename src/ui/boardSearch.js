import {
  boardSearchGroups,
  boardPlaceFromGeocode,
  isLocalityQuery,
} from './boardSearchModel.js';
import { announceMenuOpen, closeWhenAnotherOpens } from './menuSections.js';

export function createBoardSearch({ document, getModel, activate, lookup }) {
  const root = document.getElementById('frame-search');
  const input = document.getElementById('frame-search-input');
  const popup = document.getElementById('frame-search-popup');
  const list = document.getElementById('frame-search-list');
  const status = document.getElementById('frame-search-status');
  const lifecycle = new AbortController();
  const options = { signal: lifecycle.signal };
  let entries = [];
  let activeIndex = -1;
  let request;

  function cancel() {
    request?.abort();
    request = undefined;
  }

  function setActive(index) {
    activeIndex = index;
    for (const [position, { element }] of entries.entries())
      element.setAttribute('aria-selected', String(position === index));
    const item = entries[index]?.element;
    if (item) {
      input.setAttribute('aria-activedescendant', item.id);
      item.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function collapse() {
    cancel();
    popup.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    setActive(-1);
  }

  function select(target) {
    if (activate(target, input)) {
      collapse();
      input.value = '';
    } else {
      input.focus();
      redraw();
      status.textContent = 'This board result is no longer available.';
    }
  }

  function redraw() {
    const query = input.value.trim();
    if (!query) {
      collapse();
      return;
    }
    if (popup.hidden) announceMenuOpen(document, 'board-search');
    popup.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    entries = [];
    list.replaceChildren();
    for (const { label, rows } of boardSearchGroups(query, getModel())) {
      const group = document.createElement('div');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', label);
      const heading = document.createElement('div');
      heading.className = 'frame-search-group';
      heading.textContent = label;
      heading.setAttribute('aria-hidden', 'true');
      group.append(heading);
      for (const { id, label: text, target } of rows) {
        const element = document.createElement('div');
        element.id = `frame-search-option-${id.replace(':', '-')}`;
        element.className = 'frame-search-option';
        element.setAttribute('role', 'option');
        element.textContent = text;
        entries.push({ element, target });
        group.append(element);
      }
      list.append(group);
    }
    list.hidden = !entries.length;
    setActive(-1);
    status.textContent = entries.length
      ? ''
      : isLocalityQuery(query)
        ? 'No board matches. Press Enter to look up this place.'
        : 'No board matches.';
  }

  async function lookupPlace() {
    const query = input.value.trim();
    if (request || !isLocalityQuery(query)) return;
    const pending = new AbortController();
    request = pending;
    status.textContent = 'Looking up this place…';
    let result;
    try {
      result = await lookup(query, { signal: pending.signal });
    } catch {
      result = null;
    }
    if (request !== pending) return;
    request = undefined;
    const target = boardPlaceFromGeocode(result?.place);
    if (target) select(target);
    else
      status.textContent = result?.answered
        ? 'No city or country found.'
        : 'Place lookup is unavailable. Try again.';
  }

  input.addEventListener(
    'input',
    () => {
      cancel();
      redraw();
    },
    options,
  );
  input.addEventListener('focus', redraw, options);
  input.addEventListener(
    'keydown',
    (event) => {
      if (event.isComposing) return;
      if (event.key === 'Escape' && !popup.hidden) {
        event.preventDefault();
        event.stopPropagation();
        collapse();
        return;
      }
      if (event.key === 'Tab') {
        collapse();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (popup.hidden) redraw();
        if (!entries.length || popup.hidden) return;
        event.preventDefault();
        const next =
          event.key === 'ArrowDown'
            ? (activeIndex + 1) % entries.length
            : (activeIndex <= 0 ? entries.length : activeIndex) - 1;
        setActive(next);
        return;
      }
      if (event.key !== 'Enter' || !input.value.trim()) return;
      event.preventDefault();
      if (popup.hidden) {
        redraw();
        return;
      }
      if (!entries.length && !request) redraw();
      const target = entries[Math.max(0, activeIndex)]?.target;
      if (target) select(target);
      else if (!event.repeat) void lookupPlace();
    },
    options,
  );
  list.addEventListener(
    'pointerdown',
    (event) => event.preventDefault(),
    options,
  );
  list.addEventListener(
    'click',
    (event) => {
      const option = event.target.closest('[role="option"]');
      const target = entries.find(({ element }) => element === option)?.target;
      if (target) select(target);
    },
    options,
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!root.contains(event.target)) collapse();
    },
    options,
  );
  root.addEventListener(
    'focusout',
    (event) => {
      if (!root.contains(event.relatedTarget)) collapse();
    },
    options,
  );
  closeWhenAnotherOpens(document, 'board-search', collapse, lifecycle.signal);

  return {
    destroy() {
      collapse();
      lifecycle.abort();
    },
  };
}
