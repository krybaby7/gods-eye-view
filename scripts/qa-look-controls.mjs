import fs from 'node:fs/promises';
import path from 'node:path';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';

const tools = '#frame-menu-tools';
const layers = '#data-panel';
const route = '[data-layer-id="directions"]';
const card = '#gev-voice-card';

async function measure(page, selector) {
  return page.$eval(selector, (target) => {
    const rect = (element) => element?.getBoundingClientRect().toJSON();
    const style = getComputedStyle(target);
    return {
      box: rect(target),
      globe: rect(document.getElementById('cesiumContainer')),
      credits: rect(document.getElementById('cesium-credits')),
      backdrop: style.backdropFilter,
      background: style.backgroundColor,
      text: style.fontSize,
    };
  });
}

function contain(outer, inner) {
  return (
    inner.left >= outer.left - 1 &&
    inner.right <= outer.right + 1 &&
    inner.top >= outer.top - 1 &&
    inner.bottom <= outer.bottom + 1
  );
}

async function showVoiceFixture(page) {
  await page.evaluate(async () => {
    const { createVoiceControl } = await import('/src/voice/control.js');
    const { VoiceCardControls } = await import('/src/voice/voiceCard.js');
    const { root } = createVoiceControl();
    const voice = new VoiceCardControls({ root, idleMs: 60000 });
    window.lookQa.voice = voice;
    voice.handle({ type: 'interruption' });
    voice.handle({
      type: 'transcript',
      role: 'user',
      text: 'Show me the Texas State Capitol.',
      final: true,
    });
    voice.handle({
      type: 'transcript',
      role: 'assistant',
      text: 'I found the Texas State Capitol in Austin.',
      final: true,
    });
    voice.handle({
      type: 'action-call',
      name: 'annotate_map',
      callId: 'controls-fixture',
      arguments: { annotations: [{ target: 'Texas State Capitol' }] },
    });
    voice.handle({
      type: 'action-result',
      name: 'annotate_map',
      callId: 'controls-fixture',
      result: {
        ok: true,
        display: {
          title: 'Marked 1 place',
          lines: ['Texas State Capitol'],
          sources: [{ label: 'OpenStreetMap' }],
        },
      },
    });
  });
}

export async function captureControls({
  page,
  options,
  out,
  report,
  markFrameStage,
  viewports,
  wait,
}) {
  const visible = { ...wait, visible: true };

  for (const [width, height] of viewports) {
    await markFrameStage(`${width}x${height} shared controls`);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    async function capture(view, selector) {
      await page.waitForSelector(selector, visible);
      let last;
      let stable = 0;
      let data;
      for (let attempt = 0; attempt < 40 && stable < 3; attempt++) {
        data = await measure(page, selector);
        const sample = JSON.stringify(data);
        stable = sample === last ? stable + 1 : 1;
        last = sample;
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      const errors = [];
      if (stable < 3) errors.push('control box did not settle');
      if (!contain(data.globe, data.box))
        errors.push('control box lies outside the globe');
      if (data.credits?.height && data.box.bottom > data.credits.top)
        errors.push('control box reaches the attribution line');
      if (options.label === 'after' && data.backdrop !== 'none')
        errors.push('surface uses a blurred backdrop');
      const stem = `${options.label}-${width}x${height}-controls-${view}`;
      const full = path.join(out, `${stem}.png`);
      const crop = path.join(out, `${stem}-crop.png`);
      await captureLookImage(page, full, crop, data.box, { width, height });
      await fs.writeFile(
        path.join(out, `${stem}.json`),
        JSON.stringify({ ...data, errors }, null, 2),
      );
      report.cases.push({
        panel: 'controls',
        view,
        width,
        height,
        full,
        crop,
        errors,
      });
      report.errors.push(...errors.map((message) => `${stem}: ${message}`));
    }

    await page.click('#frame-menu');
    await page.click('#frame-menu-item-tools');
    await page.$eval('#draw-mode-row', (row) =>
      row.scrollIntoView({ block: 'center' }),
    );
    await page.click('#draw-mode-row [data-shape="pin"]');
    await page.waitForSelector(
      '#draw-mode-row [data-shape="pin"][aria-checked="true"]',
      wait,
    );
    await capture('draw', tools);
    await page.$eval('#scene-panel', (panel) =>
      panel.scrollIntoView({ block: 'end' }),
    );
    await capture('scenes', tools);
    await page.click(`${tools} [data-menu-close]`);

    await page.click('#frame-layers');
    await page.$eval(route, (row) => row.scrollIntoView({ block: 'center' }));
    await page.click(`${route} [role="switch"]`);
    await page.waitForSelector(`${route} [data-chip-id="set-a"]`, visible);
    await page.$eval(route, (row) => row.scrollIntoView({ block: 'center' }));
    await capture('directions', layers);
    await page.click(`${route} [role="switch"]`);
    await page.click('#layers-menu-close');

    await showVoiceFixture(page);
    await capture('voice', card);
    await page.click('#gev-voice-card-dismiss');
    await page.waitForSelector(`${card}[hidden]`, wait);
    await page.evaluate(() => window.lookQa.voice.destroy());
  }
}
