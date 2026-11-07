import { normalizeSearchRecord, normalizeSearchSnapshot } from './records.js';

export function createSearchesSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  endpoint = '/api/searches',
} = {}) {
  async function request(path = '', { method = 'GET', signal, body } = {}) {
    signal?.throwIfAborted();
    const response = await fetchImpl(endpoint + path, {
      method,
      signal,
      cache: 'no-store',
      headers:
        body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    signal?.throwIfAborted();
    if (!response.ok)
      throw Object.assign(
        new Error(
          payload?.reason ||
            payload?.message ||
            payload?.error ||
            `Searches HTTP ${response.status}`,
        ),
        { code: payload?.error, status: response.status },
      );
    if (!payload) throw new Error('Malformed Searches response');
    return payload;
  }

  return {
    async getSnapshot({ rev, asOf, signal } = {}) {
      const params = new URLSearchParams();
      if (rev) params.set('rev', rev);
      if (asOf) params.set('asOf', asOf);
      const payload = await request(params.size ? `?${params}` : '', {
        signal,
      });
      if (payload.unchanged) return payload;
      const snapshot = normalizeSearchSnapshot(payload);
      if (!snapshot) throw new Error('Malformed Searches snapshot');
      return snapshot;
    },
    ask(question, { agent, signal } = {}) {
      return request('', { method: 'POST', body: { question, agent }, signal });
    },
    action(action, { id, findingId, signal, ...fields }) {
      const path = `/${encodeURIComponent(id)}`;
      if (action === 'patch')
        return request(path, { method: 'PATCH', body: fields, signal });
      if (action === 'delete')
        return request(path, { method: 'DELETE', signal });
      if (action === 'deleteFinding')
        return request(`${path}/findings/${encodeURIComponent(findingId)}`, {
          method: 'DELETE',
          signal,
        });
      if (['update', 'retry', 'cancel'].includes(action))
        return request(`${path}/${action}`, {
          method: 'POST',
          body: fields,
          signal,
        });
      throw new TypeError(`Unknown search action: ${action}`);
    },
    async getRun(id, runId, { signal } = {}) {
      const path = `/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`;
      const payload = await request(path, { signal });
      const search = normalizeSearchRecord(payload.search ?? payload);
      if (!search) throw new Error('Malformed Searches run');
      return search;
    },
    getChanges(id, from, to, { signal } = {}) {
      const params = new URLSearchParams({ from, to });
      return request(`/${encodeURIComponent(id)}/changes?${params}`, {
        signal,
      });
    },
  };
}
