import assert from 'node:assert/strict';
import path from 'node:path';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';

const launcher = '#first-run-launcher';
const titleSelector = '#first-run-title';
const skipSelector = '[data-first-run-skip]';
const nextSelector = '[data-first-run-next]';
const backSelector = '[data-first-run-back]';
const tourMenuSelector = '#frame-menu-item-tour';
const steps = ['Today', 'Find a country', 'Country sheet', 'Menu'];
const viewports = [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
];

function measure(dialog) {
  const description = dialog.querySelector('#first-run-description');
  const buttons = [...dialog.querySelectorAll('button:not([hidden])')];
  return {
    box: dialog.getBoundingClientRect().toJSON(),
    description: {
      rect: description.getBoundingClientRect().toJSON(),
      size: Number.parseFloat(getComputedStyle(description).fontSize),
    },
    controls: buttons.map((button) => button.getBoundingClientRect().toJSON()),
    accessible:
      dialog.getAttribute('role') === 'dialog' &&
      dialog.querySelector('#' + dialog.getAttribute('aria-labelledby'))
        ?.textContent.trim().length > 0,
    horizontalOverflow: dialog.scrollWidth > dialog.clientWidth + 1,
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
  verifyWelcomeReload,
}) {
  const original = page.viewport();
  const focus = () => page.evaluate(() => document.activeElement.id);
  const hasFocus = (selector) =>
    page.evaluate((selector) => document.activeElement.matches(selector), selector);
  const read = (selector) => page.$eval(selector, (node) => node.textContent.trim());
  const visible = () =>
    page.waitForSelector(`${launcher}:not([hidden])`, { ...wait, visible: true });
  const hidden = () =>
    page.waitForSelector(`${launcher}[hidden]`, wait);
  const verifyStep = async (index) => {
    assert.equal(await read(titleSelector), steps[index]);
    assert.equal(await read('#first-run-progress'), `${index + 1} of ${steps.length}`);
    assert.equal(await focus(), 'first-run-title');
  };

  async function capture(state) {
    for (const [width, height] of viewports) {
      const stem = `${options.label}-${width}x${height}-${state}`;
      await markFrameStage(stem);
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      const layout = await page.$eval(launcher, measure);
      const viewport = { left: 0, top: 0, right: width, bottom: height };
      assert.ok(inside(viewport, layout.box), `${stem}: dialog clips the viewport`);
      assert.ok(!layout.horizontalOverflow, `${stem}: horizontal overflow`);
      assert.ok(layout.accessible, `${stem}: missing dialog name`);
      assert.ok(layout.description.size >= 13, `${stem}: small reading text`);
      assert.ok(inside(layout.box, layout.description.rect), `${stem}: hidden description`);
      for (const control of layout.controls)
        assert.ok(inside(layout.box, control), `${stem}: clipped control`);
      const full = path.join(out, `${stem}.png`);
      const crop = path.join(out, `${stem}-crop.png`);
      await captureLookImage(page, full, crop, layout.box, { width, height });
      report.cases.push({ panel: 'welcome', state, width, height, full, crop });
      console.log(`[PASS] ${stem}: visible, named dialog and readable controls`);
    }
  }

  await visible();
  const accessible = await page.accessibility.snapshot({
    root: await page.$(launcher),
    interestingOnly: false,
  });
  assert.equal(accessible?.role, 'dialog');
  assert.equal(accessible.name, await read(titleSelector));
  assert.ok(await hasFocus(nextSelector), 'welcome focuses Start tour');
  await capture('welcome');

  await page.keyboard.press('Enter');
  for (const [index] of steps.entries()) {
    await verifyStep(index);
    if (index === 1) {
      await page.click(backSelector);
      await verifyStep(0);
      await page.click(nextSelector);
      await verifyStep(index);
    }
    await capture(`tour-${index + 1}`);
    await page.click(nextSelector);
  }
  await hidden();
  assert.equal(await page.evaluate(() => localStorage.getItem('gev:first-run-tour:v1')), 'seen');
  console.log('[PASS] four steps, Back and Finish remember the tour');

  await page.click('#frame-menu');
  await page.keyboard.press('End');
  assert.equal(await focus(), 'frame-menu-item-tour');
  await page.keyboard.press('Enter');
  await visible();
  await verifyStep(0);
  assert.equal(await page.$eval('#frame-menu-list', (node) => node.hidden), true);
  await page.keyboard.press('Escape');
  await hidden();
  assert.equal(await focus(), 'frame-menu');

  await page.click('#frame-menu');
  await page.click(tourMenuSelector);
  await visible();
  await page.click(skipSelector);
  await hidden();
  assert.equal(await focus(), 'frame-menu');
  console.log('[PASS] keyboard replay, Escape, quiet Skip and return focus');

  await verifyWelcomeReload();
  console.log('[PASS] a returning tab keeps welcome hidden and offers Menu replay');
  await page.setViewport(original);
}
