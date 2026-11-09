const HOUR = 3_600_000;

export function actorSourceDue({ data, lastCheckedAt, now }, hours) {
  return (
    !(Date.parse(data?.retryAt) > +now) &&
    !(+now - Date.parse(lastCheckedAt) < hours * HOUR)
  );
}

export async function fetchActorSource(fetchImpl, url, now, options = {}) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(options.timeout ?? 12_000),
    headers: options.headers,
  });
  if (response.ok) return response;
  await response.body?.cancel();
  const error = new Error(
    'HTTP ' + response.status + ' from ' + new URL(url).hostname,
  );
  if (response.status === 429) {
    const retry = response.headers.get('Retry-After')?.trim() ?? '';
    const requested = /^\d+$/.test(retry)
      ? +now + Number(retry) * 1000
      : Date.parse(retry);
    const retryAt = Number.isFinite(requested)
      ? Math.max(requested, +now + 1000)
      : +now + HOUR;
    error.retryAt = new Date(retryAt).toISOString();
  }
  throw error;
}

export function safeHttps(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password)
      return url.href;
  } catch {
    return null;
  }
  return null;
}
