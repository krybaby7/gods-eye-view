import fs from 'node:fs/promises';
import path from 'node:path';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';

const launcher = '#first-run-launcher';
const choiceIds = ['contacts', 'space-missions', 'environmental', 'explore'];

function measure(target) {
  const list = target.querySelector('.first-run-choices');
  const description = target.querySelector('#first-run-description');
  const suppress = target.querySelector('[data-first-run-suppress]');
  const tip = target.querySelector('[data-first-run-status]');
  const buttons = [...list.querySelectorAll('[data-first-run-choice]')];
  const rect = (element) => element.getBoundingClientRect().toJSON();
  const style = getComputedStyle(target);
  return {
    box: rect(target),
    description: rect(description),
    suppress: rect(suppress),
    tip: rect(tip),
    choices: buttons.map(({ dataset }) => dataset.firstRunChoice),
    smallText: buttons.map((button) =>
      Number.parseFloat(
        getComputedStyle(button.querySelector('small')).fontSize,
      ),
    ),
    icons: buttons.filter((button) =>
      button.querySelector('svg[aria-hidden="true"]'),
    ).length,
    masking: list.dataset.scrollable === 'true',
    scrollable: list.scrollHeight > list.clientHeight + 1,
    focused: target.contains(document.activeElement),
    tipText: tip.textContent.trim(),
    opacity: Number(style.opacity),
    background: style.backgroundColor,
  };
}

function inside(outer, inner) {
  return (
    inner.left >= outer.left - 1 &&
    inner.right <= outer.right + 1 &&
    inner.top >= outer.top - 1 &&
    inner.bottom <= outer.bottom + 1
  );
}

export async function captureWelcome({
  page,
  options,
  out,
  report,
  markFrameStage,
  wait,
}) {
  const original = page.viewport();
  const viewports = [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
    [390, 844],
    [667, 390],
  ];
  await page.waitForSelector(`${launcher}.visible:not([hidden])`, {
    ...wait,
    visible: true,
  });

  for (const [width, height] of viewports) {
    const stem = `${options.label}-${width}x${height}-welcome`;
    await markFrameStage(stem);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.waitForFunction(
      (selector) =>
        getComputedStyle(document.querySelector(selector)).opacity === '1',
      wait,
      launcher,
    );

    let previous;
    let stable = 0;
    let data;
    for (let attempt = 0; attempt < 40 && stable < 3; attempt++) {
      data = await page.$eval(launcher, measure);
      const sample = JSON.stringify(data);
      stable = previous === sample ? stable + 1 : 1;
      previous = sample;
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    const errors = [];
    const viewport = { left: 0, top: 0, right: width, bottom: height };
    if (stable < 3) errors.push('launcher layout did not settle');
    if (!inside(viewport, data.box)) errors.push('launcher clips the viewport');
    for (const part of ['description', 'suppress', 'tip'])
      if (!inside(data.box, data[part])) errors.push(`launcher clips ${part}`);
    if (data.choices.join(',') !== choiceIds.join(','))
      errors.push('the four mission choices changed');
    if (!data.focused)
      errors.push('opening did not place focus in the launcher');
    if (data.masking !== data.scrollable)
      errors.push('scroll cue disagrees with actual overflow');
    if (options.label === 'after') {
      if (data.icons !== 4)
        errors.push('choice icons require an external font');
      if (data.smallText.some((size) => size < 13))
        errors.push('choice descriptions are below the shared small text size');
      if (!/the microphone in the bottom bar/i.test(data.tipText))
        errors.push('the tip does not point to the current microphone');
    }
    const full = path.join(out, `${stem}.png`);
    const crop = path.join(out, `${stem}-crop.png`);
    await captureLookImage(page, full, crop, data.box, { width, height });
    await fs.writeFile(
      path.join(out, `${stem}.json`),
      JSON.stringify({ ...data, errors }, null, 2),
    );
    report.cases.push({ panel: 'welcome', width, height, full, crop, errors });
    report.errors.push(...errors.map((message) => `${stem}: ${message}`));
  }

  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (selector) => !document.querySelector(`${selector}.visible`),
    wait,
    launcher,
  );
  await page.setViewport(original);
}
