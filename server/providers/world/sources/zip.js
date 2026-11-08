import { Readable } from 'node:stream';
import { crc32, createInflateRaw } from 'node:zlib';

function findZipEnd(zip) {
  const minimum = Math.max(0, zip.length - 22 - 0xffff);
  for (let i = zip.length - 22; i >= minimum; i -= 1) {
    if (
      zip.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + zip.readUInt16LE(i + 20) === zip.length
    )
      return i;
  }
  throw new Error('ZIP end of directory not found');
}

function findZipEntry(zip, matchesName) {
  const end = findZipEnd(zip);
  const directory = zip.readUInt32LE(end + 16);
  const entries = zip.readUInt16LE(end + 10);
  if (
    zip.readUInt32LE(end + 4) !== 0 ||
    directory + zip.readUInt32LE(end + 12) !== end
  ) {
    throw new Error('Unsupported ZIP directory');
  }

  let cursor = directory;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > end || zip.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Invalid ZIP directory entry');
    }
    const nameEnd = cursor + 46 + zip.readUInt16LE(cursor + 28);
    const next =
      nameEnd + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
    if (next > end) throw new Error('Invalid ZIP directory entry length');
    if (matchesName(zip.toString('utf8', cursor + 46, nameEnd))) {
      const offset = zip.readUInt32LE(cursor + 42);
      const size = zip.readUInt32LE(cursor + 20);
      if (offset + 30 > directory || zip.readUInt32LE(offset) !== 0x04034b50) {
        throw new Error('Invalid ZIP entry header');
      }
      const start =
        offset +
        30 +
        zip.readUInt16LE(offset + 26) +
        zip.readUInt16LE(offset + 28);
      if (
        start + size > directory ||
        (zip.readUInt16LE(cursor + 8) & 1) !== 0
      ) {
        throw new Error('Unsupported ZIP entry');
      }
      return {
        bytes: zip.subarray(start, start + size),
        method: zip.readUInt16LE(cursor + 10),
        size: zip.readUInt32LE(cursor + 24),
        checksum: zip.readUInt32LE(cursor + 16),
      };
    }
    cursor = next;
  }
  throw new Error('CSV file missing from ZIP');
}

export async function* zipEntryChunks(bytes, matchesName, maxBytes) {
  const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entry = findZipEntry(zip, matchesName);
  if (entry.method !== 0 && entry.method !== 8)
    throw new Error('Unsupported ZIP compression');
  const stream = Readable.from([entry.bytes]);
  const contents =
    entry.method === 8 ? stream.pipe(createInflateRaw()) : stream;
  let size = 0;
  let checksum = 0;
  try {
    for await (const chunk of contents) {
      size += chunk.length;
      if (size > entry.size || size > maxBytes)
        throw new Error('Expanded ZIP CSV exceeds size limit');
      checksum = crc32(chunk, checksum);
      yield chunk;
    }
    if (size !== entry.size || checksum !== entry.checksum) {
      throw new Error('ZIP CSV failed integrity check');
    }
  } finally {
    contents.destroy();
    stream.destroy();
  }
}
