// The legend in the bottom bar: a stop is shown whole or not at all, the
// title and the Unknown key are always whole, and whenever anything is left
// out or cut (or the bar has no room for the legend at all) the info button
// opens a popover holding all of it. The browser measures; here a small
// layout model stands in for it, drawing each part's boxes the way the bar's
// CSS lays them out, so the rules are exercised on drawn geometry.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeDocument } from '../testSupport/fakeDocument.mjs';
import { createFrameLegend } from './frameLegend.js';
import { MENU_OPEN_EVENT } from './menuSections.js';

const CLASS_COLOURS = ['rgb(219, 71, 79)', 'rgb(232, 147, 63)'];
// The bar's legend band, its line heights and the height of a line of 12 px
// type's own box (taller than the dense line, as in the browser).
const BAND = 48;
const LINE = 15;
const DENSE = 12;
const TYPE = 15;
// The legend band's width, and the room the info button takes from it when
// it shows (its 28 px and the bar's 14 px gap).
const WIDTH = 400;
const BUTTON = 42;

/**
 * The bar's legend as frame.html has it, with a layout model: the marks take
 * `lines` lines (or `lines(n)` when n stops are in the bar) and the note one
 * more, centred in the 48 px band; the title sits on the first line and the
 * Unknown key on the last, each a box of the type's height centred on its
 * line, and the stops are line-high boxes between. The ramp sits on the
 * title's line. The band is 400 px wide, less the button's room while the
 * button shows, and `lines(n, width)` may use that width. The note is
 * `noteWidth` px of text in a line as wide as the band.
 */
