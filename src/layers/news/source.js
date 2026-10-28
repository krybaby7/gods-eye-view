import { normalizeNewsSnapshot } from './records.js';

/**
 * War monitor endpoints: the collected items and digested stories, and the
 * Refresh action that runs one digest. Construction makes no request.
 * @param {{fetchImpl?: Function, endpoint?: string}} [options]
 */
export function createNewsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  endpoint = '/api/news',
} = {}) {
  const query = (params) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params))
      if (value) search.set(key, value);
    const text = search.toString();
    return text ? `?${text}` : '';
  };
  return {
    /**
     * @param {{signal?: AbortSignal, theater?: string, rev?: string}} [options]
     * @returns {Promise<object>} A normalized snapshot, or `{unchanged: true}`.
     */
    async getSnapshot({ signal, theater, rev } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(
        `${endpoint}${query({ theater, rev })}`,
        {
          signal,
          cache: 'no-store',
        },
      );
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        /* status below remains authoritative */
      }
      signal?.throwIfAborted();
      if (!response.ok) throw new Error(`News HTTP ${response.status}`);
      if (payload?.unchanged === true)
        return { unchanged: true, revision: String(payload.revision || '') };
      const snapshot = normalizeNewsSnapshot(payload);
      if (!snapshot) throw new Error('Malformed news snapshot');
      return snapshot;
    },

    /**
     * Run one digest. Resolves to a plain outcome; HTTP refusals are
     * outcomes, not exceptions.
     * @param {{signal?: AbortSignal, theater?: string}} [options]
     */
    async requestDigest({ signal, theater } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(
        `${endpoint}/digest${query({ theater })}`,
        {
          method: 'POST',
          signal,
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        },
      );
      let body = null;
      try {
        body = await response.json();
      } catch {
        /* handled below */
      }
      if (response.status === 503 && body?.error === 'no_key')
        return { ok: false, keyRequired: true, error: 'no_key' };
      if (response.ok)
        return body?.skipped
          ? { ok: true, skipped: true, message: body.message, run: body.run }
          : {
              ok: true,
              run: body?.run ?? null,
              briefRun: body?.briefRun ?? null,
              budget: body?.budget ?? null,
            };
      return {
        ok: false,
        status: response.status,
        error: body?.error || `HTTP ${response.status}`,
        message: body?.reason || body?.message || null,
        run: body?.run ?? null,
      };
    },

    /**
     * Retry brief: rerun the brief for the latest digest after its brief
     * failed. Resolves to a plain outcome, like requestDigest.
     * @param {{signal?: AbortSignal, theater?: string}} [options]
     */
    async requestBrief({ signal, theater } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(
        `${endpoint}/brief${query({ theater })}`,
        {
          method: 'POST',
          signal,
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        },
      );
      let body = null;
      try {
        body = await response.json();
      } catch {
        /* handled below */
      }
      if (response.status === 503 && body?.error === 'no_key')
        return { ok: false, keyRequired: true, error: 'no_key' };
      if (response.ok)
        return {
          ok: true,
          briefRun: body?.briefRun ?? null,
          budget: body?.budget ?? null,
        };
      return {
        ok: false,
        status: response.status,
        error: body?.error || `HTTP ${response.status}`,
        message: body?.reason || body?.message || null,
        briefRun: body?.briefRun ?? null,
      };
    },
  };
}
