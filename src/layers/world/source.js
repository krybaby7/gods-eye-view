export function createWorldSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  endpoint = '/api/world',
} = {}) {
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

  return {
    getSnapshot: (options) => request('', 'GET', options),
    refresh: (options) => request('/refresh', 'POST', options),
  };
}
