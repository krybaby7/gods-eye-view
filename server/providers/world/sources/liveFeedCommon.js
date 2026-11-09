import {
  readResponseBytesCapped,
  readResponseJsonCapped,
  readResponseTextCapped,
} from '../../common/http.js';

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
const retryAfter = new Map();

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
  const origin = new URL(url).origin;
  const now = Date.now();
  if (retryAfter.get(origin) > now)
    throw new Error(
      'Live source request deferred after HTTP 429 from ' + origin,
    );
  retryAfter.delete(origin);
  const signal = AbortSignal.timeout(35_000);
  const response = await fetchImpl(url, {
    signal,
    ...(accept && { headers: { Accept: accept } }),
  });
  if (!response.ok) {
    if (response.status === 429) {
      const value = response.headers.get('retry-after')?.trim() ?? '';
      const received = Date.now();
      const deadline = /^\d+$/.test(value)
        ? received + Number(value) * 1000
        : Date.parse(value);
      retryAfter.set(
        origin,
        Number.isFinite(deadline) ? deadline : received + HOUR,
      );
    }
    await response.body?.cancel();
    throw Object.assign(
      new Error('HTTP ' + response.status + ' from ' + origin),
      { status: response.status },
    );
  }
  const readers = {
    json: readResponseJsonCapped,
    text: readResponseTextCapped,
    bytes: readResponseBytesCapped,
  };
  try {
    return await readers[kind](response, cap, signal);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error('Invalid JSON from ' + origin);
    throw error;
  }
}

export function dateOf(value) {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toISOString().slice(0, 10)
    : null;
}
