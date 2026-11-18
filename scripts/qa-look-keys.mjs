import fs from 'node:fs/promises';
import path from 'node:path';
import { keySetupStatus } from '../src/keySetupCore.mjs';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';

const dialog = '#key-setup.visible:not([hidden])';

export const keylessFixtures = new Map([
  ['/api/setup/status', keySetupStatus({})],
  [
    '/api/setup/search-agents',
    {
      defaultAgent: 'claude',
      agents: { claude: { installed: false, signedIn: false } },
    },
  ],
  [
    '/api/news/status',
    {
      digest: {
        agent: 'claude',
        agentStatus: { disabledReason: 'Claude Code is not installed' },
      },
      keyConfigured: false,
    },
  ],
]);

export async function verifyKeysQuery(page, wait) {
  await page.waitForSelector(dialog, { ...wait, visible: true });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#key-setup[hidden]', wait);
}

function measureKeys() {
  const panel = document.getElementById('key-setup');
  const globe = document.getElementById('cesiumContainer');
  const scroll = panel.querySelector('.key-setup-body, .key-setup-rows');
  const status = document.querySelector('#intel-hud .hud-status');
  const close = panel.querySelector('[data-key-setup-close]');
  const save = panel.querySelector('[data-key-setup-apply]');
  const rect = (element) => element.getBoundingClientRect().toJSON();
  return {
    box: rect(panel),
    globe: rect(globe),
    status: status && rect(status),
    close: rect(close),
    save: rect(save),
    title: document.getElementById(panel.getAttribute('aria-labelledby'))
      ?.textContent,
    hasRows: !!panel.querySelector('[data-key-id]'),
    hasCloseIcon: !!close.querySelector('svg[aria-hidden="true"]'),
    sourcesVisible:
      getComputedStyle(document.getElementById('frame-menu-sources'))
        .visibility === 'visible',
    scrollable: scroll.scrollHeight > scroll.clientHeight,
    opacity: Number(getComputedStyle(panel).opacity),
  };
}

export async function captureKeys({
  page,
  options,
  out,
  report,
  markFrameStage,
  viewports,
  wait,
}) {
  await page.click('#frame-menu');
  await page.click('#frame-menu-item-sources');
  await page.waitForSelector('#frame-keys-open:not([hidden])', {
    ...wait,
    visible: true,
  });
  await page.click('#frame-keys-open');
  await page.waitForSelector(dialog, { ...wait, visible: true });

  for (const [width, height] of viewports) {
    await markFrameStage(`${width}x${height} keys`);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    let previous;
    let stable = 0;
    let data;
    for (let attempt = 0; attempt < 30 && stable < 3; attempt++) {
      data = await page.evaluate(measureKeys);
      const sample = JSON.stringify(data);
      stable = sample === previous ? stable + 1 : 1;
      previous = sample;
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    const {
      box,
      globe,
      status,
      close,
      save,
      title,
      hasRows,
      hasCloseIcon,
      sourcesVisible,
      scrollable,
      opacity,
    } = data;
    const contain = (outer, inner) =>
      outer.left <= inner.left &&
      outer.top <= inner.top &&
      outer.right >= inner.right &&
      outer.bottom >= inner.bottom;
    const centered =
      Math.abs(box.left + box.right - globe.left - globe.right) <= 2 &&
      Math.abs(box.top + box.bottom - globe.top - globe.bottom) <= 2;
    const stem = `${options.label}-${width}x${height}-keys`;
    const errors = [];
    if (stable < 3 || opacity !== 1) errors.push('dialog did not settle');
    if (options.label === 'after' && (!contain(globe, box) || !centered))
      errors.push('dialog is outside the globe region or off-center');
    if (options.label === 'after' && status?.height && box.bottom > status.top)
      errors.push('dialog overlaps the globe status line');
    if (!contain(box, close) || !contain(box, save))
      errors.push('dialog clips an action');
    if (!hasRows || !scrollable) errors.push('fixture rows cannot scroll');
    if (options.label === 'after' && title !== 'Data sources and keys')
      errors.push('dialog name is incorrect');
    if (options.label === 'after' && sourcesVisible)
      errors.push('source menu is visible behind the dialog');
    if (options.label === 'after' && !hasCloseIcon)
      errors.push('close icon requires a remote font');

    const full = path.join(out, `${stem}.png`);
    const crop = path.join(out, `${stem}-crop.png`);
    await captureLookImage(page, full, crop, box, { width, height });
    await fs.writeFile(
      path.join(out, `${stem}.json`),
      JSON.stringify({ ...data, errors }, null, 2),
    );
    report.cases.push({ panel: 'keys', width, height, full, crop, errors });
    report.errors.push(...errors.map((message) => `${stem}: ${message}`));
  }
  if (options.label === 'after') {
    await page.click('#key-setup [data-key-setup-close]');
    await page.waitForSelector('#key-setup[hidden]', wait);
    const returned = await page.evaluate(
      () => document.activeElement?.id === 'frame-keys-open',
    );
    if (!returned)
      report.errors.push('focus did not return to Open provider keys');
  }
}
