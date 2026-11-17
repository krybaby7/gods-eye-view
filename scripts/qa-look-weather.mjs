import fs from 'node:fs/promises';
import path from 'node:path';
import { captureStateFailures } from '../src/tooling/qaLook.mjs';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';
import {
  measureWeather,
  weatherFailures,
  weatherTimelineCaptureDelta,
} from '../src/tooling/qaLookWeather.mjs';
import {
  WEATHER_LOOK_IDS,
  WEATHER_LOOK_TIMES,
} from './qa-look-weather.fixtures.mjs';

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
  report,
  proxy,
  markFrameStage,
  viewports,
}) {
  const filled = options.state === 'filled';
  const active = filled ? WEATHER_LOOK_IDS : WEATHER_LOOK_IDS.slice(0, 1);
  const observed = active.filter((id) => id !== 'wind');
  let [width, height] = viewports[0];
  const stage = (next) => markFrameStage(`${width}x${height} weather ${next}`);
  const errors = [];
  const interactions = {};
  const recordCheck = (condition, message) => {
    if (!condition) errors.push(`${width}x${height} weather: ${message}`);
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
      const expected = WEATHER_LOOK_TIMES.latest[id];
      if (filled && enabled && expected) await loaded({ [id]: expected });
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
    recordCheck(returned, 'Escape did not return focus to Layers');
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

  async function loaded(times) {
    const diagnostics = (ids) => {
      const manager = window.__godsEyeView.dataManager;
      return Object.fromEntries(
        ids.map((id) => [id, manager.layers.get(id).module.getDiagnostics()]),
      );
    };
    try {
      const handle = await page.waitForFunction(
        (times) => {
          const manager = window.__godsEyeView.dataManager;
          return Object.entries(times).every(([id, expected]) => {
            const { loading, time } = manager.layers
              .get(id)
              .module.getDiagnostics();
            return !loading && time === expected;
          });
        },
        { ...optionsForWait, timeout: 75000 },
        times,
      );
      await handle.dispose();
    } catch (error) {
      const actual = await page.evaluate(diagnostics, Object.keys(times));
      throw new Error(
        `Observation frames did not settle to ${JSON.stringify(times)}: ${JSON.stringify(actual)}`,
        { cause: error },
      );
    }
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
      WEATHER_LOOK_TIMES,
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
    for (const key of ['target', 'header', 'body'])
      if (JSON.stringify(data[key]) !== JSON.stringify(after[key]))
        issues.push(`Weather ${key} changed during capture`);
    // A periodic refresh may advance the history age during the screenshot.
    // Keep both raw snapshots while checking that only that elapsed age advanced.
    const timelineDelta = weatherTimelineCaptureDelta(
      data.timeline,
      after.timeline,
    );
    if (timelineDelta) {
      data.timelineAfterCapture = after.timeline;
      data.timelineCaptureDelta = timelineDelta;
      if (!timelineDelta.elapsedAgeRefresh)
        issues.push(
          `Weather timeline changed during capture: ${timelineDelta.changed.join(', ')}`,
        );
    }
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

  async function adjustViewport([nextWidth, nextHeight]) {
    width = nextWidth;
    height = nextHeight;
    await stage('viewport');
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
  }

  async function exerciseDisclosure(interactions) {
    await stage('mounted rail');
    await page.waitForSelector(`${panel}:not([hidden])`, seen);
    if (await page.$(`${panel}.collapsed`)) await page.click(disclosure);
    await page.waitForSelector(`${panel}:not(.collapsed) ${body}`, seen);
    await stage('collapse and reopen');
    await page.focus(disclosure);
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${panel}.collapsed`, seen);
    const collapsed = await inspect();
    interactions.collapseHidBody = !collapsed.weather.bodyVisible;
    recordCheck(
      interactions.collapseHidBody,
      'Weather body remains visible when collapsed',
    );
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${panel}:not(.collapsed) ${body}`, seen);
    interactions.disclosureFocused = await page.$eval(
      disclosure,
      (button) => button === document.activeElement,
    );
    recordCheck(
      interactions.disclosureFocused,
      'Weather disclosure lost keyboard focus',
    );
  }

  async function captureLatest(interactions) {
    await stage('populated products');
    const wind = card('wind');
    const forecastFocus = await openCard('wind');
    const motion = `${wind} [data-chip-id="motion"]`;
    if (await page.$(`${motion}[aria-pressed="false"]`))
      await page.click(motion);
    // A parked flow keeps the forecast field readable and prevents wind
    // animation from driving continuous SwiftShader renders in this journey.
    await page.waitForSelector(`${motion}[aria-pressed="true"]`, seen);
    interactions.windMotionPaused = true;
    await loaded(WEATHER_LOOK_TIMES.latest);
    await page.waitForFunction(
      (selector) => {
        const input = document.querySelector(selector);
        return input && !input.disabled && Number(input.max) === 5;
      },
      optionsForWait,
      slider,
    );
    interactions.forecastFocus = forecastFocus;
    recordCheck(
      forecastFocus.focused &&
        forecastFocus.focusVisible &&
        forecastFocus.outline !== 'none',
      'Wind card lacks a visible keyboard focus indicator',
    );
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
    recordCheck(
      interactions.windReading === '26.2 km/h from WSW',
      'Map-center reading did not use the fixture vectors',
    );
    await capture('latest', {
      interactions: { ...interactions },
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
      recordCheck(
        JSON.stringify(scrollBefore.frames) === JSON.stringify(after.frames),
        'Weather wheel moved frame geometry',
      );
      recordCheck(
        JSON.stringify(scrollBefore.target) === JSON.stringify(after.target),
        'Weather wheel moved the whole panel',
      );
    }
  }

  async function enterHistory() {
    await stage('play and step observed clock');
    await page.click(play);
    await page.waitForSelector(`${play}[aria-pressed="true"]`, seen);
    await page.click(play);
    await page.waitForSelector(`${play}[aria-pressed="false"]`, seen);
    interactions.clockPlayedAndPaused = true;
    await page.click(latest);
    await loaded(WEATHER_LOOK_TIMES.latest);
    await page.click(earlier);
    await page.waitForFunction(
      (selector) =>
        document.querySelector(selector)?.getAttribute('aria-pressed') ===
        'false',
      optionsForWait,
      latest,
    );
    await loaded(WEATHER_LOOK_TIMES.history);
  }

  async function captureHistory(interactions, latestIndex) {
    const observedFocus = await openCard('weather-radar');
    const observedState = await inspect();
    interactions.observedFocus = observedFocus;
    interactions.observedHistory = observedState.cards.find(
      ({ id }) => id === 'weather-radar',
    );
    recordCheck(
      observedFocus.focused &&
        observedFocus.focusVisible &&
        observedFocus.outline !== 'none',
      'Radar card lacks a visible keyboard focus indicator',
    );
    recordCheck(
      interactions.observedHistory?.observed &&
        interactions.observedHistory?.open &&
        /synced|nearest/i.test(interactions.observedHistory.lines.time ?? ''),
      'Radar did not render an observed history frame',
    );
    await capture('observed', {
      interactions: { observedFocus },
    });
    await openCard('wind');
    const history = await inspect();
    interactions.historyIndexChanged =
      history.timeline.index === latestIndex - 1;
    recordCheck(
      interactions.historyIndexChanged,
      'Earlier observation did not change the range index',
    );
    await capture('history', {
      interactions: {
        ...interactions,
        clockPlayedAndPaused: true,
      },
    });
  }

  await adjustViewport(viewports[0]);
  await switchLayers(active, true);
  const disclosureBySize = new Map();
  for (const viewport of viewports) {
    await adjustViewport(viewport);
    const details = {};
    await exerciseDisclosure(details);
    if (filled) {
      await captureLatest(details);
    } else {
      await stage('unavailable response');
      await page.waitForFunction(
        () =>
          /source unavailable/i.test(
            document.querySelector('#weather-panel [data-line-id="status"]')
              ?.textContent ?? '',
          ),
        optionsForWait,
      );
      await capture('unavailable', { interactions: details });
    }
    disclosureBySize.set(width, details);
  }

  if (filled) {
    // Change the observation clock on the smallest viewport. Wait for both
    // real frames to settle before resizing the same, already loaded scene.
    await adjustViewport(viewports[0]);
    const latestIndex = (await inspect()).timeline.index;
    await enterHistory();
    for (const viewport of viewports) {
      await adjustViewport(viewport);
      await captureHistory(disclosureBySize.get(width), latestIndex);
    }
    await adjustViewport(viewports[0]);
    await stage('return to latest');
    await page.click(latest);
    await page.waitForSelector(`${latest}[aria-pressed="true"]`, seen);
    await loaded(WEATHER_LOOK_TIMES.latest);
  }
  await switchLayers([...active].reverse(), false);
  await stage('inactive after switching off');
  await page.waitForSelector(`${panel}[hidden]`, optionsForWait);

  if (filled) {
    const latestFrames = report.cases.filter((item) => item.view === 'latest');
    const smallest = latestFrames.find(
      (item) => item.width === viewports[0][0],
    );
    recordCheck(
      smallest?.inspectionMarker?.overWeather,
      'Smallest viewport did not exercise marker overlap with Weather',
    );
    recordCheck(
      latestFrames.some(
        (item) =>
          item.width > viewports[0][0] && item.inspectionMarker?.globeExposed,
      ),
      'No wider viewport exercised the marker over the exposed globe',
    );
  }
  const replies = report.transport.weatherReplies ?? {};
  const consumed = (key) => replies[key] ?? 0;
  recordCheck(
    consumed('/api/weather/manifest') >= observed.length,
    'Observed products did not request their local manifests',
  );
  if (filled) {
    recordCheck(
      consumed('/api/wind/manifest') >= 2 &&
        consumed('/api/wind/grid/gfs-look.bin') >= 2,
      'Wind and temperature did not request their local manifests and grids',
    );
    recordCheck(
      (replies['/api/weather/tile'] ?? 0) +
        (replies['/api/weather/image'] ?? 0) >
        0,
      'Observed imagery did not use the local fixture transport',
    );
  } else {
    recordCheck(
      !replies['/api/weather/tile'] && !replies['/api/weather/image'],
      'Unavailable Weather fabricated imagery requests',
    );
  }
  const blockedWeather = (report.transport.suppressedApis ?? []).filter((url) =>
    /^\/api\/(weather|wind)(\/|$)/.test(url),
  );
  recordCheck(
    !blockedWeather.length,
    `Weather requested unexpected provider paths: ${[...new Set(blockedWeather)].join(', ')}`,
  );
  recordCheck(
    !Object.keys(proxy.totals.deniedTargets).some(
      (target) =>
        new URL(target, options.url.origin).origin === options.url.origin &&
        /^\/api\/(weather|wind)(\/|$)/.test(
          new URL(target, options.url.origin).pathname,
        ),
    ),
    'A Weather provider request escaped CDP interception',
  );
  for (const viewport of viewports) {
    await adjustViewport(viewport);
    await capture('inactive', { interactions });
  }
  report.errors.push(...errors);
}
