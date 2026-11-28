import { MENU_SECTIONS } from './menuSections.js';

const CONTROLS = {
  'menu:layers': '#frame-layers',
  'menu:presets': '#frame-presets',
};

function visible(element) {
  return Boolean(element?.getClientRects().length);
}

export function boardSearchCommands(document, toolsMenu) {
  const commands = new Set();
  if (
    visible(document.getElementById('frame-today-fold')) ||
    visible(document.getElementById('frame-today-open'))
  ) {
    commands.add('menu:today');
  }
  for (const section of MENU_SECTIONS)
    if (toolsMenu.canOpen(section)) commands.add(`menu:${section}`);
  const tour = document.getElementById('frame-menu-item-tour');
  if (tour && !tour.hidden && !tour.disabled) commands.add('menu:tour');
  for (const [command, selector] of Object.entries(CONTROLS))
    if (visible(document.querySelector(selector))) commands.add(command);
  if (
    commands.has('menu:presets') &&
    document.querySelector(
      '#frame-presets-menu [data-lens-id="hazards"]:enabled',
    )
  )
    commands.add('preset:hazards');
  return commands;
}

function openButton(document, id) {
  const button = document.querySelector(id);
  if (!visible(button) || button.disabled) return null;
  if (button.getAttribute('aria-expanded') === 'false') button.click();
  return button.getAttribute('aria-expanded') === 'true' ? button : null;
}

function focusControl(document, control) {
  if (!visible(control) || control.disabled) return false;
  control.focus();
  return document.activeElement === control;
}

export function openBoardSearchControl(
  document,
  target,
  toolsMenu,
  openLayers,
  returnFocus,
) {
  if (target.kind === 'layer') {
    const control = document.querySelector(
      `[data-layer-id="${target.id}"] button.data-toggle-btn`,
    );
    return (
      Boolean(
        visible(document.getElementById('frame-layers')) && openLayers(),
      ) && focusControl(document, control)
    );
  }

  if (target.id === 'preset:hazards') {
    const control = document.querySelector(
      '#frame-presets-menu [data-lens-id="hazards"]:enabled',
    );
    return (
      Boolean(control && openButton(document, '#frame-presets')) &&
      focusControl(document, control)
    );
  }

  if (target.id === 'menu:today') {
    const rail = document.getElementById('frame-today-open');
    if (visible(rail)) rail.click();
    return focusControl(document, document.getElementById('frame-today-fold'));
  }

  if (target.id === 'menu:tour') {
    const tour = document.getElementById('frame-menu-item-tour');
    if (!tour || tour.hidden || tour.disabled) return false;
    tour.click();
    return true;
  }

  if (target.id === 'menu:layers')
    return Boolean(
      visible(document.getElementById('frame-layers')) && openLayers(),
    );

  const control = CONTROLS[target.id];
  if (control) return focusControl(document, openButton(document, control));

  const section = target.id.replace(/^menu:/u, '');
  return toolsMenu.open(section, { returnFocus });
}
