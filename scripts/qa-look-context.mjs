import fs from 'node:fs/promises';
import path from 'node:path';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';
import {
  captureStateFailures,
  collisions,
  requiredContextFailures,
} from '../src/tooling/qaLook.mjs';

const panel = '#global-context-panel';
const disclosure = `${panel} [data-collapse-target="global-context-panel"]`;
const contacts = '#global-context-flights-btn';
const missions = '#global-context-missions-btn';
const wait = { timeout: 75000, polling: 125 };
const seen = { ...wait, visible: true };

export function contextFixture(state) {
  return {
    results:
      state === 'filled'
        ? Array.from({ length: 3 }, (_, index) => ({
            id: `context-fixture-mission-${index + 1}`,
            name: `Fixture mission ${index + 1}`,
            net: new Date(Date.now() - (index + 1) * 864e5).toISOString(),
            status: { name: 'Launch successful', abbrev: 'Success' },
            launch_service_provider: { name: 'Fixture Launch Service' },
            pad: { name: 'Fixture pad', latitude: 21, longitude: 81 },
          }))
        : [],
  };
}

function measureContext() {
  const find = (selector) => document.querySelector(selector);
  const target = find('#global-context-panel');
  const surface = target.firstElementChild;
  const id = (node) => node.id || node.className || node.tagName;
  const box = (node, name = id(node)) => {
    const { left, top, right, bottom } = node.getBoundingClientRect();
    const ancestors = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement)
      ancestors.push(id(parent));
    return { left, top, right, bottom, name, elementId: id(node), ancestors };
  };
  const visible = (node) =>
    node?.getClientRects().length &&
    getComputedStyle(node).visibility === 'visible';
  const frames = [
    ['top bar', '#frame-top'],
    ['bottom bar', '#frame-bottom'],
    ['Today', '#frame-today'],
    ['rail', '#frame-rail'],
    ['sheet', '#frame-sheet'],
  ].flatMap(([name, selector]) => {
    const node = find(selector);
    return visible(node) ? [box(node, name)] : [];
  });
  const panels = [
    ...document.querySelectorAll(
      '#right-context-rail > [data-panel-id], #data-panel, #command-dock, #world-hover',
    ),
  ]
    .filter(visible)
    .map((node) => box(node));
  const styles = getComputedStyle(surface);
  const text = [...target.querySelectorAll('*')]
    .filter(
      (node) =>
        visible(node) &&
        !node.closest(
          '#radio-panel, #context-radio-dock, #cockpit-entry, .material-symbols-outlined',
        ) &&
        [...node.childNodes].some(
          (child) =>
            child.nodeType === Node.TEXT_NODE &&
            /[\p{L}\p{N}]/u.test(child.textContent),
        ),
    )
    .map((node) => ({
      text: node.textContent,
      px: parseFloat(getComputedStyle(node).fontSize),
    }));
  return {
    target: box(target),
    frames,
    panels,
    backdrop: styles.backdropFilter,
    background: styles.backgroundColor,
    text,
    sheetCode: find('#world-sheet-code')?.textContent,
    frameState: window.lookFrameDiagnostics.snapshot(),
    scroll: {
      top: surface.scrollTop,
      height: surface.clientHeight,
      contentHeight: surface.scrollHeight,
      width: surface.clientWidth,
      contentWidth: surface.scrollWidth,
    },
  };
}

