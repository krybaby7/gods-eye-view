import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  captureStateFailures,
  collisions,
  requiredContextFailures,
} from '../src/tooling/qaLook.mjs';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';

const panel = '#recent-imagery-panel';
const body = '#recent-imagery-panel-body';
const divider = '#recent-imagery-split-line';
const action = (id) => `${panel} [data-action-id="${id}"]`;
const wait = { timeout: 75000, polling: 125 };
const seen = { ...wait, visible: true };

export async function createImageryLookFixture() {
  // A local, decoded image exercises the actual thumbnail and globe pipelines.
  const tile = await sharp(
    fileURLToPath(
      new URL(
        '../node_modules/cesium/Build/Cesium/Assets/Textures/NaturalEarthII/0/0/0.jpg',
        import.meta.url,
      ),
    ),
  )
    .png()
    .toBuffer();
  return (url) => {
    if (
      url.hostname === 'cmr.earthdata.nasa.gov' &&
      url.pathname === '/search/granules.umm_json'
    ) {
      const [w, s, e, n] = url.searchParams
        .get('bounding_box')
        .split(',')
        .map(Number);
      const end = Date.parse(url.searchParams.get('temporal').split(',')[1]);
      const items = [2, 4].map((days, i) => ({
        meta: { 'concept-id': `local-fixture-${i + 1}` },
        umm: {
          TemporalExtent: {
            RangeDateTime: {
              BeginningDateTime: new Date(end - days * 864e5).toISOString(),
            },
          },
          AdditionalAttributes: [{ Name: 'CLOUD_COVERAGE', Values: ['12'] }],
          SpatialExtent: {
            HorizontalSpatialDomain: {
              Geometry: {
                BoundingRectangles: [
                  {
                    WestBoundingCoordinate: w,
                    SouthBoundingCoordinate: s,
                    EastBoundingCoordinate: e,
                    NorthBoundingCoordinate: n,
                  },
                ],
              },
            },
          },
        },
      }));
      return { kind: 'catalog', value: { hits: items.length, items } };
    }
    if (
      url.hostname === 'wvs.earthdata.nasa.gov' &&
      url.pathname === '/api/v1/snapshot'
    )
      return { kind: 'thumbnail', value: tile, contentType: 'image/png' };
    if (
      /^gibs-[abc]\.earthdata\.nasa\.gov$/.test(url.hostname) &&
      url.pathname.startsWith('/wmts/epsg3857/best/')
    )
      return { kind: 'tile', value: tile, contentType: 'image/png' };
    return null;
  };
}

