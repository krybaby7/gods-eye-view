import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';
import { collisions } from '../src/tooling/qaLook.mjs';

const wait = { timeout: 20000, polling: 125 };
const fixture = { id: 'qa9001', callsign: 'QA9001', lon: 81.7, lat: 21.2 };

function measure(targetSelector, menuSelector) {
  const bounds = (selector) => {
    const node = document.querySelector(selector);
    if (
      !node?.getClientRects().length ||
      getComputedStyle(node).visibility !== 'visible'
    )
      return null;
    const { left, top, right, bottom } = node.getBoundingClientRect();
    const ancestors = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement)
      if (parent.id) ancestors.push(parent.id);
    return {
      selector,
      elementId: node.id || selector,
      left,
      top,
      right,
      bottom,
      ancestors,
    };
  };
  const cockpitComponents = [
    '.cockpit-compass',
    '#cockpit-speed-rim',
    '#cockpit-altitude-rim',
    '#cockpit-speed-value',
    '#cockpit-altitude-value',
    '.cockpit-heading-value',
    '.cockpit-topline',
    '.cockpit-position-readout',
    '#cockpit-context',
    '#cockpit-signal-stream',
    '#cockpit-utility-controls',
    '#cockpit-layers',
    '#cockpit-presets',
    '#cockpit-reset-globe',
    '#map-view-switch',
    '#cesium-credits',
    '#global-loading-status',
  ];
  const byId = (id) => document.getElementById(id);
  return {
    target: bounds(targetSelector),
    menu: menuSelector ? bounds(menuSelector) : null,
    components: cockpitComponents.map(bounds).filter(Boolean),
    tickCounts: ['#cockpit-speed-rim', '#cockpit-altitude-rim'].map(
      (id) =>
        Array.from(
          document.querySelectorAll(
            `${id} .cockpit-altitude-rim-scale > span.major:not([hidden]) b`,
          ),
        ).filter(
          (node) =>
            node.getClientRects().length &&
            getComputedStyle(node).clipPath === 'none',
        ).length,
    ),
    figures: [
      'cockpit-speed-value',
      'cockpit-altitude-value',
      'cockpit-heading-value',
    ].map((id) => ({
      id,
      text: byId(id)?.getAttribute('aria-label') || byId(id)?.textContent,
      fontSize: Number.parseFloat(getComputedStyle(byId(id)).fontSize),
    })),
    focus: {
      id: document.activeElement?.id,
      label:
        document.activeElement?.getAttribute('aria-label') ||
        document.activeElement?.textContent?.trim(),
    },
  };
}

