import { createSurfaceKeyboard } from './ui/surfaceKeyboard.js';

export const FIRST_RUN_STORAGE_KEY = 'gev:first-run-tour:v1';

const intro = {
  title: 'Welcome to Global Eye View',
  description: 'Explore countries and public data on an interactive globe.',
};

const steps = [
  {
    title: 'Today',
    description:
      'Today is on the left. Use its button to fold the list away or open it again.',
  },
  {
    title: 'Find a country',
    description: 'Select a country on the globe to open its sheet.',
  },
  {
    title: 'Country sheet',
    description:
      'Start with the overview, then open a tab to see more detail and its sources.',
  },
  {
    title: 'Menu',
    description:
      'Open Menu for settings and tools. Choose Show the tour whenever you want to see these steps again.',
  },
];

const exclusiveSurfaceClasses = [
  'cockpit-mode',
  'scene-playback-mode',
  'recording-mode',
  'ui-clean-view',
];

function storeAccess(kind, injected, write) {
  try {
    const store = injected === undefined ? globalThis[kind] : injected;
    if (write) store?.setItem(FIRST_RUN_STORAGE_KEY, 'seen');
    else return store?.getItem(FIRST_RUN_STORAGE_KEY);
  } catch {
    // When durable storage is blocked, dismissal can still be remembered for the tab.
  }
}

function isEmbedded(params) {
  return params.get('embed') === '1' || globalThis.GEV_EMBED_INLINE === true;
}

export function shouldShowFirstRun({
  hasShareState = false,
  storage,
  sessionStorageRef,
  location = globalThis.location,
} = {}) {
  const params = new URLSearchParams(location?.search);
  if (hasShareState || isEmbedded(params) || params.get('setup') === '1')
    return false;
  if (params.get('welcome') === '0') return false;
  if (params.get('welcome') === '1') return true;
  return (
    storeAccess('localStorage', storage) !== 'seen' &&
    storeAccess('sessionStorage', sessionStorageRef) !== 'seen'
  );
}

/** Give an introduction after startup and keep replay available from Menu. */
export function initFirstRunExperience({
  styleManager,
  documentRef = globalThis.document,
  storage,
  sessionStorageRef,
  location = globalThis.location,
} = {}) {
  const find = (id) => documentRef?.getElementById(id);
  const root = find('first-run-launcher');
  const params = new URLSearchParams(location?.search);
  if (!root || root.dataset.initialized || isEmbedded(params)) return null;
  root.dataset.initialized = 'true';

  const heading = find('first-run-title');
  const description = find('first-run-description');
  const progress = find('first-run-progress');
  const back = root.querySelector('[data-first-run-back]');
  const next = root.querySelector('[data-first-run-next]');
  const skip = root.querySelector('[data-first-run-skip]');
  const replay = find('frame-menu-item-tour');

  const blocked = () => {
    const focus = documentRef.activeElement;
    const dialog =
      focus?.closest?.('[role="dialog"]') ??
      focus?.closest?.('.cesium-credit-lightbox');
    return (
      (dialog && dialog !== root) ||
      exclusiveSurfaceClasses.some((name) =>
        documentRef.body.classList.contains(name),
      )
    );
  };
  let step = -1;
  let pending = shouldShowFirstRun({
    hasShareState: styleManager?.hasShareState,
    storage,
    sessionStorageRef,
    location,
  });

  function isTopmost() {
    if (root.hidden || blocked()) return false;
    if (!documentRef.elementFromPoint) return true;
    const rect = root.getBoundingClientRect();
    const hit = documentRef.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return !hit || root.contains(hit);
  }

  function dismiss({ restoreFocus = true, remember = true } = {}) {
    if (root.hidden) return;
    if (remember) {
      storeAccess('localStorage', storage, true);
      storeAccess('sessionStorage', sessionStorageRef, true);
    }
    root.classList.remove('visible');
    root.hidden = true;
    keyboard.deactivate({ restoreFocus });
  }

  const keyboard = createSurfaceKeyboard({
    root,
    documentRef,
    isActive: isTopmost,
    onEscape: dismiss,
    fallbackFocus: () => find('frame-menu'),
  });

  function render() {
    const welcome = step < 0;
    const content = welcome ? intro : steps[step];
    heading.textContent = content.title;
    description.textContent = content.description;
    progress.hidden = welcome;
    if (!welcome) progress.textContent = `${step + 1} of ${steps.length}`;
    back.hidden = step <= 0;
    next.textContent = welcome
      ? 'Start tour'
      : step === steps.length - 1
        ? 'Finish'
        : 'Next';
    (welcome ? next : heading).focus({ preventScroll: true });
  }

  function show(startAt) {
    if (blocked()) return;
    pending = false;
    step = startAt;
    root.hidden = false;
    root.classList.add('visible');
    keyboard.activate();
    render();
  }

  const advance = () => {
    if (step === steps.length - 1) dismiss();
    else {
      step += 1;
      render();
    }
  };
  const previous = () => {
    if (step <= 0) return;
    step -= 1;
    render();
  };
  const startTour = () => show(0);
  const skipTour = () => dismiss();

  function syncSurface() {
    if (blocked()) dismiss({ restoreFocus: false, remember: false });
    else if (pending) show(-1);
  }

  if (replay) replay.hidden = false;
  const controls = [
    [back, previous],
    [next, advance],
    [skip, skipTour],
    [replay, startTour],
  ];
  for (const [button, handler] of controls)
    button?.addEventListener('click', handler);

  const observer =
    typeof MutationObserver === 'function'
      ? new MutationObserver(syncSurface)
      : null;
  observer?.observe(documentRef.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
  documentRef.addEventListener('focusin', syncSurface);
  syncSurface();

  return {
    dismiss,
    isTopmost,
    destroy() {
      observer?.disconnect();
      documentRef.removeEventListener('focusin', syncSurface);
      dismiss({ restoreFocus: false, remember: false });
      keyboard.destroy();
      for (const [button, handler] of controls)
        button?.removeEventListener('click', handler);
      if (replay) replay.hidden = true;
      delete root.dataset.initialized;
    },
  };
}
