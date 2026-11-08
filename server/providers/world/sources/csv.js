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
