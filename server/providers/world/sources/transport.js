import { setTimeout as wait } from 'node:timers/promises';

const USER_AGENT =
  'GodsEyeView-WorldBoard/0.2 (https://github.com/krybaby7/gods-eye-view)';
const CONNECTION_ERRORS = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export function isConnectionError(error) {
  return (
    CONNECTION_ERRORS.has(error?.code) ||
    error?.errors?.some(isConnectionError) ||
    Boolean(error?.cause && isConnectionError(error.cause))
  );
}

function retryAt(response) {
  if (response.status !== 429 && response.status < 500) return 0;
  const header = response.headers.get('Retry-After')?.trim();
  if (!header) return 0;
  return /^\d+$/.test(header)
    ? Date.now() + Number(header) * 1000
    : Date.parse(header) || 0;
}

function untilReady(ready, signal) {
  if (!signal) return ready;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    ready.then(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    });
  });
}

function holdForBody(response, signal, release) {
  if (!response.body) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  function done() {
    signal?.removeEventListener('abort', done);
    release();
  }
  if (signal?.aborted) done();
  else signal?.addEventListener('abort', done, { once: true });
  const body = new ReadableStream(
    {
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            controller.close();
            done();
          } else {
            controller.enqueue(chunk.value);
          }
        } catch (error) {
          done();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          done();
        }
      },
    },
    { highWaterMark: 0 },
  );
  const tracked = new Response(body, response);
  Object.defineProperty(tracked, 'url', { value: response.url });
  return tracked;
}

export function createWorldFetch(
  fetchImpl = (...args) => globalThis.fetch(...args),
  { retryDelayMs = 500 } = {},
) {
  const hosts = new Map();
  async function requestOnHost(url, options) {
    const host = new URL(url).hostname;
    const lane = hosts.get(host) ?? { tail: Promise.resolve(), retryAt: 0 };
    const previous = lane.tail;
    const { promise, resolve } = Promise.withResolvers();
    const tail = previous.then(() => promise);
    lane.tail = tail;
    hosts.set(host, lane);
    tail.then(() => {
      if (lane.tail === tail && lane.retryAt <= Date.now()) hosts.delete(host);
    });
    const { signal, retryConnection = true, ...requestOptions } = options;
    try {
      await untilReady(previous, signal);
      while (lane.retryAt > Date.now()) {
        await wait(Math.min(lane.retryAt - Date.now(), 2_147_483_647), null, {
          signal,
        });
      }
      signal?.throwIfAborted();
      const headers = new Headers(options.headers);
      if (!headers.has('User-Agent')) headers.set('User-Agent', USER_AGENT);
      const request = () =>
        fetchImpl(url, { ...requestOptions, signal, headers });
      let response;
      try {
        response = await request();
      } catch (error) {
        if (!retryConnection || signal?.aborted || !isConnectionError(error))
          throw error;
        await wait(retryDelayMs, null, { signal });
        response = await request();
      }
      lane.retryAt = retryAt(response);
      return holdForBody(response, signal, resolve);
    } catch (error) {
      resolve();
      signal?.throwIfAborted();
      throw error;
    }
  }

  return async (url, options = {}) => {
    if (options.redirect && options.redirect !== 'follow') {
      return requestOnHost(url, options);
    }
    let next = url;
    let request = { ...options, redirect: 'manual' };
    for (let redirects = 0; ; redirects++) {
      const response = await requestOnHost(next, request);
      const location = response.headers.get('Location');
      if (!location || !REDIRECTS.has(response.status)) return response;
      await response.body?.cancel();
      if (redirects === 20)
        throw new Error('Too many World Board HTTP redirects');
      const destination = new URL(location, next);
      const headers = new Headers(request.headers);
      if (destination.origin !== new URL(next).origin) {
        for (const name of [
          'Authorization',
          'Cookie',
          'Proxy-Authorization',
          'Host',
        ])
          headers.delete(name);
      }
      const method = (request.method ?? 'GET').toUpperCase();
      const switchToGet =
        ((response.status === 301 || response.status === 302) &&
          method === 'POST') ||
        (response.status === 303 && method !== 'GET' && method !== 'HEAD');
      if (switchToGet) {
        for (const name of [
          'Content-Encoding',
          'Content-Language',
          'Content-Length',
          'Content-Location',
          'Content-Type',
        ])
          headers.delete(name);
        request = { ...request, method: 'GET', body: undefined };
      }
      request = { ...request, headers };
      next = destination.href;
    }
  };
}
