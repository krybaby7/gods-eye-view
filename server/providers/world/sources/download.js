import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { columnIndices, csvRows } from './csv.js';
import { fetchOnDispatch, isConnectionError } from './transport.js';

const activeDownloads = new Map();
const activeLegacyCleanups = new Map();
const CACHE_DIRECTORY = '.gev-cache/world/downloads';
const PART_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LEGACY_MAX_AGE_MS = 30 * PART_MAX_AGE_MS;
const CACHE_KEY = /^[a-f0-9]{64}$/;

function cacheFile(url, cacheDirectory) {
  return path.resolve(
    cacheDirectory,
    createHash('sha256').update(String(url)).digest('hex'),
  );
}

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
    return entry.isFile()
      ? { metadata, bytes: entry.size, mtimeMs: entry.mtimeMs }
      : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function assertSignature(file, format, csvColumns) {
  const handle = await open(file, 'r');
  const buffer = Buffer.alloc(4096);
  let bytesRead;
  try {
    ({ bytesRead } = await handle.read(buffer));
  } finally {
    await handle.close();
  }
  const prefix = buffer.subarray(0, bytesRead);
  if (
    /^\s*(?:<!doctype\s+html\b|<(?:html|head|body|title)(?:\s|>))/i.test(
      prefix.toString('utf8'),
    )
  ) {
    throw downloadError('DOWNLOAD_SIGNATURE', 'Download is an HTML page.');
  }
  if (!format) return;
  let valid = false;
  if (format === 'zip') {
    valid = prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]));
  } else if (format === 'gzip') {
    valid = prefix.subarray(0, 3).equals(Buffer.from([0x1f, 0x8b, 8]));
  } else if (format === 'csv') {
    const text = prefix.toString('utf8');
    const lineEnd = text.search(/[\r\n]/);
    const header = lineEnd === -1 ? text : text.slice(0, lineEnd);
    try {
      columnIndices(csvRows(header).next().value, csvColumns);
      valid =
        (lineEnd !== -1 || bytesRead < buffer.length) && !/^\s*</.test(header);
    } catch {
      // A non-CSV response cannot supply the expected schema.
    }
  }
  if (!valid)
    throw downloadError(
      'DOWNLOAD_SIGNATURE',
      `Download is not the expected ${format} file.`,
    );
}

function statIfPresent(file) {
  return stat(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
}

async function pruneStaleParts(directory, current) {
  const cutoff = Date.now() - PART_MAX_AGE_MS;
  const names = await readdir(directory);
  const parts = new Set(
    names.flatMap((name) => {
      const [key, suffix] = name.split('.');
      return CACHE_KEY.test(key) && suffix === 'part' ? [key] : [];
    }),
  );
  for (const key of parts) {
    const file = path.join(directory, key);
    const part = file + '.part';
    const info =
      (await statIfPresent(part)) ?? (await statIfPresent(part + '.json'));
    if (
      info?.mtimeMs < cutoff &&
      (file === current || !activeDownloads.has(file))
    )
      await clearEntry(part);
  }
}

export async function hasWorldDownload(url, cacheDirectory = CACHE_DIRECTORY) {
  const entry = await readEntry(cacheFile(url, cacheDirectory));
  return Boolean(entry && entry.bytes === entry.metadata?.size);
}

export async function pruneWorldDownloads(source, current) {
  if (!current.length) return;
  const directory = path.dirname(current[0]);
  const names = await readdir(directory);
  const previous = [];
  for (const name of names.filter((name) => CACHE_KEY.test(name))) {
    const file = path.join(directory, name);
    if (current.includes(file) || activeDownloads.has(file)) continue;
    const entry = await readEntry(file);
    if (entry?.metadata?.source === source) previous.push({ file, ...entry });
  }
  previous.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { file } of previous.slice(1)) {
    if (!activeDownloads.has(file)) await clearEntry(file);
  }
}