function measureImagery() {
  const panel = document.querySelector('#recent-imagery-panel');
  const body = panel.querySelector('#recent-imagery-panel-body');
  const id = (node) => node.id || node.className || node.tagName;
  const visible = (node) =>
    node?.getClientRects().length &&
    getComputedStyle(node).visibility === 'visible';
  const box = (node, name = id(node)) => {
    const { left, top, right, bottom } = node.getBoundingClientRect();
    const ancestors = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement)
      ancestors.push(id(parent));
    return { name, elementId: id(node), left, top, right, bottom, ancestors };
  };
  const frames = [
    ['top bar', '#frame-top'],
    ['bottom bar', '#frame-bottom'],
    ['Today', '#frame-today'],
    ['rail', '#frame-rail'],
    ['sheet', '#frame-sheet'],
  ].flatMap(([name, selector]) => {
    const node = document.querySelector(selector);
    return visible(node) ? [box(node, name)] : [];
  });
  const panels = [
    ...document.querySelectorAll(
      '#right-context-rail > [data-panel-id], #data-panel, #frame-presets-menu, #command-dock, #frame-tools > .tools-panel, #world-hover',
    ),
  ]
    .filter(visible)
    .map((node) => box(node));
  const heading = panel.querySelector('.panel-title');
  const frameState = window.lookFrameDiagnostics.snapshot();
  return {
    target: box(panel),
    frames,
    panels,
    frameState,
    sheetCode: document.querySelector('#world-sheet-code')?.textContent,
    text: heading.textContent,
    surface: getComputedStyle(panel.firstElementChild).backgroundColor,
    backdrop: getComputedStyle(panel.firstElementChild).backdropFilter,
    fontSizes: [...body.querySelectorAll('*')]
      .filter(
        (node) =>
          visible(node) &&
          [...node.childNodes].some(
            ({ nodeType, textContent }) =>
              nodeType === Node.TEXT_NODE && /[\p{L}\p{N}]/u.test(textContent),
          ),
      )
      .map((node) => ({
        text: node.textContent,
        px: parseFloat(getComputedStyle(node).fontSize),
      })),
    blocks: [
      ...body.querySelectorAll(
        '.ri-block, #ri-zoom-in, #ri-mode, #ri-slot-a, #ri-slot-b, #ri-opacity, #ri-swap, [data-action-id="export-a"], [data-action-id="export-b"]',
      ),
    ].map((child) => {
      const bounds = child.getBoundingClientRect();
      const { top, left } = body.getBoundingClientRect();
      return {
        id: child.id || child.dataset.actionId,
        top: bounds.top - top + body.scrollTop,
        left: bounds.left - left,
        width: bounds.width,
        ...(child.id === 'ri-details' ? {} : { height: bounds.height }),
      };
    }),
    split: Boolean(
      document.querySelector('#recent-imagery-split-line:not([hidden])'),
    ),
    thumbnails: [
      ...panel.querySelectorAll('img.ri-thumb-img:not([hidden])'),
    ].filter((image) => image.complete && image.naturalWidth > 0).length,
    scroll: {
      top: body.scrollTop,
      height: body.clientHeight,
      content: body.scrollHeight,
      width: body.clientWidth,
      contentWidth: body.scrollWidth,
    },
  };
}

