import { open } from 'node:fs/promises';
import { addAbortSignal, pipeline, Readable } from 'node:stream';
import { crc32, createInflateRaw } from 'node:zlib';

function integrityError(message, cause) {
  return Object.assign(new Error(message, { cause }), {
    code: 'ZIP_INTEGRITY',
  });
}

function findZipEnd(zip) {
  const minimum = Math.max(0, zip.length - 22 - 0xffff);
  for (let i = zip.length - 22; i >= minimum; i -= 1) {
    if (
      zip.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + zip.readUInt16LE(i + 20) === zip.length
    )
      return i;
  }
  throw integrityError('ZIP end of directory not found');
}

async function findZipEntry(read, length, matchesName) {
  const tailSize = Math.min(length, 22 + 0xffff);
  const tail = await read(length - tailSize, tailSize);
  const tailEnd = findZipEnd(tail);
  const end = length - tailSize + tailEnd;
  const directory = tail.readUInt32LE(tailEnd + 16);
  const entries = tail.readUInt16LE(tailEnd + 10);
  if (tail.readUInt32LE(tailEnd + 4) !== 0 || directory === 0xffffffff)
    throw new Error('Unsupported ZIP directory');
  if (directory + tail.readUInt32LE(tailEnd + 12) !== end)
    throw integrityError('Invalid ZIP directory size');

  let cursor = directory;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > end) throw integrityError('Invalid ZIP directory entry');
    const header = await read(cursor, 46);
    if (header.readUInt32LE(0) !== 0x02014b50) {
      throw integrityError('Invalid ZIP directory entry');
    }
    const nameSize = header.readUInt16LE(28);
    const next =
      cursor +
      46 +
      nameSize +
      header.readUInt16LE(30) +
      header.readUInt16LE(32);
    if (next > end) throw integrityError('Invalid ZIP directory entry length');
    const name = await read(cursor + 46, nameSize);
    if (matchesName(name.toString('utf8'))) {
      const offset = header.readUInt32LE(42);
      const compressedSize = header.readUInt32LE(20);
      if (offset === 0xffffffff || compressedSize === 0xffffffff)
        throw new Error('Unsupported ZIP entry');
      if (offset + 30 > directory)
        throw integrityError('Invalid ZIP entry header');
      const local = await read(offset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50) {
        throw integrityError('Invalid ZIP entry header');
      }
      const start =
        offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (start + compressedSize > directory)
        throw integrityError('Invalid ZIP entry length');
      if ((header.readUInt16LE(8) & 1) !== 0)
        throw new Error('Unsupported ZIP entry');
      return {
        start,
        compressedSize,
        method: header.readUInt16LE(10),
        size: header.readUInt32LE(24),
        checksum: header.readUInt32LE(16),
      };
    }
    cursor = next;
  }
  if (cursor !== end) throw integrityError('Invalid ZIP directory size');
  throw new Error('CSV file missing from ZIP');
}

async function readFileRange(file, position, length) {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(
      buffer,
      offset,
      length - offset,
      position + offset,
    );
    if (!bytesRead) throw integrityError('Unexpected end of ZIP');
    offset += bytesRead;
  }
  return buffer;
}

async function* readChunks(read, start, length) {
  const end = start + length;
  for (let offset = start; offset < end; offset += 64 * 1024) {
    yield await read(offset, Math.min(end - offset, 64 * 1024));
  }
}

async function* expandEntry(read, entry, maxBytes, signal) {
  if (entry.method !== 0 && entry.method !== 8)
    throw new Error('Unsupported ZIP compression');
  if (entry.size > maxBytes)
    throw new Error('Expanded ZIP CSV exceeds size limit');
  const stream = Readable.from(
    readChunks(read, entry.start, entry.compressedSize),
    { objectMode: false },
  );
  const contents =
    entry.method === 8
      ? pipeline(stream, createInflateRaw(), () => {})
      : stream;
  if (signal) addAbortSignal(signal, contents);
  let size = 0;
  let checksum = 0;
  try {
    for await (const chunk of contents.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > entry.size)
        throw integrityError('Expanded ZIP CSV exceeds declared size');
      checksum = crc32(chunk, checksum);
      yield chunk;
    }
    if (size !== entry.size || checksum !== entry.checksum) {
      throw integrityError('ZIP CSV failed integrity check');
    }
  } catch (error) {
    if (error.code === 'Z_DATA_ERROR' || error.code === 'Z_BUF_ERROR')
      throw integrityError('ZIP CSV failed decompression', error);
    throw error;
  } finally {
    contents.destroy();
    stream.destroy();
  }
}

export async function* zipEntryChunks(archive, matchesName, maxBytes, signal) {
  signal?.throwIfAborted();
  const file = typeof archive === 'string' ? await open(archive, 'r') : null;
  try {
    const bytes = file
      ? null
      : Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
    const length = file ? (await file.stat()).size : bytes.length;
    const read = (offset, size) => {
      signal?.throwIfAborted();
      return file
        ? readFileRange(file, offset, size)
        : bytes.subarray(offset, offset + size);
    };
    const entry = await findZipEntry(read, length, matchesName);
    yield* expandEntry(read, entry, maxBytes, signal);
  } finally {
    await file?.close();
  }
}
