import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { collisions } from '../src/tooling/qaLook.mjs';
import { captureStable } from '../src/tooling/qaLookCapture.mjs';
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
  homepage: null,
  languages: ['English'],
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
  const clipOverflow = new Set(['auto', 'scroll', 'hidden', 'clip']);
  function clipped(node) {
    const rect = box(node);
    rect.left = Math.max(rect.left, 0);
    rect.top = Math.max(rect.top, 0);
    rect.right = Math.min(rect.right, window.innerWidth);
    rect.bottom = Math.min(rect.bottom, window.innerHeight);
    const clips = [];
    for (
      let parent = node.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (!parent.getClientRects().length) continue;
      const css = getComputedStyle(parent);
      const horizontal = clipOverflow.has(css.overflowX);
      const vertical = clipOverflow.has(css.overflowY);
      if (!horizontal && !vertical) continue;
      // Scrollable paint is clipped at the scrollport, not the parent's
      // border box. clientWidth/Height exclude borders and scrollbar gutters.
      const bounds = parent.getBoundingClientRect();
      const left = bounds.left + parent.clientLeft;
      const top = bounds.top + parent.clientTop;
      const right = left + parent.clientWidth;
      const bottom = top + parent.clientHeight;
      if (horizontal) {
        rect.left = Math.max(rect.left, left);
        rect.right = Math.min(rect.right, right);
      }
      if (vertical) {
        rect.top = Math.max(rect.top, top);
        rect.bottom = Math.min(rect.bottom, bottom);
      }
      clips.push({
        id: parent.id || parent.className,
        left,
        top,
        right,
        bottom,
        horizontal,
        vertical,
        scrollLeft: parent.scrollLeft,
        scrollTop: parent.scrollTop,
      });
    }
    return { rect, clips };
  }
  const { rect: crop, clips } = clipped(target);
  const frameSelector =
    '#frame-top, #frame-bottom, #frame-today, #frame-rail, #frame-sheet';
  const panelSelector =
    '#right-context-rail > [data-panel-id], #data-panel, #command-dock';
  const boxes = (query) =>
    [...document.querySelectorAll(query)]
      .filter(visible)
      .map((node) => clipped(node).rect)
      .filter(({ left, right, top, bottom }) => right > left && bottom > top);
  const rail = document.getElementById('right-context-rail');
  const context = document.getElementById('global-context-panel');
  const scroller = context.querySelector('.global-context-panel-inner');
  const filter = document.querySelector('#radio-filter');
  const sdr = document.querySelector('#sdr-connection-state');
  return {
    frames: boxes(frameSelector),
    panels: boxes(panelSelector),
    target: raw,
    crop,
    clips,
    rail: {
      measuring: rail.hasAttribute('data-rail-measuring'),
      allocation: context.style.getPropertyValue(
        '--right-panel-allocated-height',
      ),
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
      bounds: box(scroller),
      transitions: [rail, context, scroller]
        .flatMap((node) => node.getAnimations())
        .filter(
          ({ playState }) => playState === 'pending' || playState === 'running',
        ).length,
    },
    contextExpanded: !context.classList.contains('collapsed'),
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
    const read = () => page.evaluate(measure, selector);
    async function settle() {
      let prior;
      let stable = 0;
      // Allow the delayed rail allocation and disclosure scrolling to settle.
      for (let i = 0; i < 120; i++) {
        const sample = await read();
        const serialized = JSON.stringify(sample);
        stable =
          sample.rail.measuring || sample.rail.transitions
            ? 0
            : serialized === prior
              ? stable + 1
              : 1;
        if (stable === 9) return sample;
        prior = serialized;
        await pause(125);
      }
      throw new Error(`Radio ${view} geometry did not settle`);
    }
    const stem = `${options.label}-${options.state}-${width}x${height}-${view}`;
    const screenshot = path.join(out, `${stem}.png`);
    const cropFile = path.join(out, `${stem}-crop.png`);
    const fullAttempt = path.join(out, `${stem}-attempt.png`);
    const cropAttempt = path.join(out, `${stem}-attempt-crop.png`);
    const discard = () =>
      Promise.all(
        [fullAttempt, cropAttempt].map((file) => fs.rm(file, { force: true })),
      );
    let attempt;
    try {
      attempt = await captureStable({
        settle,
        read,
        key: (data) => data,
        capture: ({ crop }) =>
          captureLookImage(page, fullAttempt, cropAttempt, crop, {
            width,
            height,
          }),
        discard,
      });
    } catch (error) {
      await discard();
      await fs.writeFile(
        path.join(out, `${stem}-capture-attempts.json`),
        JSON.stringify(
          { error: error.message, attempts: error.attempts ?? [] },
          null,
          2,
        ),
      );
      throw error;
    }
    const { before: evidence, value: pixels } = attempt;
    await fs.rename(fullAttempt, screenshot);
    if (pixels) await fs.rename(cropAttempt, cropFile);
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

    if (!pixels) errors.push('target crop has no pixels');
    const result = {
      width,
      height,
      view,
      ...evidence,
      pixels,
      captureAttempts: attempt.attempts,
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
      const selected = await page.evaluate(
        (id) =>
          window.__godsEyeView.dataManager.layers
            .get('radio')
            .module.selectRadioStation(id),
        stations[0].id,
      );
      if (!selected) throw new Error('Could not select a fixture station');
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
