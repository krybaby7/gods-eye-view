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
        const rgb = (value) =>
          value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
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
    source: document.querySelector('#cctv-source-badge')?.textContent,
    frameTime: document.querySelector('#cctv-frame-time')?.textContent,
    image: {
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
  if (await page.$(`${panel}.collapsed`))
    await page.click('[data-collapse-target="cctv-panel"]');
  await page.focus('[data-collapse-target="cctv-panel"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${panel}.collapsed`, wait);
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${panel}:not(.collapsed)`, wait);
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
    const before = await page.$eval(coverage, (n) => n.textContent);
    await page.click(coverage);
    const after = await page.$eval(coverage, (n) => n.textContent);
    if (before === after)
      report.errors.push('Coverage control did not change state');
    await page.click(coverage);
  }
  async function capture(width, height, view) {
    await markFrameStage(`${width}x${height} cctv ${view}`);
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    const data = await page.evaluate(measure);
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
      !/Frame loaded.*UTC/i.test(data.frameTime ?? '')
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
    if (options.label === 'after' && legacy.length) issues.push(...legacy);
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
}