function setup({
  lines = 2,
  noteWidth = 300,
  drawn = true,
  swatches = false,
  stops = ['Weak', 'Midrange', 'Strong'],
  note = 'World Bank · IMF · UCDP · V-Dem',
  observe = false,
  rampRight = 226,
} = {}) {
  const document = createFakeDocument();
  const el = (tag, id, className) => {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (className) node.className = className;
    return node;
  };
  const bar = el('footer', 'frame-bottom', 'frame-region frame-bar');
  const legend = el('aside', 'world-legend', 'frame-legend');
  const row = el('div', '', 'frame-legend-row');
  const title = el('strong', 'world-legend-title');
  const ramp = el('span', '', 'world-legend-ramp');
  const stopList = el('span', 'world-legend-stops');
  const unknown = el('span', '', 'world-legend-unknown');
  unknown.append(el('span', '', 'world-hatch'), 'Unknown or disputed');
  row.append(title, ramp, stopList, unknown);
  const noteNode = el('span', 'world-legend-note');
  legend.append(row, noteNode);
  const button = el('button', 'frame-legend-whole', 'frame-iconbtn');
  button.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  const popup = el('div', 'frame-legend-popup', 'frame-popup');
  popup.hidden = true;
  const outside = el('button', 'frame-layers');
  const lensBar = el('section', 'world-lens-bar', 'frame-lens');
  const lensButton = el('button');
  lensButton.setAttribute('aria-pressed', 'true');
  lensBar.append(lensButton);
  bar.append(lensBar, legend, button, popup, outside);
  document.body.append(bar);

  const model = { lines, noteWidth, drawn, fits: 0 };
  const width = () => WIDTH - (button.hidden ? 0 : BUTTON);
  const shownStops = () =>
    stopList.children.filter((stop) => !stop.hasAttribute('data-out'));
  const noteShown = () =>
    Boolean(noteNode.textContent.trim()) &&
    !legend.hasAttribute('data-note-off');
  const layout = () => {
    const line = legend.hasAttribute('data-dense') ? DENSE : LINE;
    const marks =
      typeof model.lines === 'function'
        ? model.lines(shownStops().length, width())
        : model.lines;
    const total = (marks + (noteShown() ? 1 : 0)) * line;
    const top = (BAND - total) / 2;
    const at = (index) => top + index * line;
    const typeBox = (index) => {
      const middle = at(index) + line / 2;
      return {
        left: 0,
        right: 100,
        top: middle - TYPE / 2,
        bottom: middle + TYPE / 2,
      };
    };
    return { line, marks, at, typeBox };
  };
  legend.getClientRects = () => {
    model.fits += 1;
    return model.drawn ? [{}] : [];
  };
  legend.getBoundingClientRect = () => ({
    left: 0,
    right: width(),
    top: 0,
    bottom: BAND,
    width: width(),
    height: BAND,
  });
  title.getClientRects = () => [layout().typeBox(0)];
  // The ramp beside the title; a lens of classes does not draw it.
  ramp.getClientRects = () => {
    if (swatches) return [];
    const { at, line } = layout();
    return [
      { left: 110, right: rampRight, top: at(0) + 3, bottom: at(0) + line - 3 },
    ];
  };
  unknown.getClientRects = () => {
    const { marks, typeBox } = layout();
    return [typeBox(marks - 1)];
  };
  noteNode.getClientRects = () => {
    if (!noteShown()) return [];
    const { marks, at, line } = layout();
    return [
      { left: 0, right: width(), top: at(marks), bottom: at(marks) + line },
    ];
  };
  // A stop is a line-high box on the lines between the title's and the
  // Unknown key's.
  const stopRects = (stop) => {
    if (stop.hasAttribute('data-out')) return [];
    const { marks, at, line } = layout();
    const index = Math.min(shownStops().indexOf(stop) + 1, marks - 1);
    return [{ left: 0, right: 300, top: at(index), bottom: at(index) + line }];
  };
  Object.defineProperty(noteNode, 'scrollWidth', {
    get: () => model.noteWidth,
  });
  Object.defineProperty(noteNode, 'clientWidth', { get: width });
  const window = {
    getComputedStyle(node, pseudo) {
      if (pseudo === '::before') {
        const at = stopList.children.indexOf(node);
        return swatches && at >= 0
          ? {
              content: '""',
              display: 'inline-block',
              backgroundColor: CLASS_COLOURS[at % CLASS_COLOURS.length],
            }
          : { content: 'none', display: 'inline', backgroundColor: '' };
      }
      if (node === ramp)
        return swatches
          ? { display: 'none' }
          : {
              display: 'inline-block',
              backgroundColor: 'rgba(0, 0, 0, 0)',
              backgroundImage: 'linear-gradient(90deg, red, green)',
            };
      return {};
    },
  };
  // The row's box grows with the lines its marks take; the bar's does not.
  row.getBoundingClientRect = () => {
    const { marks, line } = layout();
    return { width: width(), height: marks * line };
  };
  bar.getBoundingClientRect = () => ({ width: 1280, height: 52 });

  // The board's render of a lens: title, stops, note.
  function show(next) {
    title.textContent = next.title;
    stopList.replaceChildren(
      ...next.stops.map((text) => {
        const span = el('span');
        span.textContent = text;
        span.getClientRects = () => stopRects(span);
        return span;
      }),
    );
    noteNode.textContent = next.note;
  }
  show({ title: 'Condition', stops, note });

  // Observers that deliver what a browser's would: a mutation reaches a
  // MutationObserver only when its options cover that kind of change, and a
  // ResizeObserver hears of the boxes it watches.
  const mutationObservers = [];
  const resizeObservers = [];
  const saved = [globalThis.MutationObserver, globalThis.ResizeObserver];
  if (observe) {
    globalThis.MutationObserver = class {
      constructor(callback) {
        this.callback = callback;
        mutationObservers.push(this);
      }
      observe(target, options) {
        this.target = target;
        this.options = options;
      }
      disconnect() {}
    };
    globalThis.ResizeObserver = class {
      constructor(callback) {
        this.callback = callback;
        this.targets = [];
        resizeObservers.push(this);
      }
      observe(target) {
        this.targets.push(target);
      }
      disconnect() {}
    };
  }
  const events = new AbortController();
  let frameLegend;
  try {
    frameLegend = createFrameLegend({
      document,
      window,
      signal: events.signal,
      observers: [],
    });
  } finally {
    [globalThis.MutationObserver, globalThis.ResizeObserver] = saved;
    if (!saved[0]) delete globalThis.MutationObserver;
    if (!saved[1]) delete globalThis.ResizeObserver;
  }
  /** A change of `type` to `node`, delivered to every observer it reaches. */
  function mutate(node, type, attributeName) {
    for (const observer of mutationObservers) {
      const { target, options = {} } = observer;
      const reaches =
        node === target || (options.subtree && target.contains(node));
      const kind =
        type === 'attributes'
          ? options.attributes &&
            (!options.attributeFilter ||
              options.attributeFilter.includes(attributeName))
          : options[type];
      if (reaches && kind)
        observer.callback([{ type, target: node, attributeName }]);
    }
  }
  /** The observers' report of a layout pass over the boxes they watch. */
  function resize() {
    for (const observer of resizeObservers)
      observer.callback(observer.targets.map((target) => ({ target })));
  }
  return {
    document,
    legend,
    title,
    ramp,
    unknown,
    noteNode,
    button,
    lensButton,
    popup,
    outside,
    model,
    show,
    mutate,
    resize,
    sync: frameLegend.sync,
    key: (key) => document.dispatchEvent({ type: 'keydown', key }),
    pointerdown: (target) =>
      document.dispatchEvent({ type: 'pointerdown', target }),
  };
}

