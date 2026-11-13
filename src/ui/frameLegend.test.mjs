// The legend in the bottom bar: its marks are never cut, the note takes the
// line that is left, and whenever anything is cut (or the bar has no room for
// the legend at all) the info button opens a popover holding all of it. The
// browser measures; here a small layout model stands in for it, so the rules
// are exercised on what the measuring reports.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeDocument } from '../testSupport/fakeDocument.mjs';
import { createFrameLegend } from './frameLegend.js';

const CLASS_COLOURS = ['rgb(219, 71, 79)', 'rgb(232, 147, 63)'];

/**
 * The bar's legend as frame.html has it, with a layout model: the marks take
 * `lines` lines of 15 px (12 px when dense) in a 48 px box, or
 * `lines(n)` lines when n stops are in the bar, and the note is `noteWidth` px
 * of text in a 400 px line.
 */
function setup({
  lines = 2,
  noteWidth = 300,
  drawn = true,
  swatches = false,
  stops = ['Weak', 'Midrange', 'Strong'],
  note = 'World Bank · IMF · UCDP · V-Dem',
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
  bar.append(legend, button, popup, outside);
  document.body.append(bar);

  const model = { lines, noteWidth, drawn };
  const dense = () => legend.hasAttribute('data-dense');
  legend.getClientRects = () => (model.drawn ? [{}] : []);
  Object.defineProperty(row, 'scrollHeight', {
    get: () => {
      const shown = stopList.children.filter(
        (stop) => !stop.hasAttribute('data-out'),
      ).length;
      const lines =
        typeof model.lines === 'function' ? model.lines(shown) : model.lines;
      return lines * (dense() ? 12 : 15);
    },
  });
  row.scrollWidth = row.clientWidth = 400;
  Object.defineProperty(noteNode, 'scrollWidth', {
    get: () => model.noteWidth,
  });
  noteNode.clientWidth = 400;
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
      if (node === legend) return { maxHeight: '48px' };
      if (node === ramp)
        return swatches
          ? { display: 'none' }
          : {
              display: 'inline-block',
              backgroundColor: 'rgba(0, 0, 0, 0)',
              backgroundImage: 'linear-gradient(90deg, red, green)',
            };
      return { lineHeight: dense() ? '12px' : '15px' };
    },
  };

  // The board's render of a lens: title, stops, note.
  function show(next) {
    title.textContent = next.title;
    stopList.replaceChildren(
      ...next.stops.map((text) => {
        const span = el('span');
        span.textContent = text;
        return span;
      }),
    );
    noteNode.textContent = next.note;
  }
  show({ title: 'Condition', stops, note });

  const events = new AbortController();
  const frameLegend = createFrameLegend({
    document,
    window,
    signal: events.signal,
    observers: [],
  });
  return {
    document,
    legend,
    button,
    popup,
    outside,
    model,
    show,
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

test('marks that fill the bar leave no line for the note: it goes, and the button shows', () => {
  const page = setup({ lines: 3 });
  assert.equal(page.legend.hasAttribute('data-dense'), false);
  assert.equal(page.legend.hasAttribute('data-note-off'), true);
  assert.equal(page.button.hidden, false);
});

test('marks one line over close up to the dense line rather than leaving the bar', () => {
  const page = setup({ lines: 4 });
  // 4 × 15 px is over the 48 px bar; 4 × 12 px fits it.
  assert.equal(page.legend.hasAttribute('data-dense'), true);
  assert.equal(page.legend.hasAttribute('data-note-off'), true);
  assert.deepEqual(outOf(page), []);
  assert.equal(page.button.hidden, false);
});

const OWNERSHIP_LIKE = [
  'Documented foreign ownership',
  'Grey dashes mark documented military presence',
  'Dotted lines and ? markers show exact site unknown',
  'Fainter lines and outlined markers mark draft evidence',
];

test('marks that do not fit even dense leave the bar whole, from the last, and the popover lists them all', () => {
  // A title line, an Unknown-key line and one line per stop: four lines of
  // 12 px fit 48 px, so two stops stay.
  const page = setup({
    lines: (shown) => 2 + shown,
    stops: OWNERSHIP_LIKE,
    noteWidth: 120,
  });
  assert.equal(page.legend.hasAttribute('data-dense'), true);
  assert.deepEqual(outOf(page), OWNERSHIP_LIKE.slice(2));
  assert.equal(page.button.hidden, false);
  page.button.click();
  const whole = text(page.popup);
  for (const part of [...OWNERSHIP_LIKE, 'Unknown or disputed'])
    assert.ok(whole.includes(part), `the popover has "${part}": ${whole}`);
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
  assert.equal(outOf(page).length, 2);
  page.model.lines = 2;
  page.show({ title: 'Condition', stops: ['Weak', 'Strong'], note: '' });
  page.sync();
  assert.deepEqual(outOf(page), []);
  assert.equal(page.button.hidden, true);
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
