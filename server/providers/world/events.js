import { registerWorldSources } from './refreshRegistry.js';
import { debtDistress } from './sources/liveDebtDsa.js';
import { gdacs } from './sources/liveDisasters.js';
import { savedUcdp, unhcr } from './sources/liveDisplacement.js';
import { coups, gdelt } from './sources/liveGovernance.js';
import { optionalLiveSources } from './sources/liveOptional.js';
import { fao, fx, imfCpi } from './sources/livePrices.js';

registerWorldSources(
  {
    'live-gdacs': gdacs,
    'live-fx': fx,
    'live-coups': coups,
    'live-gdelt': gdelt,
    'live-fao': fao,
    'live-imf-cpi': imfCpi,
    'live-unhcr': unhcr,
    'live-ucdp-saved': savedUcdp,
    'live-debt-dsa': debtDistress,
    ...optionalLiveSources(),
  },
  { 'live-ucdp-saved': 'ucdp' },
);
