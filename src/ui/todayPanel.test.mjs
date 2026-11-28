import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeDocument } from '../testSupport/fakeDocument.mjs';
import { createTodayPanel } from './todayPanel.js';

function channel(snapshot) {
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(next) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

function fixture({ board = null, digest = null } = {}) {
  const document = createFakeDocument();
  const make = (tag, id, parent = document.body) => {
    const element = document.createElement(tag);
    element.id = id;
    parent.append(element);
    return element;
  };
  const rail = make('button', 'frame-today-open');
  const empty = make('div', 'frame-today-empty');
  const next = make('button', 'frame-today-next', empty);
  const list = make('ol', 'frame-today-list');
  const more = make('button', 'frame-today-more');
  const worldSheet = make('section', 'world-character-sheet');
  worldSheet.hidden = true;
  const countryTitle = make('h2', 'world-sheet-name', worldSheet);
  const story = make('section', 'frame-today-story');
  story.hidden = true;
  const storyTitle = make('h2', 'frame-today-story-title', story);
  const close = make('button', 'frame-today-story-close', story);
  const context = make('p', 'frame-today-story-context', story);
  const summary = make('p', 'frame-today-story-summary', story);
  const whatsNew = make('p', 'frame-today-story-new', story);
  const sources = make('ul', 'frame-today-story-sources', story);
  const world = channel(board);
  const news = channel(digest);
  const calls = [];
  world.clearSelection = () => calls.push('clear-selection');
  news.selectStory = () => assert.fail('Today selects only through its hook');
  news.setTheater = () => assert.fail('Today must not reload a theater');
  const panel = createTodayPanel({
    document,
    world,
    news,
    selectStory(id) {
      calls.push(['select-story', id]);
      news.update({ ...news.getSnapshot(), selectedStoryId: id });
      return true;
    },
    clearStory() {
      calls.push('clear-story');
      news.update({ ...news.getSnapshot(), selectedStoryId: null });
    },
    openSources: () => calls.push('sources'),
    openCountry(code) {
      calls.push(['open-country', code]);
      worldSheet.hidden = false;
      world.update({ ...world.getSnapshot(), selected: code });
      return true;
    },
    frameCountry: (code) => calls.push(['frame-country', code]),
  });
  return {
    document,
    rail,
    empty,
    next,
    list,
    more,
    story,
    storyTitle,
    context,
    summary,
    whatsNew,
    sources,
    worldSheet,
    countryTitle,
    close,
    world,
    news,
    calls,
    panel,
  };
}

const outlets = [
  ['a', 'Fixture Herald', 'https://herald.invalid/a'],
  ['b', 'Fixture Courier', 'https://courier.invalid/b'],
  ['c', 'Fixture Ledger', 'https://ledger.invalid/c'],
  ['d', 'Fixture Wire', 'https://wire.invalid/d'],
  ['e', 'Fixture Post', 'https://post.invalid/e'],
];

function digest(storyOverrides = {}, ...more) {
  const stories = [
    {
      id: 'depot',
      title: 'A strike hit a fixture depot.',
      summary: 'Fixture summary of the depot strike.',
      whatsNew: 'Fixture outlets agreed on the time.',
      category: 'armed-conflict',
      kind: 'event',
      place: 'Fixture City',
      location: { lat: 31.5, lon: 34.4 },
      status: 'open',
      updatedAt: '2026-11-09T08:05:00.000Z',
      itemIds: ['a', 'b'],
      ...storyOverrides,
    },
    ...more,
  ];
  return {
    enabled: true,
    theater: { id: 'world', name: 'World affairs' },
    stories,
    visibleStories: stories,
    items: outlets.map(([id, , url]) => ({ id, sourceId: id, url })),
    sources: outlets.map(([id, name]) => ({ id, name })),
    selectedStoryId: null,
  };
}

const firstRow = (f) => f.list.children[0].children[0];
const links = (f) => f.sources.querySelectorAll('a');

test('the empty action points to the existing settings without a refresh', () => {
  const f = fixture();
  assert.equal(f.empty.hidden, false);
  assert.equal(f.list.hidden, true);
  assert.equal(f.more.hidden, true);
  f.next.click();
  assert.deepEqual(f.calls, ['sources']);
});

test('five rows show before More expands and a country row uses its known code', () => {
  const countries = Object.fromEntries(
    ['TAA', 'TAB', 'TAC', 'TAD', 'TAE', 'TAF', 'TAG'].map((iso3) => [
      iso3,
      { name: iso3 },
    ]),
  );
  const f = fixture({
    board: {
      enabled: true,
      countries,
      turn: {
        number: 2,
        endedAt: '2026-11-09T10:00:00Z',
        changes: Object.keys(countries).map((iso3) => ({ iso3 })),
      },
    },
  });
  assert.equal(f.empty.hidden, true);
  assert.equal(f.list.children.length, 5);
  assert.equal(f.more.hidden, false);
  f.more.click();
  assert.equal(f.list.children.length, 7);
  assert.equal(f.more.getAttribute('aria-expanded'), 'true');
  f.list.children[6].children[0].click();
  assert.deepEqual(f.calls, [['open-country', 'TAG']]);
  f.more.click();
  assert.equal(f.list.children.length, 5);
});

test('a row shows the headline, place and time, outlets and reason', () => {
  const f = fixture({ digest: digest({ itemIds: ['a', 'b', 'c', 'd', 'e'] }) });
  const parts = firstRow(f).children.map((node) => node.textContent);
  assert.deepEqual(parts, [
    'A strike hit a fixture depot.',
    'Fixture City · updated 9 Nov 2026, 08:05 UTC',
    'Fixture Courier · Fixture Herald · Fixture Ledger and 2 more',
    'Reported by 5 outlets',
  ]);
  const few = fixture({ digest: digest() });
  assert.equal(
    firstRow(few).children[2].textContent,
    'Fixture Courier · Fixture Herald',
  );
});

test('opening a located story shows its text and every outlet, and selects it on the map', async () => {
  const f = fixture({ digest: digest({ itemIds: ['a', 'b', 'c', 'd', 'e'] }) });
  const row = firstRow(f);
  row.focus();
  row.click();
  await Promise.resolve();
  assert.equal(f.story.hidden, false);
  assert.equal(row.getAttribute('aria-expanded'), 'true');
  assert.equal(f.storyTitle.textContent, 'A strike hit a fixture depot.');
  assert.equal(
    f.context.textContent,
    'Fixture City · updated 9 Nov 2026, 08:05 UTC',
  );
  assert.equal(f.summary.textContent, 'Fixture summary of the depot strike.');
  assert.equal(f.whatsNew.hidden, false);
  assert.equal(
    f.whatsNew.textContent,
    'New: Fixture outlets agreed on the time.',
  );
  assert.deepEqual(
    links(f).map((link) => [
      link.textContent,
      link.getAttribute('href'),
      link.getAttribute('target'),
      link.getAttribute('rel'),
    ]),
    [
      [
        'Fixture Courier',
        'https://courier.invalid/b',
        '_blank',
        'noopener noreferrer',
      ],
      [
        'Fixture Herald',
        'https://herald.invalid/a',
        '_blank',
        'noopener noreferrer',
      ],
      [
        'Fixture Ledger',
        'https://ledger.invalid/c',
        '_blank',
        'noopener noreferrer',
      ],
      [
        'Fixture Post',
        'https://post.invalid/e',
        '_blank',
        'noopener noreferrer',
      ],
      [
        'Fixture Wire',
        'https://wire.invalid/d',
        '_blank',
        'noopener noreferrer',
      ],
    ],
  );
  // A located story is framed by the news layer's own flight, not a country.
  assert.deepEqual(f.calls, ['clear-selection', ['select-story', 'depot']]);
  assert.equal(f.document.activeElement, f.storyTitle);

  f.close.click();
  assert.equal(f.story.hidden, true);
  assert.deepEqual(f.calls.at(-1), 'clear-story');
  assert.equal(f.news.getSnapshot().selectedStoryId, null);
  assert.equal(f.document.activeElement, row);
});

test('Escape closes the story and clears the selection Today made', () => {
  const f = fixture({ digest: digest() });
  firstRow(f).click();
  let prevented = false;
  f.story.dispatchEvent({
    type: 'keydown',
    key: 'Escape',
    defaultPrevented: false,
    preventDefault: () => (prevented = true),
    stopPropagation() {},
  });
  assert.ok(prevented);
  assert.equal(f.story.hidden, true);
  assert.equal(f.calls.at(-1), 'clear-story');
});

test('a map selection elsewhere closes the opened story without moving focus', () => {
  const f = fixture({ digest: digest() });
  firstRow(f).click();
  const elsewhere = f.document.createElement('button');
  f.document.body.append(elsewhere);
  elsewhere.focus();
  f.news.update({ ...f.news.getSnapshot(), selectedStoryId: 'another' });
  assert.equal(f.story.hidden, true);
  assert.equal(f.document.activeElement, elsewhere);
  assert.equal(f.news.getSnapshot().selectedStoryId, 'another');
  assert.ok(!f.calls.includes('clear-story'));

  firstRow(f).click();
  f.news.update({ ...f.news.getSnapshot(), selectedStoryId: null });
  assert.equal(f.story.hidden, true);
  assert.equal(f.document.activeElement, elsewhere);
  assert.ok(!f.calls.includes('clear-story'));
});

test('closing leaves a selection the viewer made before Today opened it', () => {
  const f = fixture({ digest: { ...digest(), selectedStoryId: 'depot' } });
  firstRow(f).click();
  assert.equal(f.story.hidden, false);
  f.close.click();
  assert.equal(f.story.hidden, true);
  assert.ok(!f.calls.includes('clear-story'));
  assert.equal(f.news.getSnapshot().selectedStoryId, 'depot');
});

test('opening a second story from Today keeps the second one open', () => {
  const f = fixture({
    digest: digest(
      {},
      {
        id: 'second',
        title: 'A second fixture story.',
        summary: '',
        whatsNew: '',
        kind: 'development',
        place: null,
        status: 'open',
        updatedAt: '2026-11-08T08:05:00.000Z',
        itemIds: ['c'],
      },
    ),
  });
  firstRow(f).click();
  f.list.children[1].children[0].click();
  assert.equal(f.story.hidden, false);
  assert.equal(f.storyTitle.textContent, 'A second fixture story.');
  assert.equal(f.news.getSnapshot().selectedStoryId, 'second');
  f.close.click();
  assert.equal(f.news.getSnapshot().selectedStoryId, null);
});

test('an unlocated story in a country frames that country', () => {
  const f = fixture({
    board: { enabled: true, countries: { IND: { name: 'India' } } },
    digest: digest({
      kind: 'development',
      location: null,
      place: 'India',
      whatsNew: '',
    }),
  });
  firstRow(f).click();
  assert.equal(f.whatsNew.hidden, true);
  assert.deepEqual(f.calls, [
    'clear-selection',
    ['select-story', 'depot'],
    ['frame-country', 'IND'],
  ]);
});

test('a story placed only in its theater leaves the view where it is', () => {
  const f = fixture({ digest: digest({ location: null, place: null }) });
  firstRow(f).click();
  assert.equal(f.story.hidden, false);
  assert.match(f.context.textContent, /^World affairs · updated /);
  assert.deepEqual(f.calls, ['clear-selection', ['select-story', 'depot']]);
});

test('story text is shown as text, never as markup', () => {
  const markup = '<img src=x onerror=alert(1)><b>bold</b>';
  const f = fixture({
    digest: digest({ title: markup, summary: markup, whatsNew: markup }),
  });
  const row = firstRow(f);
  row.click();
  assert.equal(row.children[0].textContent, markup);
  assert.equal(f.storyTitle.textContent, markup);
  assert.equal(f.summary.textContent, markup);
  assert.equal(f.whatsNew.textContent, `New: ${markup}`);
  for (const root of [f.list, f.story])
    assert.deepEqual(
      [...root.descendants()].filter((node) =>
        ['IMG', 'B'].includes(node.tagName),
      ),
      [],
    );
});

test('turning news off closes its open story and removes its row', () => {
  const f = fixture({ digest: digest() });
  firstRow(f).click();
  assert.equal(f.story.hidden, false);
  f.news.update({ ...f.news.getSnapshot(), enabled: false });
  assert.equal(f.story.hidden, true);
  assert.equal(f.list.children.length, 0);
  assert.equal(f.empty.hidden, false);
});

test('map selection replaces a story with the ordinary country sheet', () => {
  const board = { enabled: true, countries: { IND: { name: 'India' } } };
  const f = fixture({ board, digest: digest() });
  firstRow(f).click();
  f.world.update({ ...board, selected: 'IND' });
  assert.equal(f.story.hidden, true);
});

test('opening a country moves focus to its sheet and closing returns to folded Today', async () => {
  const board = {
    enabled: true,
    countries: { IND: { name: 'India' } },
    turn: {
      number: 2,
      endedAt: '2026-11-09T10:00:00Z',
      changes: [{ iso3: 'IND' }],
    },
  };
  const f = fixture({ board });
  const row = firstRow(f);
  row.focus();
  row.click();
  await Promise.resolve();
  assert.equal(f.document.activeElement, f.countryTitle);

  f.document.body.dataset.today = 'folded';
  f.worldSheet.hidden = true;
  f.world.update({ ...board, selected: null });
  await Promise.resolve();
  assert.equal(f.document.activeElement, f.rail);
});

test('an open source link keeps focus across unrelated updates and after its address changes', async () => {
  const board = { enabled: true, countries: { IND: { name: 'India' } } };
  const f = fixture({ board, digest: digest() });
  firstRow(f).click();
  await Promise.resolve();
  const link = () => links(f)[1];
  const original = link();
  original.focus();
  f.world.update({
    ...board,
    turn: { number: 2, endedAt: '2026-11-09', changes: [{ iso3: 'IND' }] },
  });
  assert.equal(f.list.children.length, 2);
  assert.ok(link() === original, 'an unchanged story keeps its DOM nodes');
  assert.equal(f.document.activeElement, original);

  const snapshot = f.news.getSnapshot();
  f.news.update({
    ...snapshot,
    items: snapshot.items.map((item) =>
      item.id === 'a'
        ? { ...item, url: 'https://herald.invalid/revised' }
        : item,
    ),
  });
  assert.equal(link().getAttribute('href'), 'https://herald.invalid/revised');
  assert.equal(f.document.activeElement, link());
});