export async function captureImagery({
  page,
  options,
  out,
  report,
  markFrameStage,
  viewports,
}) {
  const filled = options.state === 'filled';
  const toggle =
    '#data-panel [data-layer-id="recent-imagery"] .data-toggle-btn';
  const disclosure = `${panel} [data-collapse-target="recent-imagery-panel"]`;
  async function setEnabled(enabled) {
    await page.click('#frame-layers');
    await page.waitForSelector(toggle, seen);
    await page.click(toggle);
    await page.waitForFunction(
      (selector, next) =>
        document.querySelector(selector)?.getAttribute('aria-checked') ===
        String(next),
      wait,
      toggle,
      enabled,
    );
    await page.keyboard.press('Escape');
    await page.waitForSelector('#data-panel.collapsed', wait);
  }
  async function settle() {
    let previous;
    let equal = 0;
    for (let i = 0; i < 80; i++) {
      const data = await page.evaluate(measureImagery);
      const sample = JSON.stringify(data);
      equal = sample === previous ? equal + 1 : 1;
      if (equal === 4) return data;
      previous = sample;
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
    throw new Error('Recent imagery did not settle');
  }
  async function capture(view, width, height, data) {
    const file = path.join(
      out,
      `${options.label}-${options.state}-${width}x${height}-imagery-${view}`,
    );
    const overlaps = collisions(data.frames, data.panels).filter(({ a, b }) =>
      [a, b].some(({ elementId }) => elementId === 'recent-imagery-panel'),
    );
    const issues = requiredContextFailures(data);
    const cropPixels = await captureLookImage(
      page,
      `${file}-full.png`,
      `${file}-crop.png`,
      data.target,
      { width, height },
    );
    if (!cropPixels) issues.push('Recent imagery crop is empty');
    const { left, right, top, bottom } = data.target;
    if (left < 0 || top < 0 || right > width || bottom > height)
      issues.push('Recent imagery panel extends outside the viewport');
    const after = await page.evaluate(measureImagery);
    issues.push(...captureStateFailures(data.frameState, after.frameState));
    if (JSON.stringify(data.target) !== JSON.stringify(after.target))
      issues.push('Recent imagery panel moved during capture');
    const legacyIssues = [];
    if (overlaps.length)
      legacyIssues.push('Recent imagery overlaps another panel or frame');
    if (data.fontSizes.some(({ px }) => px < 12))
      legacyIssues.push('Recent imagery has text under 12px');
    if (data.backdrop !== 'none')
      legacyIssues.push('Recent imagery has a backdrop filter');
    if (data.scroll.contentWidth > data.scroll.width + 1)
      legacyIssues.push('Recent imagery body scrolls horizontally');
    if (options.label === 'after') issues.push(...legacyIssues);
    const evidence = {
      panel: 'imagery',
      view,
      width,
      height,
      state: options.state,
      ...data,
      cropPixels,
      overlaps,
      legacyIssues,
      ...(issues.length ? { error: issues.join('; ') } : {}),
    };
    report.cases.push(evidence);
    await fs.writeFile(`${file}.json`, JSON.stringify(evidence, null, 2));
  }

  await setEnabled(true);
  await page.waitForSelector(`${panel}:not([hidden])`, seen);
  if (await page.$(`${panel}.collapsed`)) await page.click(disclosure);
  await page.waitForSelector(`${panel}:not(.collapsed) #ri-strip`, seen);
  await page.focus(disclosure);
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${panel}.collapsed`, wait);
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${panel}:not(.collapsed) #ri-strip`, seen);
  for (const [width, height] of viewports) {
    await markFrameStage(`${width}x${height} imagery ${options.state}`);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const empty = await settle();
    if (!filled) {
      await capture('no-box', width, height, empty);
      continue;
    }
    await page.evaluate(() =>
      window.__gevRecentImagery.layer.setBox({
        west: 81.5,
        south: 21,
        east: 81.9,
        north: 21.4,
      }),
    );
    await page.waitForSelector('#ri-strip .ri-thumb-img:not([hidden])', seen);
    const populated = await settle();
    if (!populated.thumbnails)
      throw new Error('Local imagery thumbnails did not decode');
    if (JSON.stringify(empty.blocks) !== JSON.stringify(populated.blocks))
      throw new Error('Imagery controls moved after the search');
    await capture('results', width, height, populated);
    await page.click('#ri-mode [data-mode="basemap"]');
    await page.focus('#ri-strip');
    await page.keyboard.press('s');
    await page.waitForSelector(divider, seen);
    await page.click('#ri-swap');
    await page.waitForSelector('#ri-swap[aria-pressed="true"]', wait);
    await page.focus('#ri-opacity');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(
      () => document.querySelector('#ri-opacity')?.value === '99',
      wait,
    );
    const comparison = await settle();
    const moved = populated.blocks.flatMap((before, index) => {
      const after = comparison.blocks[index];
      return JSON.stringify(before) === JSON.stringify(after)
        ? []
        : [{ before, after }];
    });
    if (moved.length)
      throw new Error(
        `Imagery controls moved in comparison mode: ${JSON.stringify(moved)}`,
      );
    await capture('comparison', width, height, comparison);
    await page.focus('#ri-opacity');
    await page.keyboard.press('End');
    await page.click(`${body} .rail-card-header`);
    await page.waitForSelector(
      `${body} .rail-card-header[aria-expanded="true"]`,
      seen,
    );
    await capture('details', width, height, await settle());
    await page.click(`${body} .rail-card-header`);
    await page.click('#ri-mode [data-mode="image"]');
    await page.click(action('clear'));
    await page.waitForSelector('#ri-strip .ri-strip-empty:not([hidden])', seen);
  }
  await setEnabled(false);
  await page.waitForSelector(`${panel}[hidden]`, wait);
  const replies = report.transport.imageryReplies ?? {};
  if (filled && (!replies.catalog || !replies.thumbnail))
    report.errors.push(
      'Recent imagery did not use the local catalog and thumbnail fixtures',
    );
  if (!filled && Object.keys(replies).length)
    report.errors.push('Recent imagery requested provider data without a box');
}