export async function pruneLegacyWorldDownloads(
  cacheDirectory = CACHE_DIRECTORY,
  currentUrls = [],
) {
  const directory = path.resolve(cacheDirectory);
  if (activeLegacyCleanups.has(directory))
    return activeLegacyCleanups.get(directory);
  const pending = (async () => {
    const marker = path.join(directory, '.legacy-downloads-pruned');
    if (await statIfPresent(marker)) return;
    const cutoff = Date.now() - LEGACY_MAX_AGE_MS;
    const current = new Set(
      currentUrls.map((url) => cacheFile(url, directory)),
    );
    const names = await readdir(directory).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!names) return;
    for (const name of names.filter((name) => CACHE_KEY.test(name))) {
      const file = path.join(directory, name);
      if (current.has(file) || activeDownloads.has(file)) continue;
      const removal = (async () => {
        const info = await statIfPresent(file);
        if (!info?.isFile() || info.mtimeMs >= cutoff) return;
        const entry = await readEntry(file);
        if (!entry?.metadata?.source) await clearEntry(file);
      })();
      activeDownloads.set(file, removal);
      try {
        await removal;
      } finally {
        if (activeDownloads.get(file) === removal) activeDownloads.delete(file);
      }
    }
    await writeFile(marker, '', { mode: 0o600 });
  })();
  activeLegacyCleanups.set(directory, pending);
  try {
    await pending;
  } finally {
    activeLegacyCleanups.delete(directory);
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
    format,
    csvColumns,
    source,
  } = options;
  const abort = new AbortController();
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, abort.signal])
    : abort.signal;
  let overallTimer;
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
  const onDispatch = () => {
    overallTimer ??= setTimeout(() => {
      abort.abort(
        downloadError(
          'DOWNLOAD_TIMEOUT',
          `Download reached its overall limit of ${overallTimeoutMs} ms.`,
        ),
      );
    }, overallTimeoutMs);
    resetStall();
  };
  const part = file + '.part';
  let response;
  try {
    signal.throwIfAborted();
    const directory = path.dirname(file);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await pruneStaleParts(directory, file);
    let complete = await readEntry(file);
    if (complete && complete.bytes !== complete.metadata?.size) {
      await clearEntry(file);
      complete = null;
    }
    if (complete) {
      complete = { ...complete.metadata, bytes: complete.bytes };
      try {
        await assertSignature(file, format, csvColumns);
      } catch (error) {
        if (error.code !== 'DOWNLOAD_SIGNATURE') throw error;
        await clearEntry(file);
        complete = null;
      }
    }
    const reusable = complete && complete.bytes === complete.size;
    const useComplete = async () => {
      enforceSize(complete.bytes, maxBytes);
      if (source && complete.source !== source)
        await writeMetadata(file, { ...complete, source });
      onProgress?.({
        bytes: complete.bytes,
        totalBytes: complete.bytes,
        resumedFrom: 0,
      });
      return { path: file, ...complete, reused: true, resumedFrom: 0 };
    };
    if (reusable && immutable) return useComplete();

    const readPartial = async () => {
      const entry = await readEntry(part);
      return entry && { ...entry.metadata, bytes: entry.bytes };
    };
    let partial = await readPartial();
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
      partial = await readPartial();
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
      try {
        response = await fetchOnDispatch(
          fetchImpl,
          url,
          { headers, signal, retryConnection: false },
          onDispatch,
          () => clearTimeout(stallTimer),
        );
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
        ...(source && { source }),
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
      await assertSignature(part, format, csvColumns);
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
      error.code === 'DOWNLOAD_LENGTH' ||
      error.code === 'DOWNLOAD_SIGNATURE'
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
    cacheDirectory = CACHE_DIRECTORY,
    fetchImpl = fetch,
    signal,
    onProgress,
    stallTimeoutMs = 60_000,
    overallTimeoutMs = 30 * 60_000,
    maxBytes = Infinity,
    immutable = false,
    format,
    csvColumns = [],
    source,
    parse,
  } = {},
) {
  const file = cacheFile(url, cacheDirectory);
  const previous = activeDownloads.get(file);
  const pending = (
    previous ? previous.catch(() => {}) : Promise.resolve()
  ).then(async () => {
    const result = await transfer(url, file, {
      fetchImpl,
      signal,
      onProgress,
      stallTimeoutMs,
      overallTimeoutMs,
      maxBytes,
      immutable,
      format,
      csvColumns,
      source,
    });
    if (!parse) return result;
    try {
      return { ...result, parsed: await parse(file) };
    } catch (error) {
      if (
        !signal?.aborted &&
        ['DOWNLOAD_SIGNATURE', 'DOWNLOAD_LENGTH', 'ZIP_INTEGRITY'].includes(
          error?.code,
        )
      )
        await clearEntry(file);
      throw error;
    }
  });
  activeDownloads.set(file, pending);
  try {
    return await pending;
  } finally {
    if (activeDownloads.get(file) === pending) activeDownloads.delete(file);
  }
}
