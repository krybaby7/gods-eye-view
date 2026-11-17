// One menu at a time, the layers menu's foot links, and the cockpit's own
// Layers and Presets buttons (roadmap 1.4, stage two).
const SECTIONS = ['sources', 'display', 'tools'];

// The cockpit's instruments a menu must stay clear of. The two rims are
// arcs whose boxes span the visor; they are measured and reported, not
// failed (their drawn arcs, not their boxes, are what a menu could cover).
const INSTRUMENTS = [
  ['top line', '.cockpit-topline'],
  ['compass', '.cockpit-compass'],
  ['position', '.cockpit-position-readout'],
  ['contact window', '#cockpit-context'],
  ['briefing window', '#cockpit-signal-stream'],
  ['utility controls', '#cockpit-utility-controls'],
  ['help line', '.cockpit-help'],
];
const RIMS = [
  ['speed rim', '#cockpit-speed-rim'],
  ['altitude rim', '#cockpit-altitude-rim'],
];

export default async function phase9({
  assert,
  page,
  report,
  step,
  shot,
  pickCountry,
  wait,
  desktop,
}) {
  report.layersMenu ??= {};
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => setTimeout(resolve, 250)),
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
  /** Which menus are open, and the page state Escape must leave alone. */
  const state = () =>
    page.evaluate(() => {
      const find = (id) => document.getElementById(id);
      const open = (id) => Boolean(find(id) && !find(id).hidden);
      return {
        layers: !find('data-panel')?.classList.contains('collapsed'),
        presets: open('frame-presets-menu'),
        list: open('frame-menu-list'),
        panels: ['sources', 'display', 'tools'].filter((name) =>
          open(`frame-menu-${name}`),
        ),
        more: open('frame-sheet-more-menu'),
        legend: open('frame-legend-popup'),
        sheet: document.body.dataset.sheet,
        today: document.body.dataset.today,
        cockpit: document.body.classList.contains('cockpit-mode'),
        active: document.activeElement?.id || null,
      };
    });
  const openOnes = (s) =>
    [
      s.layers && 'layers',
      s.presets && 'presets',
      s.list && 'menu list',
      ...s.panels.map((name) => `menu ${name}`),
      s.more && 'more',
      s.legend && 'legend',
    ].filter(Boolean);
  const onlyOpen = async (expected, label) => {
    await settle();
    const now = await state();
    assert.deepEqual(openOnes(now), expected, label);
    return now;
  };
  const visible = (selector) =>
    page.evaluate((selector) => {
      const node = document.querySelector(selector);
      if (!node || node.hidden) return false;
      const style = getComputedStyle(node);
      return (
        style.display !== 'none' &&
        style.visibility === 'visible' &&
        node.getClientRects().length > 0
      );
    }, selector);
  const closeSheet = async () => {
    if ((await state()).sheet !== 'open') return;
    await page.click('#world-sheet-close');
    await page.waitForFunction(
      () => document.body.dataset.sheet === 'closed',
      wait,
    );
  };
  const blur = () =>
    page.evaluate(() => {
      document.activeElement?.blur?.();
    });
  /** A point in the top bar with nothing to press under it. */
  const quietPoint = () =>
    page.evaluate(() => {
      const bar = document.getElementById('frame-top');
      const box = bar?.getBoundingClientRect();
      if (!box) return null;
      const y = Math.round(box.top + box.height / 2);
      for (let x = Math.round(box.left + 4); x < box.right - 4; x += 6) {
        const node = document.elementFromPoint(x, y);
        if (!node || !bar.contains(node)) continue;
        if (
          node.closest(
            'button, a, input, select, textarea, label, [role], [tabindex], [contenteditable]',
          )
        )
          continue;
        return { x, y, id: node.closest('[id]')?.id ?? node.tagName };
      }
      return null;
    });
  const closeAll = async () => {
    for (let tries = 0; tries < 4; tries++) {
      if (!openOnes(await state()).length) return;
      await blur();
      await page.keyboard.press('Escape');
      await settle();
    }
  };

  await step(
    'One menu at a time: each menu opened closes the one before it',
    async () => {
      await resize(1440, 900);
      await closeAll();
      const covered = [];
      await page.click('#frame-layers');
      await onlyOpen(['layers'], 'Layers opens the layers menu');
      await page.click('#frame-presets');
      await onlyOpen(['presets'], 'Presets closes the layers menu');
      covered.push('layers → presets');
      await page.click('#frame-menu');
      await onlyOpen(['menu list'], 'The Menu button closes Presets');
      covered.push('presets → menu list');
      await page.click('#frame-menu-item-display');
      await onlyOpen(['menu display'], 'The Display panel opens alone');
      await page.click('#frame-layers');
      await onlyOpen(['layers'], 'Layers closes the Display panel');
      covered.push('menu panel → layers');
      await page.click('#frame-menu');
      await onlyOpen(['menu list'], 'The Menu button closes the layers menu');
      covered.push('layers → menu list');
      await closeAll();

      // The sheet's More, when the open sheet has more tabs than it shows.
      await pickCountry(81.7, 21.2, 'IND');
      await settle();
      if (await visible('#frame-sheet-more')) {
        await page.click('#frame-layers');
        await page.click('#frame-sheet-more');
        await onlyOpen(['more'], 'More closes the layers menu');
        await page.click('#frame-presets');
        await onlyOpen(['presets'], 'Presets closes More');
        covered.push('layers → more → presets');
        await closeAll();
      } else covered.push('more: not shown with this sheet, not exercised');

      // Ownership has a long legend; at 800 pixels the bottom-bar controls remain available.
      await resize(800, 600);
      await page.$eval(
        '#world-lens-bar [data-world-lens="ownership"]',
        (node) => node.click(),
      );
      await settle();
      assert.ok(
        await visible('#frame-legend-whole'),
        'The whole-legend button is shown for Ownership at 800 pixels',
      );
      await page.click('#frame-presets');
      await page.click('#frame-legend-whole');
      await onlyOpen(['legend'], 'The legend closes Presets');
      await page.click('#frame-layers');
      await onlyOpen(['layers'], 'Layers closes the legend');
      await page.click('#frame-legend-whole');
      await onlyOpen(['legend'], 'The legend closes Layers');
      await page.click('#frame-presets');
      await onlyOpen(['presets'], 'Presets closes the legend');
      covered.push('presets → legend → layers → legend → presets');
      await closeAll();
      report.layersMenu.oneAtATime = covered;
      console.log(`[INFO] One menu at a time covered: ${covered.join('; ')}`);
      await shot('layers-menu-one-at-a-time');
    },
    { fatal: false },
  );

  await step(
    'Escape closes only the open menu, and a click outside closes it',
    async () => {
      await resize(1440, 900);
      await closeAll();
      if ((await state()).sheet !== 'open')
        await pickCountry(81.7, 21.2, 'IND');
      const before = await state();
      assert.equal(before.sheet, 'open', 'A sheet is open to be left alone');
      for (const [button, name] of [
        ['#frame-layers', 'layers'],
        ['#frame-presets', 'presets'],
      ]) {
        await page.click(button);
        await onlyOpen([name], `${name} opens`);
        await page.keyboard.press('Escape');
        const after = await onlyOpen([], `Escape closes ${name}`);
        assert.equal(
          after.sheet,
          before.sheet,
          `Escape on ${name} keeps the sheet`,
        );
        assert.equal(
          after.today,
          before.today,
          `Escape on ${name} keeps Today`,
        );
        assert.equal(
          after.active,
          button.slice(1),
          `Escape on ${name} gives focus back to its button`,
        );
      }
      const point = await quietPoint();
      assert.ok(point, 'A point in the top bar with nothing to press');
      report.layersMenu.outsidePoint = point;
      for (const [button, name] of [
        ['#frame-layers', 'layers'],
        ['#frame-presets', 'presets'],
      ]) {
        await page.click(button);
        await onlyOpen([name], `${name} opens`);
        await page.mouse.click(point.x, point.y);
        const after = await onlyOpen([], `A click outside closes ${name}`);
        assert.equal(after.sheet, before.sheet);
      }
      // F, the layers shortcut, opens and closes it in the frame.
      await blur();
      await page.keyboard.press('f');
      await onlyOpen(['layers'], 'F opens the layers menu');
      await blur();
      await page.keyboard.press('f');
      await onlyOpen([], 'F closes the layers menu');
      await closeSheet();
    },
    { fatal: false },
  );

  await step(
    'The layers menu’s foot links open the Menu’s sections, the layers menu closed and focus in the panel',
    async () => {
      await resize(1440, 900);
      await closeAll();
      await page.click('#frame-layers');
      await onlyOpen(['layers'], 'Layers opens the layers menu');
      const foot = await page.$$eval(
        '#data-panel [data-menu-section]',
        (links) =>
          links.map((link) => ({
            section: link.dataset.menuSection,
            tag: link.tagName,
            type: link.type,
            text: link.textContent.trim(),
            shown: !link.hidden && link.getClientRects().length > 0,
          })),
      );
      report.layersMenu.foot = foot;
      assert.deepEqual(
        foot.map(({ section, tag, shown }) => [section, tag, shown]),
        SECTIONS.map((section) => [section, 'BUTTON', true]),
      );
      await shot('layers-menu-foot');
      await page.keyboard.press('Escape');
      await onlyOpen([], 'Escape closes the layers menu');
      for (const [index, section] of SECTIONS.entries()) {
        await page.click('#frame-layers');
        await onlyOpen(['layers'], 'Layers opens the layers menu');
        const link = `#data-panel [data-menu-section="${section}"]`;
        // The first by keyboard, the others by pointer.
        if (index === 0) {
          await page.focus(link);
          await page.keyboard.press('Enter');
        } else await page.click(link);
        await page.waitForSelector(
          `#frame-menu-${section}:not([hidden])`,
          wait,
        );
        const now = await onlyOpen(
          [`menu ${section}`],
          `The ${section} link opens only its panel`,
        );
        const inside = await page.evaluate(
          (section) =>
            document
              .getElementById(`frame-menu-${section}`)
              .contains(document.activeElement),
          section,
        );
        assert.ok(inside, `Focus is in the ${section} panel (${now.active})`);
        await shot(`layers-menu-foot-${section}`);
        await page.keyboard.press('Escape');
        const closed = await onlyOpen([], `Escape closes the ${section} panel`);
        assert.equal(closed.active, 'frame-layers', 'Focus returns to Layers');
      }
    },
    { fatal: false },
  );

  await step(
    'In the cockpit its own Layers and Presets open the same menus, clear of the instruments',
    async () => {
      await resize(1440, 900);
      await closeAll();
      await closeSheet();
      const result = { entry: null };
      report.layersMenu.cockpit = result;
      // One synthetic aircraft under the camera, served by the fixtures.
      const centre = await page.evaluate(() => {
        const { camera } = window.__godsEyeView.viewer;
        const where = camera.positionCartographic;
        return {
          lon: (where.longitude * 180) / Math.PI,
          lat: (where.latitude * 180) / Math.PI,
        };
      });
      report.transport.flightFixture = {
        id: 'qa9001',
        callsign: 'QA9001',
        lon: Number(centre.lon.toFixed(4)),
        lat: Number(Math.max(-70, Math.min(70, centre.lat)).toFixed(4)),
      };
      try {
        // The cockpit's own gate needs Contacts on (flights and military
        // flights, contextModePolicy.js cockpitEntryAllowed), as "open
        // contacts" does it; the military feed is answered by nothing.
        result.contacts = await page.evaluate(async () => {
          const { styleManager, dataManager } = window.__godsEyeView;
          const outcome = await styleManager.setContextMode('contacts');
          for (const id of ['flights', 'military'])
            if (!dataManager.isEnabled(id))
              await dataManager.setEnabled(id, true, { origin: 'user' });
          return { ok: Boolean(outcome?.ok), mode: outcome?.mode ?? null };
        });
        const tracked = await page.evaluate(async () => {
          const manager = window.__godsEyeView.dataManager;
          const module = manager.layers.get('flights')?.module;
          const deadline = performance.now() + 15_000;
          while (performance.now() < deadline) {
            if (module?.trackById?.('qa9001')) return true;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          return false;
        });
        result.tracked = tracked;
        assert.ok(tracked, 'The fixture aircraft is tracked');
        // What the cockpit's own gate sees before C is pressed.
        result.before = await page.evaluate(() => {
          const { viewer, styleManager } = window.__godsEyeView;
          const view = styleManager.cockpitView;
          return {
            info: Boolean(view.readAircraftInfo()),
            position: Boolean(viewer.trackedEntity?.position),
            allowed: Boolean(view.isEntryAllowed()),
            entryShown: !document.getElementById('cockpit-entry')?.hidden,
          };
        });
        // The real way first: C with an aircraft tracked.
        await blur();
        await page.keyboard.press('c');
        const activeCockpit = () =>
          document.body.classList.contains('cockpit-mode') &&
          window.__godsEyeView.styleManager.cockpitView.active &&
          !document.getElementById('cockpit-hud').hidden;
        try {
          await page.waitForFunction(activeCockpit, { timeout: 8_000 });
          result.entry = `Contacts on (${JSON.stringify(result.contacts)}), fixture aircraft tracked, then the C key`;
        } catch {
          // By code, as the cockpit's own entry does it.
          await page.evaluate(() => {
            const view = window.__godsEyeView.styleManager.cockpitView;
            view.syncEntry();
            view.enter();
          });
          await page.waitForFunction(activeCockpit, { timeout: 10_000 });
          result.entry = `Contacts on, fixture aircraft tracked, then by code (C did not enter: ${JSON.stringify(result.before)})`;
        }
        console.log(`[INFO] Cockpit entered: ${result.entry}`);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await settle();
        assert.ok(await visible('#cockpit-layers'), 'Cockpit Layers is shown');
        assert.ok(
          await visible('#cockpit-presets'),
          'Cockpit Presets is shown',
        );
        assert.equal(
          await visible('#frame-bottom'),
          false,
          'The bottom bar is not drawn in the cockpit',
        );

        const measure = (menu) =>
          page.evaluate(
            (menu, instruments, rims) => {
              const shown = (node) => {
                if (!node || node.hidden) return false;
                const style = getComputedStyle(node);
                return (
                  style.display !== 'none' &&
                  style.visibility === 'visible' &&
                  node.getClientRects().length > 0
                );
              };
              const box = (node) => {
                const { left, top, right, bottom } =
                  node.getBoundingClientRect();
                return { left, top, right, bottom };
              };
              const list = (pairs) =>
                pairs
                  .map(([name, selector]) => [
                    name,
                    document.querySelector(selector),
                  ])
                  .filter(([, node]) => shown(node))
                  .map(([name, node]) => ({ name, ...box(node) }));
              const node = document.getElementById(menu);
              return {
                width: innerWidth,
                height: innerHeight,
                menu: shown(node) ? box(node) : null,
                inBody: node?.parentNode === document.body,
                instruments: list(instruments),
                rims: list(rims),
                buttons: list([
                  ['Layers', '#cockpit-layers'],
                  ['Presets', '#cockpit-presets'],
                  ['exit', '#map-view-switch'],
                  ['reset', '#cockpit-reset-globe'],
                ]),
              };
            },
            menu,
            INSTRUMENTS,
            RIMS,
          );
        const meet = (a, b) =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        const clear = async (menu, label) => {
          const data = await measure(menu);
          result[label] = data;
          assert.ok(data.menu, `The ${label} menu is drawn in the cockpit`);
          assert.ok(
            data.menu.left >= -0.5 &&
              data.menu.top >= -0.5 &&
              data.menu.right <= data.width + 0.5 &&
              data.menu.bottom <= data.height + 0.5,
            `The ${label} menu lies inside the window: ${JSON.stringify(data.menu)}`,
          );
          const under = [...data.instruments, ...data.buttons]
            .filter((part) => meet(part, data.menu))
            .map((part) => part.name);
          assert.deepEqual(under, [], `The ${label} menu meets an instrument`);
          result[`${label}Rims`] = data.rims
            .filter((rim) => meet(rim, data.menu))
            .map((rim) => rim.name);
          return data;
        };

        // Layers: the same #data-panel, by the cockpit's own button.
        await page.click('#cockpit-layers');
        const layersOpen = await onlyOpen(['layers'], 'Cockpit Layers opens');
        assert.equal(layersOpen.cockpit, true);
        assert.equal(
          await page.$eval('#cockpit-layers', (node) =>
            node.getAttribute('aria-expanded'),
          ),
          'true',
        );
        await clear('data-panel', 'layers');
        assert.equal(
          await page.$$eval('#data-panel [data-menu-section]', (links) =>
            links.some(
              (link) => !link.hidden && link.getClientRects().length > 0,
            ),
          ),
          false,
          'No footer links are visible in cockpit',
        );
        await shot('cockpit-layers-menu');
        await page.keyboard.press('Escape');
        const afterEscape = await onlyOpen([], 'Escape closes the layers menu');
        assert.equal(afterEscape.cockpit, true, 'Escape leaves the cockpit on');
        assert.equal(afterEscape.active, 'cockpit-layers');

        // Presets: the same #frame-presets-menu, moved to the body.
        await page.click('#cockpit-presets');
        await onlyOpen(['presets'], 'Cockpit Presets opens');
        const presets = await clear('frame-presets-menu', 'presets');
        assert.equal(presets.inBody, true, 'Presets is drawn from the body');
        await shot('cockpit-presets-menu');
        await page.keyboard.press('Escape');
        const presetsEscape = await onlyOpen([], 'Escape closes Presets');
        assert.equal(
          presetsEscape.cockpit,
          true,
          'Escape leaves the cockpit on',
        );

        assert.equal(
          presetsEscape.active,
          'cockpit-presets',
          'Presets returns focus to its cockpit button',
        );

        // A click outside: on the cockpit's help line, which presses nothing.
        const help = await page.$eval('.cockpit-help', (node) => {
          const { left, top, width, height } = node.getBoundingClientRect();
          return { x: left + width / 2, y: top + height / 2 };
        });
        for (const [button, name] of [
          ['#cockpit-layers', 'layers'],
          ['#cockpit-presets', 'presets'],
        ]) {
          await page.click(button);
          await onlyOpen([name], `Cockpit ${name} opens`);
          await page.mouse.click(help.x, help.y);
          const after = await onlyOpen([], `A click outside closes ${name}`);
          assert.equal(after.cockpit, true);
        }

        // F opens and closes the layers menu in the cockpit too.
        await blur();
        await page.keyboard.press('f');
        await onlyOpen(['layers'], 'F opens the layers menu in the cockpit');
        await blur();
        await page.keyboard.press('f');
        const afterF = await onlyOpen([], 'F closes it in the cockpit');
        assert.equal(afterF.cockpit, true);
        // At phone width, record only this piece's controls and menus.
        await resize(390, 844);
        for (const [button, name, id] of [
          ['#cockpit-layers', 'layers', 'data-panel'],
          ['#cockpit-presets', 'presets', 'frame-presets-menu'],
        ]) {
          assert.ok(
            await visible(button),
            `${name} route is visible at phone width`,
          );
          await page.click(button);
          await onlyOpen([name], `${name} opens at phone width`);
          const data = await measure(id);
          result[`${name}Phone`] = data;
          const route = data.buttons.find(
            (part) => part.name.toLowerCase() === name,
          );
          assert.ok(
            route &&
              route.left >= -0.5 &&
              route.top >= -0.5 &&
              route.right <= data.width + 0.5 &&
              route.bottom <= data.height + 0.5,
            `${name} button is inside the phone window`,
          );
          assert.ok(
            data.menu &&
              data.menu.left >= -0.5 &&
              data.menu.top >= -0.5 &&
              data.menu.right <= data.width + 0.5 &&
              data.menu.bottom <= data.height + 0.5,
            `${name} menu is inside the phone window`,
          );
          await shot(`cockpit-${name}-390x844`);
          await page.keyboard.press('Escape');
          await onlyOpen([], `${name} closes at phone width`);
        }
        await resize(1440, 900);
        await page.click('#cockpit-layers');
        await onlyOpen(['layers'], 'Layers is open when leaving cockpit');
        if (result.layersRims?.length || result.presetsRims?.length)
          console.log(
            `[INFO] Cockpit menu boxes meet the rims' boxes (arcs, reported only): layers ${JSON.stringify(result.layersRims)}, presets ${JSON.stringify(result.presetsRims)}`,
          );
      } finally {
        await page
          .evaluate(async () => {
            const { styleManager, dataManager } = window.__godsEyeView;
            if (styleManager.cockpitView.active)
              styleManager.cockpitView.exit();
            await styleManager.setContextMode('off');
            for (const id of ['flights', 'military'])
              await dataManager.setEnabled(id, false, { origin: 'user' });
          })
          .catch(() => {});
        report.transport.flightFixture = null;
        await page.setViewport(desktop);
      }
      const left = await state();
      assert.equal(left.cockpit, false, 'The cockpit is left');
      assert.deepEqual(
        openOnes(left),
        [],
        'Leaving cockpit closes its open menu',
      );
      assert.equal(
        await page.$eval(
          '#frame-presets-menu',
          (node) =>
            node.parentNode ===
            document.querySelector('#frame-bottom .frame-presets'),
        ),
        true,
        'Presets is back in its exact bottom-bar parent after the cockpit',
      );
    },
    { fatal: false },
  );
}
