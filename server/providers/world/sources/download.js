import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { isConnectionError } from './transport.js';

const activeDownloads = new Map();

function downloadError(code, message) {
  return Object.assign(new Error(message), { code });
}

function parseSize(value) {
  if (!/^\d+$/.test(value ?? '')) return null;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

async function readEntry(file) {
  try {
    const metadata = JSON.parse(await readFile(file + '.json', 'utf8'));
    const entry = await stat(file);
    return entry.isFile() ? { ...metadata, bytes: entry.size } : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeMetadata(file, metadata) {
  const destination = file + '.json';
  const temp = destination + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, JSON.stringify(metadata), {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temp, destination);
  } finally {
    await rm(temp, { force: true });
  }
}

async function clearEntry(file) {
  await rm(file + '.json', { force: true });
  await rm(file, { force: true });
}

function ifRangeValue(entry) {
  if (entry?.etag?.startsWith('"')) return entry.etag;
  if (!entry?.etag && Number.isFinite(Date.parse(entry?.lastModified)))
    return entry.lastModified;
  return null;
}

function resumeResponse(response, partial) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
    response.headers.get('Content-Range'),
  );
  if (!match) return null;
  const [start, end, total] = match.slice(1).map(parseSize);
  if (
    start === null ||
    end === null ||
    total === null ||
    start !== partial.bytes ||
    end < start ||
    end >= total
  ) {
    return null;
  }
  const length = parseSize(response.headers.get('Content-Length'));
  const etag = response.headers.get('ETag');
  const lastModified = response.headers.get('Last-Modified');
  if (
    (partial.size !== null && total !== partial.size) ||
    (length !== null && length !== end - start + 1) ||
    (etag && partial.etag && etag !== partial.etag) ||
    (lastModified &&
      partial.lastModified &&
      lastModified !== partial.lastModified)
  ) {
    return null;
  }
  return { end: end + 1, total };
}

function enforceSize(bytes, maxBytes) {
  if (bytes !== null && bytes > maxBytes) {
    throw downloadError(
      'RESPONSE_TOO_LARGE',
      `Download exceeds the ${maxBytes} byte limit.`,
    );
  }
}

async function streamToDisk(
  response,
  file,
  { offset, end, total, maxBytes, onBytes, signal },
) {
  if (!response.body) throw new Error('Download has no response body.');
  let bytes = offset;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      try {
        enforceSize(bytes, maxBytes);
        if (end !== null && bytes > end) {
          throw downloadError(
            'DOWNLOAD_LENGTH',
            `Download exceeded its declared length of ${end} bytes.`,
          );
        }
        if (chunk.length) onBytes(bytes, total);
        callback(null, chunk);
      } catch (error) {
        callback(error);
      }
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    meter,
    createWriteStream(file, { flags: offset ? 'a' : 'wx', mode: 0o600 }),
    { signal },
  );
  if (end !== null && bytes !== end) {
    throw new Error(`Download incomplete at ${bytes} of ${end} bytes.`);
  }
  return bytes;
}