const outOf = (page) =>
  page.document
    .getElementById('world-legend-stops')
    .children.filter((stop) => stop.hasAttribute('data-out'))
    .map((stop) => stop.textContent);
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();

test('a legend that fits whole shows no info button', () => {
  const page = setup();
  assert.equal(page.button.hidden, true);
  assert.equal(page.legend.hasAttribute('data-dense'), false);
  assert.equal(page.legend.hasAttribute('data-note-off'), false);
});

test('a legend with no note that fits shows no info button', () => {
  const page = setup({ lines: 3, note: '' });
  assert.equal(page.button.hidden, true);
});

test('a note cut by its ellipsis brings the button, and the popover holds the whole legend', () => {
  const note =
    'Sourced owner or operator home country · hatching means unknown · draft evidence is fainter';
  const page = setup({ noteWidth: 900, note });
  assert.equal(page.button.hidden, false);
  assert.equal(page.legend.hasAttribute('data-note-off'), false);

  page.button.click();
  assert.equal(page.popup.hidden, false);
  assert.equal(page.button.getAttribute('aria-expanded'), 'true');
  assert.equal(page.document.activeElement, page.popup);
  const whole = text(page.popup);
  for (const part of [
    'Condition',
    'Weak',
    'Midrange',
    'Strong',
    'Unknown or disputed',
    note,
  ])
    assert.ok(whole.includes(part), `the popover has "${part}": ${whole}`);
  // The ramp is drawn as the bar draws it.
  const ramp = page.popup.querySelector('.frame-legend-popup-ramp');
  assert.equal(
    ramp.style.backgroundImage,
    'linear-gradient(90deg, red, green)',
  );

  // Escape closes it and gives focus back to the button.
  page.key('Escape');
  assert.equal(page.popup.hidden, true);
  assert.equal(page.button.getAttribute('aria-expanded'), 'false');
  assert.equal(page.document.activeElement, page.button);
});

/** The boxes a node draws, all inside the legend's band as drawn (to 1 px). */
const wholeInBand = (node) => {
  const rects = node.getClientRects();
  const band = node.ownerDocument
    .getElementById('world-legend')
    .getBoundingClientRect();
  return (
    rects.length > 0 &&
    rects.every(
      (rect) =>
        rect.top >= band.top - 1 &&
        rect.bottom <= band.bottom + 1 &&
        rect.left >= band.left - 1 &&
        rect.right <= band.right + 1,
    )
  );
};
/** Every part the bar draws of the legend lies whole inside its band. */
const drawnWhole = (page) =>
  [
    page.title,
    page.ramp,
    ...page.document
      .getElementById('world-legend-stops')
      .children.filter((stop) => !stop.hasAttribute('data-out')),
    page.unknown,
    ...(page.legend.hasAttribute('data-note-off') ? [] : [page.noteNode]),
  ]
    .filter((node) => node.getClientRects().length)
    .every(wholeInBand);

test('a note with no line left is dropped, the stops stay, and the button shows', () => {
  // Three lines of marks fill the band: the note has no line, and even with
  // every stop out it would not, so the note goes and the stops come back.
  const page = setup({ lines: 3 });
  assert.equal(page.legend.hasAttribute('data-note-off'), true);
  assert.deepEqual(page.noteNode.getClientRects(), []);
  assert.deepEqual(outOf(page), []);
  assert.equal(page.legend.hasAttribute('data-dense'), false);
  assert.equal(page.button.hidden, false);
  assert.ok(wholeInBand(page.title) && wholeInBand(page.unknown));
});

