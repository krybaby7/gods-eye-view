import { lensValue, scoreColor } from './model.js';

const strengthStops = ['Weak', 'Midrange', 'Strong'];

export const baseWorldLenses = [
  {
    id: 'condition',
    label: 'Condition',
    order: 10,
    legend: () => ({
      name: 'Condition',
      stops: strengthStops,
      note: 'World Bank · IMF · UCDP · V-Dem',
    }),
  },
  {
    id: 'strength',
    label: 'Strength',
    order: 20,
    legend: (snapshot) => {
      const area = snapshot.indicators?.find(
        ({ slot }) => slot === snapshot.area,
      );
      return {
        name: area ? `Strength · ${area.shortLabel}` : 'Strength',
        stops: strengthStops,
        note: area
          ? (snapshot.sources?.find(({ id }) => id === area.source)?.name ??
            'Published source data')
          : 'World Bank · IMF · UCDP · V-Dem',
      };
    },
  },
  {
    id: 'data-age',
    label: 'Data age',
    order: 40,
    legend: () => ({
      name: 'Data age',
      stops: ['8+ years old', '4 years old', 'Current year'],
      note: 'Annual source data · forecasts excluded',
    }),
  },
];

export function worldLegend(snapshot) {
  return (
    baseWorldLenses.find(({ id }) => id === snapshot.lens) ?? baseWorldLenses[0]
  ).legend(snapshot);
}

export function worldLensColor(definition, country, snapshot) {
  if (!country || country.kind === 'disputed') return null;
  if (definition?.color) return definition.color(country, snapshot);
  const year =
    Number(snapshot.asOf?.slice(0, 4)) || new Date().getUTCFullYear();
  const score = lensValue(country, snapshot.lens, snapshot.area, year);
  return Number.isFinite(score) ? scoreColor(score) : null;
}
