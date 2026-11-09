import * as imf from './sources/imf.js';
import * as ucdp from './sources/ucdp.js';
import * as vdem from './sources/vdem.js';
import * as worldbank from './sources/worldbank.js';

export const worldAdapters = { worldbank, imf, ucdp, vdem };
export const worldRefreshSteps = { ucdp: 'worldbank' };
export const worldFeatureViews = new Map();

// A phase registers its adapters once from its own module.
export function registerWorldSources(adapters, after = {}) {
  Object.assign(worldAdapters, adapters);
  Object.assign(worldRefreshSteps, after);
}

// Keep full source results in the store. Each lens defines its public summary
// and selects only the rows needed by its detail view.
export function registerWorldFeatureView(lens, view) {
  if (worldFeatureViews.has(lens)) {
    throw new Error(`Duplicate World Board feature view: ${lens}`);
  }
  worldFeatureViews.set(lens, view);
}
