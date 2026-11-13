/**
 * The legend in the frame's bottom bar, and the way to read it whole.
 *
 * The bar is one 52 px row. The legend's marks (its title, the ramp and its
 * stops or the classes with their swatches, and the "Unknown or disputed"
 * key) wrap onto as many lines as the bar holds, each mark whole; when they
 * need more lines than the bar has at its usual line height they close up to
 * the dense one, and marks that still do not fit leave the bar whole, from
 * the last one back (the title and the Unknown key always stay). The note
 * takes the line that is left, cut short with an ellipsis, and goes when no
 * line is left. Whenever a mark is left out or the note is cut, or the
 * legend is not drawn at all (a phone), a small button at the legend's end
 * opens a popover holding the whole legend.
 *
 * What is cut is measured, not guessed: after each change of lens, of the
 * columns beside the globe and of the window's size.
 */

const SLACK = 1;

const px = (value) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
};

/**
 * @param {object} options
 * @param {Document} options.document
 * @param {Window} [options.window]
 * @param {AbortSignal} options.signal
 * @param {MutationObserver[]|ResizeObserver[]} options.observers
 */
export function createFrameLegend({ document, window, signal, observers }) {
  const find = (id) => document.getElementById(id);
  const legend = find('world-legend');
  const button = find('frame-legend-whole');
  const popup = find('frame-legend-popup');
  if (!legend || !button || !popup) return { sync() {}, close() {} };
  const row = legend.querySelector('.frame-legend-row');
  const note = find('world-legend-note');
  const style = (node, pseudo) =>
    window?.getComputedStyle?.(node, pseudo) ?? null;

  /** Lays the legend out for the room it has; true when anything is cut. */
  function fit() {
    legend.removeAttribute('data-dense');
    legend.removeAttribute('data-note-off');
    const stops = [...(find('world-legend-stops')?.children ?? [])];
    for (const stop of stops) stop.removeAttribute('data-out');
    // A legend that is not drawn (the phone's bar has no room for it) is
    // read only through the popover.
    if (!legend.getClientRects?.().length) return true;
    const room = px(style(legend)?.maxHeight) || legend.clientHeight;
    const over = () =>
      (row?.scrollHeight ?? 0) > room + SLACK ||
      (row?.scrollWidth ?? 0) > (row?.clientWidth ?? 0) + SLACK;
    if (over()) legend.setAttribute('data-dense', '');
    // Marks that still do not fit leave the bar whole, from the last one
    // back: a mark is shown whole or not at all, and the title and the
    // Unknown key always stay.
    let left = 0;
    for (let at = stops.length - 1; at >= 0 && over(); at -= 1) {
      stops[at].setAttribute('data-out', '');
      left += 1;
    }
    const marksCut = left > 0 || over();
    const marks = row?.scrollHeight ?? 0;
    if (!note?.textContent.trim()) return marksCut;
    const line = px(style(note)?.lineHeight) || px(style(row)?.lineHeight);
    if (room - marks < line - SLACK) {
      legend.setAttribute('data-note-off', '');
      return true;
    }
    return marksCut || note.scrollWidth > note.clientWidth + SLACK;
  }

  // ── The popover: the same legend, whole ──
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  /** A swatch drawn before a stop (the classes of a lens such as Diplomacy). */
  function swatchOf(stop) {
    const before = style(stop, '::before');
    if (!before || before.content === 'none' || before.display === 'none')
      return null;
    const colour = before.backgroundColor;
    if (!colour || colour === 'transparent' || colour === 'rgba(0, 0, 0, 0)')
      return null;
    return colour;
  }
  function fill() {
    const title = find('world-legend-title')?.textContent ?? '';
    const stops = [...(find('world-legend-stops')?.children ?? [])];
    const parts = [make('strong', 'frame-legend-popup-title', title)];
    const ramp = legend.querySelector('.world-legend-ramp');
    const rampStyle = ramp && style(ramp);
    if (rampStyle && rampStyle.display !== 'none') {
      const copy = make('span', 'world-legend-ramp frame-legend-popup-ramp');
      copy.setAttribute('aria-hidden', 'true');
      copy.style.backgroundColor = rampStyle.backgroundColor;
      copy.style.backgroundImage = rampStyle.backgroundImage;
      parts.push(copy);
    }
    const list = make('ul', 'frame-legend-popup-stops');
    for (const stop of stops) {
      const item = make('li');
      const colour = swatchOf(stop);
      if (colour) {
        const swatch = make('span', 'frame-legend-popup-swatch');
        swatch.setAttribute('aria-hidden', 'true');
        swatch.style.backgroundColor = colour;
        item.append(swatch);
      }
      item.append(document.createTextNode(stop.textContent));
      list.append(item);
    }
    parts.push(list);
    const unknown = make(
      'p',
      'world-legend-unknown frame-legend-popup-unknown',
    );
    const hatch = make('span', 'world-hatch');
    hatch.setAttribute('aria-hidden', 'true');
    unknown.append(hatch, document.createTextNode('Unknown or disputed'));
    parts.push(unknown);
    const noteText = note?.textContent.trim();
    if (noteText) parts.push(make('p', 'frame-legend-popup-note', noteText));
    popup.replaceChildren(...parts);
  }
  /** Keeps the popover inside the window, over the button where it can. */
  function place() {
    const bar = popup.offsetParent ?? popup.parentElement;
    const barBox = bar?.getBoundingClientRect?.();
    const buttonBox = button.getBoundingClientRect?.();
    if (!barBox || !buttonBox) return;
    const viewport = window?.innerWidth ?? barBox.width;
    const width = popup.getBoundingClientRect?.().width ?? 0;
    const want = buttonBox.right - width;
    const left = Math.max(8, Math.min(want, viewport - width - 8));
    popup.style.left = `${Math.round(left - barBox.left)}px`;
  }

  const isOpen = () => !popup.hidden;
  function open() {
    fill();
    popup.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    popup.focus?.();
  }
  function close({ focus = false } = {}) {
    if (!isOpen()) return;
    popup.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus && !button.hidden) button.focus();
  }

  function sync() {
    if (legend.hidden) {
      button.hidden = true;
      close();
      return;
    }
    const cut = fit();
    button.hidden = !cut;
    if (!cut) close();
    else if (isOpen()) {
      fill();
      place();
    }
  }

  button.addEventListener(
    'click',
    () => (isOpen() ? close({ focus: true }) : open()),
    { signal },
  );
  document.addEventListener?.(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && isOpen()) close({ focus: true });
    },
    { signal },
  );
  document.addEventListener?.(
    'pointerdown',
    (event) => {
      if (!isOpen()) return;
      if (button.contains(event.target) || popup.contains(event.target)) return;
      const inside = popup.contains(document.activeElement);
      close({ focus: inside });
    },
    { signal },
  );

  if (typeof MutationObserver !== 'undefined') {
    // The board rewrites the legend's words on a change of lens or country.
    const observer = new MutationObserver(sync);
    observer.observe(legend, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });
    observers.push(observer);
  }
  if (typeof ResizeObserver !== 'undefined') {
    // The window's width, a fold of Today or the sheet, and the phone's
    // layout all reach the legend as a change of its own or the bar's size.
    const observer = new ResizeObserver(sync);
    observer.observe(legend);
    if (legend.parentElement) observer.observe(legend.parentElement);
    observers.push(observer);
  }
  window?.addEventListener?.('resize', sync, { signal });
  sync();

  return { sync, close };
}
