import {
  countrySheet,
  describeWorldHover,
  worldLegend,
  worldTurn,
} from './worldPanelModel.js';
import { worldPhases } from '../layers/world/phaseRegistry.js';

const baseTabs = [
  ['condition', 'Condition'],
  ['strength', 'Strength'],
  ['exposure', 'Exposure', 2],
  ['relations', 'Relations', 3],
  ['assets', 'Assets', 4],
  ['stakes', 'Stakes', 7],
  ['people', 'People', 5],
];
const phases = (key) => worldPhases.flatMap((phase) => phase[key] ?? []);
const tabsById = new Map(
  baseTabs.map(([id, label, phase], order) => [
    id,
    { id, label, phase, order: order * 10 },
  ]),
);
for (const tab of phases('tabs')) {
  tabsById.set(tab.id, { ...tabsById.get(tab.id), ...tab });
}
const tabsInOrder = [...tabsById.values()].sort((a, b) => a.order - b.order);
const cards = new Map(phases('cards').map((card) => [card.type, card]));

function element(document, tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

function button(document, content) {
  const node = element(
    document,
    'button',
    'panel-surface-control world-control',
    content,
  );
  node.type = 'button';
  return node;
}

function scoreText(score) {
  return score === null ? 'Unknown' : `${Math.round(score)} / 100`;
}

function scoreBar(document, score) {
  const track = element(
    document,
    'span',
    score === null ? 'world-score-track world-hatch' : 'world-score-track',
  );
  track.setAttribute('aria-hidden', 'true');
  if (score !== null) {
    const fill = element(document, 'span', 'world-score-fill');
    fill.style.width = `${Math.min(100, Math.max(0, score))}%`;
    track.append(fill);
  }
  return track;
}

function explanation(document, row) {
  const why = element(document, 'div', 'world-why');
  why.id = `world-why-${row.slot}`;
  why.hidden = true;
  const title = element(document, 'strong', 'world-kicker', 'Why this number');
  const source = element(
    document,
    row.sourceUrl ? 'a' : 'span',
    '',
    row.source,
  );
  if (row.sourceUrl) {
    source.href = row.sourceUrl;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
  }
  const definition = element(document, 'dl', 'world-why-facts');
  const facts = [
    ['Measure', row.measure],
    ['Source', source],
    ['Source code', row.sourceCode],
    ['Period', row.period ?? 'No published period'],
    ['Raw value', row.rawValue ?? 'No published value'],
    ['Formula', row.formula],
    ['Score', scoreText(row.score)],
  ];
  if (row.sourceVersion)
    facts.splice(3, 0, ['Source release', row.sourceVersion]);
  if (row.retrievedAt)
    facts.splice(3, 0, ['Fetched', row.retrievedAt.slice(0, 10)]);
  for (const [label, value] of facts) {
    const data = element(document, 'dd');
    data.append(value?.nodeType ? value : String(value ?? 'Unknown'));
    definition.append(element(document, 'dt', '', label), data);
  }
  why.append(title, definition);
  if (row.draft)
    why.append(element(document, 'span', 'world-flag', 'Draft anchors'));
  return why;
}

function slotRow(document, row, expanded) {
  const wrapper = element(document, 'div', 'world-slot');
  const toggle = button(document);
  toggle.classList.add('world-row');
  toggle.dataset.worldSlot = row.slot;
  const why = explanation(document, row);
  why.hidden = !expanded;
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-controls', why.id);
  const heading = element(document, 'span', 'world-row-heading');
  heading.append(
    element(document, 'span', 'world-slot-id', row.slot),
    element(document, 'strong', '', row.area),
    element(document, 'span', 'world-row-score', scoreText(row.score)),
  );
  const details =
    `${row.measure} · ${row.value ?? 'No published value'}` +
    (row.period ? ` [${row.period}]` : '') +
    ` · ${row.source}`;
  toggle.append(
    heading,
    scoreBar(document, row.score),
    element(document, 'span', 'world-detail', details),
  );
  if (row.flags.length) {
    const flags = element(document, 'span', 'world-flags');
    flags.append(
      ...row.flags.map((flag) => element(document, 'span', 'world-flag', flag)),
    );
    toggle.append(flags);
  }
  toggle.addEventListener('click', () => {
    why.hidden = !why.hidden;
    toggle.setAttribute('aria-expanded', String(!why.hidden));
  });
  wrapper.append(toggle, why);
  return wrapper;
}

function turnList(document, turn, fallback) {
  const list = element(document, 'ul', 'world-change-list');
  list.append(
    ...(turn.changes.length ? turn.changes : [fallback]).map((change) =>
      element(document, 'li', '', change),
    ),
  );
  return list;
}

export function createWorldPanel({
  layer,
  openSheet,
  document = globalThis.document,
}) {
  const find = (id) => document.getElementById(id);
  const bar = find('world-lens-bar');
  const legend = find('world-legend');
  const hover = find('world-hover');
  const hoverName = find('world-hover-name');
  const hoverValue = find('world-hover-value');
  const sheet = find('world-character-sheet');
  const refresh = find('world-refresh');
  const progress = find('world-progress');
  const areas = find('world-areas');
  const turnChip = find('world-turn');
  const turnPopup = find('world-turn-changes');
  const tabs = find('world-sheet-tabs');
  const tabBody = find('world-sheet-content');
  const close = find('world-sheet-close');
  const lensOptions = bar.querySelector('.world-lens-options');
  const lensButtons = layer.getSnapshot().lenses.map(({ id, label }) => {
    const node = button(document, label);
    node.dataset.worldLens = id;
    return node;
  });
  lensOptions.replaceChildren(...lensButtons);
  const events = new AbortController();
  const { signal } = events;
  let previous = {};
  let tab = 'condition';
  let sheetModel = null;
  let currentSnapshot;
  let areaButtons = [];
  const countryContent = find('world-country-content');
  const cardContent = find('world-card-content');
  const extra = find('world-sheet-extra');
  const openCard = (type, id) => layer.openCard(type, id);
  const renderContext = () => ({
    document,
    snapshot: currentSnapshot,
    sheetModel,
    openCard,
    getDetail: (country, lens, options) =>
      layer.getDetail(country, lens, options),
  });

  function setTurnOpen(open) {
    turnChip.setAttribute('aria-expanded', String(open));
    turnPopup.hidden = !open;
  }

  function renderTab({ preserve = false } = {}) {
    const index = tabsInOrder.findIndex(({ id }) => id === tab);
    const { id, label, phase, render } = tabsInOrder[index];
    tabs.querySelectorAll('button').forEach((node, i) => {
      node.setAttribute('aria-selected', String(i === index));
      node.tabIndex = i === index ? 0 : -1;
    });
    tabBody.setAttribute('aria-labelledby', `world-tab-${id}`);
    tabBody.tabIndex = phase || render ? 0 : -1;
    if (render) {
      tabBody.replaceChildren(render(renderContext()));
      return;
    }
    if (phase) {
      tabBody.replaceChildren(
        element(
          document,
          'p',
          'world-detail',
          `${label} arrives in phase ${phase}.`,
        ),
      );
      return;
    }
    const rows = sheetModel?.rows.filter((row) => row.section === tab) ?? [];
    const open = new Set(
      preserve
        ? [
            ...tabBody.querySelectorAll(
              '[data-world-slot][aria-expanded="true"]',
            ),
          ].map((node) => node.dataset.worldSlot)
        : [],
    );
    const active = document.activeElement;
    const focusedSlot =
      preserve && tabBody.contains(active)
        ? active.closest('.world-slot')?.querySelector('[data-world-slot]')
            ?.dataset.worldSlot
        : null;
    tabBody.replaceChildren(
      ...rows.map((row) =>
        slotRow(
          document,
          {
            ...row,
            flags: [
              ...row.flags,
              ...phases('rowFlags').flatMap((flags) =>
                flags(row, renderContext()),
              ),
            ],
          },
          open.has(row.slot),
        ),
      ),
    );
    if (focusedSlot) {
      const row = [...tabBody.querySelectorAll('[data-world-slot]')].find(
        (node) => node.dataset.worldSlot === focusedSlot,
      );
      const link = active.matches('a') && row?.parentElement.querySelector('a');
      (link || row)?.focus({ preventScroll: true });
    }
  }

  for (const { id, label } of tabsInOrder) {
    const node = button(document, label);
    node.id = `world-tab-${id}`;
    node.dataset.worldTab = id;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-controls', tabBody.id);
    tabs.append(node);
  }

  function selectTab(id) {
    if (tab === id) return;
    tab = id;
    renderTab();
  }

  tabs.addEventListener(
    'click',
    ({ target }) => {
      const node = target.closest('[data-world-tab]');
      if (node) selectTab(node.dataset.worldTab);
    },
    { signal },
  );
  tabs.addEventListener(
    'keydown',
    (event) => {
      const current = tabsInOrder.findIndex(({ id }) => id === tab);
      const count = tabsInOrder.length;
      const indices = {
        ArrowLeft: (current + count - 1) % count,
        ArrowRight: (current + 1) % count,
        Home: 0,
        End: count - 1,
      };
      const next = indices[event.key];
      if (!Number.isInteger(next)) return;
      event.preventDefault();
      selectTab(tabsInOrder[next].id);
      tabs.children[next].focus();
    },
    { signal },
  );

  function renderSheet(snapshot) {
    currentSnapshot = snapshot;
    const selectionChanged = snapshot.selected !== previous.selected;
    sheetModel = snapshot.selected
      ? countrySheet(snapshot, snapshot.selected)
      : null;
    const card = cards.get(snapshot.card?.type);
    sheet.hidden = !snapshot.enabled || (!sheetModel && !card);
    if (sheet.hidden) return;
    cardContent.hidden = !card;
    countryContent.hidden = Boolean(card);
    close.setAttribute(
      'aria-label',
      card ? 'Close World Board card' : 'Clear country selection',
    );
    if (card) {
      find('world-sheet-name').textContent = card.label;
      find('world-sheet-code').textContent = '';
      cardContent.replaceChildren(
        card.render({ ...renderContext(), id: snapshot.card.id }),
      );
      if (sheet.classList.contains('collapsed')) openSheet?.();
      return;
    }
    cardContent.replaceChildren();
    if (selectionChanged) {
      tab = 'condition';
      find('world-sheet-body').scrollTop = 0;
    }
    const { iso3, name, coverage, condition, disputed, hasData } = sheetModel;
    find('world-sheet-name').textContent = name;
    find('world-sheet-code').textContent = iso3;
    find('world-coverage').textContent = coverage;
    extra.replaceChildren(
      ...phases('header').flatMap((render) => render(renderContext()) ?? []),
    );
    extra.hidden = !extra.childNodes.length;
    const noData = find('world-no-data');
    noData.hidden = hasData;
    noData.textContent = disputed
      ? 'Disputed territory · no published values.'
      : 'No published values for this territory.';
    find('world-hp-label').textContent =
      condition.score === null
        ? 'HP · Condition unknown'
        : `HP · Weakest bar · ${condition.label} ${scoreText(condition.score)}`;
    find('world-hp-track').replaceChildren(scoreBar(document, condition.score));
    renderTab({ preserve: !selectionChanged });
    const turn = worldTurn(snapshot.turn, iso3);
    const sinceTurn = find('world-since-turn');
    sinceTurn.hidden = !turn;
    if (turn) {
      sinceTurn.replaceChildren(
        element(
          document,
          'h3',
          'world-kicker',
          `${turn.label} · Since last turn`,
        ),
        turnList(document, turn, 'No changes for this country.'),
      );
    }
    if (selectionChanged && sheet.classList.contains('collapsed'))
      openSheet?.();
  }

  function renderLens(snapshot) {
    if (snapshot.indicators !== previous.indicators) {
      areaButtons = (snapshot.indicators ?? [])
        .filter(({ section }) => section === 'strength')
        .map(({ slot, shortLabel }) => {
          const node = button(document, `${slot} ${shortLabel}`);
          node.dataset.worldArea = slot;
          return node;
        });
      areas.replaceChildren(...areaButtons);
    }
    for (const node of lensButtons) {
      node.setAttribute(
        'aria-pressed',
        String(node.dataset.worldLens === snapshot.lens),
      );
    }
    for (const node of areaButtons) {
      node.setAttribute(
        'aria-pressed',
        String(node.dataset.worldArea === snapshot.area),
      );
    }
    areas.hidden = snapshot.lens !== 'strength' || !areaButtons.length;
    const lens = snapshot.lenses.find(({ id }) => id === snapshot.lens);
    const definition = lens?.legend?.(snapshot) ?? worldLegend(snapshot);
    find('world-legend-title').textContent = definition.name;
    const stops = find('world-legend-stops');
    stops.replaceChildren(
      ...definition.stops.map((stop) => element(document, 'span', '', stop)),
    );
    find('world-legend-note').textContent = definition.note;
  }

  function renderStatus(snapshot) {
    refresh.disabled = Boolean(snapshot.loading || snapshot.progress);
    const load = snapshot.progress;
    let status = '';
    if (load) {
      const source =
        snapshot.sources?.find(({ id }) => id === load.source)?.name ??
        load.source;
      const size = (bytes) =>
        `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1_000_000)} MB`;
      const download = load.download;
      const transferred =
        download &&
        (download.totalBytes == null
          ? size(download.bytes)
          : `${size(download.bytes).replace(/ MB$/, '')} / ${size(download.totalBytes)}`);
      status =
        `Loading World Board · ${load.completed} / ${load.total} sources` +
        (source ? ` · ${source}` : '') +
        (transferred ? ` · ${transferred}` : '');
    } else if (snapshot.loading) {
      status = snapshot.turn
        ? 'Refreshing World Board…'
        : 'Loading World Board…';
    } else if (snapshot.error) {
      status = String(snapshot.error);
    }
    progress.classList.toggle(
      'panel-surface-error',
      Boolean(snapshot.error && !snapshot.loading && !load),
    );
    progress.textContent = status;
    progress.hidden = !status;
  }

  function renderHover(snapshot) {
    const position = snapshot.hovered;
    const model =
      position && snapshot.enabled && snapshot.visible
        ? describeWorldHover(snapshot, position.iso3)
        : null;
    hover.hidden = !model;
    if (!model) return;
    if (hoverName.textContent !== model.name)
      hoverName.textContent = model.name;
    const lens = snapshot.lenses.find(({ id }) => id === snapshot.lens);
    const value =
      lens?.hover?.(snapshot.countries[position.iso3], snapshot) ?? model.value;
    const flags = phases('hoverFlags').flatMap((getFlags) =>
      getFlags(position.iso3, snapshot),
    );
    const text = [value, ...flags].join(' · ');
    if (hoverValue.textContent !== text) hoverValue.textContent = text;
    hover.style.setProperty('--world-hover-x', `${position.x + 16}px`);
    hover.style.setProperty('--world-hover-y', `${position.y + 16}px`);
  }

  function render() {
    const snapshot = layer.getSnapshot();
    bar.hidden = !snapshot.enabled;
    legend.hidden = !snapshot.enabled;
    if (!snapshot.enabled) setTurnOpen(false);
    if (
      snapshot.lens !== previous.lens ||
      snapshot.area !== previous.area ||
      snapshot.selected !== previous.selected ||
      snapshot.features !== previous.features ||
      snapshot.indicators !== previous.indicators
    )
      renderLens(snapshot);
    if (
      snapshot.loading !== previous.loading ||
      snapshot.progress !== previous.progress ||
      snapshot.error !== previous.error ||
      snapshot.turn !== previous.turn
    )
      renderStatus(snapshot);
    if (snapshot.turn !== previous.turn) {
      const turn = worldTurn(snapshot.turn);
      turnChip.hidden = !turn;
      if (turn) {
        turnChip.textContent = turn.label;
        turnChip.title = turn.summary;
        turnPopup.replaceChildren(
          element(document, 'strong', 'world-kicker', turn.summary),
          turnList(document, turn, 'No changes this turn.'),
        );
      }
    }
    if (
      snapshot.enabled !== previous.enabled ||
      snapshot.selected !== previous.selected ||
      snapshot.card !== previous.card ||
      snapshot.features !== previous.features ||
      snapshot.countries !== previous.countries ||
      snapshot.indicators !== previous.indicators ||
      snapshot.turn !== previous.turn
    )
      renderSheet(snapshot);
    renderHover(snapshot);
    previous = snapshot;
  }

  bar.addEventListener(
    'click',
    ({ target }) => {
      const { worldLens, worldArea } = target.dataset;
      if (worldLens) layer.setLens(worldLens);
      if (worldArea) layer.setLens('strength', worldArea);
    },
    { signal },
  );
  refresh.addEventListener('click', () => layer.refresh(), { signal });
  turnChip.addEventListener('click', () => setTurnOpen(turnPopup.hidden), {
    signal,
  });
  close.addEventListener(
    'click',
    () => {
      if (layer.getSnapshot().card) {
        layer.closeCard();
        return;
      }
      lensButtons
        .find((node) => node.getAttribute('aria-pressed') === 'true')
        ?.focus();
      layer.clearSelection();
    },
    { signal },
  );
  document.addEventListener(
    'pointerdown',
    ({ target }) => {
      if (
        !turnPopup.hidden &&
        !turnChip.contains(target) &&
        !turnPopup.contains(target)
      )
        setTurnOpen(false);
    },
    { signal },
  );
  bar.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || turnPopup.hidden) return;
      setTurnOpen(false);
      turnChip.focus();
      event.stopPropagation();
    },
    { signal },
  );
  const resize = new ResizeObserver(() => {
    const bottom = Math.ceil(bar.getBoundingClientRect().bottom);
    document.documentElement.style.setProperty(
      '--world-lens-bottom',
      `${bottom}px`,
    );
  });
  resize.observe(bar);
  const unsubscribe = layer.subscribe(render);
  render();

  return {
    destroy() {
      unsubscribe();
      events.abort();
      resize.disconnect();
      document.documentElement.style.removeProperty('--world-lens-bottom');
      bar.hidden = legend.hidden = hover.hidden = sheet.hidden = true;
      setTurnOpen(false);
      tabs.replaceChildren();
      tabBody.replaceChildren();
      cardContent.replaceChildren();
      lensOptions.replaceChildren();
    },
  };
}