const OWNERSHIP_LIKE = [
  'Documented foreign ownership',
  'Grey dashes mark documented military presence',
  'Dotted lines and ? markers show exact site unknown',
  'Fainter lines and outlined markers mark draft evidence',
];

test('a band filled to the edge by dense lines is not taken: the title and the Unknown key stay whole and stops leave instead', () => {
  // A title line, one line per stop and an Unknown-key line, then the note.
  // One stop and the note make four dense lines, exactly the band, and the
  // title's and the Unknown key's type would stand 1.5 px past its edges
  // (what the browser found at 1280 and 1440 px). Only the layout whose
  // every part is whole is kept.
  const page = setup({
    lines: (shown) => 2 + shown,
    stops: OWNERSHIP_LIKE,
    noteWidth: 120,
  });
  assert.ok(wholeInBand(page.title), 'the title is whole');
  assert.ok(wholeInBand(page.unknown), 'the Unknown key is whole');
  assert.ok(wholeInBand(page.noteNode), 'the note is whole');
  assert.deepEqual(outOf(page), OWNERSHIP_LIKE);
  assert.equal(page.legend.hasAttribute('data-dense'), false);
  assert.equal(page.button.hidden, false);
  page.button.click();
  const whole = text(page.popup);
  for (const part of [...OWNERSHIP_LIKE, 'Unknown or disputed'])
    assert.ok(whole.includes(part), `the popover has "${part}": ${whole}`);
});

test('stops leave from the last one back, each whole or not at all', () => {
  // The marks wrap two stops to a line after the title's: with the note
  // there is room for two lines of marks, so the first two stops stay and
  // the last two leave.
  const page = setup({
    lines: (shown) => 1 + Math.ceil(shown / 2),
    stops: OWNERSHIP_LIKE,
    noteWidth: 120,
  });
  assert.deepEqual(outOf(page), OWNERSHIP_LIKE.slice(2));
  for (const stop of page.document.getElementById('world-legend-stops')
    .children)
    assert.ok(
      stop.hasAttribute('data-out') || wholeInBand(stop),
      `${stop.textContent} is whole or out`,
    );
  assert.equal(page.button.hidden, false);
});

test('where only the title and the Unknown key fit, they are whole inside the band and the rest is behind the button', () => {
  // A title line, a line per stop and an Unknown-key line: with no stop and
  // no note that is three lines, which the band holds; anything more it does
  // not. The stops and the note go, and what stays is drawn whole.
  const page = setup({ lines: (shown) => 3 + shown });
  assert.equal(page.legend.hasAttribute('data-away'), false);
  assert.deepEqual(outOf(page), ['Weak', 'Midrange', 'Strong']);
  assert.equal(page.legend.hasAttribute('data-note-off'), true);
  assert.ok(wholeInBand(page.title), 'the title is whole in the band');
  assert.ok(wholeInBand(page.unknown), 'the Unknown key is whole in the band');
  assert.ok(drawnWhole(page));
  assert.equal(page.button.hidden, false);
});

test('where even the title and the Unknown key cannot be whole, the legend leaves the bar and the button shows', () => {
  // Marks that take four lines whatever is left out: no layout is whole.
  const page = setup({ lines: 4 });
  assert.equal(page.legend.hasAttribute('data-away'), true);
  assert.equal(page.button.hidden, false);
  page.button.click();
  const whole = text(page.popup);
  for (const part of [
    'Condition',
    'Weak',
    'Midrange',
    'Strong',
    'Unknown or disputed',
    'World Bank · IMF · UCDP · V-Dem',
  ])
    assert.ok(whole.includes(part), `the popover has "${part}": ${whole}`);
  // Room again: the legend comes back to the bar, whole.
  page.model.lines = 2;
  page.model.noteWidth = 120;
  page.sync();
  assert.equal(page.legend.hasAttribute('data-away'), false);
  assert.ok(drawnWhole(page));
  assert.equal(page.button.hidden, true);
});