export async function captureCockpit({
  page,
  options,
  out,
  report,
  markFrameStage,
  viewports,
}) {
  report.transport.flightFixture = fixture;
  if (await page.evaluate(() => document.body.dataset.sheet === 'open')) {
    await page.click('#world-sheet-close');
    await page.waitForFunction(
      () => document.body.dataset.sheet === 'closed',
      wait,
    );
  }
  await page.evaluate(async () => {
    const { styleManager, dataManager } = window.__godsEyeView;
    await styleManager.setContextMode('contacts');
    for (const id of ['flights', 'military'])
      if (!dataManager.isEnabled(id))
        await dataManager.setEnabled(id, true, { origin: 'user' });
  });
  await page.waitForFunction(
    (id) =>
      window.__godsEyeView.dataManager.layers
        .get('flights')
        ?.module?.trackById?.(id),
    wait,
    fixture.id,
  );
  if (!report.transport.flightFixtureReplies)
    throw new Error('Fixture flight was not served by the strict transport');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('c');
  await page.waitForSelector(
    'body.cockpit-mode #cockpit-hud:not([hidden])',
    wait,
  );
  await page.waitForFunction(
    (callsign) =>
      document.getElementById('cockpit-callsign').textContent === callsign,
    wait,
    fixture.callsign,
  );

  async function capture(width, height, view, selector, menu = null) {
    await markFrameStage(`${width}x${height} cockpit ${view}`);
    let previous;
    let stable = 0;
    let data;
    for (let i = 0; i < 30 && stable < 3; i++) {
      data = await page.evaluate(measure, selector, menu);
      const sample = JSON.stringify(data);
      stable = sample === previous ? stable + 1 : 1;
      previous = sample;
      if (stable < 3) await pause(100);
    }
    if (stable < 3) throw new Error(`Cockpit ${view} did not settle`);
    const { target, components, menu: menuBox, tickCounts, figures } = data;
    const errors = [];
    const overlaps = menuBox
      ? collisions(components, [menuBox]).filter(
          ({ a, b }) => a.selector === menu || b.selector === menu,
        )
      : [];
    if (overlaps.length) errors.push('menu overlaps instruments or controls');
    if (!target) errors.push('capture target is missing');
    if (
      menuBox &&
      (menuBox.left < -1 ||
        menuBox.top < -1 ||
        menuBox.right > width + 1 ||
        menuBox.bottom > height + 1)
    )
      errors.push('menu leaves the viewport');
    const primary = new Set([
      '.cockpit-compass',
      '#cockpit-speed-rim',
      '#cockpit-altitude-rim',
      '#cockpit-speed-value',
      '#cockpit-altitude-value',
      '.cockpit-heading-value',
      '#map-view-switch',
    ]);
    for (const component of components) {
      if (!primary.delete(component.selector)) continue;
      if (
        component.left < -1 ||
        component.top < -1 ||
        component.right > width + 1 ||
        component.bottom > height + 1
      )
        errors.push(`${component.selector} leaves the viewport`);
    }
    for (const missing of primary) errors.push(`${missing} is missing`);
    if (tickCounts.some((count) => count < 2))
      errors.push('each flight scale needs readable major marks');
    if (figures.some(({ text, fontSize }) => !/\d/.test(text) || fontSize < 12))
      errors.push('a primary flight figure is unavailable or illegible');
    const deck = components.find(
      ({ selector }) => selector === '.cockpit-compass',
    );
    const bottomControls = components.filter(({ selector }) =>
      [
        '#cockpit-layers',
        '#cockpit-presets',
        '#cockpit-reset-globe',
        '#map-view-switch',
      ].includes(selector),
    );
    if (
      deck &&
      collisions(bottomControls, [deck]).some(
        ({ a, b }) => a === deck || b === deck,
      )
    )
      errors.push('instrument deck overlaps the bottom controls');

    if (width <= 760) {
      const credit = components.find(
        ({ selector }) => selector === '#cesium-credits',
      );
      if (!credit) errors.push('map attribution is missing');
      else if (
        collisions([...bottomControls, ...(deck ? [deck] : [])], [credit]).some(
          ({ a, b }) => a === credit || b === credit,
        )
      )
        errors.push('instrument deck or controls cover the map attribution');
    }

    const stem = `${options.label}-${options.state}-${width}x${height}-${view}`;
    const crop = await captureLookImage(
      page,
      path.join(out, `${stem}.png`),
      path.join(out, `${stem}-crop.png`),
      target,
      { width, height },
    );
    const evidence = {
      width,
      height,
      view,
      ...data,
      crop,
      collisions: options.label === 'after' ? overlaps : [],
      ...(options.label === 'before'
        ? { baselineFindings: errors, baselineCollisions: overlaps }
        : {}),
      ...(options.label === 'after' && errors.length
        ? { error: errors.join('; ') }
        : {}),
    };
    report.cases.push(evidence);
    await fs.writeFile(
      path.join(out, `${stem}.json`),
      JSON.stringify(evidence, null, 2),
    );
  }

  async function focusReachableOption(selector) {
    const focusedAndReachable = () =>
      page.evaluate((selector) => {
        const active = document.activeElement;
        if (!active?.matches(selector)) return false;
        const { left, top, width, height } = active.getBoundingClientRect();
        const hit = document.elementFromPoint(
          left + width / 2,
          top + height / 2,
        );
        return active.contains(hit);
      }, selector);

    for (let i = 0; i < 16; i++) {
      if (await focusedAndReachable()) return;
      await page.keyboard.press('Tab');
    }
    throw new Error(
      `Keyboard could not reach a visible option matching ${selector}`,
    );
  }

  for (const [width, height] of [...viewports, [390, 844], [667, 390]]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await capture(width, height, 'instruments', '.cockpit-compass');
    for (const [button, name, selector, open] of [
      [
        '#cockpit-layers',
        'layers',
        '#data-panel',
        '#data-panel:not(.collapsed)',
      ],
      [
        '#cockpit-presets',
        'presets',
        '#frame-presets-menu',
        '#frame-presets-menu:not([hidden])',
      ],
    ]) {
      await page.click(button);
      await page.waitForSelector(open, { ...wait, visible: true });
      if (options.label === 'after' && height <= 480)
        await focusReachableOption(
          name === 'layers'
            ? '.layers-menu .data-toggle-btn'
            : '#frame-presets-menu .lens-button',
        );
      await capture(width, height, name, selector, selector);
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        (button) =>
          document.querySelector(button).getAttribute('aria-expanded') ===
            'false' &&
          document.activeElement === document.querySelector(button),
        wait,
        button,
      );
    }

    if (options.label === 'after' && height <= 480) {
      await page.click('#cockpit-display-toggle-btn');
      await page.waitForSelector('#cockpit-display-panel:not([hidden])', {
        ...wait,
        visible: true,
      });
      await focusReachableOption('#cockpit-display-panel button');
      await capture(
        width,
        height,
        'display',
        '#cockpit-display-panel',
        '#cockpit-display-panel',
      );
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () =>
          document.getElementById('cockpit-display-panel').hidden &&
          document.activeElement?.id === 'cockpit-display-toggle-btn',
        wait,
      );
    }
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => !document.body.classList.contains('cockpit-mode'),
    wait,
  );
}