export async function captureContext({
  page,
  options,
  out,
  report,
  markFrameStage,
  viewports,
}) {
  async function settle() {
    let previous;
    let equal = 0;
    for (let i = 0; i < 80; i++) {
      const data = await page.evaluate(measureContext);
      const sample = JSON.stringify(data);
      equal = sample === previous ? equal + 1 : 1;
      if (equal === 4) return data;
      previous = sample;
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
    throw new Error('Context geometry did not settle');
  }

  async function capture(view, viewport, extra = {}) {
    const { width, height } = viewport;
    await markFrameStage(`${width}x${height} context ${view}`);
    const data = await settle();
    const stem = path.join(
      out,
      `${options.label}-${options.state}-${width}x${height}-context-${view}`,
    );
    const overlaps = collisions(data.frames, data.panels).filter(({ a, b }) =>
      [a, b].some(({ elementId }) => elementId === 'global-context-panel'),
    );
    const issues = requiredContextFailures(data);
    const { left, top, right, bottom } = data.target;
    if (left < 0 || top < 0 || right > width || bottom > height)
      issues.push('Context extends outside the viewport');
    const legacyIssues = [];
    if (overlaps.length) legacyIssues.push('Context overlaps a frame or panel');
    if (view !== 'collapsed' && data.backdrop !== 'none')
      legacyIssues.push('Context uses a backdrop filter');
    if (data.text.some(({ px }) => px < 12))
      legacyIssues.push('Context text is smaller than 12 px');
    if (
      data.scroll.contentWidth > data.scroll.width + 1 &&
      view !== 'collapsed'
    )
      legacyIssues.push('Context body scrolls horizontally');
    if (
      extra.focus &&
      (!extra.focus.visible ||
        !extra.focus.selected ||
        extra.focus.outline !== 'solid')
    )
      issues.push('Selected Context tab lost its keyboard focus indicator');
    if (options.label === 'after') issues.push(...legacyIssues);
    const cropPixels = await captureLookImage(
      page,
      `${stem}-full.png`,
      `${stem}-crop.png`,
      data.target,
      viewport,
    );
    const after = await page.evaluate(measureContext);
    issues.push(...captureStateFailures(data.frameState, after.frameState));
    if (!cropPixels) issues.push('Context crop is empty');
    if (JSON.stringify(data.target) !== JSON.stringify(after.target))
      issues.push('Context moved during capture');
    const evidence = {
      panel: 'context',
      view,
      width,
      height,
      state: options.state,
      ...data,
      ...extra,
      cropPixels,
      overlaps,
      legacyIssues,
      ...(issues.length ? { error: issues.join('; ') } : {}),
    };
    report.cases.push(evidence);
    await fs.writeFile(`${stem}.json`, JSON.stringify(evidence, null, 2));
  }

  for (const [width, height] of viewports) {
    const viewport = { width, height };
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.waitForSelector(`${panel}.collapsed`, seen);
    await capture('collapsed', viewport);
    await page.focus(disclosure);
    await page.keyboard.press('Enter');
    await page.waitForSelector(
      `${panel}:not(.collapsed) #context-mode-standby:not([hidden])`,
      seen,
    );
    await capture('chooser', viewport);
    await page.focus(contacts);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#context-flights-view:not([hidden])', seen);
    await page.waitForSelector(`${contacts}[aria-busy="false"]`, wait);
    await capture('contacts', viewport);
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector(
      `${missions}[aria-selected="true"][aria-busy="false"]`,
      seen,
    );
    const focus = await page.$eval(missions, (node) => ({
      selected: node === document.activeElement,
      visible: node.matches(':focus-visible'),
      outline: getComputedStyle(node).outlineStyle,
    }));
    const rows = '[data-mission-roster-id]';
    if (options.state === 'filled') await page.waitForSelector(rows, seen);
    else
      await page.waitForFunction(
        () =>
          /no missions/i.test(
            document.querySelector('.space-mission-roster-empty')
              ?.textContent || '',
          ),
        wait,
      );
    await capture('missions', viewport, { focus });
    if (options.state === 'filled') {
      await page.click(rows);
      await page.waitForSelector(
        '#space-mission-panel:not([hidden]) [data-mission-title]',
        seen,
      );
      await capture('mission-details', viewport);
      await page.click('[data-mission-close]');
      await page.waitForSelector(rows, seen);
    }
    await page.click(missions);
    await page.waitForSelector('#context-mode-standby:not([hidden])', seen);
    await page.waitForSelector(`${missions}[aria-busy="false"]`, wait);
    await page.click(disclosure);
    await page.waitForSelector(`${panel}.collapsed`, seen);
  }
  if (!report.transport.contextReplies)
    report.errors.push('Context did not consume the local launch fixture');
}