test('a ramp the band would cut is seen: the legend is never drawn with it half-clipped', () => {
  // The ramp runs past the band's right edge whatever else is left out.
  const page = setup({ rampRight: 460 });
  assert.equal(page.legend.hasAttribute('data-away'), true);
  assert.equal(page.button.hidden, false);
  // A lens of classes draws no ramp, and its legend stays in the bar.
  const classes = setup({ rampRight: 460, swatches: true });
  assert.equal(classes.legend.hasAttribute('data-away'), false);
});

test('the room the button takes is measured: what is drawn is what was fitted', () => {
  // In the full band the marks take two lines; in the band less the
  // button's room they take a line for the title and Unknown key and one per
  // stop. The note is cut, so the button must show: fitted once without it
  // the legend would keep every stop, and the button would then push the
  // marks onto five lines, past the band.
  const page = setup({
    lines: (shown, width) => (width >= WIDTH ? 2 : 1 + shown),
    noteWidth: 900,
  });
  assert.equal(page.button.hidden, false);
  assert.ok(
    drawnWhole(page),
    'every part drawn is whole with the button shown',
  );
  assert.deepEqual(outOf(page), ['Midrange', 'Strong']);
  // The note becomes short and nothing needs the button: it hides, and the
  // stops that the band without it holds come back.
  page.model.noteWidth = 120;
  page.sync();
  assert.equal(page.button.hidden, true);
  assert.deepEqual(outOf(page), []);
  assert.ok(drawnWhole(page));
});

test('marks that fit are all kept in the bar', () => {
  // Every stop fits at the usual line height: none leaves, nothing is dense.
  const page = setup({
    lines: (shown) => 1 + Math.ceil(shown / 2),
    stops: OWNERSHIP_LIKE,
    note: '',
  });
  assert.deepEqual(outOf(page), []);
  assert.equal(page.legend.hasAttribute('data-dense'), false);
  assert.equal(page.button.hidden, true);
});

test('a lens change brings back marks a previous lens left out', () => {
  const page = setup({
    lines: (shown) => 2 + shown,
    stops: OWNERSHIP_LIKE,
    note: '',
  });
  assert.equal(outOf(page).length, 3);
  page.model.lines = 2;
  page.show({ title: 'Condition', stops: ['Weak', 'Strong'], note: '' });
  page.sync();
  assert.deepEqual(outOf(page), []);
  assert.equal(page.button.hidden, true);
});

test('words that change after the first fit are fitted again, wherever in the legend they change', () => {
  const page = setup({ observe: true });
  assert.equal(page.button.hidden, true);
  // A country picked: the board rewrites the note's text in place, longer.
  page.model.noteWidth = 900;
  page.noteNode.firstChild.data =
    'IND · sourced owner or operator home country';
  page.mutate(page.noteNode.firstChild, 'characterData');
  assert.equal(page.button.hidden, false);
  // A lens change: new stops that need more lines than the band has.
  page.model.noteWidth = 120;
  page.model.lines = (shown) => 2 + shown;
  page.show({ title: 'Ownership', stops: OWNERSHIP_LIKE, note: 'Sourced' });
  page.mutate(page.document.getElementById('world-legend-stops'), 'childList');
  assert.deepEqual(outOf(page), OWNERSHIP_LIKE);
  assert.ok(wholeInBand(page.title) && wholeInBand(page.unknown));
});

test("the fit's own marks do not call it again; the legend's hidden does", () => {
  const page = setup({ observe: true, lines: 3 });
  const before = page.model.fits;
  const stop = page.document.getElementById('world-legend-stops').children[0];
  page.mutate(stop, 'attributes', 'data-out');
  page.mutate(page.legend, 'attributes', 'data-dense');
  page.mutate(page.legend, 'attributes', 'data-note-off');
  assert.equal(page.model.fits, before);
  page.legend.hidden = true;
  page.mutate(page.legend, 'attributes', 'hidden');
  assert.equal(page.button.hidden, true);
});

test('a resize the fit itself left is not fitted again; a real change of size is', () => {
  const page = setup({ observe: true });
  const before = page.model.fits;
  page.resize();
  assert.equal(page.model.fits, before, 'no box changed size');
  // The marks grow a line (a font that loaded, say): the row's box grows.
  page.model.lines = 3;
  page.resize();
  // One fit with the button hidden, which leaves the note out, and one more
  // with the button shown.
  assert.equal(page.model.fits, before + 2);
  assert.equal(page.legend.hasAttribute('data-note-off'), true);
  assert.equal(page.button.hidden, false);
});

