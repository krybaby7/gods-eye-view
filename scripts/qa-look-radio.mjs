import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { collisions } from '../src/tooling/qaLook.mjs';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';

const stations = [
  ['1', 'Fixture Jazz', 'music,jazz', 21.5, 81.6],
  ['2', 'Fixture News', 'news', 22.0, 82.6],
  ['3', 'Fixture Weather', 'weather', 22.3, 83.7],
].map(([suffix, name, tags, lat, lon]) => ({
  id: `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
  name,
  tags: tags.split(','),
  lat,
  lon,
  streamUrl: `https://audio.example.test/${suffix}.mp3`,
  country: 'India',
  countryCode: 'IN',
  state: 'Chhattisgarh',
  metadataTrust: 'untrusted-community',
  codec: 'MP3',
  bitrate: 128,
}));

export function radioFixture(state) {
  return (url) =>
    url.pathname === '/api/radio/stations'
      ? {
          stations: state === 'filled' ? stations : [],
          updatedAt: new Date().toISOString(),
          stale: false,
          degraded: false,
          acceptedGeneration: 1,
          catalogInstance: 'one-look-radio',
        }
      : null;
}

function measure(selector) {
  const target = document.querySelector(selector);
  const radio = window.__godsEyeView.dataManager.layers.get('radio').module;
  const { audioState, stationCount, selected } = radio.getUIState();
  const box = (node) => {
    const { left, right, top, bottom } = node.getBoundingClientRect();
    const ancestors = [];
    for (let p = node.parentElement; p; p = p.parentElement)
      if (p.id) ancestors.push(p.id);
    return { elementId: node.id, left, right, top, bottom, ancestors };
  };
  const visible = (node) =>
    node.getClientRects().length > 0 &&
    getComputedStyle(node).visibility === 'visible';
  const raw = box(target);
  const crop = { ...raw };
  for (let p = target.parentElement; p; p = p.parentElement) {
    const css = getComputedStyle(p);
    const clip = box(p);
    if (['auto', 'scroll', 'hidden', 'clip'].includes(css.overflowX)) {
      crop.left = Math.max(crop.left, clip.left);
      crop.right = Math.min(crop.right, clip.right);
    }
    if (['auto', 'scroll', 'hidden', 'clip'].includes(css.overflowY)) {
      crop.top = Math.max(crop.top, clip.top);
      crop.bottom = Math.min(crop.bottom, clip.bottom);
    }
  }
  const frameSelector =
    '#frame-top, #frame-bottom, #frame-today, #frame-rail, #frame-sheet';
  const panelSelector =
    '#right-context-rail > [data-panel-id], #data-panel, #command-dock';
  const boxes = (query) =>
    [...document.querySelectorAll(query)].filter(visible).map(box);
  const filter = document.querySelector('#radio-filter');
  const sdr = document.querySelector('#sdr-connection-state');
  return {
    frames: boxes(frameSelector),
    panels: boxes(panelSelector),
    target: raw,
    crop,
    contextExpanded: !document
      .querySelector('#global-context-panel')
      .classList.contains('collapsed'),
    compactExpanded:
      document
        .querySelector('#context-radio-toggle-btn')
        .getAttribute('aria-expanded') === 'true',
    tunerVisible: visible(document.querySelector('#radio-tuner')),
    sdrActive: sdr.classList.contains('active'),
    sdrStatus: sdr.textContent.trim(),
    audioState,
    stationCount,
    station: selected?.name ?? null,
    filterColors: [...filter.options].map((option) => ({
      category: option.value,
      color: getComputedStyle(option).color,
    })),
    figure: getComputedStyle(
      target.querySelector('.gev-slider-value') ??
        document.querySelector('#radio-volume-value'),
    ).fontSize,
  };
}

