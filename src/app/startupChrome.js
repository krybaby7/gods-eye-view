import { initFirstRunExperience } from '../firstRunExperience.js';

/** Reveal welcome controls only after restoration and the loading transition. */
export function startApplicationChrome({
  loadingScreen,
  styleManager,
  dataManager,
  signal,
  initializeWelcome = initFirstRunExperience,
  initializeSettings,
}) {
  let disposed = false;
  let firstRun;
  let revealTimer;
  let resolveDelay;
  const document = loadingScreen.ownerDocument;
  const searchButtons =
    !signal.aborted && dataManager?.layers?.has('searches')
      ? [...(document?.querySelectorAll('[data-open-search-layers]') ?? [])]
      : [];
  const openSearchLayers = async () => {
    const enabled = await dataManager.setEnabled('searches', true, {
      origin: 'user',
      signal,
    });
    if (!enabled || disposed || signal.aborted) return;
    styleManager.setPanelCollapsed('searches-panel', false, { explicit: true });
    if (firstRun?.isTopmost?.()) firstRun.dismiss({ restoreFocus: false });
    document
      .querySelector('#searches-panel .searches-question')
      ?.focus({ preventScroll: true });
  };
  for (const button of searchButtons) {
    button.hidden = false;
    button.addEventListener('click', openSearchLayers);
  }
  const minimumDelay = new Promise((resolve) => {
    resolveDelay = resolve;
  });
  const delayTimer = setTimeout(resolveDelay, 1000);
  const revealFirstRun = () => {
    if (disposed || signal.aborted || firstRun) return;
    firstRun = initializeWelcome?.({ styleManager, dataManager });
    clearTimeout(revealTimer);
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
  };
  void Promise.all([styleManager.initialRestorePromise, minimumDelay])
    .catch(() => {
      /* Restoration reports its own outcome through the controls. */
    })
    .then(() => {
      if (disposed || signal.aborted) return;
      loadingScreen.classList.add('hidden');
      loadingScreen.addEventListener('transitionend', revealFirstRun, {
        once: true,
      });
      revealTimer = setTimeout(revealFirstRun, 900);
    });
  const keySetup = Promise.resolve(
    signal.aborted ? null : initializeSettings?.({ signal }),
  );
  // Own the pending initializer too; it must not reveal a dialog after abort.
  void keySetup.catch(() =>
    console.error('Provider settings initialization failed'),
  );
  return async () => {
    disposed = true;
    for (const button of searchButtons) {
      button.removeEventListener('click', openSearchLayers);
      button.hidden = true;
    }
    clearTimeout(delayTimer);
    clearTimeout(revealTimer);
    resolveDelay();
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
    firstRun?.destroy();
    (await keySetup.catch(() => null))?.destroy();
  };
}