test('a legend the bar cannot draw (a phone) is read through the button', () => {
  const page = setup({ drawn: false });
  assert.equal(page.button.hidden, false);
  page.button.click();
  assert.ok(text(page.popup).includes('World Bank · IMF · UCDP · V-Dem'));
});

test('classes keep their swatches in the popover', () => {
  const page = setup({
    swatches: true,
    noteWidth: 900,
    stops: ['Allied', 'Partner'],
  });
  page.button.click();
  const items = page.popup.querySelectorAll('li');
  assert.deepEqual(
    items.map((item) => [
      item.textContent,
      item.querySelector('.frame-legend-popup-swatch')?.style.backgroundColor,
    ]),
    [
      ['Allied', CLASS_COLOURS[0]],
      ['Partner', CLASS_COLOURS[1]],
    ],
  );
  // Diplomacy hides its ramp in the bar; the popover leaves it out too.
  assert.equal(page.popup.querySelector('.frame-legend-popup-ramp'), null);
});

test('a click outside closes the popover; a click inside does not', () => {
  const page = setup({ noteWidth: 900 });
  page.button.click();
  page.pointerdown(page.popup.firstChild);
  assert.equal(page.popup.hidden, false);
  page.pointerdown(page.outside);
  assert.equal(page.popup.hidden, true);
  // Focus was in the popover, so it returns to the button.
  assert.equal(page.document.activeElement, page.button);
  // The button toggles it too.
  page.button.click();
  page.button.click();
  assert.equal(page.popup.hidden, true);
});

test('a change of lens is measured again: the open popover follows it, and closes once nothing is cut', () => {
  const page = setup({ noteWidth: 900 });
  page.button.click();
  page.show({
    title: 'Data age',
    stops: ['8+ years old', 'Current year'],
    note: 'Annual source data',
  });
  page.sync();
  assert.ok(text(page.popup).startsWith('Data age'));
  assert.ok(text(page.popup).includes('Annual source data'));

  page.model.noteWidth = 120;
  page.sync();
  assert.equal(page.button.hidden, true);
  assert.equal(page.popup.hidden, true);
});

test('a hidden legend hides the button and closes the popover', () => {
  const page = setup({ noteWidth: 900 });
  page.button.click();
  page.legend.hidden = true;
  page.sync();
  assert.equal(page.button.hidden, true);
  assert.equal(page.popup.hidden, true);
});

test('a popover closed by a fit gives focus back to the button, or to the pressed lens where the button goes', () => {
  const page = setup({ noteWidth: 900 });
  page.button.click();
  assert.equal(page.document.activeElement, page.popup);
  // The note becomes short: nothing is cut, the button hides, the popover
  // closes, and focus goes to the lens rather than the page's body.
  page.model.noteWidth = 120;
  page.sync();
  assert.equal(page.popup.hidden, true);
  assert.equal(page.document.activeElement, page.lensButton);

  // The legend hidden while focus is in the popover: the same.
  const hidden = setup({ noteWidth: 900 });
  hidden.button.click();
  hidden.legend.hidden = true;
  hidden.sync();
  assert.equal(hidden.document.activeElement, hidden.lensButton);

  // Focus elsewhere is left where it is.
  const elsewhere = setup({ noteWidth: 900 });
  elsewhere.button.click();
  elsewhere.outside.focus();
  elsewhere.model.noteWidth = 120;
  elsewhere.sync();
  assert.equal(elsewhere.document.activeElement, elsewhere.outside);
});

test('the popover is one menu among the others: it announces itself and closes when another opens', () => {
  const page = setup({ noteWidth: 900 });
  const heard = [];
  page.document.addEventListener(MENU_OPEN_EVENT, (event) =>
    heard.push(event.detail.menu),
  );
  page.button.click();
  assert.deepEqual(heard, ['legend']);
  page.document.dispatchEvent({
    type: MENU_OPEN_EVENT,
    detail: { menu: 'layers' },
  });
  assert.equal(page.popup.hidden, true);
  assert.equal(page.button.getAttribute('aria-expanded'), 'false');
});
