import { registerWorldSources } from './refreshRegistry.js';
import * as curated from './sources/relationsCurated.js';
import * as ucdp from './sources/relationsUcdp.js';
import * as voting from './sources/relationsVoting.js';
import { blocAdapter, diplomacyAdapter } from './sources/relationsWikidata.js';
import {
  ofacSanctions,
  ukSanctions,
  unSanctions,
} from './sources/relationsSanctions.js';

registerWorldSources({
  'relations-curated': curated,
  'relations-ucdp': ucdp,
  'relations-voting': voting,
  'relations-blocs': blocAdapter,
  'relations-diplomatic': diplomacyAdapter,
  'relations-sanctions-un': unSanctions,
  'relations-sanctions-uk': ukSanctions,
  'relations-sanctions-ofac': ofacSanctions,
});
