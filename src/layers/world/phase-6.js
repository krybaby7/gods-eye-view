import { flagLabels, liveFlags, startLiveTimers } from './events.js';
import { renderLiveFlagPanel } from '../../ui/worldLiveFlagPanel.js';

function liveOverlay({ viewer, signal, fixtures, refresh }) {
  let latest;
  const document = viewer.scene.canvas.ownerDocument;
  const banner = document.createElement('a');
  banner.className = 'world-live-fao world-board-hud';
  banner.id = 'world-live-fao';
  banner.hidden = true;
  banner.target = '_blank';
  banner.rel = 'noopener noreferrer';
  document.getElementById('world-lens-bar')?.after(banner);
  const stop = startLiveTimers({
    refresh,
    snapshot: () => latest,
    signal,
    fixtures,
  });
  return {
    update(snapshot) {
      latest = snapshot;
      const item = snapshot.features?.['live-fao']?.banner;
      banner.hidden = !item || !snapshot.visible;
      if (item && !banner.hidden) {
        banner.textContent = item.label + ' · FAO · ' + item.date;
        banner.href =
          'https://www.fao.org/worldfoodsituation/foodpricesindex/en/';
      }
    },
    destroy() {
      stop();
      banner.remove();
    },
  };
}

export default {
  overlays: [liveOverlay],
  rowFlags: [
    (row, { snapshot, sheetModel }) =>
      flagLabels(snapshot, sheetModel.iso3, row.slot),
  ],
  hoverFlags: [(iso3, snapshot) => flagLabels(snapshot, iso3)],
  header: [
    ({ document, snapshot, sheetModel }) =>
      renderLiveFlagPanel(document, liveFlags(snapshot, sheetModel.iso3)),
  ],
};
