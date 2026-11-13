import {
  renderChokepoint,
  renderExposure,
  renderLeverage,
} from '../../ui/worldEnergyPanels.js';
import { energyLens } from './energy.js';
import { createEnergyOverlay } from './energyOverlay.js';

export default {
  lenses: [energyLens],
  overlays: [createEnergyOverlay],
  tabs: [
    { id: 'exposure', render: renderExposure },
    { id: 'leverage', label: 'Leverage', order: 45, render: renderLeverage },
  ],
  cards: [
    { type: 'chokepoint', label: 'Chokepoint', render: renderChokepoint },
  ],
};
