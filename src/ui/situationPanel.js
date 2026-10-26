/**
 * Situation panel (right rail): the war monitor's Refresh control, digest
 * line, category toggles, and the Stories and Raw feed tabs. Driven only by
 * the news layer's getSnapshot()/subscribe(); every feed string is written
 * as text, never markup.
 */
import {
  SITUATION_DISCLAIMER,
  SITUATION_FOLDER_LABELS,
  citedItems,
  degradedSources,
  filterRawItems,
  folderCounts,
  formatDigestLine,
  formatSituationTime,
  itemDigestState,
  listOnlyCount,
  rawFilterOptions,
  refreshState,
  tabCounts,
  verificationLabel,
} from './situationPanelModel.js';
import { NEWS_FOLDERS, newsCategoryColor } from '../layers/news/records.js';

const PANEL_ID = 'situation-panel';
const RAW_ITEM_LIMIT = 200;
const CLAIM_LABELS = Object.freeze({
  occurrence: 'event',
  attribution: 'attribution',
  casualty: 'casualties',
  damage: 'damage',
  statement: 'statement',
  denial: 'denial',
  intent: 'intent',
  other: 'claim',
});

// Remounting must not reopen a panel the user already collapsed.
const appearedDocuments = new WeakSet();

/**
 * @param {{container: HTMLElement, layer: object, now?: () => number, setIntervalImpl?: Function, clearIntervalImpl?: Function}} options
 * @returns {?{root: HTMLElement, destroy: () => void}}
 */
