export function createWorldSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  endpoint = '/api/world',
} = {}) {
  let details = new Map();

  async function request(path, method, { signal } = {}) {
    const response = await fetchImpl(endpoint + path, {
      method,
      signal,
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    signal?.throwIfAborted();
    if (!response.ok)
      throw new Error(
        payload?.message ||
          payload?.error ||
          `World Board HTTP ${response.status}`,
      );
    return payload;
  }

  async function getSnapshot(options) {
    const payload = await request('', 'GET', options);
    if (
      !Array.isArray(payload?.countryIndex) ||
      !Array.isArray(payload.indicators) ||
      !Array.isArray(payload.sources) ||
      !payload.countries ||
      Array.isArray(payload.countries) ||
      typeof payload.countries !== 'object'
    ) {
      throw new Error('Malformed World Board snapshot');
    }
    return payload;
  }

  async function getProgress(path, method, options) {
    const payload = await request(path, method, options);
    if (
      !Number.isSafeInteger(payload?.revision) ||
      payload.revision < 0 ||
      (payload.refresh !== null &&
        !Number.isSafeInteger(payload.refresh?.completed))
    ) {
      throw new Error('Malformed World Board progress');
    }
    return payload;
  }

  async function getDetail(country, lens, { signal } = {}) {
    signal?.throwIfAborted();
    const params = new URLSearchParams();
    if (country != null) params.set('country', country);
    params.set('lens', lens);
    const key = params.toString();
    const cache = details;
    if (!cache.has(key)) {
      const pending = request('/detail?' + key, 'GET').then((payload) => {
        if (
          payload?.lens !== lens ||
          payload.country !== (country ?? null) ||
          !Object.hasOwn(payload, 'data')
        ) {
          throw new Error('Malformed World Board detail');
        }
        return payload.data;
      });
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
    }
    const pending = cache.get(key);
    if (!signal) return pending;

    // A caller can stop waiting without cancelling the shared request.
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      signal.throwIfAborted();
      const data = await Promise.race([pending, cancelled]);
      signal.throwIfAborted();
      return data;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  return {
    getSnapshot,
    getProgress: (options) => getProgress('/progress', 'GET', options),
    refresh: (options) => getProgress('/refresh', 'POST', options),
    getDetail,
    invalidateDetails() {
      details = new Map();
    },
  };
}
