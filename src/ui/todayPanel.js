import { buildTodayItems } from './todayItems.js';

const VISIBLE_ITEMS = 5;
/** Outlets a row names before "and N more"; the opened story names all. */
const ROW_OUTLETS = 3;
const dayFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const monthFormat = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const clockFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

/**
 * A fixed date at the precision the item holds: "2025", "Oct 2026",
 * "9 Nov 2026" or "9 Nov 2026, 08:05 UTC". Never relative, so it cannot go
 * stale while the list sits open.
 */
function when(date) {
  if (!date) return null;
  if (date.length === 4) return date;
  const at = new Date(date.length === 7 ? `${date}-01` : date);
  if (date.length === 7) return monthFormat.format(at);
  if (date.length === 10) return dayFormat.format(at);
  return `${dayFormat.format(at)}, ${clockFormat.format(at)} UTC`;
}

function readingContext(row) {
  const turn = row.turn ? `Turn ${row.turn}` : null;
  return [row.place, when(row.date), turn].filter(Boolean).join(' · ');
}

function outletLine(sources) {
  const named = sources.slice(0, ROW_OUTLETS).join(' · ');
  const rest = sources.length - ROW_OUTLETS;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

/**
 * Present the digest's stories and the board's alerts and turn changes in
 * the frame. Opening a story selects it through the news layer's own
 * selectStory, so its pin lights and the globe flies there when it has one.
 */
export function createTodayPanel({
  document,
  world,
  news,
  selectStory,
  clearStory,
  openSources,
  openCountry,
  frameCountry,
}) {
  const find = (id) => document.getElementById(id);
  const empty = find('frame-today-empty');
  const next = find('frame-today-next');
  const list = find('frame-today-list');
  const more = find('frame-today-more');
  const story = find('frame-today-story');
  const countrySheet = find('world-character-sheet');
  const storyTitle = find('frame-today-story-title');
  const storyContext = find('frame-today-story-context');
  const storySummary = find('frame-today-story-summary');
  const storyNew = find('frame-today-story-new');
  const storySources = find('frame-today-story-sources');
  const storyClose = find('frame-today-story-close');
  if (!list || !story) return { destroy() {} };

  const buttons = new Map();
  let worldSnapshot = world?.getSnapshot() ?? null;
  let newsSnapshot = news?.getSnapshot() ?? null;
  let expanded = false;
  let openId = null;
  // The news story Today selected, so closing clears only its own choice.
  let selectedByToday = null;
  let countryOpener = null;
  let rendered = null;
  let renderedStory = null;

  function makeText(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function fillStory(row) {
    const context = readingContext(row);
    const signature = JSON.stringify([
      row.title,
      context,
      row.summary,
      row.whatsNew,
      row.citations,
    ]);
    if (signature === renderedStory) return;
    renderedStory = signature;
    const focusedOutlet = storySources.contains(document.activeElement)
      ? document.activeElement.textContent
      : null;
    storyTitle.textContent = row.title;
    storyContext.textContent = context;
    if (storySummary) {
      storySummary.textContent = row.summary;
      storySummary.hidden = !row.summary;
    }
    if (storyNew) {
      storyNew.textContent = row.whatsNew ? `New: ${row.whatsNew}` : '';
      storyNew.hidden = !row.whatsNew;
    }
    let refocus = null;
    storySources.replaceChildren(
      ...row.citations.map(({ outlet, href }) => {
        const item = document.createElement('li');
        const link = makeText('a', 'frame-today-source-link', outlet);
        link.setAttribute('href', href);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        if (outlet === focusedOutlet) refocus = link;
        item.append(link);
        return item;
      }),
    );
    refocus?.focus({ preventScroll: true });
  }

  function focusToday(rowId) {
    const target =
      document.body.dataset.today === 'folded'
        ? find('frame-today-open')
        : buttons.get(rowId) || buttons.values().next().value || next;
    target?.focus({ preventScroll: true });
  }

  function releaseStory() {
    const id = selectedByToday;
    selectedByToday = null;
    if (id && news?.getSnapshot()?.selectedStoryId === id) clearStory?.();
  }

  function closeStory({ restoreFocus = true } = {}) {
    if (!openId) return;
    const previousId = openId;
    openId = null;
    renderedStory = null;
    story.hidden = true;
    buttons.get(previousId)?.setAttribute('aria-expanded', 'false');
    releaseStory();
    if (restoreFocus) focusToday(previousId);
  }

  function activate(row) {
    if (row.target.kind === 'country') {
      closeStory({ restoreFocus: false });
      countryOpener = row;
      if (!openCountry?.(row.target.iso3)) {
        countryOpener = null;
        return;
      }
      // The frame's observer exposes the selected sheet before focus moves.
      queueMicrotask(() => {
        if (countryOpener === row && countrySheet && !countrySheet.hidden)
          find('world-sheet-name')?.focus({ preventScroll: true });
      });
      return;
    }
    countryOpener = null;
    world?.clearSelection?.();
    buttons.get(openId)?.setAttribute('aria-expanded', 'false');
    openId = row.id;
    fillStory(row);
    story.hidden = false;
    buttons.get(openId)?.setAttribute('aria-expanded', 'true');
    // The news layer flies to a story it pins; one it does not pin but placed
    // in a country frames that country; anything else leaves the view alone.
    selectedByToday = selectStory?.(row.target.id) ? row.target.id : null;
    if (!row.target.mapped && row.target.iso3) frameCountry?.(row.target.iso3);
    queueMicrotask(() => {
      if (openId === row.id) storyTitle.focus({ preventScroll: true });
    });
  }

  function rowNode(row) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'frame-today-row';
    button.dataset.todayItem = row.id;
    if (row.target.kind === 'story') {
      button.setAttribute('aria-controls', story.id);
      button.setAttribute('aria-expanded', String(row.id === openId));
    }
    button.append(
      makeText('span', 'frame-today-title', row.title),
      makeText('span', 'frame-today-context', readingContext(row)),
      makeText('span', 'frame-today-context', outletLine(row.sources)),
      makeText('span', 'frame-today-reason', row.reason),
    );
    button.addEventListener('click', () => activate(row));
    buttons.set(row.id, button);
    item.append(button);
    return item;
  }

  function render() {
    const rows = buildTodayItems(worldSnapshot, newsSnapshot);
    if (rows.length <= VISIBLE_ITEMS) expanded = false;
    const open = openId && rows.find(({ id }) => id === openId);
    if (openId && !open) {
      const restoreFocus = story.contains(document.activeElement);
      closeStory({ restoreFocus: false });
      if (restoreFocus) {
        const target =
          document.body.dataset.today === 'folded'
            ? find('frame-today-open')
            : find('frame-today-fold');
        target?.focus({ preventScroll: true });
      }
    }
    const signature = JSON.stringify([expanded, rows]);
    if (signature === rendered) return;
    rendered = signature;
    const focused = document.activeElement?.dataset?.todayItem;
    empty.hidden = rows.length > 0;
    list.hidden = !rows.length;
    more.hidden = rows.length <= VISIBLE_ITEMS;
    more.textContent = expanded ? 'Show fewer' : 'Show more';
    more.setAttribute('aria-expanded', String(expanded));
    buttons.clear();
    list.replaceChildren(
      ...(expanded ? rows : rows.slice(0, VISIBLE_ITEMS)).map(rowNode),
    );
    if (focused) {
      const replacement =
        buttons.get(focused) || buttons.values().next().value || next;
      replacement?.focus({ preventScroll: true });
    }
    if (open) fillStory(open);
  }

  const updateWorld = () => {
    const snapshot = world.getSnapshot();
    if (snapshot.selected || snapshot.card) closeStory({ restoreFocus: false });
    if (countryOpener && snapshot.selected !== countryOpener.target.iso3) {
      const { id } = countryOpener;
      countryOpener = null;
      const focus = document.activeElement;
      if (
        !snapshot.selected &&
        !snapshot.card &&
        (focus === document.body || countrySheet?.contains(focus))
      )
        queueMicrotask(() => !countryOpener && !openId && focusToday(id));
    }
    if (
      worldSnapshot &&
      ['enabled', 'countries', 'turn', 'features'].every(
        (key) => snapshot[key] === worldSnapshot[key],
      )
    )
      return;
    worldSnapshot = snapshot;
    render();
  };

  const updateNews = () => {
    newsSnapshot = news.getSnapshot();
    render();
  };

  function onMore() {
    expanded = !expanded;
    render();
  }
  function closeFromControl() {
    closeStory();
  }
  function onStoryKey(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    closeStory();
  }

  const listeners = [
    [next, 'click', openSources],
    [more, 'click', onMore],
    [storyClose, 'click', closeFromControl],
    [story, 'keydown', onStoryKey],
  ];
  for (const [node, event, listener] of listeners)
    if (listener) node.addEventListener(event, listener);
  const unsubscribeWorld = world?.subscribe(updateWorld);
  const unsubscribeNews = news?.subscribe(updateNews);
  render();

  return {
    takeCountryReturnFocus() {
      if (!countryOpener) return null;
      const { id } = countryOpener;
      countryOpener = null;
      return () => {
        const focus = document.activeElement;
        if (focus === document.body || countrySheet?.contains(focus))
          focusToday(id);
      };
    },
    destroy() {
      countryOpener = null;
      unsubscribeWorld?.();
      unsubscribeNews?.();
      for (const [node, event, listener] of listeners)
        if (listener) node.removeEventListener(event, listener);
      closeStory({ restoreFocus: false });
      buttons.clear();
      list.replaceChildren();
    },
  };
}
