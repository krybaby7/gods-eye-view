import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { captureStateFailures } from '../src/tooling/qaLook.mjs';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';
import { collisions, requiredContextFailures } from '../src/tooling/qaLook.mjs';

// Synthetic public traffic camera: no live provider or image is represented.
export function cctvFixture(state) {
  const frame = sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#8ab4c6"/><path d="M0 80h320v100H0z" fill="#48644c"/><path d="M100 180L145 80h30l45 100z" fill="#34383c"/><path d="M160 88v20m0 14v30m0 12v16" stroke="#f7efbe" stroke-width="4"/><rect x="145" y="125" width="18" height="10" fill="#e3e7e8"/><text x="8" y="170" font-size="12" fill="white">SYNTHETIC FIXTURE</text></svg>`,
    ),
  )
    .png()
    .toBuffer();
  return async (url) => {
    if (url.pathname === '/api/cctv/sources')
      return {
        value: {
          sources:
            state === 'filled'
              ? [
                  {
                    id: 'look-traffic',
                    name: 'Synthetic traffic intersection',
                    city: 'Fixture city',
                    lat: 21.2,
                    lon: 81.7,
                    provider: 'Local synthetic fixture',
                    sourceKind: 'configured',
                    feedType: 'image',
                    url: 'https://fixture.invalid/frame',
                    headingDeg: 90,
                    fovDeg: 70,
                  },
                ]
              : [],
        },
      };
    if (url.pathname === '/api/cctv/health') return { value: { cameras: [] } };
    if (url.pathname === '/api/cctv/frame/look-traffic')
      return {
        value: await frame,
        contentType: 'image/png',
      };
    return null;
  };
}

