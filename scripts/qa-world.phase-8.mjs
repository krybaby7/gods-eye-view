// The top bar's menu, which holds the original app's tools (roadmap 1.5).
const SECTIONS = ['sources', 'display', 'tools'];
const SIZES = [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
];

// The original controls the menu took in; each lives in its panel now.
const MOVED = [
  'location-bar',
  'control-panel',
  'pp-toggles',
  'scene-panel',
  'share-btn',
  'globe-navigation',
  'draw-toggle',
];

export default async function phase8({
  assert,
  page,
  report,
  step,
  shot,
  pickCountry,
  legendAt,
  wait,
  desktop,
}) {
  report.toolsMenu ??= {};
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => setTimeout(resolve, 300)),
          ),
        ),
    );
  const resize = async (width, height) => {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.waitForFunction(
      (width, height) => innerWidth === width && innerHeight === height,
      wait,
      width,
      height,
    );
    await settle();
  };
  const today = () => page.evaluate(() => document.body.dataset.today);
  const setToday = async (state) => {
    if ((await today()) === state) return;
    await page.click(
      state === 'open' ? '#frame-today-open' : '#frame-today-fold',
    );
    await page.waitForFunction(
      (state) => document.body.dataset.today === state,
      wait,
      state,
    );
  };
  const sheet = () => page.evaluate(() => document.body.dataset.sheet);
  const closeSheet = async () => {
    if ((await sheet()) !== 'open') return;
    await page.click('#world-sheet-close');
    await page.waitForFunction(
      () => document.body.dataset.sheet === 'closed',
      wait,
    );
  };
  const openSection = async (name) => {
    await page.click('#frame-menu');
    await page.waitForSelector('#frame-menu-list:not([hidden])', wait);
    await page.click(`#frame-menu-item-${name}`);
    await page.waitForSelector(`#frame-menu-${name}:not([hidden])`, wait);
    await settle();
  };
  const closeByEscape = async (name) => {
    await page.focus(`#frame-menu-${name}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      (name) => document.getElementById(`frame-menu-${name}`).hidden,
      wait,
      name,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      'frame-menu',
      `Escape on the ${name} panel returns focus to the menu button`,
    );
  };
  // Where a section's panel and the frame's regions lie in the window.
  const geometry = (section) =>
    page.evaluate((section) => {
      const shown = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility === 'visible' &&
          element.getClientRects().length > 0
        );
      };
      const box = (element) => {
        const { left, top, right, bottom } = element.getBoundingClientRect();
        return { left, top, right, bottom };
      };
      const regions = [
        ['top bar', '#frame-top'],
        ['bottom bar', '#frame-bottom'],
        ['Today', '#frame-today'],
        ['rail', '#frame-rail'],
        ['sheet', '#frame-sheet'],
      ]
        .map(([name, selector]) => [name, document.querySelector(selector)])
        .filter(([, element]) => shown(element))
        .map(([name, element]) => ({ name, ...box(element) }));
      const panel = section && document.getElementById(`frame-menu-${section}`);
      const list = document.getElementById('frame-menu-list');
      const sources =
        section === 'display' && shown(panel)
          ? [...panel.querySelectorAll('.map-stack-chip')]
              .filter(shown)
              .map((button) => {
                const label = button.querySelector('.map-stack-chip-label');
                const requirement = button.querySelector('.map-stack-chip-req');
                const textBoxes = (element) => {
                  if (!element) return [];
                  const range = document.createRange();
                  range.selectNodeContents(element);
                  return Array.from(range.getClientRects(), (rect) =>
                    rect.toJSON(),
                  );
                };
                return {
                  name: label.textContent,
                  font: Number.parseFloat(getComputedStyle(label).fontSize),
                  pressed: button.getAttribute('aria-pressed') === 'true',
                  box: box(button),
                  lines: textBoxes(label),
                  requirement: textBoxes(requirement),
                };
              })
          : [];
      return {
        width: innerWidth,
        height: innerHeight,
        today: document.body.dataset.today,
        sheet: document.body.dataset.sheet,
        regions,
        panel: shown(panel) ? box(panel) : null,
        list: shown(list) ? box(list) : null,
        sources,
      };
    }, section);
  const meet = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const inside = (box, { width, height }) =>
    box.left >= -0.5 &&
    box.top >= -0.5 &&
    box.right <= width + 0.5 &&
    box.bottom <= height + 0.5;
  // A section's panel is drawn, inside the window, clear of every region.
  const checkPanel = async (section, label) => {
    const data = await geometry(section);
    report.toolsMenu.panels ??= [];
    report.toolsMenu.panels.push({ section, label, ...data });
    const where = `${section} at ${data.width}×${data.height} (${label}, Today ${data.today}, sheet ${data.sheet})`;
    assert.ok(data.panel, `The ${section} panel is drawn: ${where}`);
    assert.ok(
      inside(data.panel, data),
      `The ${section} panel lies inside the window: ${where} ${JSON.stringify(data.panel)}`,
    );
    const under = data.regions
      .filter((region) => meet(region, data.panel))
      .map((region) => region.name);
    assert.deepEqual(
      under,
      [],
      `The ${section} panel meets a region: ${where}`,
    );
    if (section === 'display') {
      assert.ok(
        data.sources.length >= 2,
        `Map source buttons are drawn: ${where}`,
      );
      assert.equal(data.sources.filter(({ pressed }) => pressed).length, 1);
      for (const [index, source] of data.sources.entries()) {
        const { box, lines, font, name, requirement } = source;
        assert.ok(
          font >= 13 && box.bottom - box.top >= 28,
          `Readable Map source button: ${name}, ${where}`,
        );
        assert.ok(
          lines.length &&
            [...lines, ...requirement].every(
              (line) =>
                line.left >= box.left - 1 &&
                line.right <= box.right + 1 &&
                line.top >= box.top - 1 &&
                line.bottom <= box.bottom + 1,
            ),
          `Map source labels stay within their button: ${name}, ${where}`,
        );
        assert.ok(
          requirement.length <= 1 &&
            requirement.every((tag) => !lines.some((line) => meet(line, tag))),
          `Map source requirement stays on one line, clear of its label: ${name}, ${where}`,
        );
        assert.equal(
          data.sources.slice(index + 1).some((other) => meet(box, other.box)),
          false,
          `Map source buttons stay separate: ${name}, ${where}`,
        );
      }
    }
    return data;
  };

  /**
   * What is drawn over the open globe: the area between the bars, Today or
   * its rail, the sheet and the status line, sampled on a grid. Each point's
   * topmost element is named by its nearest id. The frame, the globe, the
   * World Board's own marks and the status line are the new app; the parts
   * listed in `exempt` are not this piece's (the layer list, the preset strip
   * and "clear selected layers" are 1.4's; the layers' detail panels stay as
   * they are, piece brief §5) and are reported, not failed.
   */
  const scanGlobe = () =>
    page.evaluate(() => {
      const shown = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility === 'visible' &&
          element.getClientRects().length > 0
        );
      };
      const rect = (selector) => {
        const element = document.querySelector(selector);
        return shown(element) ? element.getBoundingClientRect() : null;
      };
      const top = rect('#frame-top');
      const bottom = rect('#frame-bottom');
      const left = rect('#frame-today') ?? rect('#frame-rail');
      const sheet = rect('#frame-sheet');
      const status = rect('#intel-hud .hud-status');
      const area = {
        left: left ? left.right : 0,
        top: top ? top.bottom : 0,
        right: sheet ? sheet.left : innerWidth,
        bottom: status ? status.top : bottom ? bottom.top : innerHeight,
      };
      const exempt = [
        ['#data-panel', 'data-panel'],
        ['#lens-bar', 'lens-bar'],
        ['#clear-selected-layers', 'clear-selected-layers'],
        ['#right-context-rail > [data-panel-id]', null],
      ];
      const ours = [
        '.frame-region',
        '#cesiumContainer',
        '.hud-status',
        '[id^="world-"]',
        '[class^="world-"]',
        '[class*=" world-"]',
      ].join(', ');
      const name = (element) =>
        element.closest('[id]')?.id ||
        element.getAttribute('class') ||
        element.tagName;
      const offenders = new Map();
      const exempted = new Map();
      const columns = 32;
      const rows = 20;
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
          const x =
            area.left + ((column + 0.5) / columns) * (area.right - area.left);
          const y = area.top + ((row + 0.5) / rows) * (area.bottom - area.top);
          const element = document.elementFromPoint(x, y);
          if (
            !element ||
            element === document.body ||
            element === document.documentElement
          )
            continue;
          const kept = exempt.find(([selector]) => element.closest(selector));
          if (kept) {
            const id = kept[1] ?? element.closest(kept[0]).id;
            exempted.set(id, (exempted.get(id) ?? 0) + 1);
            continue;
          }
          if (element.closest(ours)) continue;
          const id = name(element);
          offenders.set(id, (offenders.get(id) ?? 0) + 1);
        }
      }
      // Controls that do not take pointer events are not found by the grid:
      // the original ones, by name, wherever they are drawn.
      const named = [
        '#command-dock > :not(#gev-voice-control)',
        '#gev-voice-control > :not(.gev-voice-card, .gev-voice-error-tray)',
        '#key-setup-chip',
        '.map-zoom-controls',
        '#top-center-actions > :not(#clear-selected-layers)',
        '#left-panel-stack > :not(#data-panel, #lens-bar)',
        ...[
          'location-bar',
          'control-panel',
          'pp-toggles',
          'scene-panel',
          'share-btn',
          'globe-navigation',
        ].map((id) => `#${id}`),
      ];
      const meets = (box) =>
        Math.min(box.right, area.right) - Math.max(box.left, area.left) > 1 &&
        Math.min(box.bottom, area.bottom) - Math.max(box.top, area.top) > 1;
      for (const selector of named)
        for (const element of document.querySelectorAll(selector)) {
          if (!shown(element) || element.closest('#frame-tools')) continue;
          if (!meets(element.getBoundingClientRect())) continue;
          const id = name(element);
          offenders.set(id, (offenders.get(id) ?? 0) + 1);
        }
      return {
        width: innerWidth,
        height: innerHeight,
        area,
        offenders: Object.fromEntries(offenders),
        exempted: Object.fromEntries(exempted),
      };
    });

  await step(
    'The original tools live in the top bar’s menu, each where the menu put it',
    async () => {
      await page.setViewport(desktop);
      const homes = await page.evaluate(
        (ids) =>
          Object.fromEntries(
            ids.map((id) => {
              const element = document.getElementById(id);
              return [
                id,
                element
                  ? (element.closest('[data-menu-section-panel]')?.dataset
                      .menuSectionPanel ?? 'outside the menu')
                  : 'absent',
              ];
            }),
          ),
        MOVED,
      );
      report.toolsMenu.homes = homes;
      assert.deepEqual(homes, {
        'location-bar': 'tools',
        'control-panel': 'display',
        'pp-toggles': 'display',
        'scene-panel': 'tools',
        'share-btn': 'tools',
        'globe-navigation': 'tools',
        'draw-toggle': 'tools',
      });
      const order = await page.$eval('#frame-top', (bar) =>
        [...bar.querySelectorAll('button')]
          .filter((button) => !button.closest('[role="menu"]'))
          .filter((button) => getComputedStyle(button).display !== 'none')
          .map((button) => button.id)
          .slice(-2),
      );
      assert.equal(order.at(-1), 'frame-menu', 'The menu button comes last');
      const opened = await page.$$eval('#frame-tools .tools-panel', (nodes) =>
        nodes.filter((node) => !node.hidden).map((node) => node.id),
      );
      assert.deepEqual(opened, [], 'No menu panel opens by itself');
    },
    { fatal: false },
  );

  await step(
    'Nothing of the original app lies over the globe at three window sizes with nothing opened',
    async () => {
      await page.setViewport(desktop);
      await closeSheet();
      const before = await today();
      const scans = [];
      try {
        for (const [width, height] of SIZES) {
          await resize(width, height);
          for (const state of ['open', 'folded']) {
            await setToday(state);
            await settle();
            const scan = await scanGlobe();
            scans.push({ today: state, ...scan });
            await shot(`tools-menu-globe-${width}x${height}-today-${state}`);
          }
        }
      } finally {
        report.toolsMenu.globeScans = scans;
        await setToday(before);
      }
      const found = scans
        .filter((scan) => Object.keys(scan.offenders).length)
        .map(
          (scan) =>
            `${scan.width}×${scan.height} Today ${scan.today}: ${JSON.stringify(scan.offenders)}`,
        );
      assert.deepEqual(found, [], 'Original parts over the globe');
    },
    { fatal: false },
  );

  await step(
    'Each section of the menu opens inside the window, clear of the frame, and Escape gives focus back',
    async () => {
      await closeSheet();
      for (const [width, height] of SIZES) {
        await resize(width, height);
        for (const section of SECTIONS) {
          await openSection(section);
          await checkPanel(section, 'sheet-closed');
          await shot(`tools-menu-${section}-${width}x${height}`);
          await closeByEscape(section);
        }
      }
    },
    { fatal: false },
  );

  await step(
    'At 1280×720 with Today and a country’s sheet open, each menu panel stays clear of the bars, Today and the sheet',
    async () => {
      await page.setViewport(desktop);
      await setToday('open');
      if ((await sheet()) !== 'open') await pickCountry(81.7, 21.2, 'IND');
      await resize(1280, 720);
      assert.equal(await sheet(), 'open');
      assert.equal(await today(), 'open');
      for (const section of SECTIONS) {
        await openSection(section);
        await checkPanel(section, 'today-open-sheet-open');
        await shot(`tools-menu-${section}-1280x720-today-sheet`);
        await closeByEscape(section);
      }
    },
    { fatal: false },
  );

  await step(
    'The menu works by keyboard and closes on a click outside',
    async () => {
      await resize(1280, 720);
      await page.focus('#frame-menu');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#frame-menu-list:not([hidden])', wait);
      const list = await geometry(null);
      assert.ok(
        list.list && inside(list.list, list),
        `The menu list lies inside the window: ${JSON.stringify(list.list)}`,
      );
      const focused = () => page.evaluate(() => document.activeElement?.id);
      assert.equal(await focused(), 'frame-menu-item-sources');
      await page.keyboard.press('ArrowDown');
      assert.equal(await focused(), 'frame-menu-item-display');
      await page.keyboard.press('End');
      assert.equal(await focused(), 'frame-menu-item-tour');
      await page.keyboard.press('ArrowUp');
      assert.equal(await focused(), 'frame-menu-item-tools');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#frame-menu-list[hidden]', wait);
      assert.equal(await focused(), 'frame-menu');
      assert.equal(
        await page.$eval('#frame-menu', (node) =>
          node.getAttribute('aria-expanded'),
        ),
        'false',
      );
      await page.keyboard.press('Enter');
      await page.waitForSelector('#frame-menu-list:not([hidden])', wait);
      await page.click('#frame-date');
      await page.waitForSelector('#frame-menu-list[hidden]', wait);
      // Enter on an entry opens its section.
      await page.focus('#frame-menu');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#frame-menu-list:not([hidden])', wait);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#frame-menu-display:not([hidden])', wait);
      await closeByEscape('display');
    },
    { fatal: false },
  );

  await step(
    'The War Monitor’s switch in Data sources and keys agrees with the layer',
    async () => {
      await resize(1280, 720);
      await openSection('sources');
      const state = await page.evaluate(() => ({
        layer: Boolean(
          window.__godsEyeView?.dataManager?.isEffectivelyEnabled('news'),
        ),
        checked: document.getElementById('frame-war-switch').checked,
        disabled: document.getElementById('frame-war-switch').disabled,
        keys: document.getElementById('frame-keys-note').textContent,
      }));
      report.toolsMenu.sources = state;
      // Only read: switching it would start the War Monitor's collectors.
      assert.equal(state.checked, state.layer);
      assert.equal(state.disabled, false);
      await closeByEscape('sources');
    },
    { fatal: false },
  );

  await step(
    'At a phone’s width the menu’s panels are full-width sheets',
    async () => {
      await closeSheet();
      await resize(390, 844);
      for (const section of SECTIONS) {
        await openSection(section);
        const data = await geometry(section);
        report.toolsMenu.panels.push({ section, label: 'phone', ...data });
        assert.ok(data.panel, `The ${section} panel is drawn on a phone`);
        assert.ok(inside(data.panel, data), `${section} inside the window`);
        assert.ok(
          Math.abs(data.panel.left) <= 1 &&
            Math.abs(data.panel.right - data.width) <= 1,
          `The ${section} panel spans the window: ${JSON.stringify(data.panel)}`,
        );
        await shot(`tools-menu-${section}-390x844`);
        await closeByEscape(section);
      }
    },
    { fatal: false },
  );

  await step(
    'The legend’s band at 1280×720 with the menu button in the top bar',
    async () => {
      // Measured twice in the same window: with the menu button, and with
      // its holder taken out of the layout, which is the bar as it was
      // before this piece added the button.
      let withButton;
      let withoutButton;
      try {
        await resize(1280, 720);
        await page.click('#world-lens-bar [data-world-lens="strength"]');
        withButton = await legendAt(1280, 720, 'tools-menu');
        await page.$eval('#frame-top .frame-menu', (node) => {
          node.style.display = 'none';
        });
        withoutButton = await legendAt(1280, 720, 'tools-menu-without-button');
      } finally {
        await page
          .$eval('#frame-top .frame-menu', (node) => {
            node.style.display = '';
          })
          .catch(() => {});
        await page.setViewport(desktop);
      }
      assert.ok(
        withButton?.drawn && withButton.width > 0,
        'The Strength legend is drawn with positive width',
      );
      assert.ok(
        withoutButton?.drawn && withoutButton.width > 0,
        'The comparison legend is drawn with positive width',
      );
      assert.equal(
        withButton?.lens,
        'strength',
        'The baseline comparison uses Strength',
      );
      assert.equal(
        withoutButton?.lens,
        withButton?.lens,
        'Both measurements use the same lens',
      );
      assert.equal(
        withButton?.width,
        withoutButton?.width,
        'The menu button does not narrow the same legend',
      );
      report.toolsMenu.legendBaseline = { lens: 'strength', width: 481 };
      report.toolsMenu.legendBand1280 = withButton?.width ?? null;
      report.toolsMenu.legendBand1280WithoutButton =
        withoutButton?.width ?? null;
      console.log(
        `[INFO] Legend band at 1280×720 (${withButton?.lens ?? 'no lens'}): ${withButton?.width ?? 'not drawn'} px with the menu button, ${withoutButton?.width ?? 'not drawn'} px without it`,
      );
      assert.ok(withButton, 'The legend is read at 1280×720');
      assert.equal(
        typeof withButton.width,
        'number',
        'The legend band is measured',
      );
    },
    { fatal: false },
  );
}
