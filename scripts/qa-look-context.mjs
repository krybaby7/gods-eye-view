import fs from 'node:fs/promises';
import path from 'node:path';
import { captureStable } from '../src/tooling/qaLookCapture.mjs';
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
    worldEnabled:
      window.__godsEyeView.dataManager.isEffectivelyEnabled('world'),
    railTransitions: [
      ...find('#right-context-rail').getAnimations(),
      ...target.getAnimations(),
    ].filter(
      ({ playState }) => playState === 'running' || playState === 'pending',
    ).length,
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
  const read = () => page.evaluate(measureContext);
  const key = (data) => data;
  async function settle() {
    let previous;
    let equal = 0;
    // The rail schedules a second allocation after its 240 ms settle timer.
    // Wait for a quiet second and bracket every capture with fresh measures.
    for (let i = 0; i < 120; i++) {
      const data = await read();
      const sample = JSON.stringify(key(data));
      equal = data.railTransitions ? 0 : sample === previous ? equal + 1 : 1;
      if (equal === 9) return data;
      previous = sample;
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
    throw new Error('Context geometry did not settle');
  }

  async function capture(view, viewport, extra = {}) {
    const { width, height } = viewport;
    await markFrameStage(`${width}x${height} context ${view}`);
    const stem = path.join(
      out,
      `${options.label}-${options.state}-${width}x${height}-context-${view}`,
    );
    const full = `${stem}-attempt-full.png`;
    const crop = `${stem}-attempt-crop.png`;
    let attempt;
    const discard = () =>
      Promise.all([full, crop].map((file) => fs.rm(file, { force: true })));
    try {
      attempt = await captureStable({
        settle,
        read,
        key,
        capture: (before) =>
          captureLookImage(page, full, crop, before.target, viewport),
        discard,
      });
    } catch (error) {
      await discard();
      await fs.writeFile(
        `${stem}-capture-attempts.json`,
        JSON.stringify(
          {
            error: error.message,
            attempts: error.attempts ?? [],
          },
          null,
          2,
        ),
      );
      throw error;
    }
    await fs.rename(full, `${stem}-full.png`);
    if (attempt.value) await fs.rename(crop, `${stem}-crop.png`);
    const { before: data, after, value: cropPixels } = attempt;
    const overlaps = collisions(data.frames, data.panels).filter(({ a, b }) =>
      [a, b].some(({ elementId }) => elementId === 'global-context-panel'),
    );
    const neutral =
      view === 'collapsed' || view === 'chooser' || view === 'restored';
    const visibleSheet = data.frames.some(({ name }) => name === 'sheet');
    const issues = neutral ? requiredContextFailures(data) : [];
    if (
      data.frameState.today !== 'open' ||
      !data.frames.some(({ name }) => name === 'Today')
    )
      issues.push('Today closed during the Context journey');
    if (neutral && (!data.worldEnabled || data.frameState.sheet !== 'open'))
      issues.push(
        'World and the India sheet should be open outside an active Context mode',
      );
    if (
      !neutral &&
      (data.worldEnabled || data.frameState.sheet !== 'closed' || visibleSheet)
    )
      issues.push(
        'Active Context mode did not yield the World layer and country sheet',
      );

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
    issues.push(...captureStateFailures(data.frameState, after.frameState));
    if (!cropPixels) issues.push('Context crop is empty');
    const evidence = {
      panel: 'context',
      view,
      width,
      height,
      state: options.state,
      ...data,
      ...extra,
      cropPixels,
      captureAttempts: attempt.attempts,
      overlaps,
      legacyIssues,
      ...(issues.length ? { error: issues.join('; ') } : {}),
    };
    report.cases.push(evidence);
    await fs.writeFile(`${stem}.json`, JSON.stringify(evidence, null, 2));
  }

  async function waitForSheet(open) {
    await page.waitForFunction(
      (expected) =>
        document.body.dataset.sheet === (expected ? 'open' : 'closed') &&
        window.__godsEyeView.dataManager.isEffectivelyEnabled('world') ===
          expected,
      wait,
      open,
    );
  }

  async function reopenIndiaSheet() {
    await page.waitForFunction(
      () =>
        window.__godsEyeView.dataManager.layers
          .get('world')
          .module.getSnapshot().visible,
      wait,
    );
    await page.evaluate(() => {
      const { C } = window.lookQa;
      const { viewer } = window.__godsEyeView;
      viewer.camera.cancelFlight();
      viewer.camera.setView({
        destination: C.Cartesian3.fromDegrees(82, 22, 9000000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      viewer.scene.requestRender();
    });
    const hit = await page.waitForFunction(() => {
      const { C } = window.lookQa;
      const { scene } = window.__godsEyeView.viewer;
      const point = C.SceneTransforms.worldToWindowCoordinates(
        scene,
        C.Cartesian3.fromDegrees(81.7, 21.2),
      );
      if (!point) return false;
      const canvas = scene.canvas.getBoundingClientRect();
      for (const [dx, dy] of [
        [0, 0],
        [16, 0],
        [-16, 0],
        [0, 16],
        [0, -16],
        [24, 14],
        [-24, 14],
      ]) {
        const probe = new C.Cartesian2(point.x + dx, point.y + dy);
        const x = Math.round(probe.x + canvas.left);
        const y = Math.round(probe.y + canvas.top);
        if (
          document.elementFromPoint(x, y) === scene.canvas &&
          scene.pick(probe, 1, 1)?.id?.startsWith?.('world:IND:')
        )
          return { x, y };
      }
      scene.requestRender();
      return false;
    }, wait);
    const { x, y } = await hit.jsonValue();
    await hit.dispose();
    await page.mouse.click(x, y);
    await waitForSheet(true);
    await page.waitForFunction(
      () => document.getElementById('world-sheet-code')?.textContent === 'IND',
      wait,
    );
  }

  for (const [width, height] of viewports) {
    const viewport = { width, height };
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.waitForSelector(`${panel}.collapsed`, seen);
    await waitForSheet(true);
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
    // Entering either Context mode excludes World from its scene.
    await waitForSheet(false);
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
    await waitForSheet(false);
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
    // Exiting restores the World layer. A fresh country click restores
    // the sheet because disabling World released the previous selection.
    await markFrameStage(`${width}x${height} reopen country after Context`);
    await reopenIndiaSheet();
    await capture('restored', viewport);
  }
  if (!report.transport.contextReplies)
    report.errors.push('Context did not consume the local launch fixture');
}
