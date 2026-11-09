import {
  renderAssetCard,
  renderAssetsTab,
  renderNuclearBadge,
} from '../../ui/worldAssetPanels.js';
import { createAssetOverlay } from './assetOverlay.js';
import { ownershipLens } from './assets.js';

export default {
  lenses: [ownershipLens],
  overlays: [createAssetOverlay],
  tabs: [{ id: 'assets', render: renderAssetsTab }],
  cards: [{ type: 'asset', label: 'Asset', render: renderAssetCard }],
  header: [renderNuclearBadge],
};
