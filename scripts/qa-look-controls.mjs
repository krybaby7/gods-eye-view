import fs from 'node:fs/promises';
import path from 'node:path';
import { captureLookImage } from '../src/tooling/qaLookImage.mjs';

const tools = '#frame-menu-tools';
const layers = '#data-panel';
const route = '[data-layer-id="directions"]';
const card = '#gev-voice-card';
const draw = '#draw-toggle';
const shape = '#draw-mode-row [data-shape="pin"]';
const credits = '#cesium-credits';
const creditLink = `${credits} .cesium-credit-expand-link`;
const creditLightbox = '.cesium-credit-lightbox';
const screenCredit = '[data-look-screen-credit]';
const detailCredit = '[data-look-detail-credit]';
const trafficChip = '#traffic-sync-chip';
const cameraChip = '#cctv-sync-chip';

async function measure(page, selector) {
  return page.$eval(selector, (target) => {
    const rect = (element) => element?.getBoundingClientRect().toJSON();
    const style = getComputedStyle(target);
    const creditRoot = target.closest('#cesium-credits');
    const creditRootBox = rect(creditRoot);
    const targetBox = rect(target);
    const hasBox = (box) => box?.width > 0 && box.height > 0;
    let creditBackground = null;
    if (creditRoot) {
      for (let node = target; node; node = node.parentElement) {
        const paint = getComputedStyle(node).backgroundColor;
        if (
          hasBox(rect(node)) &&
          paint !== 'rgba(0, 0, 0, 0)' &&
          paint !== 'transparent'
        ) {
          creditBackground = paint;
          break;
        }
        if (node === creditRoot) break;
      }
    }
    const ink = creditRoot?.querySelector('.cesium-credit-expand-link');
    const creditRow = target.closest('.cesium-widget-credits');
    const creditRowBox = rect(creditRow);
    const boxes = [targetBox, rect(ink)].filter(hasBox);
    const visibleCreditBox = creditRoot && {
      left: Math.min(...boxes.map((box) => box.left)),
      top: Math.min(...boxes.map((box) => box.top)),
      right: Math.max(...boxes.map((box) => box.right)),
      bottom: Math.max(...boxes.map((box) => box.bottom)),
    };
    return {
      box: hasBox(creditRootBox)
        ? creditRootBox
        : visibleCreditBox || targetBox,
      creditRootBox,
      creditRowBox,
      creditRowOverflow:
        creditRow && creditRow.scrollWidth > creditRow.clientWidth + 1,
      creditLinkBox: rect(ink),
      creditRootDisplay: creditRoot && getComputedStyle(creditRoot).display,
      creditLinkColor: ink && getComputedStyle(ink).color,
      globe: rect(document.getElementById('cesiumContainer')),
      credits: rect(document.getElementById('cesium-credits')),
      backdrop: style.backdropFilter,
      background: creditRoot
        ? creditBackground || 'transparent'
        : style.backgroundColor,
      fontSize: style.fontSize,
      color: style.color,
      text: target.textContent.trim(),
      label: target.getAttribute('aria-label'),
      outline: style.outlineStyle,
      focused: target === document.activeElement,
      focusVisible: target.matches(':focus-visible'),
      opacity: Number(style.opacity),
      parent: rect(target.closest('.tools-panel')),
      traffic: rect(document.querySelector('#traffic-sync-chip.visible')),
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

function contrast(foreground, background) {
  const luminance = (rgb) =>
    rgb.slice(0, 3).reduce((total, channel, index) => {
      const linear = channel / 255;
      return (
        total +
        [0.2126, 0.7152, 0.0722][index] *
          (linear <= 0.04045
            ? linear / 12.92
            : ((linear + 0.055) / 1.055) ** 2.4)
      );
    }, 0);
  const fg = foreground.match(/[\d.]+/g)?.map(Number);
  const bg = background.match(/[\d.]+/g)?.map(Number);
  if (!fg || !bg || (bg[3] ?? 1) !== 1) return 0;
  const [dark, light] = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
  return (light + 0.05) / (dark + 0.05);
}

async function showStatusFixture(page) {
  await page.evaluate(async () => {
    const { ShellFeedback } = await import('/src/ui/shellFeedback.js');
    const { _updateCctvSyncChip } = await import('/src/ui/cctvPresentation.js');
    const feedback = new ShellFeedback({
      readLayers: () => [
        {
          id: 'traffic',
          enabled: true,
          stats: { loading: true, loadingLabel: 'Syncing fixture roads' },
        },
      ],
    });
    const camera = {
      _cctvSyncChip: document.getElementById('cctv-sync-chip'),
      _cctvSyncLabel: document.getElementById('cctv-sync-label'),
      _cctvSyncProgress: document.getElementById('cctv-sync-progress'),
    };
    _updateCctvSyncChip.call(
      camera,
      { active: true, loaded: 2, total: 5 },
      true,
    );
    feedback._updateTrafficSyncChip();
    // The real app's idle traffic poll still runs in this fixture browser.
    // Keep the sample visible while taking the two sync-chip screenshots.
    const trafficTimer = setInterval(
      () => feedback._updateTrafficSyncChip(),
      50,
    );
    let toastTimeout;
    window.lookQa.statusFixture = {
      toast() {
        // Capture the timeout from this synchronous renderer call only.
        // Slow screenshots cannot consume the toast's display interval.
        const setTimeout = window.setTimeout;
        try {
          window.setTimeout = (callback) => {
            toastTimeout = callback;
            return null;
          };
          feedback._showToast('Shared controls fixture notification');
        } finally {
          window.setTimeout = setTimeout;
        }
      },
      expireToast() {
        if (!toastTimeout) throw new Error('Toast did not schedule dismissal');
        toastTimeout();
        toastTimeout = null;
      },
      stop() {
        clearInterval(trafficTimer);
        feedback.destroy();
        camera._cctvSyncChip.classList.remove('visible');
      },
    };
  });
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

    async function capture(view, selector, check = () => []) {
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
      const attribution = view === 'credits' || view === 'attribution';
      const bounds = attribution
        ? { left: 0, top: 0, right: width, bottom: height }
        : data.globe;
      if (!contain(bounds, data.box))
        errors.push('control box lies outside its available region');
      if (
        !attribution &&
        data.credits?.height &&
        data.box.bottom > data.credits.top
      )
        errors.push('control box reaches the attribution line');
      if (options.label === 'after' && data.backdrop !== 'none')
        errors.push('surface uses a blurred backdrop');
      errors.push(...check(data));
      const stem = `${options.label}-${width}x${height}-controls-${view}`;
      const full = path.join(out, `${stem}.png`);
      const crop = path.join(out, `${stem}-crop.png`);
      if (
        !(await captureLookImage(page, full, crop, data.box, { width, height }))
      )
        errors.push('control crop has no pixels');
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

    await markFrameStage(`${width}x${height} Draw activation`);
    await page.click('#frame-menu');
    await page.click('#frame-menu-item-tools');
    await page.waitForSelector(draw, visible);
    await page.focus(draw);
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${draw}[aria-pressed="true"]`, visible);
    await page.waitForSelector(shape, visible);
    for (const expected of ['area', 'line', 'pin']) {
      await page.keyboard.press('Tab');
      const reached = await page.evaluate(
        (value) => document.activeElement?.dataset.shape === value,
        expected,
      );
      if (!reached) throw new Error(`Tab did not focus Draw shape ${expected}`);
    }
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${shape}[aria-checked="true"]`, wait);
    await capture('draw', tools);
    await capture('draw-focus', shape, (data) =>
      data.focused &&
      data.focusVisible &&
      data.outline === 'solid' &&
      contain(data.parent, data.box)
        ? []
        : ['selected Draw control is clipped or lacks visible keyboard focus'],
    );
    await page.keyboard.press('Escape');
    await page.waitForSelector(`${draw}[aria-pressed="false"]`, visible);
    await page.$eval('#scene-panel', (panel) =>
      panel.scrollIntoView({ block: 'end' }),
    );
    await capture('scenes', tools);
    await page.click(`${tools} [data-menu-close]`);

    await markFrameStage(`${width}x${height} Directions activation`);
    await page.click('#frame-layers');
    await page.$eval(route, (row) => row.scrollIntoView({ block: 'center' }));
    await page.click(`${route} [role="switch"]`);
    await page.waitForSelector(`${route} [data-chip-id="set-a"]`, visible);
    await page.$eval(route, (row) => row.scrollIntoView({ block: 'center' }));
    await capture('directions', layers);
    await page.click(`${route} [role="switch"]`);
    await page.click('#layers-menu-close');

    await markFrameStage(`${width}x${height} voice card`);
    await showVoiceFixture(page);
    await capture('voice', card);
    await page.click('#gev-voice-card-dismiss');
    await page.waitForSelector(`${card}[hidden]`, wait);
    await page.evaluate(() => window.lookQa.voice.destroy());

    await markFrameStage(`${width}x${height} status fixtures`);
    await showStatusFixture(page);
    await capture('traffic-sync', `${trafficChip}.visible`, (data) =>
      data.text.includes('Syncing fixture roads')
        ? []
        : ['traffic sync text is missing'],
    );
    await capture('camera-sync', `${cameraChip}.visible`, (data) =>
      data.traffic &&
      data.traffic.bottom <= data.box.top + 1 &&
      data.text.includes('2/5')
        ? []
        : ['camera and traffic sync chips overlap or fixture count is missing'],
    );
    await markFrameStage(`${width}x${height} toast fixture`);
    await page.evaluate(() => window.lookQa.statusFixture.toast());
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector('#toast')).opacity === '1',
      wait,
    );
    await capture('toast', '#toast.visible', (data) =>
      data.opacity === 1 && data.text === 'Shared controls fixture notification'
        ? []
        : ['toast text is missing or still transparent'],
    );
    await page.evaluate(() => window.lookQa.statusFixture.expireToast());
    await page.waitForSelector('#toast:not(.visible)', wait);
    await page.evaluate(() => window.lookQa.statusFixture.stop());

    await markFrameStage(`${width}x${height} attribution`);
    await page.evaluate(() => {
      const { C } = window.lookQa;
      const { viewer } = window.__godsEyeView;
      const fixtures = [
        new C.Credit(
          '<span data-look-screen-credit>Local imagery fixture</span>',
          true,
        ),
        new C.Credit(
          '<span data-look-detail-credit>Local data fixture</span>',
          false,
        ),
      ];
      fixtures.forEach((credit) =>
        viewer.creditDisplay.addStaticCredit(credit),
      );
      window.lookQa.removeCreditFixtures = () => {
        fixtures.forEach((credit) =>
          viewer.creditDisplay.removeStaticCredit(credit),
        );
        viewer.scene.requestRender();
      };
      viewer.scene.requestRender();
    });
    await page.waitForSelector(creditLink, visible);
    await capture('credits', screenCredit, (data) => {
      const errors = [];
      if (data.text !== 'Local imagery fixture')
        errors.push('on-screen credit did not render');
      if (
        options.label === 'after' &&
        [data.color, data.creditLinkColor].some(
          (ink) => !ink || contrast(ink, data.background) < 4.5,
        )
      )
        errors.push('credit caption and link need a solid contrasting backing');
      if (
        options.label === 'after' &&
        (!data.creditRootBox?.height ||
          !data.creditRowBox?.height ||
          !data.creditLinkBox?.height ||
          !contain(data.creditRootBox, data.creditRowBox) ||
          !contain(data.creditRowBox, data.creditLinkBox) ||
          data.creditRowOverflow)
      )
        errors.push('rendered credit row or link overflows its backing');
      if (options.label === 'after' && parseFloat(data.fontSize) < 12)
        errors.push('credit caption is smaller than 12 px');
      return errors;
    });
    await page.focus(creditLink);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () =>
        document.activeElement?.classList.contains(
          'cesium-credit-lightbox-close',
        ) &&
        document
          .querySelector('.cesium-credit-expand-link')
          ?.getAttribute('aria-expanded') === 'true',
      wait,
    );
    await page.waitForSelector(detailCredit, visible);
    await capture('attribution', creditLightbox, (data) =>
      data.text.includes('Local data fixture')
        ? []
        : ['attribution details are empty'],
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      (selector) => {
        const link = document.querySelector(selector);
        return (
          document.activeElement === link &&
          link.getAttribute('aria-expanded') === 'false'
        );
      },
      wait,
      creditLink,
    );
    await page.evaluate(() => window.lookQa.removeCreditFixtures());
    await page.waitForSelector(screenCredit, { ...wait, hidden: true });
  }
}
