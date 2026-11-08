export function monthIndex(date) {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

export function releaseDue({ lastCheckedAt, now }, releaseMonth) {
  const checked = new Date(lastCheckedAt ?? NaN);
  return !Number.isFinite(+checked) || monthIndex(checked) < releaseMonth(now);
}

export function countryCode(country, source) {
  return country.aliases?.[source] ?? country.iso3;
}

export function sourceCountries(registry) {
  return registry.countries.filter(
    ({ kind, dataIso3 }) => kind !== 'disputed' && !dataIso3,
  );
}

export async function fetchResponse(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response;
}

export function observation(
  now,
  indicator,
  iso3,
  value,
  period,
  { publishedAt = null, sourceVersion = null, method = 'observed' } = {},
) {
  return {
    iso3,
    indicator,
    value,
    period,
    publishedAt,
    retrievedAt: now.toISOString(),
    sourceVersion,
    method,
  };
}
