import fs from 'node:fs/promises';
import path from 'node:path';
import { captureStateFailures } from '../src/tooling/qaLook.mjs';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';
import {
  measureWeather,
  weatherFailures,
} from '../src/tooling/qaLookWeather.mjs';
import { WEATHER_LOOK_IDS } from './qa-look-weather.fixtures.mjs';

const panel = '#weather-panel';
const disclosure = '[data-collapse-target="weather-panel"]';
const body = '#weather-panel-body';
const slider = '#weather-panel .weather-timeline';
const latest = '#weather-panel [title="Newest frame per product"]';
const earlier = '#weather-panel [title="Earlier observation"]';
const play = '#weather-panel [title="Replay observed history"]';
const card = (id) => `${panel} [data-card-id="${id}"]`;
const optionsForWait = { timeout: 30000, polling: 125 };
const seen = { ...optionsForWait, visible: true };

export async function captureWeather({
  page,
  options,
  out,
  width,
  height,
  report,
  proxy,
  markFrameStage,
}) {
  const filled = options.state === 'filled';
  const active = filled ? WEATHER_LOOK_IDS : WEATHER_LOOK_IDS.slice(0, 1);
  const observed = active.filter((id) => id !== 'wind');
  const phase = `${width}x${height} weather`;
  const stage = (next) => markFrameStage(`${phase} ${next}`);
  const errors = [];
  const interactions = {};
  const transportAtStart = { ...report.transport.weatherReplies };
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const inspect = () => page.evaluate(measureWeather);

  async function switchLayers(ids, enabled) {
    await stage(enabled ? 'enable layers' : 'disable layers');
    await page.click('#frame-layers');
    await page.waitForSelector('#data-panel:not(.collapsed)', seen);
    for (const id of ids) {
      const toggle = `#data-panel [data-layer-id="${id}"] .data-toggle-btn`;
      await page.waitForSelector(toggle, seen);
      await page.click(toggle);
      await page.waitForFunction(
        (selector, enabled) =>
          document.querySelector(selector)?.getAttribute('aria-checked') ===
          String(enabled),
        optionsForWait,
        toggle,
        enabled,
      );
    }
    await page.keyboard.press('Escape');
    await page.waitForSelector('#data-panel.collapsed', optionsForWait);
    const returned = await page.$eval(
      '#frame-layers',
      (button) => button === document.activeElement,
    );
    interactions[
      enabled ? 'menuEnableFocusReturned' : 'menuDisableFocusReturned'
    ] = returned;
    require(returned, 'Escape did not return focus to Layers');
  }

  async function openCard(id) {
    const selector = `${card(id)} .rail-card-header`;
    await page.waitForSelector(selector, seen);
    await page.focus(selector);
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${selector}[aria-expanded="true"]`, seen);
    return page.$eval(selector, (button) => ({
      focused: button === document.activeElement,
      focusVisible: button.matches(':focus-visible'),
      outline: getComputedStyle(button).outlineStyle,
      outlineWidth: getComputedStyle(button).outlineWidth,
    }));
  }

  async function loaded(ids) {
    const handle = await page.waitForFunction(
      (ids) => {
        const manager = window.__godsEyeView.dataManager;
        return ids.every((id) => {
          const { loading, time } = manager.layers
            .get(id)
            .module.getDiagnostics();
          return !loading && time;
        });
      },
      optionsForWait,
      ids,
    );
    await handle.dispose();
  }

  async function capture(view, extra = {}) {
    await stage(`${view} evidence`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    const data = await inspect();
    const { failures, legacy, overlaps } = weatherFailures(
      data,
      view,
      view === 'inactive' ? 0 : active.length,
    );
    const issues = [...failures];
    if (options.label === 'after') issues.push(...legacy);
    const stem = `${options.label}-${options.state}-${width}x${height}-weather-${view}`;
    data.cropPixels = await captureLookImage(
      page,
      path.join(out, `${stem}-full.png`),
      path.join(out, `${stem}-crop.png`),
      data.target,
      { width, height },
    );
    if (view !== 'inactive' && !data.cropPixels)
      issues.push('Weather rail has no pixels inside the screenshot');
    const after = await inspect();
    issues.push(...captureStateFailures(data.frameState, after.frameState));
    for (const key of ['target', 'header', 'body', 'timeline'])
      if (JSON.stringify(data[key]) !== JSON.stringify(after[key]))
        issues.push(`Weather ${key} changed during capture`);
    const evidence = {
      width,
      height,
      panel: 'weather',
      view,
      state: options.state,
      ...data,
      ...extra,
      collisions: overlaps,
      legacyIssues: legacy,
      transport: structuredClone(report.transport),
      ...(issues.length ? { error: issues.join('; ') } : {}),
    };
    report.cases.push(evidence);
    await fs.writeFile(
      path.join(out, `${stem}.json`),
      JSON.stringify(evidence, null, 2),
    );
  }

  await switchLayers(active, true);
  await stage('mounted rail');
  await page.waitForSelector(`${panel}:not([hidden])`, seen);
  if (await page.$(`${panel}.collapsed`)) await page.click(disclosure);
  await page.waitForSelector(`${panel}:not(.collapsed) ${body}`, seen);
  await stage('collapse and reopen');
  await page.focus(disclosure);
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${panel}.collapsed`, seen);
  interactions.collapsed = await inspect();
  require(!interactions.collapsed.weather
    .bodyVisible, 'Weather body remains visible when collapsed');
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${panel}:not(.collapsed) ${body}`, seen);
  interactions.disclosureFocused = await page.$eval(
    disclosure,
    (button) => button === document.activeElement,
  );
  require(interactions.disclosureFocused, 'Weather disclosure lost keyboard focus');

  if (!filled) {
    await stage('unavailable response');
    await page.waitForFunction(
      () =>
        /source unavailable/i.test(
          document.querySelector('#weather-panel [data-line-id="status"]')
            ?.textContent ?? '',
        ),
      optionsForWait,
    );
    await capture('unavailable');
  } else {
    await stage('populated products');
    await loaded(observed);
    await page.waitForFunction(
      (selector) => {
        const input = document.querySelector(selector);
        return input && !input.disabled && Number(input.max) === 5;
      },
      optionsForWait,
      slider,
    );
    const wind = card('wind');
    const forecastFocus = await openCard('wind');
    interactions.forecastFocus = forecastFocus;
    require(forecastFocus.focused &&
      forecastFocus.focusVisible &&
      forecastFocus.outline !==
        'none', 'Wind card lacks a visible keyboard focus indicator');
    await stage('temperature and map-center reading');
    await page.click(`${wind} [data-chip-id="overlay-temperature"]`);
    const readAction = `${wind} [data-action-id="read-wind"]:not(:disabled)`;
    await page.waitForSelector(`${wind} .rail-card-zero:not([hidden])`, seen);
    await page.waitForSelector(readAction, seen);
    await page.click(readAction);
    await page.waitForSelector(`${wind} [data-line-id="wind"]`, seen);
    interactions.windReading = await page.$eval(
      `${wind} [data-line-id="wind"]`,
      (line) => line.textContent.trim(),
    );
    const latestState = await inspect();
    await capture('latest', {
      interactions: { forecastFocus, windReading: interactions.windReading },
    });

    const scrollBefore = await inspect();
    if (scrollBefore.scroll.contentHeight > scrollBefore.scroll.height + 1) {
      await stage('wheel within Weather');
      const { left, right, top, bottom } = scrollBefore.body;
      await page.mouse.move((left + right) / 2, (top + bottom) / 2);
      const deltaY = scrollBefore.scroll.top > 10 ? -220 : 220;
      await page.mouse.wheel({ deltaY });
      const handle = await page.waitForFunction(
        (selector, top) =>
          Math.abs(document.querySelector(selector).scrollTop - top) > 1,
        optionsForWait,
        body,
        scrollBefore.scroll.top,
      );
      await handle.dispose();
      const after = await inspect();
      interactions.wheel = {
        from: scrollBefore.scroll.top,
        to: after.scroll.top,
      };
      errors.push(
        ...captureStateFailures(scrollBefore.frameState, after.frameState),
      );
      require(JSON.stringify(scrollBefore.frames) ===
        JSON.stringify(after.frames), 'Weather wheel moved frame geometry');
      require(JSON.stringify(scrollBefore.target) ===
        JSON.stringify(after.target), 'Weather wheel moved the whole panel');
    }

    await stage('play and step observed clock');
    await page.click(play);
    await page.waitForSelector(`${play}[aria-pressed="true"]`, seen);
    await page.click(play);
    await page.waitForSelector(`${play}[aria-pressed="false"]`, seen);
    interactions.clockPlayedAndPaused = true;
    await page.click(latest);
    await page.click(earlier);
    await page.waitForFunction(
      (selector) =>
        document.querySelector(selector)?.getAttribute('aria-pressed') ===
        'false',
      optionsForWait,
      latest,
    );
    const observedFocus = await openCard('weather-radar');
    const observedState = await inspect();
    interactions.observedFocus = observedFocus;
    interactions.observedHistory = observedState.cards.find(
      ({ id }) => id === 'weather-radar',
    );
    require(observedFocus.focused &&
      observedFocus.focusVisible &&
      observedFocus.outline !==
        'none', 'Radar card lacks a visible keyboard focus indicator');
    require(interactions.observedHistory?.observed &&
      interactions.observedHistory?.open &&
      /synced|nearest/i.test(
        interactions.observedHistory.lines.time ?? '',
      ), 'Radar did not render an observed history frame');
    await openCard('wind');
    const history = await inspect();
    interactions.historyIndexChanged =
      history.timeline.index !== latestState.timeline.index;
    require(interactions.historyIndexChanged, 'Earlier observation did not change the range index');
    await capture('history', {
      interactions: { ...interactions, collapsed: undefined },
    });
    await page.click(latest);
    await page.waitForSelector(`${latest}[aria-pressed="true"]`, seen);
    await page.click(`${wind} [data-chip-id="overlay-none"]`);
    await page.waitForFunction(
      (selector) =>
        document.querySelector(selector)?.getAttribute('aria-pressed') ===
        'true',
      optionsForWait,
      `${wind} [data-chip-id="overlay-none"]`,
    );
  }
  await switchLayers([...active].reverse(), false);
  await stage('inactive after switching off');
  await page.waitForSelector(`${panel}[hidden]`, optionsForWait);

  const replies = report.transport.weatherReplies ?? {};
  const consumed = (key) => (replies[key] ?? 0) - (transportAtStart[key] ?? 0);
  require(consumed('/api/weather/manifest') >=
    observed.length, 'Observed products did not request their local manifests');
  if (filled) {
    require(consumed('/api/wind/manifest') >= 2 &&
      consumed('/api/wind/grid/gfs-look.bin') >=
        2, 'Wind and temperature did not request their local manifests and grids');
    require((replies['/api/weather/tile'] ?? 0) +
      (replies['/api/weather/image'] ?? 0) >
      0, 'Observed imagery did not use the local fixture transport');
  } else {
    require(!replies['/api/weather/tile'] &&
      !replies[
        '/api/weather/image'
      ], 'Unavailable Weather fabricated imagery requests');
  }
  const blockedWeather = (report.transport.suppressedApis ?? []).filter((url) =>
    /^\/api\/(weather|wind)(\/|$)/.test(url),
  );
  require(!blockedWeather.length, `Weather requested unexpected provider paths: ${[...new Set(blockedWeather)].join(', ')}`);
  require(!Object.keys(proxy.totals.deniedTargets).some(
    (target) =>
      new URL(target, options.url.origin).origin === options.url.origin &&
      /^\/api\/(weather|wind)(\/|$)/.test(
        new URL(target, options.url.origin).pathname,
      ),
  ), 'A Weather provider request escaped CDP interception');
  await capture('inactive', { interactions });
  for (const error of errors) report.errors.push(`${phase}: ${error}`);
}
