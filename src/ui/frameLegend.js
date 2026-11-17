import { announceMenuOpen, closeWhenAnotherOpens } from './menuSections.js';

/**
 * The legend in the frame's bottom bar, and the way to read it whole.
 *
 * The bar is one 52 px row and the legend a fixed band of it. The legend's
 * marks (its title, the ramp and its stops or the classes with their
 * swatches, and the "Unknown or disputed" key) wrap onto as many lines as the
 * band holds, and the note takes a line under them, cut short with an
 * ellipsis. The rule: a colour class is shown whole or not at all, and while
 * the legend is in the bar its title and the Unknown key are whole. When the
 * marks need more room than the band has they use tighter spacing;
 * stops that still do not fit leave the bar, from the last one back; if even
 * that is not enough the note goes (and the stops that then fit come back).
 * Where the band cannot hold even the title and the Unknown key whole (a
 * narrow window), nothing of the legend is drawn in the bar (data-away). And
 * on a phone the bar does not draw the legend at all. Whenever anything is
 * left out or the note is cut, a button at the legend's end opens a popover
 * holding the whole legend.
 *
 * What fits is measured on what is drawn: every part still shown (the ramp
 * among them) must lie wholly inside the legend's box, the same test the
 * browser check makes. The button takes room from the legend when it shows,
 * so the state drawn is the state measured: the legend is fitted with the
 * button hidden; if anything is then left out or cut, the button is shown
 * and the legend fitted once more beside it, and the button stays shown for
 * that pass whatever the second fit finds. Two passes at most, and no
 * flipping. It is measured again whenever the legend's words, the room
 * beside it, the window or the fonts change.
 */

const SLACK = 1;

