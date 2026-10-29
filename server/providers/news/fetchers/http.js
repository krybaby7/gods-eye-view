import { gunzipSync } from 'node:zlib';

import { readResponseBytesCapped } from '../../common/http.js';

export const NEWS_USER_AGENT =
  'GodsEyeView/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

function charsetOf(contentType, bytes) {
  const header = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '')?.[1];
  if (header) return header;
  const prolog = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  return /<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i.exec(prolog)?.[1];
}

function decodeBody(bytes, contentType) {
  const label = charsetOf(contentType, bytes) || 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * One bounded upstream read as raw bytes. The deadline covers the body.
 * `url` is where redirects ended. Never logs the URL or the body.
 * @param {string} url
 * @param {{fetchImpl?: Function, timeoutMs?: number, maxBytes?: number, headers?: object, method?: string, body?: string, signal?: AbortSignal}} [options]
 * @returns {Promise<{status: number, ok: boolean, bytes: Uint8Array, url: string, headers: Headers}>}
 */
export async function fetchNewsBytes(url, options = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    headers = {},
    method = 'GET',
    body,
    signal,
  } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(url, {
    method,
    body,
    signal: combined,
    redirect: 'follow',
    headers: {
      'User-Agent': NEWS_USER_AGENT,
      'Accept-Encoding': 'gzip, deflate, br',
      ...headers,
    },
  });
  const finalUrl = response.url || url;
  if (!response.ok) {
    void response.body?.cancel?.().catch(() => {});
    return {
      status: response.status,
      ok: false,
      bytes: new Uint8Array(0),
      url: finalUrl,
      headers: response.headers,
    };
  }
  return {
    status: response.status,
    ok: true,
    bytes: await readResponseBytesCapped(response, maxBytes, combined),
    url: finalUrl,
    headers: response.headers,
  };
}

/**
 * One bounded upstream read for the news fetchers, decoded as text. gzip
 * bodies served without Content-Encoding (`.xml.gz` feeds) are inflated under
 * the same byte cap. Never logs the URL or the body.
 * @param {string} url
 * @param {Parameters<typeof fetchNewsBytes>[1]} [options]
 * @returns {Promise<{status: number, ok: boolean, text: string, url: string, headers: Headers}>}
 */
export async function fetchNewsBody(url, options = {}) {
  const response = await fetchNewsBytes(url, options);
  const { bytes, ...rest } = response;
  if (!response.ok) return { ...rest, text: '' };
  const inflated =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? gunzipSync(bytes, {
          maxOutputLength: options.maxBytes ?? DEFAULT_MAX_BYTES,
        })
      : bytes;
  return {
    ...rest,
    text: decodeBody(inflated, response.headers?.get?.('content-type')),
  };
}

/** Failure classification shared by every transport's status record. */
export function httpFailure(status) {
  return {
    error: `HTTP ${status}`,
    blocked: status === 401 || status === 403 || status === 451,
    rateLimited: status === 429,
  };
}
