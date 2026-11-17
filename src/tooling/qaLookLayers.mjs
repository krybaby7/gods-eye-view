import { requiredContextFailures } from './qaLook.mjs';

// Data centres uses bundled GeoJSON. Fire perimeters uses a synthetic CDP
// response modeled on the perimeter ownership test. Directions is opened
// without setting either endpoint, so its local chips do not request a route.
export const LAYERS_FIXTURE_IDS = [
  'local-datacenters',
  'fire-perimeters',
  'directions',
];
export const FIRE_PERIMETER_FIXTURE = {
  stableId: '2026-NMGNF-000123',
  name: 'Fixture Fire',
  acres: 512.5,
  containedPct: 40,
  state: 'US-NM',
  category: 'WF',
  discoveredTime: 1757900000000,
  updatedTime: 1757950000000,
  polygons: [
    [
      [
        [-108.1, 35.2],
        [-108.0, 35.2],
        [-108.0, 35.3],
        [-108.1, 35.2],
      ],
    ],
  ],
};

export function measureLayers({ width, height, settle }) {
  const find = (selector) => document.querySelector(selector);
  const visible = (element) => {
    if (!element?.getClientRects().length) return false;
    const { width, height } = element.getBoundingClientRect();
    if (width <= 0 || height <= 0) return false;
    for (let node = element; node; node = node.parentElement) {
      const css = getComputedStyle(node);
      if (
        node.hidden ||
        css.display === 'none' ||
        css.visibility !== 'visible' ||
        Number(css.opacity) === 0
      )
        return false;
    }
    return true;
  };
  const bounds = (rect) => {
    const { left, top, right, bottom } = rect;
    return { left, top, right, bottom };
  };
  const identify = (el) => el.id || el.getAttribute('class') || el.tagName;
  const box = (name, element) => {
    const ancestors = [];
    for (let node = element.parentElement; node; node = node.parentElement)
      ancestors.push(identify(node));
    return {
      name,
      ...bounds(element.getBoundingClientRect()),
      elementId: identify(element),
      ancestors,
    };
  };
  const information = (element) => {
    if (!visible(element)) return { visible: false };
    const r = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    const reachable = [...element.getClientRects()].every(reachableRect);
    return {
      visible: r.width > 0 && r.height > 0,
      text: element.textContent.trim(),
      name: element.getAttribute('aria-label'),
      fontSize: css.fontSize,
      fontFamily: css.fontFamily,
      lineHeight: css.lineHeight,
      transform: css.textTransform,
      reachable,
    };

    function reachableRect(rect) {
      for (let node = element.parentElement; node; node = node.parentElement) {
        if (!node.clientWidth || !node.clientHeight) continue;
        const clip = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const left = clip.left + node.clientLeft;
        const top = clip.top + node.clientTop;
        const clippedX = ['auto', 'scroll', 'hidden', 'clip'].includes(
          style.overflowX,
        );
        const clippedY = ['auto', 'scroll', 'hidden', 'clip'].includes(
          style.overflowY,
        );
        const scrollableY = ['auto', 'scroll'].includes(style.overflowY);
        if (
          clippedX &&
          (rect.left < left - 1 || rect.right > left + node.clientWidth + 1)
        )
          return false;
        if (
          clippedY &&
          !scrollableY &&
          (rect.top < top - 1 || rect.bottom > top + node.clientHeight + 1)
        )
          return false;
        if (
          scrollableY &&
          (rect.top + node.scrollTop < top - 1 ||
            rect.bottom + node.scrollTop > top + node.scrollHeight + 1 ||
            rect.height > node.clientHeight + 1)
        )
          return false;
        // Everything below this scrollport can be brought into its own window.
        if (scrollableY) return true;
      }
      return true;
    }
  };
  const read = () => {
    const menu = find('#data-panel');
    if (!visible(menu)) throw new Error('Layers menu is not visible');
    const button = find('#frame-layers');
    const list = find('#data-toggles');
    const scroller = menu.querySelector('.layers-menu-inner');
    const manager = window.__godsEyeView.dataManager;
    const layers = new Map(manager.getAll().map((entry) => [entry.id, entry]));
    const frames = [
      ['top bar', '#frame-top'],
      ['bottom bar', '#frame-bottom'],
      ['Today', '#frame-today'],
      ['rail', '#frame-rail'],
      ['sheet', '#frame-sheet'],
    ]
      .map(([name, selector]) => [name, find(selector)])
      .filter(([, element]) => visible(element))
      .map(([name, element]) => box(name, element));
    const panels = [
      ...document.querySelectorAll(
        '#data-panel, #frame-presets-menu, #right-context-rail > [data-panel-id], #command-dock, #frame-tools > .tools-panel, #world-hover',
      ),
    ]
      .filter(visible)
      .map((element) => box(identify(element), element));
    const rows = [...list.querySelectorAll('[data-layer-id]')].map((row) => {
      const id = row.dataset.layerId;
      const toggle = row.querySelector('.data-toggle-btn');
      const layer = layers.get(id);
      return {
        legend: [...row.querySelectorAll('.data-toggle-legend-item')]
          .filter(visible)
          .map(information),
        chips: [...row.querySelectorAll('[data-chip-id]')]
          .filter(visible)
          .map((chip) => ({
            id: chip.dataset.chipId,
            ...information(chip),
          })),
        id,
        title: information(row.querySelector('.data-name')),
        state: information(row.querySelector(`[id="layer-state-${id}"]`)),
        control: information(toggle),
        role: toggle?.getAttribute('role') ?? toggle?.tagName.toLowerCase(),
        checked: toggle?.getAttribute('aria-checked'),
        busy: toggle?.getAttribute('aria-busy') === 'true',
        opensPanel: Boolean(row.dataset.opensPanel),
        active: row.classList.contains('on'),
        managed: layer?.enabled,
        records: layer?.stats?.count ?? 0,
      };
    });
    const text = [...menu.querySelectorAll('*')].flatMap((element) => {
      if (!visible(element) || element.closest('[aria-hidden="true"]'))
        return [];
      const nodes = [...element.childNodes].filter(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
      );
      const css = getComputedStyle(element);
      // The legacy switch's internal code is invisible and has an ARIA name.
      if (
        element.matches('button[aria-label]') &&
        (Number.parseFloat(css.fontSize) === 0 ||
          css.color === 'rgba(0, 0, 0, 0)' ||
          css.color === 'transparent')
      )
        return [];
      return nodes.map((node) => ({
        name: identify(element),
        value: node.textContent.trim(),
        ...information(element),
        reading: element.matches(
          '.data-name, .layers-menu-foot-note, .data-toggle-controls-info',
        ),
        clipped:
          element.clientWidth > 0 &&
          element.scrollWidth > element.clientWidth + 1 &&
          ['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX),
      }));
    });
    return {
      width: innerWidth,
      height: innerHeight,
      frameState: window.lookFrameDiagnostics.snapshot(),
      sheetCode: find('#world-sheet-code')?.textContent.trim(),
      frames,
      panels,
      rows,
      text,
      target: box('Layers', menu),
      controls: {
        expanded: button.getAttribute('aria-expanded'),
        triggerName: button.getAttribute('aria-label'),
        triggerCount: information(find('#frame-layers-count')),
        heading: information(
          document.getElementById(menu.getAttribute('aria-labelledby')),
        ),
        headCount: information(find('#layers-menu-count')),
        listCount: list.dataset.onCount,
        clear: information(find('#clear-selected-layers')),
        close: information(find('#layers-menu-close')),
      },
      menu: {
        role: menu.getAttribute('role'),
        focused: menu.contains(document.activeElement),
        scrollTop: scroller.scrollTop,
        verticalOverflow: scroller.scrollHeight - scroller.clientHeight,
        horizontalOverflow: scroller.scrollWidth - scroller.clientWidth,
      },
    };
  };
  if (!settle) return read();
  return new Promise((resolve, reject) => {
    let previous, since, samples, frame;
    const timer = setTimeout(() => {
      cancelAnimationFrame(frame);
      reject(new Error('Layers layout stability timed out'));
    }, 10000);
    function sample(now) {
      try {
        const data = read();
        const key = JSON.stringify(data);
        if (key !== previous) {
          previous = key;
          since = now;
          samples = 0;
        }
        if (
          data.width === width &&
          data.height === height &&
          !data.rows.some((row) => row.busy) &&
          ++samples >= 3 &&
          now - since >= 250
        ) {
          clearTimeout(timer);
          resolve(data);
          return;
        }
        frame = requestAnimationFrame(sample);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    }
    frame = requestAnimationFrame(sample);
  });
}

export function layersFailures(data, expectedOn, label) {
  const errors = requiredContextFailures(data);
  if (data.frameState.today !== 'open' || data.frameState.sheet !== 'open')
    errors.push('Today and the India sheet must be open');
  for (const box of [data.target, ...data.frames]) {
    if (
      box.left < -1 ||
      box.top < -1 ||
      box.right > data.width + 1 ||
      box.bottom > data.height + 1 ||
      box.right <= box.left ||
      box.bottom <= box.top
    )
      errors.push(`${box.name} lies outside the viewport or has no area`);
  }
  const { controls, menu } = data;
  const count = expectedOn.length;
  if (
    menu.role !== 'dialog' ||
    !menu.focused ||
    controls.expanded !== 'true' ||
    controls.heading.text !== 'Layers' ||
    !controls.heading.reachable ||
    !controls.close.name ||
    !controls.close.reachable
  )
    errors.push(
      'Layers dialog lacks an accessible heading, opener, close or focus',
    );
  if (menu.horizontalOverflow > 1)
    errors.push('Layers menu scrolls horizontally');
  if (
    !controls.headCount.reachable ||
    controls.headCount.text !== `${count} on.` ||
    controls.listCount !== String(count) ||
    controls.triggerName !==
      (count ? `Layers, ${count} on` : 'Layers, none on') ||
    controls.triggerCount.visible !== count > 0 ||
    (count && controls.triggerCount.text !== String(count)) ||
    controls.clear.visible !== count > 0 ||
    (count && (!controls.clear.reachable || !controls.clear.name))
  )
    errors.push(`Layers controls do not reflect ${count} on`);
  for (const id of [...LAYERS_FIXTURE_IDS, 'flights', 'searches'])
    if (!data.rows.some((row) => row.id === id))
      errors.push(`Missing Layers row: ${id}`);
  for (const row of data.rows) {
    const enabled = expectedOn.includes(row.id);
    if (
      row.managed !== enabled ||
      row.active !== enabled ||
      (!row.opensPanel &&
        (row.role !== 'switch' || row.checked !== String(enabled))) ||
      row.busy
    )
      errors.push(`Wrong Layers switch state for ${row.id}`);
    if (
      !row.title.text ||
      !row.state.text ||
      !row.control.name ||
      ![row.title, row.state, row.control].every(
        (part) => part.visible && part.reachable,
      )
    )
      errors.push(`Missing or inaccessible Layers row content: ${row.id}`);
    if (
      enabled &&
      row.id !== 'directions' &&
      (!(row.records > 0) || !['On', 'Live'].includes(row.state.text))
    )
      errors.push(`Missing loaded local data for ${row.id}`);
  }
  if (expectedOn.includes('fire-perimeters')) {
    const legend =
      data.rows.find((row) => row.id === 'fire-perimeters')?.legend ?? [];
    if (
      legend.length !== 4 ||
      legend.some((entry) => !entry.reachable) ||
      !legend.some((entry) => entry.text === 'Under 50% contained 1')
    )
      errors.push('Loaded perimeter must appear in the containment legend');
  }
  if (expectedOn.includes('directions')) {
    const chips = data.rows.find((row) => row.id === 'directions')?.chips ?? [];
    for (const id of ['set-a', 'set-b'])
      if (!chips.some((chip) => chip.id === id && chip.text && chip.reachable))
        errors.push(`Missing or inaccessible Directions chip: ${id}`);
  }
  for (const item of data.text) {
    if (!item.reachable || item.clipped)
      errors.push(`Layers text is clipped: ${item.value}`);
    if (
      label === 'after' &&
      (Number.parseFloat(item.fontSize) < (item.reading ? 13 : 12) ||
        item.transform === 'uppercase' ||
        (/monospace/i.test(item.fontFamily) && /[a-z]{2}/i.test(item.value)))
    )
      errors.push(
        `Unreadable Layers type for ${item.value}: ${item.fontSize}, ${item.transform}`,
      );
  }
  return errors;
}

// Compare the actual rail before opening Layers and after Escape. Visibility
// and disclosure state must return together; a missing rail is not a pass.
export function railRestorationFailures(before, after) {
  if (
    !before.length ||
    !before.some((panel) => panel.visible && panel.buttonVisible)
  )
    return ['No visible rail disclosure before opening Layers'];
  return JSON.stringify(before) === JSON.stringify(after)
    ? []
    : ['Right rail visibility or disclosure state changed after Escape'];
}

export function measureRailRestoration() {
  const visible = (el) => {
    if (!el?.getClientRects().length) return false;
    for (let node = el; node; node = node.parentElement) {
      const css = getComputedStyle(node);
      if (
        node.hidden ||
        css.display === 'none' ||
        css.visibility !== 'visible' ||
        Number(css.opacity) === 0
      )
        return false;
    }
    return true;
  };
  return [
    ...document.querySelectorAll('#right-context-rail [data-panel-id]'),
  ].map((panel) => {
    const button = panel.querySelector('.panel-collapse-btn');
    return {
      id: panel.id,
      visible: visible(panel),
      buttonVisible: visible(button),
      collapsed: panel.classList.contains('collapsed'),
      hidden: panel.hidden,
      expanded: button?.getAttribute('aria-expanded') ?? null,
    };
  });
}
