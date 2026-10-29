/** Build small single-entry .zip archives for reader tests. */
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * One local file header, the entry's data, one central directory record and
 * the end record, the way `zip` writes a single file.
 * @param {string} name
 * @param {Uint8Array|string} content
 * @param {{method?: 0|8, flags?: number, crc?: number, uncompressedSize?: number, extraEntry?: boolean}} [options]
 *   `crc` and `uncompressedSize` override the true values to build corrupt archives.
 */
export function zipOneEntry(name, content, options = {}) {
  const { method = 8, flags = 0, extraEntry = false } = options;
  const data = Buffer.from(content);
  const stored = method === 8 ? deflateRawSync(data) : data;
  const fileName = Buffer.from(name);
  const crc = options.crc ?? crc32(data);
  const size = options.uncompressedSize ?? data.length;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(stored.length, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(stored.length, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(fileName.length, 28);
  const entry = Buffer.concat([local, fileName, stored]);
  const entries = extraEntry ? Buffer.concat([entry, entry]) : entry;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(entries.length, 16);
  return new Uint8Array(Buffer.concat([entries, central, fileName, end]));
}