async function transfer(url, file, options) {
  const {
    fetchImpl,
    signal: callerSignal,
    onProgress,
    stallTimeoutMs,
    overallTimeoutMs,
    maxBytes,
    immutable,
  } = options;
  const abort = new AbortController();
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, abort.signal])
    : abort.signal;
  const overallTimer = setTimeout(() => {
    abort.abort(
      downloadError(
        'DOWNLOAD_TIMEOUT',
        `Download reached its overall limit of ${overallTimeoutMs} ms.`,
      ),
    );
  }, overallTimeoutMs);
  let stallTimer;
  const resetStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      abort.abort(
        downloadError(
          'DOWNLOAD_STALLED',
          `Download stalled after ${stallTimeoutMs} ms without bytes.`,
        ),
      );
    }, stallTimeoutMs);
  };
  const part = file + '.part';
  let response;
  try {
    signal.throwIfAborted();
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const complete = await readEntry(file);
    const reusable = complete && complete.bytes === complete.size;
    const useComplete = () => {
      enforceSize(complete.bytes, maxBytes);
      onProgress?.({
        bytes: complete.bytes,
        totalBytes: complete.bytes,
        resumedFrom: 0,
      });
      return { path: file, ...complete, reused: true, resumedFrom: 0 };
    };
    if (reusable && immutable) return useComplete();

    let partial = await readEntry(part);
    let resumedFrom = 0;
    let retried = false;
    const retry = async (error) => {
      signal.throwIfAborted();
      if (retried || !isConnectionError(error)) throw error;
      retried = true;
      clearTimeout(stallTimer);
      if (response?.body && !response.body.locked)
        await response.body.cancel().catch(() => {});
      response = null;
      partial = await readEntry(part);
      await delay(500, null, { signal });
    };
    while (true) {
      signal.throwIfAborted();
      const headers = new Headers({ 'Accept-Encoding': 'identity' });
      const validator = ifRangeValue(partial);
      const canResume =
        validator &&
        partial.bytes > 0 &&
        (partial.size === null || partial.bytes < partial.size);
      if (canResume) {
        headers.set('Range', `bytes=${partial.bytes}-`);
        headers.set('If-Range', validator);
      } else if (reusable) {
        if (complete.etag) headers.set('If-None-Match', complete.etag);
        if (complete.lastModified)
          headers.set('If-Modified-Since', complete.lastModified);
      }
      resetStall();
      try {
        response = await fetchImpl(url, {
          headers,
          signal,
          retryConnection: false,
        });
      } catch (error) {
        await retry(error);
        continue;
      }
      signal.throwIfAborted();
      if (
        response.status === 304 &&
        (headers.has('If-None-Match') || headers.has('If-Modified-Since'))
      ) {
        return useComplete();
      }
      const range =
        canResume && response.status === 206
          ? resumeResponse(response, partial)
          : null;
      if (
        canResume &&
        (response.status === 416 || (response.status === 206 && !range))
      ) {
        await response.body?.cancel();
        await clearEntry(part);
        partial = null;
        resumedFrom = 0;
        continue;
      }
      if (response.status !== 200 && !range) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }
      const encoding = response.headers.get('Content-Encoding');
      if (encoding && encoding.toLowerCase() !== 'identity') {
        throw new Error(
          `Download requires identity encoding for byte integrity (received ${encoding}).`,
        );
      }
      const size = range
        ? range.total
        : parseSize(response.headers.get('Content-Length'));
      enforceSize(size, maxBytes);
      const metadata = {
        size,
        etag: response.headers.get('ETag') ?? (range ? partial.etag : null),
        lastModified:
          response.headers.get('Last-Modified') ??
          (range ? partial.lastModified : null),
      };
      const offset = range ? partial.bytes : 0;
      if (!range) {
        await clearEntry(part);
        resumedFrom = 0;
      } else {
        resumedFrom ||= offset;
      }
      await writeMetadata(part, metadata);
      let bytes;
      try {
        bytes = await streamToDisk(response, part, {
          offset,
          end: range ? range.end : size,
          total: size,
          maxBytes,
          signal,
          onBytes(bytes, totalBytes) {
            resetStall();
            onProgress?.({ bytes, totalBytes, resumedFrom });
          },
        });
      } catch (error) {
        await retry(error);
        continue;
      }
      if (range && bytes < size) {
        partial = { ...metadata, bytes };
        continue;
      }
      clearTimeout(stallTimer);
      signal.throwIfAborted();
      // Invalidate old validators before replacing the file so an interrupted publication
      // can never revalidate a new file using an older release's metadata.
      await rm(file + '.json', { force: true });
      await rename(part, file);
      await writeMetadata(file, { ...metadata, size: bytes });
      await rm(part + '.json', { force: true });
      return {
        path: file,
        ...metadata,
        size: bytes,
        bytes,
        reused: false,
        resumedFrom,
      };
    }
  } catch (error) {
    if (
      error.code === 'RESPONSE_TOO_LARGE' ||
      error.code === 'DOWNLOAD_LENGTH'
    ) {
      await clearEntry(part);
    }
    signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(stallTimer);
    clearTimeout(overallTimer);
    if (response?.body && !response.body.locked)
      await response.body.cancel().catch(() => {});
  }
}

export async function downloadWorldFile(
  url,
  {
    cacheDirectory = '.gev-cache/world/downloads',
    fetchImpl = fetch,
    signal,
    onProgress,
    stallTimeoutMs = 60_000,
    overallTimeoutMs = 30 * 60_000,
    maxBytes = Infinity,
    immutable = false,
  } = {},
) {
  const key = createHash('sha256').update(String(url)).digest('hex');
  const file = path.resolve(cacheDirectory, key);
  const previous = activeDownloads.get(file);
  const pending = (
    previous ? previous.catch(() => {}) : Promise.resolve()
  ).then(() =>
    transfer(url, file, {
      fetchImpl,
      signal,
      onProgress,
      stallTimeoutMs,
      overallTimeoutMs,
      maxBytes,
      immutable,
    }),
  );
  activeDownloads.set(file, pending);
  try {
    return await pending;
  } finally {
    if (activeDownloads.get(file) === pending) activeDownloads.delete(file);
  }
}