/** The size of a node's box, to tell a real change from the fit's own. */
const sizeOf = (node) => {
  const box = node?.getBoundingClientRect?.();
  return box ? `${box.width}x${box.height}` : '';
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
  const title = find('world-legend-title');
  const ramp = legend.querySelector('.world-legend-ramp');
  const unknown = legend.querySelector('.world-legend-unknown');
  const style = (node, pseudo) =>
    window?.getComputedStyle?.(node, pseudo) ?? null;

  const noteText = () => note?.textContent.trim() ?? '';
  const noteShown = () =>
    Boolean(noteText()) && !legend.hasAttribute('data-note-off');
  /** True when every box the node draws lies inside the legend's. */
  function within(node, frame) {
    const rects = [...(node.getClientRects?.() ?? [])];
    return (
      rects.length > 0 &&
      rects.every(
        (rect) =>
          rect.top >= frame.top - SLACK &&
          rect.bottom <= frame.bottom + SLACK &&
          rect.left >= frame.left - SLACK &&
          rect.right <= frame.right + SLACK,
      )
    );
  }
  /** True when every part still shown is drawn whole. */
  function whole(stops) {
    const frame = legend.getBoundingClientRect();
    const parts = [
      title,
      ...stops.filter((stop) => !stop.hasAttribute('data-out')),
      unknown,
    ].filter((node) => node?.textContent.trim());
    // The ramp has no words; it counts wherever it is drawn (a lens of
    // classes, such as Diplomacy, does not draw it).
    if (ramp?.getClientRects?.().length) parts.push(ramp);
    if (noteShown()) parts.push(note);
    return parts.every((node) => within(node, frame));
  }

  /** Lays the legend out for the room it has; true when anything is left out or cut. */
  function fit() {
    legend.removeAttribute('data-away');
    legend.removeAttribute('data-dense');
    legend.removeAttribute('data-note-off');
    const stops = [...(find('world-legend-stops')?.children ?? [])];
    for (const stop of stops) stop.removeAttribute('data-out');
    // A legend that is not drawn (the phone's bar has no room for it) is
    // read only through the popover.
    if (!legend.getClientRects?.().length) return true;
    let fits = whole(stops);
    if (!fits) {
      legend.setAttribute('data-dense', '');
      fits = whole(stops);
    }
    // Stops leave the bar whole, from the last one back.
    for (let at = stops.length - 1; at >= 0 && !fits; at -= 1) {
      stops[at].setAttribute('data-out', '');
      fits = whole(stops);
    }
    // Still no room for the title and the Unknown key: the note gives up its
    // line, and the stops that then fit come back, in order.
    if (!fits && noteShown()) {
      legend.setAttribute('data-note-off', '');
      fits = whole(stops);
      for (const stop of stops) {
        if (!fits || !stop.hasAttribute('data-out')) continue;
        stop.removeAttribute('data-out');
        if (!whole(stops)) {
          stop.setAttribute('data-out', '');
          break;
        }
      }
    }
    // Not even the title and the Unknown key fit whole: nothing of the
    // legend is drawn in the bar, and it is read through the popover.
    if (!fits) {
      legend.setAttribute('data-away', '');
      return true;
    }
    // Use the usual spacing when the remaining marks fit it.
    if (legend.hasAttribute('data-dense')) {
      legend.removeAttribute('data-dense');
      if (!whole(stops)) legend.setAttribute('data-dense', '');
    }
    return (
      stops.some((stop) => stop.hasAttribute('data-out')) ||
      (Boolean(noteText()) && !noteShown()) ||
      (noteShown() && note.scrollWidth > note.clientWidth + SLACK)
    );
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
  /** Aim at the button. CSS bounds the popover to the frame's insets. */
  function place() {
    const bar = popup.offsetParent ?? popup.parentElement;
    const barBox = bar?.getBoundingClientRect?.();
    const buttonBox = button.getBoundingClientRect?.();
    if (!barBox || !buttonBox) return;
    const width = popup.getBoundingClientRect?.().width ?? 0;
    const anchor = Math.round(buttonBox.right - width - barBox.left);
    popup.style.setProperty('--legend-popup-anchor', `${anchor}px`);
  }

  const isOpen = () => !popup.hidden;
  function open() {
    fill();
    popup.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    announceMenuOpen(document, 'legend');
    popup.focus?.();
  }
  /**
   * Closes the popover. With `focus`, focus goes back to the button, or,
   * where the button is no longer shown, to the pressed lens button, so it
   * never falls to the page's body.
   */
  function close({ focus = false } = {}) {
    if (!isOpen()) return;
    popup.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (!focus) return;
    if (!button.hidden) button.focus();
    else
      find('world-lens-bar')?.querySelector('[aria-pressed="true"]')?.focus?.();
  }
  /** Closes the popover from a fit, keeping focus that was inside it. */
  const closeFromFit = () =>
    close({ focus: popup.contains(document.activeElement) });

  // The boxes whose size can change what fits, and their sizes after the
  // last fit: a size the fit itself left is not a reason to fit again.
  const watched = [legend, legend.parentElement, row].filter(Boolean);
  let seen = new Map();
  const remember = () => {
    seen = new Map(watched.map((node) => [node, sizeOf(node)]));
  };
  const resized = () => watched.some((node) => seen.get(node) !== sizeOf(node));

  function sync() {
    if (legend.hidden) {
      button.hidden = true;
      closeFromFit();
      remember();
      return;
    }
    // The button takes room from the legend: what is drawn must be what was
    // measured (see the top). Fitted first without it; if anything is left
    // out, the button shows and the legend is fitted again beside it.
    const focused = document.activeElement === button;
    button.hidden = true;
    const cut = fit();
    if (cut) {
      button.hidden = false;
      fit();
      // Hidden for a moment, it may have lost focus it had: give it back.
      if (focused && document.activeElement !== button) button.focus();
    }
    if (!cut) closeFromFit();
    else if (isOpen()) {
      fill();
      place();
    }
    remember();
  }

  button.addEventListener(
    'click',
    () => (isOpen() ? close({ focus: true }) : open()),
    { signal },
  );
  document.addEventListener?.(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !isOpen()) return;
      event.preventDefault?.();
      close({ focus: true });
    },
    { signal },
  );
  // One menu at a time: another menu opening closes the popover.
  closeWhenAnotherOpens(document, 'legend', () => close(), signal);
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
    // The board rewrites the legend's words (title, stops, note) anywhere
    // inside it on a change of lens or country. Only `hidden` is watched
    // among attributes, so the fit's own data-* marks never call it again.
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
    // layout reach the legend as a change of its own or the bar's size;
    // words that grow the marks reach it as a change of the row's (the
    // legend's own box is a fixed band and does not grow with them).
    const observer = new ResizeObserver(() => {
      if (resized()) sync();
    });
    for (const node of watched) observer.observe(node);
    observers.push(observer);
  }
  window?.addEventListener?.('resize', sync, { signal });
  // A font that finishes loading changes every mark's width.
  const fonts = document.fonts;
  fonts?.addEventListener?.('loadingdone', sync, { signal });
  fonts?.ready?.then?.(() => {
    if (!signal?.aborted) sync();
  });
  sync();

  return { sync, close };
}
