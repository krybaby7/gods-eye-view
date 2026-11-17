import { collisions, requiredContextFailures } from './qaLook.mjs';

export function weatherTimelineCaptureDelta(before, after) {
  const keys = Object.keys({ ...before, ...after });
  const changed = keys.filter((key) => before[key] !== after[key]);
  if (!changed.length) return null;
  const historyAge = /^(\d{2}:\d{2} UTC) · (\d+) min ago$/;
  const start = before.readout?.match(historyAge);
  const end = after.readout?.match(historyAge);
  const elapsedAgeRefresh =
    changed.length === 1 &&
    changed[0] === 'readout' &&
    before.latest === 'false' &&
    before.utc?.endsWith(start?.[1] ?? '(missing)') &&
    Boolean(
      start && end && start[1] === end[1] && Number(end[2]) > Number(start[2]),
    );
  return { changed, elapsedAgeRefresh };
}

export function measureWeather() {
  const find = (selector) => document.querySelector(selector);
  const panel = find('#weather-panel');
  const body = find('#weather-panel-body');
  const inner = panel.querySelector('.weather-panel-inner');
  const header = panel.querySelector('[data-collapse-target="weather-panel"]');
  const title =
    find('#weather-panel-title') ?? panel.querySelector('.panel-title');
  const slider = panel.querySelector('.weather-timeline');
  const zero = panel.querySelector('[data-card-id="wind"] .rail-card-zero');
  const visible = (node) => {
    if (!node?.getClientRects().length) return false;
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (
        ancestor.hidden ||
        style.display === 'none' ||
        style.visibility !== 'visible' ||
        Number(style.opacity) === 0
      )
        return false;
    }
    return true;
  };
  const identify = (node) => node.id || node.className || node.tagName;
  const box = (name, node) => {
    const { left, top, right, bottom } = node.getBoundingClientRect();
    const ancestors = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement)
      ancestors.push(identify(parent));
    return {
      name,
      left,
      top,
      right,
      bottom,
      elementId: identify(node),
      ancestors,
    };
  };
  const frames = [
    ['top bar', '#frame-top'],
    ['bottom bar', '#frame-bottom'],
    ['Today', '#frame-today'],
    ['rail', '#frame-rail'],
    ['sheet', '#frame-sheet'],
  ]
    .filter(([, selector]) => visible(find(selector)))
    .map(([name, selector]) => box(name, find(selector)));
  const panels = [
    ...document.querySelectorAll(
      '#right-context-rail > [data-panel-id], #data-panel, #frame-presets-menu, #command-dock, #frame-tools > .tools-panel, #world-hover',
    ),
  ]
    .filter(visible)
    .map((node) => box(identify(node), node));

  const rgb = (value) => value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
  const over = (front, back) => {
    const alpha = front[3] ?? 1;
    return front
      .slice(0, 3)
      .map((channel, i) => channel * alpha + back[i] * (1 - alpha));
  };
  const luminance = (color) =>
    color.reduce((total, channel, i) => {
      const c = channel / 255;
      return (
        total +
        [0.2126, 0.7152, 0.0722][i] *
          (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      );
    }, 0);
  // A glass panel can sit over either bright or dark map imagery.
  const contrast = (node, style) =>
    [0, 255].map((base) => {
      const layers = [];
      for (let n = node; panel.contains(n); n = n.parentElement)
        layers.push(rgb(getComputedStyle(n).backgroundColor));
      const background = layers.reduceRight(
        (back, front) => over(front, back),
        [base, base, base],
      );
      const bg = luminance(background);
      const fg = luminance(over(rgb(style.color), background));
      return (
        Math.round(
          ((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)) * 100,
        ) / 100
      );
    });
  const text = [...panel.querySelectorAll('*')]
    .filter(
      (node) =>
        visible(node) && !node.closest('[aria-hidden="true"], :disabled'),
    )
    .flatMap((node) =>
      [...node.childNodes]
        .filter(
          (part) => part.nodeType === Node.TEXT_NODE && part.textContent.trim(),
        )
        .map((part) => {
          const style = getComputedStyle(node);
          const range = document.createRange();
          range.selectNodeContents(part);
          const clips = [...range.getClientRects()].some((rect) => {
            for (
              let parent = node;
              panel.contains(parent);
              parent = parent.parentElement
            ) {
              if (!parent.clientWidth || !parent.clientHeight) continue;
              const css = getComputedStyle(parent);
              const b = parent.getBoundingClientRect();
              const left = b.left + parent.clientLeft;
              const top = b.top + parent.clientTop;
              if (
                css.overflowX !== 'visible' &&
                (rect.left < left - 1 ||
                  rect.right > left + parent.clientWidth + 1)
              )
                return true;
              if (css.overflowY === 'visible') continue;
              if (parent === body) {
                if (
                  rect.top + body.scrollTop < top - 1 ||
                  rect.bottom + body.scrollTop > top + body.scrollHeight + 1
                )
                  return true;
              } else if (parent === body.parentElement && body.contains(node)) {
                // The inner surface clips its scrolling child, whose content is reachable.
                continue;
              } else if (!body.contains(node) || body.contains(parent)) {
                if (
                  rect.top < top - 1 ||
                  rect.bottom > top + parent.clientHeight + 1
                )
                  return true;
              }
            }
            return false;
          });
          return {
            text: part.textContent.trim(),
            selector: identify(node),
            fontSize: Number.parseFloat(style.fontSize),
            minimumFontSize:
              !/^\p{L}|\s\p{L}/u.test(part.textContent.trim()) ||
              Boolean(
                node.closest(
                  '.rail-card-badge, .rail-card-scale, .rail-card-zero, .rail-timeline-endpoints',
                ),
              )
                ? 12
                : 13,
            fontFamily: style.fontFamily,
            lineHeight: style.lineHeight,
            transform: style.textTransform,
            contrast: contrast(node, style),
            color: style.color,
            clipped: clips,
          };
        }),
    );
  const css = getComputedStyle(inner);
  const rect = visible(panel) ? box('Weather', panel) : null;
  const marker = find('.gev-wind-inspection-marker');
  const scene = window.__godsEyeView.viewer.scene;
  let inspectionMarker = null;
  if (visible(marker)) {
    const bounds = box('Wind inspection marker', marker);
    const x = (bounds.left + bounds.right) / 2;
    const y = (bounds.top + bounds.bottom) / 2;
    const canvas = scene.canvas;
    const value = marker.style.getPropertyValue('pointer-events');
    const priority = marker.style.getPropertyPriority('pointer-events');
    // Hit testing omits this passive marker. Expose it just for the synchronous
    // stack query, then restore its original property before any input or paint.
    try {
      marker.style.setProperty('pointer-events', 'auto', 'important');
      const stack = document.elementsFromPoint(x, y);
      const firstBehindMarker = stack.find((node) => node !== marker);
      inspectionMarker = {
        bounds,
        x,
        y,
        overWeather: Boolean(
          rect &&
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom,
        ),
        markerIndex: stack.indexOf(marker),
        weatherIndex: stack.findIndex((node) => panel.contains(node)),
        canvasIndex: stack.indexOf(canvas),
        globeExposed: firstBehindMarker === canvas,
        firstBehindMarker: firstBehindMarker
          ? identify(firstBehindMarker)
          : null,
        markerZ: getComputedStyle(marker).zIndex,
        railZ: getComputedStyle(panel.parentElement).zIndex,
      };
    } finally {
      if (value) marker.style.setProperty('pointer-events', value, priority);
      else marker.style.removeProperty('pointer-events');
    }
  }
  return {
    shown: Object.fromEntries(
      [...panel.querySelectorAll('.weather-observed-group .weather-card')].map(
        (card) => {
          const id = card.dataset.cardId;
          const { time, loading, error } =
            window.__godsEyeView.dataManager.layers
              .get(id)
              .module.getDiagnostics();
          return [id, { time, loading, error }];
        },
      ),
    ),
    frames,
    panels,
    target: rect,
    inner: box('Weather surface', inner),
    body: box('Weather body', body),
    header: box('Weather disclosure', header),
    frameState: {
      today: document.body.dataset.today,
      sheet: document.body.dataset.sheet,
      lens: find('#world-lens-bar [aria-pressed="true"]')?.dataset.worldLens,
    },
    sheetCode: find('#world-sheet-code')?.textContent,
    viewport: { width: innerWidth, height: innerHeight },
    weather: {
      hidden: panel.hidden,
      collapsed: panel.classList.contains('collapsed'),
      bodyVisible: visible(body),
      display: getComputedStyle(panel).display,
      count: Number(find('#weather-panel-count').textContent),
      heading: {
        text: title.textContent.trim(),
        tag: title.tagName,
        transform: getComputedStyle(title).textTransform,
      },
      background: css.backgroundColor,
      backgroundAlpha: rgb(css.backgroundColor)[3] ?? 1,
      backdropFilter: css.backdropFilter,
      mount: panel.parentElement.id,
    },
    scroll: {
      top: body.scrollTop,
      height: body.clientHeight,
      contentHeight: body.scrollHeight,
      width: body.clientWidth,
      contentWidth: body.scrollWidth,
      overflowY: getComputedStyle(body).overflowY,
    },
    timeline: {
      visible: visible(slider),
      disabled: slider.disabled,
      representableTicks: slider.disabled ? 0 : Number(slider.max) + 1,
      index: Number(slider.value),
      utc: slider.getAttribute('aria-valuetext'),
      readout: panel.querySelector('.rail-timeline-readout').textContent.trim(),
      latest: panel
        .querySelector('.rail-timeline-controls button')
        ?.getAttribute('aria-pressed'),
    },
    cards: [...panel.querySelectorAll('.weather-card')].map((card) => ({
      id: card.dataset.cardId,
      open: card.dataset.open === 'true',
      observed: Boolean(card.closest('.weather-observed-group')),
      title: card.querySelector('.rail-card-title').textContent.trim(),
      badge: card.querySelector('.rail-card-badge').textContent.trim(),
      compact: card.querySelector('.rail-card-compact').textContent.trim(),
      lines: Object.fromEntries(
        [...card.querySelectorAll('[data-line-id]')].map((node) => [
          node.dataset.lineId,
          node.textContent.trim(),
        ]),
      ),
    })),
    zero: {
      visible: visible(zero),
      text: zero?.textContent.trim(),
      pseudo: zero && getComputedStyle(zero, '::after').content,
    },
    inspectionMarker,
    text,
  };
}