function measure() {
  const panel = document.querySelector('#cctv-panel');
  const box = (name, node) => {
    const r = node.getBoundingClientRect();
    const ancestors = [];
    for (let p = node.parentElement; p; p = p.parentElement)
      ancestors.push(p.id || p.className || p.tagName);
    return {
      name,
      elementId: node.id || node.className || node.tagName,
      ancestors,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
    };
  };
  const visible = (n) =>
    n &&
    n.getClientRects().length &&
    getComputedStyle(n).visibility !== 'hidden' &&
    getComputedStyle(n).display !== 'none';
  const frames = [
    ['top bar', '#frame-top'],
    ['bottom bar', '#frame-bottom'],
    ['Today', '#frame-today'],
    ['rail', '#frame-rail'],
    ['sheet', '#frame-sheet'],
  ]
    .filter(([, s]) => visible(document.querySelector(s)))
    .map(([n, s]) => box(n, document.querySelector(s)));
  const panels = [
    ...document.querySelectorAll(
      '#right-context-rail > [data-panel-id], #data-panel, #command-dock',
    ),
  ]
    .filter(visible)
    .map((n) => box(n.id, n));
  const body = panel.querySelector('#cctv-panel-body, .cyber-panel-body');
  const canvas = document.querySelector('#cesiumContainer');
  const image = document.querySelector('#cctv-frame');
  const status = document.querySelector('#cctv-frame-status');
  const frame = document.querySelector('#cctv-frame-wrap');
  const imageBox = image.getBoundingClientRect();
  const center = document.elementFromPoint(
    (imageBox.left + imageBox.right) / 2,
    (imageBox.top + imageBox.bottom) / 2,
  );
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = 1;
  const colorContext = colorCanvas.getContext('2d', {
    willReadFrequently: true,
  });
  const colorCache = new Map();
  const rgb = (value) => {
    if (!colorCache.has(value)) {
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = value;
      colorContext.fillRect(0, 0, 1, 1);
      const c = [...colorContext.getImageData(0, 0, 1, 1).data];
      c[3] /= 255;
      colorCache.set(value, c);
    }
    return colorCache.get(value);
  };
  return {
    target: box('Cameras', panel),
    globe: box('globe', canvas),
    frames,
    panels,
    sheetCode: document.querySelector('#world-sheet-code')?.textContent,
    frameState: {
      today: document.body.dataset.today,
      sheet: document.body.dataset.sheet,
      lens: document.querySelector('#world-lens-bar [aria-pressed="true"]')
        ?.dataset.worldLens,
    },
    text: panel.innerText,
    floating: panel.classList.contains('panel-floating'),
    collapsed: panel.classList.contains('collapsed'),
    scroll: {
      top: body.scrollTop,
      height: body.clientHeight,
      content: body.scrollHeight,
    },
    typography: [...panel.querySelectorAll('*')]
      .filter(
        (n) =>
          visible(n) &&
          !n.closest(':disabled, [aria-hidden="true"]') &&
          [...n.childNodes].some(
            (x) => x.nodeType === Node.TEXT_NODE && x.textContent.trim(),
          ),
      )
      .map((n) => {
        const style = getComputedStyle(n);
        const over = (front, back) =>
          front
            .slice(0, 3)
            .map(
              (c, i) => c * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)),
            );
        const lum = (color) =>
          color.reduce((sum, c, i) => {
            c /= 255;
            return (
              sum +
              [0.2126, 0.7152, 0.0722][i] *
                (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
            );
          }, 0);
        const ratios = [0, 255].map((base) => {
          const layers = [];
          for (let p = n; panel.contains(p); p = p.parentElement)
            layers.push(rgb(getComputedStyle(p).backgroundColor));
          const bg = layers.reduceRight(
            (b, f) => over(f, b),
            [base, base, base],
          );
          const a = lum(bg),
            b = lum(over(rgb(style.color), bg));
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
        return {
          text: n.textContent.trim(),
          size: parseFloat(style.fontSize),
          color: style.color,
          background: style.backgroundColor,
          contrast: Math.min(...ratios),
        };
      }),
    controls: [...panel.querySelectorAll('button,select')].map((n) => ({
      id: n.id,
      text: n.innerText,
      disabled: n.disabled,
      fontSize: getComputedStyle(n).fontSize,
      color: getComputedStyle(n).color,
      background: getComputedStyle(n).backgroundColor,
    })),
    adjacent: [
      ...panel.querySelectorAll(
        '.cctv-controls, .cctv-frame-details, #cctv-meta',
      ),
    ]
      .filter(visible)
      .map((n) => box(n.id || n.className, n)),
    navigation: [
      ...panel.querySelectorAll(
        '#cctv-prev-btn, #cctv-camera-select, #cctv-next-btn',
      ),
    ]
      .filter(visible)
      .map((n) => box(n.id, n)),
    cameraState: (() => {
      const state = window.__godsEyeView.dataManager.layers
        .get('cctv')
        .module.getUIState();
      return {
        enabled: state.enabled,
        activeCameraId: state.activeCameraId,
        activeCamera: state.activeCamera && {
          id: state.activeCamera.id,
          sourceKind: state.activeCamera.sourceKind,
          provider: state.activeCamera.provider,
        },
        loading: state.loading,
      };
    })(),
    source: document.querySelector('#cctv-source-badge')?.textContent,
    sourceState:
      document.querySelector('#cctv-source-badge')?.dataset.frameState,
    frameError: image.dataset.error,
    frameTime: document.querySelector('#cctv-frame-time')?.textContent,
    frameDateTime: document
      .querySelector('#cctv-frame-time time')
      ?.getAttribute('datetime'),
    image: {
      visible: Boolean(visible(image) && !image.hidden),
      box: box('preview', image),
      frameBox: box('frame', frame),
      centerTarget: center?.id || center?.tagName,
      statusVisible: Boolean(visible(status) && !status.hidden),
      statusText: status?.textContent?.trim(),
      complete: document.querySelector('#cctv-frame').complete,
      naturalWidth: document.querySelector('#cctv-frame').naturalWidth,
      src: document.querySelector('#cctv-frame').getAttribute('src'),
    },
  };
}

export async function captureCctv({
  page,
  options,
  out,
  report,
  markFrameStage,
  viewports,
}) {
  const wait = { timeout: 30000, polling: 125 };
  const panel = '#cctv-panel';
  await page.waitForSelector(panel, { ...wait, visible: true });
  const disclosure = '[data-collapse-target="cctv-panel"]';
  async function disclosureState() {
    return page.$eval(disclosure, (n) => {
      const r = n.getBoundingClientRect();
      return {
        active:
          document.activeElement?.id ||
          document.activeElement?.outerHTML?.slice(0, 120),
        focused: n === document.activeElement,
        expanded: n.getAttribute('aria-expanded'),
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        hit: document
          .elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
          ?.outerHTML?.slice(0, 120),
      };
    });
  }
  try {
    if (await page.$(`${panel}.collapsed`)) {
      await page.click(disclosure);
      await page.waitForSelector(`${panel}:not(.collapsed)`, wait);
    }
    await page.focus(disclosure);
    if (!(await disclosureState()).focused)
      throw new Error('Could not focus disclosure before collapse');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${panel}.collapsed`, wait);
    const collapsedFocus = await disclosureState();
    if (!collapsedFocus.focused) {
      report.errors.push(
        `Disclosure lost focus after collapse: ${JSON.stringify(collapsedFocus)}`,
      );
      await page.focus(disclosure);
    }
    if (!(await disclosureState()).focused)
      throw new Error('Could not focus disclosure before reopen');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${panel}:not(.collapsed)`, wait);
  } catch (error) {
    throw new Error(
      `Disclosure interaction failed: ${JSON.stringify(await disclosureState())}`,
      { cause: error },
    );
  }
  const focus = await page.$eval(
    '[data-collapse-target="cctv-panel"]',
    (n) => ({
      focused: n === document.activeElement,
      visible: n.matches(':focus-visible'),
      outline: getComputedStyle(n).outlineStyle,
    }),
  );
  if (
    options.label === 'after' &&
    (!focus.focused || !focus.visible || focus.outline === 'none')
  )
    report.errors.push('Cameras disclosure lacks visible keyboard focus');
  if (options.state === 'filled') {
    await page.click('#cctv-enable-btn');
    await page.waitForFunction(
      () => document.querySelector('#cctv-camera-select')?.options.length > 0,
      wait,
    );
    await page.select('#cctv-camera-select', 'look-traffic');
    await page.waitForFunction(
      () =>
        document.querySelector('#cctv-camera-select')?.value === 'look-traffic',
      wait,
    );
    await page.waitForFunction(
      () => document.querySelector('#cctv-frame')?.naturalWidth === 320,
      wait,
    );
    const coverage = '#cctv-coverage-btn';
    const modes = ['off', 'on', 'viewshed'];
    const initial = await page.evaluate(
      () =>
        window.__godsEyeView.dataManager.layers.get('cctv').module.getUIState()
          .coverageMode,
    );
    for (let i = 1; i <= 3; i++) {
      const expected = modes[(modes.indexOf(initial) + i) % modes.length];
      await page.click(coverage);
      await page.waitForFunction(
        (expected) => {
          const mode = window.__godsEyeView.dataManager.layers
            .get('cctv')
            .module.getUIState().coverageMode;
          const text = document
            .querySelector('#cctv-coverage-btn')
            .textContent.toLowerCase();
          return (
            mode === expected &&
            text.includes(expected === 'viewshed' ? 'viewshed' : expected)
          );
        },
        wait,
        expected,
      );
    }
  }
  async function capture(width, height, view, seedFallback = false) {
    await markFrameStage(`${width}x${height} cctv ${view}`);
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    let data;
    let previous;
    let equal = 0;
    for (let i = 0; i < 60 && equal < 3; i++) {
      data = await page.evaluate(measure);
      const geometry = JSON.stringify(data.target);
      equal = geometry === previous ? equal + 1 : 1;
      previous = geometry;
      if (equal < 3) await new Promise((resolve) => setTimeout(resolve, 125));
    }
    if (equal < 3) throw new Error('Cameras did not settle before capture');
    const issues = requiredContextFailures(data);
    const legacy = [];
    if (data.frameState.today !== 'open' || data.frameState.sheet !== 'open')
      issues.push('Today or sheet closed');
    const t = data.target,
      g = data.globe;
    if (view === 'dragged' && !data.floating)
      issues.push('Panel did not float after drag');
    if (
      view === 'dragged' &&
      (t.left < g.left - 1 ||
        t.top < g.top - 1 ||
        t.right > g.right + 1 ||
        t.bottom > g.bottom + 1)
    )
      legacy.push('Floating panel outside globe');
    if (data.collapsed) issues.push('Cameras unexpectedly collapsed');
    if (seedFallback) {
      if (
        !data.cameraState.enabled ||
        !data.cameraState.activeCameraId ||
        data.cameraState.activeCamera?.sourceKind !== 'seed'
      )
        issues.push('Empty source response did not select a seed camera');
      if (!(report.transport.cctvReplies?.['/api/cctv/sources'] > 0))
        issues.push('Empty source fixture did not answer');
      const failedPath = `/api/cctv/frame/${encodeURIComponent(data.cameraState.activeCameraId)}`;
      if (!(report.transport.suppressedApis ?? []).includes(failedPath))
        issues.push(
          'Seed frame did not receive the local unavailable response',
        );
      if (data.image.naturalWidth || data.frameDateTime)
        issues.push('Unavailable seed frame reported image or loaded time');
      if (
        options.label === 'after' &&
        (!data.image.statusVisible ||
          data.image.statusText !== 'Frame unavailable')
      )
        issues.push('Seed frame lacks visible unavailable status');
      if (options.label === 'before' && data.sourceState !== 'error')
        issues.push('Legacy unavailable badge is missing');
    }
    const smallText = data.typography
      .filter((t) => t.size < 12)
      .map((t) => t.text);
    const lowContrast = data.typography
      .filter((t) => t.contrast < 4.5)
      .map((t) => t.text);
    if (smallText.length)
      legacy.push(`Text under 12px: ${smallText.join(', ')}`);
    if (lowContrast.length)
      legacy.push(`Text below 4.5 contrast: ${lowContrast.join(', ')}`);
    const tiny = data.controls
      .filter(
        (c) => !c.disabled && c.text.trim() && parseFloat(c.fontSize) < 12,
      )
      .map((c) => c.id || c.text);
    if (tiny.length) legacy.push(`Controls under 12px: ${tiny.join(', ')}`);
    if (/\b(?:NEAREST|SCENE SUMMARY|COVERAGE OFF)\b/.test(data.text))
      legacy.push('Legacy uppercase labels');
    if (
      options.state === 'filled' &&
      options.label === 'after' &&
      (!/Frame loaded.*\d.*UTC/i.test(data.frameTime ?? '') ||
        !Number.isFinite(Date.parse(data.frameDateTime)))
    )
      issues.push('Missing labelled frame loaded UTC time');
    if (
      options.state === 'filled' &&
      !data.text.includes('Synthetic traffic intersection')
    )
      issues.push('Synthetic camera not selected');
    const overlaps = collisions(data.frames, data.panels).filter((c) =>
      JSON.stringify(c).includes('cctv-panel'),
    );
    if (overlaps.length)
      legacy.push('Cameras collides with frame or another panel');
    if (view === 'docked' && data.floating) issues.push('Panel did not dock');

    if (
      options.state === 'filled' &&
      (!data.image.visible ||
        data.image.box.right <= data.image.box.left ||
        data.image.box.bottom <= data.image.box.top ||
        data.image.centerTarget !== 'cctv-frame' ||
        data.image.statusVisible)
    )
      legacy.push('Decoded preview is hidden, blocked, or has no geometry');
    if (
      options.state === 'filled' &&
      (!data.image.complete || data.image.naturalWidth !== 320)
    )
      issues.push('Synthetic frame failed to decode');
    if (
      options.state === 'filled' &&
      !data.text.includes('Local synthetic fixture')
    )
      issues.push('Fixture source missing');
    const f = data.image.frameBox;
    const intersects = (a, b) =>
      a.left < b.right - 1 &&
      a.right > b.left + 1 &&
      a.top < b.bottom - 1 &&
      a.bottom > b.top + 1;
    const intrusions = data.adjacent.filter((a) => intersects(a, f));
    if (intrusions.length)
      legacy.push(
        `Controls/details overlap preview: ${intrusions.map((a) => a.elementId).join(', ')}`,
      );
    const outside = data.navigation.filter(
      (n) => n.left < t.left - 1 || n.right > t.right + 1,
    );
    if (outside.length)
      legacy.push(
        `Navigation outside panel: ${outside.map((n) => n.elementId).join(', ')}`,
      );
    if (options.label === 'after' && legacy.length) issues.push(...legacy);
    const stem = `${options.label}-${options.state}-${width}x${height}-cctv-${view}`;
    data.cropPixels = await captureLookImage(
      page,
      path.join(out, `${stem}-full.png`),
      path.join(out, `${stem}-crop.png`),
      t,
      { width, height },
    );
    if (!data.cropPixels) issues.push('Panel has no screenshot pixels');
    const after = await page.evaluate(measure);
    issues.push(...captureStateFailures(data.frameState, after.frameState));
    if (JSON.stringify(data.target) !== JSON.stringify(after.target))
      issues.push('Panel moved during capture');
    const evidence = {
      seedFallback,
      width,
      height,
      panel: 'cctv',
      view,
      state: options.state,
      ...data,
      collisions: options.label === 'after' ? overlaps : [],
      baselineFindings: legacy,
      baselineCollisions: options.label === 'before' ? overlaps : [],
      focus,
      transport: structuredClone(report.transport),
      ...(issues.length ? { error: issues.join('; ') } : {}),
    };
    report.cases.push(evidence);
    await fs.writeFile(
      path.join(out, `${stem}.json`),
      JSON.stringify(evidence, null, 2),
    );
  }
  async function scrollBody() {
    const before = await page.evaluate(measure);
    if (before.scroll.content <= before.scroll.height + 1) return;
    const body = await page.$(
      '#cctv-panel-body, #cctv-panel .cyber-panel-body',
    );
    const rect = await body.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.wheel({ deltaY: 220 });
    await page.waitForFunction(
      (top) =>
        Math.abs(
          document.querySelector(
            '#cctv-panel-body, #cctv-panel .cyber-panel-body',
          ).scrollTop - top,
        ) > 1,
      wait,
      before.scroll.top,
    );
    const after = await page.evaluate(measure);
    if (JSON.stringify(before.target) !== JSON.stringify(after.target))
      report.errors.push('Wheel moved Cameras rather than scrolling its body');
    await page.mouse.wheel({ deltaY: -1000 });
  }
  for (const [width, height] of viewports) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    if (await page.$(`${panel}.panel-floating`)) {
      // Reset via the panel's supported double-click action, even when the old
      // layout put its header behind Today and pointer input cannot reach it.
      await page.$eval(`${panel} .panel-header`, (n) =>
        n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
      );
      await page.waitForSelector(`${panel}:not(.panel-floating)`, wait);
    }
    await capture(width, height, 'docked');
    await scrollBody();
    const handle = await page.$(`${panel} .panel-header`),
      b = await handle.boundingBox();
    await page.mouse.move(b.x + 40, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(-100, height + 100, { steps: 12 });
    await page.mouse.up();
    await capture(width, height, 'dragged');
    await scrollBody();
  }
  if (options.state === 'empty') {
    if (await page.$(`${panel}.panel-floating`))
      await page.$eval(`${panel} .panel-header`, (n) =>
        n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
      );
    await page.click('#cctv-enable-btn');
    await page.waitForFunction(
      () => window.__godsEyeView.dataManager.isEnabled('cctv'),
      wait,
    );
    await page.waitForFunction(() => {
      const state = window.__godsEyeView.dataManager.layers
        .get('cctv')
        .module.getUIState();
      return (
        state.activeCameraId &&
        state.activeCamera?.sourceKind === 'seed' &&
        document.querySelector('#cctv-frame')?.dataset.error === 'true'
      );
    }, wait);
    for (const [width, height] of viewports) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await capture(width, height, 'seed-unavailable', true);
    }
  }
}
