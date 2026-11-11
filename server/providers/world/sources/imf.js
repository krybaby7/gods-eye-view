import { readResponseJsonCapped } from '../../common/http.js';
import {
  countryCode,
  fetchResponseWithDeadline,
  monthIndex,
  observation,
  releaseDue,
  sourceCountries,
} from './common.js';

export const version = 1;

export function shouldCheck(context) {
  return releaseDue(context, (date) => {
    const month = date.getUTCMonth();
    const season = month >= 9 ? 9 : month >= 3 ? 3 : 0;
    return monthIndex(date) - month + season;
  });
}

export async function fetchObservations({ fetchImpl, registry, now, signal }) {
  const countries = sourceCountries(registry);
  const year = now.getUTCFullYear();
  const series = registry.indicators.filter(({ source }) => source === 'imf');
  const results = await Promise.all(
    series.map(async ({ id, sourceCode }) => {
      const url = `https://www.imf.org/external/datamapper/api/v1/${encodeURIComponent(sourceCode)}?periods=${year},${year + 1}`;
      const data = await fetchResponseWithDeadline(fetchImpl, url, {
        signal,
        read: readResponseJsonCapped,
      });
      const values = data?.values?.[sourceCode];
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new Error(`Missing IMF DataMapper series ${sourceCode}`);
      }
      return countries.flatMap((country) => {
        const value = values[countryCode(country, 'imf')]?.[year];
        return Number.isFinite(value)
          ? observation(now, id, country.iso3, value, String(year), {
              method: 'source-forecast',
            })
          : [];
      });
    }),
  );
  return {
    observations: results.flat(),
    detail:
      'DataMapper current-year forecasts. The response does not identify the WEO vintage.',
  };
}
