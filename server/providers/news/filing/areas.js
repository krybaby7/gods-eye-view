/**
 * The filing list: the board's twelve Strength areas, in slot order (S1 to
 * S12), and the keep rule. The ids, definitions and keep rule are the exact
 * questions validated in the filing test of 2026-11-12; do not reword them,
 * or the test result no longer describes what the filer is asked. Labels
 * match the board's `shortLabel` for the same slots (checked by a test).
 */

export const FILING_AREAS = Object.freeze(
  [
    {
      id: 'economy',
      label: 'Economy',
      definition:
        'Productive economy: growth, industry, jobs, trade in goods, companies and markets when they matter nationally.',
    },
    {
      id: 'fiscal',
      label: 'Fiscal',
      definition:
        'Fiscal and financial: budgets, taxes, public debt, currency, central bank, banks, IMF programmes.',
    },
    {
      id: 'government',
      label: 'Government',
      definition:
        'Government and institutions: elections, leaders, cabinets, parliaments, courts ruling on power, corruption cases against officials, coups.',
    },
    {
      id: 'people',
      label: 'People',
      definition:
        'People and human capital: health and disease, education, population, migration, refugees and displacement.',
    },
    {
      id: 'society',
      label: 'Society',
      definition:
        'Society and legitimacy: protests, unrest, rights, justice and policing, press freedom, crime, polarisation.',
    },
    {
      id: 'military',
      label: 'Military',
      definition:
        'Military and security: armed conflict, strikes, armed groups, terrorism, defence forces, weapons.',
    },
    {
      id: 'energy',
      label: 'Energy',
      definition:
        'Energy: oil, gas, electricity, nuclear power, pipelines, fuel prices and supply.',
    },
    {
      id: 'food',
      label: 'Food',
      definition:
        'Food, water and environment: hunger and food prices, farming, water, climate, disasters, pollution.',
    },
    {
      id: 'logistics',
      label: 'Logistics',
      definition:
        'Infrastructure and logistics: ports, shipping, straits and canals, roads, rail, air transport, supply chains.',
    },
    {
      id: 'technology',
      label: 'Technology',
      definition:
        'Technology and information: chips, artificial intelligence, cyber attacks, internet shutdowns, telecoms, space.',
    },
    {
      id: 'diplomacy',
      label: 'Diplomacy',
      definition:
        'Diplomacy and external access: talks, summits, treaties, alliances, sanctions, recognition, disputes between states.',
    },
    {
      id: 'culture',
      label: 'Culture',
      definition:
        'Cultural and narrative influence: religion, heritage, propaganda and information campaigns, soft power, sport or arts only when political.',
    },
  ].map((area) => Object.freeze(area)),
);

export const FILING_AREA_IDS = Object.freeze(FILING_AREAS.map((a) => a.id));

export const KEEP_RULE =
  'Keep an item when it is news about how a country or the world is governed, secured, supplied or ' +
  'held together: politics, conflict, diplomacy, the economy at national scale, crises, rights. ' +
  'Drop an item when it is sport, entertainment, lifestyle, a human-interest piece, an obituary ' +
  'without political weight, routine municipal or local administration, a single ordinary crime, ' +
  'company or product news without national weight, or weather without a crisis.';

/** Area id → definition, in slot order: the `choice` question's criteria. */
export function areaCriteria() {
  return Object.fromEntries(FILING_AREAS.map((a) => [a.id, a.definition]));
}
