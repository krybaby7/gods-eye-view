import {
  readResponseBytesCapped,
  readResponseJsonCapped,
  readResponseTextCapped,
} from '../../common/http.js';
import { fetchResponse } from './common.js';

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

export function due(context, interval) {
  const checked = Date.parse(context.lastCheckedAt);
  return !Number.isFinite(checked) || +context.now - checked >= interval;
}

export function countryIds(registry) {
  return new Set(registry.countries.map(({ iso3 }) => iso3));
}

export async function download(
  fetchImpl,
  url,
  kind = 'json',
  cap = 6_000_000,
  accept,
) {
  const signal = AbortSignal.timeout(35_000);
  const fetch = accept
    ? (url, options) =>
        fetchImpl(url, { ...options, headers: { Accept: accept } })
    : fetchImpl;
  const response = await fetchResponse(fetch, url, signal);
  const readers = {
    json: readResponseJsonCapped,
    text: readResponseTextCapped,
    bytes: readResponseBytesCapped,
  };
  return readers[kind](response, cap, signal);
}

export function dateOf(value) {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toISOString().slice(0, 10)
    : null;
}