export function createSituationPanel({
  container,
  layer,
  now = Date.now,
  setIntervalImpl = (fn, ms) => globalThis.setInterval(fn, ms),
  clearIntervalImpl = (id) => globalThis.clearInterval(id),
} = {}) {
  const document = container?.ownerDocument;
  if (!document || typeof layer?.getSnapshot !== 'function') return null;
  const panel = document.getElementById(PANEL_ID);
  const count = document.getElementById(`${PANEL_ID}-count`);
  let snapshot = layer.getSnapshot();
  let destroyed = false;
  let tab = 'stories';
  let folder = 'reporting';
  let perspective = '';
  let language = '';
  let timer = null;
  const openIds = new Set();
  const showOriginal = new Set();
  const storyRows = new Map();

  function h(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === null || value === undefined || value === false) continue;
      if (name === 'text') node.textContent = String(value);
      else if (name === 'className') node.className = value;
      // Every node lives under root and is dropped with it (or with the
      // section it was rebuilt out of), so handlers need no bookkeeping.
      else if (name.startsWith('on'))
        node.addEventListener(name.slice(2).toLowerCase(), value);
      else if (name === 'style') node.setAttribute('style', value);
      else node.setAttribute(name, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(
        typeof child === 'string' ? document.createTextNode(child) : child,
      );
    }
    return node;
  }

  /** Replace a section's children, keeping keyboard focus on the same control. */
  function replaceChildren(section, ...children) {
    const active = document.activeElement;
    const focusKey = section.contains(active)
      ? active?.getAttribute?.('data-focus-key')
      : null;
    section.replaceChildren(...children.flat().filter(Boolean));
    if (focusKey)
      section.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  const root = h('div', { className: 'situation-panel-root' });
  const controls = h('div', { className: 'situation-controls' });
  const chips = h('div', {
    className: 'situation-chips',
    role: 'group',
    'aria-label': 'Story categories',
  });
  const tabs = h('div', {
    className: 'situation-tabs',
    role: 'tablist',
    'aria-label': 'Situation views',
  });
  const storiesPanel = h('div', {
    id: 'situation-tabpanel-stories',
    className: 'situation-tabpanel',
    role: 'tabpanel',
    'aria-labelledby': 'situation-tab-stories',
  });
  const storiesNote = h('p', { className: 'situation-note' });
  const storiesList = h('ul', {
    className: 'situation-stories',
    'aria-label': 'Stories',
  });
  storiesPanel.append(storiesNote, storiesList);
  const rawPanel = h('div', {
    id: 'situation-tabpanel-raw',
    className: 'situation-tabpanel',
    role: 'tabpanel',
    'aria-labelledby': 'situation-tab-raw',
    hidden: true,
  });
  const footer = h(
    'footer',
    { className: 'situation-footer' },
    h('p', { text: SITUATION_DISCLAIMER }),
    h('p', {
      className: 'situation-credit',
      text: 'Digest: Claude Sonnet 5.5 (Anthropic) through the Perplexity Agent API. Items: the publishers named on each item, GDELT, Telegram public previews and ReliefWeb.',
    }),
  );
  root.append(controls, chips, tabs, storiesPanel, rawPanel, footer);
  container.append(root);

  // ---- controls --------------------------------------------------------
  const theaterSelect = h('select', {
    className: 'panel-surface-control situation-theater',
    'aria-label': 'Theater',
    'data-focus-key': 'theater',
    onChange: () => void layer.setTheater?.(theaterSelect.value),
  });
  const refreshButton = h('button', {
    type: 'button',
    className: 'panel-surface-control situation-refresh',
    'data-focus-key': 'refresh',
    onClick: () => {
      if (refreshButton.disabled) return;
      void layer.requestDigest();
    },
  });
  const reasonLine = h('p', {
    className: 'situation-reason',
    id: 'situation-refresh-reason',
  });
  const digestLine = h('p', { className: 'situation-digest-line' });
  const degradedLine = h('details', { className: 'situation-degraded' });
  const notice = h('p', {
    className: 'situation-notice',
    role: 'status',
    'aria-live': 'polite',
  });
  controls.append(
    h('div', { className: 'situation-row' }, theaterSelect, refreshButton),
    reasonLine,
    digestLine,
    degradedLine,
    notice,
  );

  function renderControls() {
    const theaters = snapshot.theaters?.length
      ? snapshot.theaters
      : snapshot.theater
        ? [snapshot.theater]
        : [];
    const optionsKey = theaters.map((t) => `${t.id}=${t.name}`).join('|');
    if (theaterSelect.dataset.options !== optionsKey) {
      theaterSelect.dataset.options = optionsKey;
      theaterSelect.replaceChildren(
        ...theaters.map((theater) =>
          h('option', { value: theater.id, text: theater.name }),
        ),
      );
    }
    if (snapshot.theater) theaterSelect.value = snapshot.theater.id;
    theaterSelect.disabled = theaters.length < 2;
    renderRefresh();
    digestLine.textContent = formatDigestLine(snapshot, now());
    const degraded = degradedSources(snapshot.sources);
    degradedLine.hidden = !degraded.count;
    if (degradedLine.dataset.detail !== degraded.detail) {
      degradedLine.dataset.detail = degraded.detail;
      replaceChildren(
        degradedLine,
        h('summary', { text: degraded.text }),
        h(
          'ul',
          {},
          degraded.detail
            .split('\n')
            .filter(Boolean)
            .map((line) => h('li', { text: line })),
        ),
      );
    }
    const outcome = snapshot.digest?.outcome;
    notice.textContent = outcome?.summary || '';
    notice.classList.toggle(
      'panel-surface-error',
      Boolean(outcome && !outcome.ok),
    );
  }

  function renderRefresh() {
    const state = refreshState(snapshot, now());
    refreshButton.textContent = state.label;
    refreshButton.disabled = state.disabled;
    refreshButton.setAttribute('aria-busy', state.running ? 'true' : 'false');
    if (state.reason) {
      refreshButton.setAttribute('aria-describedby', reasonLine.id);
      refreshButton.title = state.reason;
    } else {
      refreshButton.removeAttribute('aria-describedby');
      refreshButton.removeAttribute('title');
    }
    reasonLine.textContent = state.running ? '' : state.reason || '';
    reasonLine.hidden = !reasonLine.textContent;
    if (state.running && timer === null)
      timer = setIntervalImpl(() => {
        if (!destroyed) renderRefresh();
      }, 1000);
    else if (!state.running && timer !== null) {
      clearIntervalImpl(timer);
      timer = null;
    }
  }

  // ---- category chips --------------------------------------------------
  function renderChips() {
    const hidden = new Set(snapshot.hiddenCategories || []);
    const key = (snapshot.categories || [])
      .map((c) => `${c.id}:${hidden.has(c.id)}`)
      .join('|');
    if (chips.dataset.key === key) return;
    chips.dataset.key = key;
    replaceChildren(
      chips,
      (snapshot.categories || []).map((category) =>
        h(
          'button',
          {
            type: 'button',
            className: 'situation-chip data-toggle-chip',
            'aria-pressed': hidden.has(category.id) ? 'false' : 'true',
            'data-focus-key': `chip-${category.id}`,
            title: hidden.has(category.id)
              ? `Show ${category.label} stories`
              : `Hide ${category.label} stories`,
            onClick: () => layer.toggleCategory(category.id),
          },
          h('span', {
            className: 'situation-swatch',
            'aria-hidden': 'true',
            style: `background:${category.color}`,
          }),
          category.label,
        ),
      ),
    );
  }

  // ---- tabs ------------------------------------------------------------
  function selectTab(next) {
    tab = next;
    render();
    document.getElementById(`situation-tab-${next}`)?.focus();
  }

  function renderTabs() {
    const counts = tabCounts(snapshot);
    const key = `${tab}|${counts.stories}|${counts.raw}`;
    if (tabs.dataset.key !== key) {
      tabs.dataset.key = key;
      replaceChildren(
        tabs,
        [
          ['stories', `Stories (${counts.stories})`],
          ['raw', `Raw feed (${counts.raw})`],
        ].map(([id, label]) =>
          h('button', {
            type: 'button',
            id: `situation-tab-${id}`,
            className: 'situation-tab panel-surface-control',
            role: 'tab',
            'aria-selected': tab === id ? 'true' : 'false',
            'aria-controls': `situation-tabpanel-${id}`,
            tabindex: tab === id ? '0' : '-1',
            'data-focus-key': `tab-${id}`,
            text: label,
            onClick: () => selectTab(id),
            onKeydown: (event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                selectTab(tab === 'stories' ? 'raw' : 'stories');
              }
            },
          }),
        ),
      );
    }
    storiesPanel.hidden = tab !== 'stories';
    rawPanel.hidden = tab !== 'raw';
  }

  // ---- stories ---------------------------------------------------------
  function storySignature(story) {
    return JSON.stringify([
      story,
      openIds.has(story.id),
      snapshot.selectedStoryId === story.id,
      [...showOriginal].filter((id) => story.itemIds.includes(id)),
      story.itemIds.length,
    ]);
  }

  function itemRow(item, { compact = false } = {}) {
    const source = (snapshot.sources || []).find((s) => s.id === item.sourceId);
    const original = item.titleOriginal && item.titleOriginal !== item.title;
    const showing = showOriginal.has(item.id) && original;
    const state = itemDigestState(item);
    return h(
      'li',
      { className: 'situation-item', 'data-item-id': item.id },
      h(
        'p',
        { className: 'situation-item-title' },
        h('span', {
          lang: item.language || null,
          dir: 'auto',
          text: showing ? item.titleOriginal : item.title,
        }),
      ),
      h(
        'p',
        { className: 'situation-item-meta' },
        [
          source?.name || item.sourceId,
          item.perspective,
          SITUATION_FOLDER_LABELS[item.folder] || item.folder,
          item.language ? item.language.toUpperCase() : null,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
      h(
        'p',
        { className: 'situation-item-times' },
        `published ${formatSituationTime(item.publishedAt, now())} · collected ${formatSituationTime(item.collectedAt, now())} · `,
        state === 'not-digested'
          ? h('span', {
              className: 'situation-marker situation-marker-new',
              text: 'not yet digested',
            })
          : state === 'unassigned'
            ? h('span', {
                className: 'situation-marker situation-marker-unassigned',
                text: 'unassigned after digest',
              })
            : `digested ${formatSituationTime(item.digestedAt, now())}`,
      ),
      item.primarySource?.issuer && !compact
        ? h('p', {
            className: 'situation-item-primary',
            text: `Primary source: ${item.primarySource.issuer} (${item.primarySource.kind})`,
          })
        : null,
      h(
        'p',
        { className: 'situation-item-actions' },
        original
          ? h('button', {
              type: 'button',
              className: 'situation-link-button',
              'data-focus-key': `original-${item.id}`,
              text: showing ? 'Show title' : 'Show original title',
              onClick: () => {
                if (showOriginal.has(item.id)) showOriginal.delete(item.id);
                else showOriginal.add(item.id);
                render();
              },
            })
          : null,
        item.url
          ? h('a', {
              href: item.url,
              target: '_blank',
              rel: 'noopener noreferrer',
              className: 'situation-open-original',
              text: 'Open original ↗',
            })
          : null,
      ),
    );
  }

  function buildStoryRow(story) {
    const open = openIds.has(story.id);
    const bodyId = `situation-story-${story.id}`;
    const categoryLabel =
      (snapshot.categories || []).find((c) => c.id === story.category)?.label ||
      story.category;
    const flags = [];
    if (!story.location) flags.push('no location · list only');
    else if (story.location.method === 'model') flags.push('model-placed');
    if (story.status === 'closed') flags.push('closed');
    const items = citedItems(story, snapshot.items, snapshot.citations);
    return [
      h(
        'button',
        {
          type: 'button',
          className: 'situation-story-head',
          'aria-expanded': open ? 'true' : 'false',
          'aria-controls': bodyId,
          'data-focus-key': `story-${story.id}`,
          onClick: () => {
            if (openIds.has(story.id)) {
              openIds.delete(story.id);
              render();
            } else {
              openIds.add(story.id);
              // Opening selects; a located story flies there.
              if (!layer.selectStory(story.id, { focus: true })) render();
            }
          },
        },
        h('span', {
          className: 'situation-swatch',
          'aria-hidden': 'true',
          style: `background:${newsCategoryColor(story.category, snapshot.categories)}`,
        }),
        h('span', { className: 'situation-story-title', text: story.title }),
      ),
      h(
        'p',
        { className: 'situation-story-meta' },
        h('span', { className: 'situation-category', text: categoryLabel }),
        ` · ${story.sourceCount} ${story.sourceCount === 1 ? 'source' : 'sources'} · `,
        h('span', {
          className: `situation-verification situation-verification-${story.verification}`,
          text: verificationLabel(story.verification),
        }),
      ),
      h('p', {
        className: 'situation-story-times',
        text: [
          `event ${formatSituationTime(story.eventAt, now())}`,
          `updated ${formatSituationTime(story.updatedAt, now())}`,
          story.place ? story.place : null,
          ...flags,
        ]
          .filter(Boolean)
          .join(' · '),
      }),
      story.perspectives.length
        ? h(
            'p',
            { className: 'situation-perspectives' },
            story.perspectives.map((p) =>
              h('span', { className: 'situation-perspective', text: p }),
            ),
          )
        : null,
      story.whatsNew
        ? h('p', {
            className: 'situation-whatsnew',
            text: `New: ${story.whatsNew}`,
          })
        : null,
      story.contradictions.length
        ? h(
            'ul',
            {
              className: 'situation-contradictions',
              'aria-label': 'Contradictions',
            },
            story.contradictions.map((line) => h('li', { text: line })),
          )
        : null,
      h(
        'div',
        { id: bodyId, className: 'situation-story-body', hidden: !open },
        story.summary
          ? h('p', { className: 'situation-summary', text: story.summary })
          : null,
        story.claims.length
          ? h(
              'ul',
              { className: 'situation-claims', 'aria-label': 'Claims' },
              story.claims.map((claim) =>
                h(
                  'li',
                  {},
                  claim.text,
                  h('span', {
                    className: 'situation-claim-meta',
                    text: ` — ${[claim.actor, CLAIM_LABELS[claim.type] || 'claim', verificationLabel(claim.status)].filter(Boolean).join(' · ')}`,
                  }),
                ),
              ),
            )
          : null,
        h('p', {
          className: 'situation-subhead',
          text: `Cited items (${items.length})`,
        }),
        h(
          'ul',
          { className: 'situation-items', 'aria-label': 'Cited items' },
          items.map((item) => itemRow(item, { compact: true })),
        ),
      ),
    ];
  }

  function renderStories() {
    const stories = snapshot.visibleStories || [];
    const listOnly = listOnlyCount(stories);
    storiesNote.textContent = !snapshot.ready
      ? ''
      : stories.length
        ? listOnly
          ? `${listOnly} ${listOnly === 1 ? 'story has' : 'stories have'} no location and appear only here.`
          : ''
        : snapshot.lastDigest
          ? 'No stories under these categories.'
          : 'No stories yet. Collected items are in the Raw feed; press Refresh to digest them.';
    storiesNote.hidden = !storiesNote.textContent;
    const seen = new Set();
    let previous = null;
    for (const story of stories) {
      seen.add(story.id);
      let row = storyRows.get(story.id);
      const signature = storySignature(story);
      if (!row) {
        row = {
          li: h('li', { className: 'situation-story' }),
          signature: null,
        };
        row.li.dataset.storyId = story.id;
        storyRows.set(story.id, row);
      }
      if (row.signature !== signature) {
        row.signature = signature;
        row.li.dataset.open = openIds.has(story.id) ? 'true' : 'false';
        row.li.classList.toggle(
          'situation-story-selected',
          snapshot.selectedStoryId === story.id,
        );
        row.li.classList.toggle(
          'situation-story-closed',
          story.status === 'closed',
        );
        replaceChildren(row.li, buildStoryRow(story));
      }
      const expected = previous ? previous.nextSibling : storiesList.firstChild;
      if (expected !== row.li)
        storiesList.insertBefore(row.li, expected || null);
      previous = row.li;
    }
    for (const [id, row] of storyRows)
      if (!seen.has(id)) {
        row.li.remove();
        storyRows.delete(id);
      }
  }

  // ---- raw feed --------------------------------------------------------
  function renderRaw() {
    if (rawPanel.hidden) return;
    const items = snapshot.items || [];
    const counts = folderCounts(items);
    const options = rawFilterOptions(items);
    if (perspective && !options.perspectives.includes(perspective))
      perspective = '';
    if (language && !options.languages.includes(language)) language = '';
    const shown = filterRawItems(items, { folder, perspective, language });
    const key = JSON.stringify([
      folder,
      perspective,
      language,
      counts,
      options,
      shown
        .slice(0, RAW_ITEM_LIMIT)
        .map((item) => [
          item.id,
          item.digestedAt,
          item.storyId,
          showOriginal.has(item.id),
        ]),
    ]);
    if (rawPanel.dataset.key === key) return;
    rawPanel.dataset.key = key;
    const select = (label, value, values, onChange, focusKey) =>
      h(
        'select',
        {
          className: 'panel-surface-control',
          'aria-label': label,
          'data-focus-key': focusKey,
          onChange: (event) => onChange(event.target.value),
        },
        h('option', { value: '', text: `All ${label.toLowerCase()}` }),
        values.map((entry) =>
          h('option', {
            value: entry,
            text: entry,
            selected: entry === value,
          }),
        ),
      );
    replaceChildren(
      rawPanel,
      h(
        'div',
        {
          className: 'situation-folders',
          role: 'group',
          'aria-label': 'Source folders',
        },
        NEWS_FOLDERS.map((id) =>
          h('button', {
            type: 'button',
            className: 'situation-folder data-toggle-chip',
            'aria-pressed': folder === id ? 'true' : 'false',
            'data-focus-key': `folder-${id}`,
            text: `${SITUATION_FOLDER_LABELS[id]} ${counts[id]}`,
            onClick: () => {
              folder = id;
              render();
            },
          }),
        ),
      ),
      h(
        'div',
        { className: 'situation-row' },
        select(
          'Perspectives',
          perspective,
          options.perspectives,
          (value) => {
            perspective = value;
            render();
          },
          'perspective',
        ),
        select(
          'Languages',
          language,
          options.languages,
          (value) => {
            language = value;
            render();
          },
          'language',
        ),
      ),
      h('p', {
        className: 'situation-note',
        text: shown.length
          ? shown.length > RAW_ITEM_LIMIT
            ? `Newest ${RAW_ITEM_LIMIT} of ${shown.length} items.`
            : `${shown.length} ${shown.length === 1 ? 'item' : 'items'}.`
          : 'No items in this folder yet.',
      }),
      h(
        'ul',
        { className: 'situation-items', 'aria-label': 'Raw feed items' },
        shown.slice(0, RAW_ITEM_LIMIT).map((item) => itemRow(item)),
      ),
    );
  }

  // ---- panel -----------------------------------------------------------
  function renderPanel() {
    const hidden = !snapshot.enabled;
    if (panel) panel.hidden = hidden;
    root.hidden = hidden;
    if (count)
      count.textContent = hidden ? '' : String(tabCounts(snapshot).stories);
    if (hidden || !panel || appearedDocuments.has(document)) return;
    appearedDocuments.add(document);
    // First appearance opens the panel unless a stored or shared collapse
    // choice exists (marked by the panel chrome when it restored the state).
    const preference = panel.dataset?.collapsedPreference;
    if (
      panel.classList.contains('collapsed') &&
      (preference === undefined || preference === 'default')
    )
      panel.querySelector?.(`[data-collapse-target="${PANEL_ID}"]`)?.click();
  }

  function render() {
    if (destroyed) return;
    renderPanel();
    renderControls();
    renderChips();
    renderTabs();
    renderStories();
    renderRaw();
  }

  /** A map selection opens its story row and brings it into view once. */
  function revealSelected() {
    const id = snapshot.selectedStoryId;
    if (!id) {
      render();
      return;
    }
    openIds.add(id);
    if (tab !== 'stories') tab = 'stories';
    render();
    storyRows.get(id)?.li.scrollIntoView?.({ block: 'nearest' });
  }

  const unsubscribe = layer.subscribe((next, reason) => {
    if (destroyed) return;
    snapshot = next || layer.getSnapshot();
    if (reason === 'select') revealSelected();
    else render();
  });
  render();

  return {
    root,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      if (timer !== null) clearIntervalImpl(timer);
      timer = null;
      storyRows.clear();
      root.remove();
      if (count) count.textContent = '';
      if (panel) panel.hidden = true;
    },
  };
}
