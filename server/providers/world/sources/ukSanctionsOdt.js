import { StringDecoder } from 'node:string_decoder';

const PARAGRAPH_END = '</text:p>';
const DOCUMENT_END = '</office:document-content>';
const ENTITIES = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>' };

function spanText(xml) {
  return xml
    .replace(/<text:s(?:\s+text:c="\d+")?\s*\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|apos|quot|lt|gt|#x[0-9a-fA-F]+|#\d+);/g, (_, entity) =>
      entity.startsWith('#x')
        ? String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
        : entity.startsWith('#')
          ? String.fromCodePoint(Number(entity.slice(1)))
          : ENTITIES[entity],
    )
    .trim();
}

export async function* ukSanctionsRecords(chunks) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let regime;
  for await (const chunk of chunks) {
    pending += decoder.write(chunk);
    let start = 0;
    let end;
    while ((end = pending.indexOf(PARAGRAPH_END, start)) !== -1) {
      const paragraph = pending.slice(start, end);
      start = end + PARAGRAPH_END.length;
      const spans = Array.from(
        paragraph.matchAll(/<text:span(?:\s[^>]*)?>([\s\S]*?)<\/text:span>/g),
        ([, xml]) => xml,
      );
      if (!spans.length) continue;
      if (spans.length === 1) {
        const label = spanText(spans[0]);
        // The FCDO renders the Regime Name as the standalone regulation
        // heading above a group of numbered designation paragraphs.
        if (/\bREGULATIONS \d{4}$/.test(label) && label === label.toUpperCase())
          regime = label;
        else if (
          regime &&
          label &&
          !/^(?:\d+\.|INDIVIDUAL|ENTITY|SHIP)$/.test(label)
        )
          throw new Error('Unexpected UK Sanctions List section heading');
        continue;
      }
      const index = spans.findIndex((xml) => /^\s*Unique Id:\s*$/i.test(xml));
      const id = index >= 0 && spans[index + 1] && spanText(spans[index + 1]);
      if (!regime || !id)
        throw new Error('Unexpected UK Sanctions List designation record');
      yield [id, [regime]];
    }
    pending = pending.slice(start);
    if (pending.length > 256_000)
      throw new Error('UK Sanctions List paragraph exceeds size limit');
  }
  if (!regime || !(pending + decoder.end()).trimEnd().endsWith(DOCUMENT_END))
    throw new Error('Unexpected or incomplete UK Sanctions List document');
}
