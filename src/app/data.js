import { LayerLifecycle } from '../data/lifecycle.js';
import { LayerPresentation } from './layerPresentation.js';
import { createCyberSonarScene } from '../cyberSonarScene.js';
import { LENSES } from '../lenses/catalog.js';
import { createLensBar } from '../ui/lensBar.js';
import { lensLayerSnapshots } from './lensLayers.js';
/** Register the application layer catalog before allowing state restoration. */
export function createApplicationData({
  scene: { viewer, mapStackController },
  controls: { styleManager },
  catalog,
  allowQaRegistration,
  onData,
  defer,
}) {
  // Initialize data layer manager
  const dataManager = new LayerLifecycle(viewer, {
    allowQaRegistration,
    getSourceAvailability: catalog?.getSourceAvailability,
  });
  defer(async () => {
    await dataManager.destroyAll();
    if (dataManager.layers.size)
      throw new Error(
        `Data layers could not be destroyed: ${[...dataManager.layers.keys()].join(', ')}`,
      );
  });
  const presentation = new LayerPresentation(dataManager, {
    weatherClock: catalog?.weatherClock,
  });
  defer(() => presentation.destroy());
  onData?.(dataManager);
  if (!catalog?.layers || !catalog?.metadata)
    throw new TypeError('An application layer catalog is required');
  for (const layer of catalog.layers) dataManager.register(layer);
  for (const layer of catalog.layers) layer.attachDataManager?.(dataManager);
  for (const layer of catalog.layers)
    layer.attachMapStackController?.(mapStackController);
  // Restoration starts only after the caller's complete registry is sealed.
  dataManager.finalizeRegistrations(catalog.metadata);
  if (allowQaRegistration) {
    window.__gevQaRegisterLayer = (targetManager, layerModule) => {
      if (targetManager !== dataManager)
        throw new Error('QA layer manager mismatch');
      return dataManager.registerForQa(layerModule);
    };
    window.__gevQaUnregisterLayer = (targetManager, layerId) => {
      if (targetManager !== dataManager)
        throw new Error('QA layer manager mismatch');
      return dataManager.unregisterForQa(layerId);
    };
    const register = window.__gevQaRegisterLayer;
    const unregister = window.__gevQaUnregisterLayer;
    defer(() => {
      if (window.__gevQaRegisterLayer === register)
        delete window.__gevQaRegisterLayer;
      if (window.__gevQaUnregisterLayer === unregister)
        delete window.__gevQaUnregisterLayer;
    });
  }
  presentation.mount(document.getElementById('data-toggles'));
  const lensBar = createLensBar({
    container: document.getElementById('lens-bar'),
    getLayers: () => lensLayerSnapshots(dataManager, catalog),
    setEnabled: (id, enabled, options) =>
      dataManager.setEnabled(id, enabled, options),
    subscribeActivity: (listener) => dataManager.subscribeActivity(listener),
    onLayout: () =>
      styleManager._scheduleLeftPanelLayout?.({ reconsiderAutoCollapse: true }),
  });
  defer(() => lensBar.destroy());
  const localAdsb = catalog.get?.('local-adsb');
  for (const session of [localAdsb?.receiver, localAdsb?.feeds]) {
    if (typeof session?.subscribe === 'function')
      defer(session.subscribe(() => dataManager.refreshLayerStats()));
  }
  styleManager.setLensShortcutHandler?.((hotkey) => {
    const lens = LENSES.find((candidate) => candidate.hotkey === hotkey);
    if (lens) return lensBar.click(lens.id);
  });
  defer(() => styleManager.setLensShortcutHandler?.(null));
  styleManager.attachDataManager(dataManager);
  defer(createCyberSonarScene(viewer, dataManager));

  return { dataManager, catalog, presentation, lensBar };
}
