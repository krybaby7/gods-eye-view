import { StringDecoder } from 'node:string_decoder';

const MAX_CSV_RECORD_LENGTH = 1_000_000;

export async function* csvRecords(chunks) {
  const decoder = new StringDecoder('utf8');
  let quoted = false;
  let record = '';
  for await (const chunk of chunks) {
    const text = decoder.write(chunk);
    let start = 0;
    for (const match of text.matchAll(/["\r\n]/g)) {
      if (match[0] === '"') {
        // Escaped quotes toggle twice, even when split across two chunks.
        quoted = !quoted;
      } else if (!quoted) {
        record += text.slice(start, match.index);
        if (record) yield record;
        record = '';
        start = match.index + 1;
      }
    }
    record += text.slice(start);
    if (record.length > MAX_CSV_RECORD_LENGTH)
      throw new Error('CSV record exceeds size limit');
  }
  if (quoted) throw new Error('Malformed CSV field');
  record += decoder.end();
  if (record) yield record;
}

export function* csvRows(text) {
  // The quoted branch preserves commas and newlines inside source article fields.
  const field = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))([,\r\n]|$)/gy;
  const csv = text.replace(/^\uFEFF/, '');
  let row = [];
  while (field.lastIndex < csv.length) {
    const match = field.exec(csv);
    if (!match) throw new Error('Malformed CSV field');
    const [, quoted, plain, delimiter] = match;
    row.push(quoted === undefined ? plain : quoted.replaceAll('""', '"'));
    if (delimiter === ',') {
      if (field.lastIndex === csv.length) row.push('');
      continue;
    }
    if (delimiter === '\r' && csv[field.lastIndex] === '\n')
      field.lastIndex += 1;
    if (row.length > 1 || row[0] !== '') yield row;
    row = [];
  }
  if (row.length) yield row;
}

export function columnIndices(header, columns) {
  const indices = columns.map((column) => header?.indexOf(column) ?? -1);
  if (indices.includes(-1)) {
    throw new Error(
      `CSV is missing ${columns.filter((_, index) => indices[index] < 0).join(', ')}`,
    );
  }
  return indices;
}
