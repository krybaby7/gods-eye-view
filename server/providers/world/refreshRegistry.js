import * as imf from './sources/imf.js';
import * as ucdp from './sources/ucdp.js';
import * as vdem from './sources/vdem.js';
import * as worldbank from './sources/worldbank.js';

export const worldAdapters = { worldbank, imf, ucdp, vdem };
export const worldRefreshSteps = { ucdp: 'worldbank' };

// A phase registers its adapters once from its own module.
export function registerWorldSources(adapters, after = {}) {
  Object.assign(worldAdapters, adapters);
  Object.assign(worldRefreshSteps, after);
}
