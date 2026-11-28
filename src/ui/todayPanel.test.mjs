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
  make('p', 'frame-today-story-context', story);
  make('ul', 'frame-today-story-sources', story);
  const world = channel(board);
  const news = channel(digest);
  const calls = [];
  world.clearSelection = () => calls.push('clear-selection');
  news.selectStory = () =>
    assert.fail('Today must not select a news map object');
  news.setTheater = () => assert.fail('Today must not reload a theater');
  const panel = createTodayPanel({
    document,
    world,
    news,
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
    worldSheet,
    countryTitle,
    close,
    world,
    news,
    calls,
    panel,
  };
}

function civicStory() {
  return {
    enabled: true,
    theater: { id: 'world', name: 'World affairs' },
    visibleStories: [
      {
        id: 'schools',
        title: 'Lawmakers approved a public school budget.',
        summary: 'The budget covers publicly funded schools.',
        category: 'elections-governance',
        kind: 'development',
        place: 'India',
        status: 'open',
        updatedAt: '2026-11-09',
        itemIds: ['one'],
      },
    ],
    items: [
      { id: 'one', sourceId: 'feed', url: 'https://report.invalid/story' },
    ],
    sources: [{ id: 'feed', name: 'Public News' }],
  };
}

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

test('a cached civic development opens a context-free story and the known country view', async () => {
  const f = fixture({
    board: { enabled: true, countries: { IND: { name: 'India' } } },
    digest: civicStory(),
  });
  const row = f.list.children[0].children[0];
  row.click();
  await Promise.resolve();
  assert.equal(f.story.hidden, false);
  assert.match(f.story.textContent, /Public News/);
  assert.equal(
    f.document
      .getElementById('frame-today-story-source-link')
      .getAttribute('href'),
    'https://report.invalid/story',
  );
  assert.equal(f.document.activeElement, f.storyTitle);
  assert.deepEqual(f.calls, ['clear-selection', ['frame-country', 'IND']]);
  f.close.click();
  assert.equal(f.story.hidden, true);
  assert.equal(f.document.activeElement, row);
});

test('turning news off closes its open story and removes its row', () => {
  const digest = civicStory();
  const f = fixture({
    board: { enabled: true, countries: { IND: { name: 'India' } } },
    digest,
  });
  f.list.children[0].children[0].click();
  assert.equal(f.story.hidden, false);
  f.news.update({ ...digest, enabled: false });
  assert.equal(f.story.hidden, true);
  assert.equal(f.list.children.length, 0);
  assert.equal(f.empty.hidden, false);
});

test('map selection replaces a story with the ordinary country sheet', () => {
  const board = { enabled: true, countries: { IND: { name: 'India' } } };
  const f = fixture({ board, digest: civicStory() });
  f.list.children[0].children[0].click();
  f.world.update({ ...board, selected: 'IND' });
  assert.equal(f.story.hidden, true);
});

test('a theater-only development opens without guessing a camera target', () => {
  const digest = civicStory();
  digest.visibleStories[0].place = null;
  const f = fixture({ digest });
  f.list.children[0].children[0].click();
  assert.equal(f.story.hidden, false);
  assert.match(f.story.textContent, /World affairs/);
  assert.deepEqual(f.calls, ['clear-selection']);
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
  const row = f.list.children[0].children[0];
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

test('an open citation keeps focus across unrelated updates and restores it after a citation change', async () => {
  const digest = civicStory();
  const board = { enabled: true, countries: { IND: { name: 'India' } } };
  const f = fixture({ board, digest });
  f.list.children[0].children[0].click();
  await Promise.resolve();
  const link = () => f.document.getElementById('frame-today-story-source-link');
  const original = link();
  original.focus();
  f.world.update({
    ...board,
    turn: { number: 2, endedAt: '2026-11-09', changes: [{ iso3: 'IND' }] },
  });
  assert.equal(f.list.children.length, 2);
  assert.ok(
    link() === original,
    'an unchanged opened citation keeps its DOM node',
  );
  assert.equal(f.document.activeElement, original);

  f.news.update({
    ...digest,
    items: [{ ...digest.items[0], url: 'https://report.invalid/revised' }],
  });
  assert.equal(link().getAttribute('href'), 'https://report.invalid/revised');
  assert.equal(f.document.activeElement, link());
});
