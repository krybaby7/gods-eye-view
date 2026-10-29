import { crc32, inflateRawSync } from 'node:zlib';

/**
 * The one entry of a single-entry .zip held in memory, such as GDELT's
 * 15-minute files. Node's zlib inflates the data but does not read the zip
 * container, so this reads the local file header (APPNOTE 4.3.7) and inflates
 * what follows it. Stored and deflated entries only; no encryption, zip64 or
 * streamed (data-descriptor) entries. The size and CRC-32 are checked.
 */

export const ZIP_MAX_BYTES = 256 * 1024 * 1024;
const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER_BYTES = 30;
const STORED = 0;
const DEFLATED = 8;

function zipError(message) {
  return Object.assign(new Error(`zip: ${message}`), { code: 'ZIP_INVALID' });
}

/**
 * @param {Uint8Array} bytes The whole archive.
 * @param {{maxBytes?: number}} [options] Cap on the unzipped size.
 * @returns {{name: string, data: Buffer}}
 */
export function readSingleEntryZip(bytes, { maxBytes = ZIP_MAX_BYTES } = {}) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== LOCAL_HEADER)
    throw zipError('not a zip file');
  if (buffer.length < LOCAL_HEADER_BYTES) throw zipError('truncated');
  const flags = buffer.readUInt16LE(6);
  const method = buffer.readUInt16LE(8);
  const crc = buffer.readUInt32LE(14);
  const compressedSize = buffer.readUInt32LE(18);
  const size = buffer.readUInt32LE(22);
  const nameEnd = LOCAL_HEADER_BYTES + buffer.readUInt16LE(26);
  const start = nameEnd + buffer.readUInt16LE(28);
  if (flags & 0x1) throw zipError('encrypted entry not supported');
  if (flags & 0x8) throw zipError('streamed entry not supported');
  if (method !== STORED && method !== DEFLATED)
    throw zipError(`unsupported method ${method}`);
  if (compressedSize === 0xffffffff || size === 0xffffffff)
    throw zipError('zip64 entries not supported');
  if (size > maxBytes || (method === STORED && compressedSize > maxBytes))
    throw zipError(`entry larger than ${maxBytes} bytes`);
  const end = start + compressedSize;
  if (end + 4 > buffer.length) throw zipError('truncated');
  const next = buffer.readUInt32LE(end);
  if (next === LOCAL_HEADER) throw zipError('more than one entry');
  if (next !== CENTRAL_HEADER) throw zipError('no central directory');
  const name = buffer.toString('utf8', LOCAL_HEADER_BYTES, nameEnd);
  const raw = buffer.subarray(start, end);
  let data;
  if (method === STORED) data = raw;
  else {
    try {
      data = inflateRawSync(raw, { maxOutputLength: maxBytes });
    } catch (error) {
      throw error?.code === 'ERR_BUFFER_TOO_LARGE'
        ? zipError(`entry larger than ${maxBytes} bytes`)
        : zipError('corrupt data');
    }
  }
  if (data.length !== size) throw zipError('size mismatch');
  if (crc32(data) !== crc) throw zipError('checksum mismatch');
  return { name, data };
}