export async function captureRadio({
  page,
  options,
  out,
  report,
  markFrameStage,
  viewports,
}) {
  const wait = { timeout: 30000, polling: 125 };
  const context = '#global-context-panel';
  const compact = '#context-radio-mini';
  const radio = '#radio-panel';
  const sdr = '#sdr-radio-card';
  const filled = options.state === 'filled';
  const disclosure = '[data-collapse-target="global-context-panel"]';

  async function capture(width, height, view, selector) {
    await markFrameStage(`${width}x${height} radio ${view}`);
    let prior;
    let stable = 0;
    let evidence;
    for (let i = 0; i < 40 && stable < 3; i++) {
      evidence = await page.evaluate(measure, selector);
      const sample = JSON.stringify(evidence);
      stable = sample === prior ? stable + 1 : 1;
      prior = sample;
      if (stable < 3) await pause(100);
    }
    if (stable < 3) throw new Error(`Radio ${view} geometry did not settle`);

    const { crop, frames, panels, target } = evidence;
    const overlaps = collisions(frames, [...panels, crop]).filter(({ a, b }) =>
      [a.elementId, b.elementId].includes(target.elementId),
    );
    const errors = [];
    if (overlaps.length) errors.push('overlaps a frame or another panel');
    if (crop.right <= crop.left || crop.bottom <= crop.top)
      errors.push('target is fully clipped');
    if (view === 'compact') {
      if (evidence.contextExpanded || !evidence.compactExpanded)
        errors.push('compact player did not open independently');
      if (crop.bottom < target.bottom - 1 || crop.top > target.top + 1)
        errors.push('compact player is clipped');
    }
    if (view === 'detailed' && evidence.tunerVisible !== filled)
      errors.push('tuner does not reflect station availability');
    if (view === 'idle-sdr' && evidence.sdrActive)
      errors.push('SDR receiver should be idle');
    if (evidence.audioState !== 'stopped')
      errors.push('audio started without a play action');
    if (filled && evidence.stationCount !== stations.length)
      errors.push('station catalog did not load through the fixture');
    if (options.label === 'after' && evidence.figure !== '12px')
      errors.push('volume figures must render at 12px');

    const stem = `${options.label}-${options.state}-${width}x${height}-${view}`;
    const screenshot = path.join(out, `${stem}.png`);
    const cropFile = path.join(out, `${stem}-crop.png`);
    const pixels = await captureLookImage(page, screenshot, cropFile, crop, {
      width,
      height,
    });
    const result = {
      width,
      height,
      view,
      ...evidence,
      pixels,
      collisions: options.label === 'after' ? overlaps : [],
      ...(options.label === 'before' ? { baselineFindings: errors } : {}),
      ...(options.label === 'after' && errors.length
        ? { error: errors.join('; ') }
        : {}),
    };
    report.cases.push(result);
    await fs.writeFile(
      path.join(out, `${stem}.json`),
      JSON.stringify(result, null, 2),
    );
  }

  for (const [width, height] of viewports) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    if (!(await page.$(`${context}.collapsed`))) await page.click(disclosure);
    await page.waitForSelector(`${context}.collapsed`, wait);
    await page.click('#context-radio-toggle-btn');
    await page.waitForSelector(compact, { ...wait, visible: true });
    if (filled && !report.transport.radioReplies) {
      await page.click('#context-radio-mini-enable-btn');
      await page.waitForFunction(
        (count) =>
          window.__godsEyeView.dataManager.layers
            .get('radio')
            .module.getUIState().stationCount === count &&
          !document.querySelector('#context-radio-mini-next-btn').disabled,
        wait,
        stations.length,
      );
      await page.click('#context-radio-mini-next-btn');
      await page.waitForFunction(
        () =>
          window.__godsEyeView.dataManager.layers
            .get('radio')
            .module.getUIState().selected,
        wait,
      );
    }
    await capture(width, height, 'compact', compact);
    await page.click('#context-radio-details-btn');
    await page.waitForSelector(`${radio}:not(.collapsed)`, {
      ...wait,
      visible: true,
    });
    await page.$eval(radio, (node) => node.scrollIntoView({ block: 'start' }));
    await capture(width, height, 'detailed', radio);
    await page.$eval(sdr, (node) => node.scrollIntoView({ block: 'end' }));
    await capture(width, height, 'idle-sdr', sdr);
  }
}