export function weatherFailures(data, view, expectedCount, times) {
  const failures = requiredContextFailures(data);
  const legacy = [];
  const {
    weather,
    target,
    inner,
    body,
    header,
    viewport,
    scroll,
    timeline,
    cards,
    zero,
  } = data;
  if (data.frameState.today !== 'open' || data.frameState.sheet !== 'open')
    failures.push('Today and the country sheet must remain open');
  if (weather.mount !== 'right-context-rail')
    failures.push('Weather lost the right rail mount');
  if (weather.count !== expectedCount || cards.length !== expectedCount)
    failures.push(
      `Expected ${expectedCount} weather products, got ${weather.count}/${cards.length}`,
    );
  const overlaps = collisions(data.frames, data.panels);
  if (overlaps.length)
    failures.push(
      `Panel overlaps: ${overlaps.map(({ a, b }) => a.name + '/' + b.name).join(', ')}`,
    );
  if (view === 'inactive') {
    if (!weather.hidden || target || weather.bodyVisible)
      failures.push('Inactive Weather rail should be hidden');
    return { failures, legacy, overlaps };
  }
  if (weather.hidden || weather.collapsed || !target || !weather.bodyVisible) {
    failures.push('Active Weather rail is not expanded');
    return { failures, legacy, overlaps };
  }
  const inside = (outer, child) =>
    child.left >= outer.left - 1 &&
    child.top >= outer.top - 1 &&
    child.right <= outer.right + 1 &&
    child.bottom <= outer.bottom + 1;
  if (
    !inside(
      { left: 0, top: 0, right: viewport.width, bottom: viewport.height },
      target,
    )
  )
    failures.push('Weather rail extends outside the viewport');
  if (!inside(target, inner) || !inside(inner, body) || !inside(inner, header))
    legacy.push('Weather surface, header or body extends outside its panel');
  if (scroll.contentWidth > scroll.width + 1)
    legacy.push('Weather body scrolls horizontally');
  if (
    scroll.contentHeight > scroll.height + 1 &&
    !['auto', 'scroll'].includes(scroll.overflowY)
  )
    failures.push('Overflowing Weather body cannot scroll');

  if (
    weather.heading.tag !== 'H2' ||
    weather.heading.text !== 'Weather' ||
    weather.heading.transform === 'uppercase'
  )
    legacy.push('Weather title is not a sentence-case h2');
  if (weather.backgroundAlpha !== 1 || weather.backdropFilter !== 'none')
    legacy.push('Weather surface is not solid');
  const tooSmall = data.text.filter(
    ({ fontSize, minimumFontSize }) => fontSize < minimumFontSize,
  );
  const faint = data.text.filter(({ contrast }) => Math.min(...contrast) < 4.5);
  const clipped = data.text.filter((item) => item.clipped);
  for (const [label, items] of [
    ['Text below 13px (12px for captions or figures)', tooSmall],
    ['Text below 4.5:1', faint],
    ['Clipped text', clipped],
  ]) {
    if (items.length)
      legacy.push(
        `${label}: ${[...new Set(items.map((item) => item.text))].join(' | ')}`,
      );
  }
  if (view === 'unavailable') {
    if (
      !timeline.visible ||
      !timeline.disabled ||
      !cards[0]?.observed ||
      !/unavailable/i.test(cards[0]?.lines.status ?? '')
    )
      failures.push(
        'Expected a disabled observed clock and an explicit unavailable status',
      );
    if (!/no observation times/i.test(timeline.readout))
      legacy.push(
        'Unavailable clock still presents a latest observation readout',
      );
    if (/previous observation retained/i.test(cards[0]?.lines.status ?? ''))
      legacy.push(
        'Unavailable source claims it retained an observation on first activation',
      );
    if (!/^Observation unavailable$/i.test(cards[0]?.lines.time ?? ''))
      legacy.push(
        'Empty observation period does not explicitly say unavailable',
      );
  } else {
    const wind = cards.find(({ id }) => id === 'wind');
    const radar = cards.find(({ id }) => id === 'weather-radar');
    const satellite = cards.find(({ id }) => id === 'weather-satellite');
    const utc = (iso) => iso.slice(5, 16).replace('T', ' ') + ' UTC';
    const expectedTimes = view === 'latest' ? times.latest : times.history;
    if (
      !timeline.visible ||
      timeline.disabled ||
      timeline.representableTicks !== 6 ||
      cards.filter(({ observed }) => observed).length !== 2 ||
      wind?.observed !== false
    )
      failures.push(
        'Expected six observed ticks across two products and a distinct wind forecast',
      );
    const forecastPeriod = `Forecast · valid ${utc(times.forecast.validIso)} · issued ${utc(times.forecast.runIso)}`;
    if (view !== 'observed' && !wind?.open)
      failures.push('Expected the Wind forecast card to be expanded');
    if (!wind?.lines.time?.includes(forecastPeriod))
      failures.push(
        'Wind forecast does not show the expected valid and issued times',
      );
    if (!/NOAA GFS/.test(wind?.lines.source ?? ''))
      legacy.push('Wind forecast has no explicit NOAA GFS source');
    if (!/NOAA.*MRMS/.test(radar?.lines.source ?? ''))
      legacy.push('Radar observation has no explicit NOAA MRMS source');
    if (!/NOAA.*GOES|NESDIS.*GOES/i.test(satellite?.lines.source ?? ''))
      legacy.push('Satellite observation has no explicit GOES source');
    for (const observed of [radar, satellite]) {
      const expected = expectedTimes[observed?.id];
      if (!expected || !observed.lines.time?.includes(utc(expected)))
        failures.push(
          `Weather observation does not show its expected period: ${observed?.id ?? 'missing card'}`,
        );
      const shown = data.shown[observed?.id];
      if (!shown || shown.time !== expected || shown.loading || shown.error)
        failures.push(
          `Weather observation has no settled displayed frame: ${observed?.id ?? 'missing card'}`,
        );
    }
    if (view === 'latest' && timeline.latest !== 'true')
      failures.push('Weather clock is not in latest mode');
    if (view === 'latest') {
      const marker = data.inspectionMarker;
      if (!marker)
        failures.push(
          'The real Wind reading did not mount a visible globe marker',
        );
      else if (
        marker.overWeather &&
        (marker.weatherIndex === -1 ||
          (marker.markerIndex !== -1 &&
            marker.markerIndex < marker.weatherIndex))
      )
        legacy.push('Wind inspection marker paints over Weather controls');
      else if (
        marker.globeExposed &&
        (marker.markerIndex === -1 || marker.markerIndex >= marker.canvasIndex)
      )
        failures.push('Wind inspection marker is covered on the exposed globe');
    }
    if (
      view !== 'latest' &&
      (timeline.latest !== 'false' ||
        !/does not follow history/i.test(wind?.lines.time ?? ''))
    )
      failures.push('History selection changed the forecast context');
    if (view === 'observed' && (!radar?.open || wind?.open))
      failures.push('History view did not expand just the observed Radar card');
    const clockTime = utc(
      view === 'latest'
        ? expectedTimes['weather-satellite']
        : expectedTimes['weather-radar'],
    );
    if (timeline.utc !== clockTime)
      failures.push(`Observed clock did not select ${clockTime}`);
    if (view !== 'observed' && (!zero.visible || zero.text !== '0°C'))
      legacy.push('Freezing-point label is missing from actual text');
  }
  return { failures, legacy, overlaps };
}
