import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';

const colorProperties =
  /(?:^|-)color$|^(?:background(?:-image)?|border(?:-\w+)?|outline|fill|stroke|text-decoration|column-rule|caret|accent-color)$/i;
const colors =
  /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(|\b(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)\b/i;
// Remove entire var() expressions, including nested fallbacks, before inspecting a value.
function withoutVars(value) {
  let out = '',
    i = 0;
  while (i < value.length) {
    const match = /^var\s*\(/i.exec(value.slice(i));
    if (!match) {
      out += value[i++];
      continue;
    }
    i += match[0].length;
    let depth = 1;
    while (i < value.length && depth) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') depth--;
      i++;
    }
    out += ' ';
  }
  return out.replace(/url\([^)]*\)/gi, ' ');
}
function kinds(property, raw) {
  const prop = property
    .replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    .toLowerCase();
  const value = withoutVars(raw).replace(
    /\b(?:transparent|currentcolor|inherit|initial|unset|revert|none)\b/gi,
    ' ',
  );
  const result = [];
  const nonzeroSize = [
    ...value.matchAll(
      /(?:^|[\s,(/])([+-]?(?:\d*\.)?\d+)(?:px|rem|em|pt|pc|vh|vw|vmin|vmax|ch|ex|%)/gi,
    ),
  ].some((m) => Number(m[1]) !== 0);
  const custom = prop.startsWith('--');
  if (
    custom ||
    colorProperties.test(prop) ||
    /shadow/.test(prop) ||
    /^(?:-webkit-)?filter$/.test(prop)
  )
    for (const match of value.matchAll(new RegExp(colors.source, 'gi')))
      result.push('color');
  if (
    (prop === 'font-size' ||
      prop === 'font' ||
      (custom && (/font-size/.test(prop) || /^--type-/.test(prop)))) &&
    nonzeroSize
  )
    result.push('font');
  if (
    (prop === 'font-family' && value.trim()) ||
    ((prop === 'font' || (custom && /^--type-/.test(prop))) &&
      /(?:serif|sans-serif|monospace|system-ui|["']|,|(?:px|rem|em|pt|%)\s+(?:[a-z]))/i.test(
        value,
      ))
  )
    result.push('family');
  if ((/radius$/.test(prop) || (custom && /radius/.test(prop))) && nonzeroSize)
    result.push('radius');
  if (
    (/^(?:box|text)-shadow$/.test(prop) ||
      (custom && /shadow/.test(prop)) ||
      (/^(?:-webkit-)?filter$/.test(prop) &&
        /drop-shadow\s*\(\s*[^\s)]/i.test(value))) &&
    value.trim() &&
    !/^0(?:[a-z%]+)?$/i.test(value.trim())
  )
    result.push('shadow');
  if (/^(?:-webkit-)?backdrop-filter$/.test(prop) && value.trim())
    result.push('backdrop');
  return result;
}
// Preserve offsets while removing comments from JavaScript; quoted strings and templates remain intact.
function maskComments(source) {
  let out = '',
    quote = '',
    i = 0;
  while (i < source.length) {
    const c = source[i],
      n = source[i + 1];
    if (quote) {
      out += c;
      i++;
      if (c === '\\' && i < source.length) out += source[i++];
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i++;
    } else if (c === '/' && (n === '/' || n === '*')) {
      const block = n === '*';
      out += '  ';
      i += 2;
      while (
        i < source.length &&
        (block
          ? !(source[i] === '*' && source[i + 1] === '/')
          : source[i] !== '\n')
      )
        out += source[i++] === '\n' ? '\n' : ' ';
      if (block && i < source.length) {
        out += '  ';
        i += 2;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
export function scanSource(file, source) {
  const hits = new Map();
  const add = (kind, offset) => {
    const line = source.slice(0, offset).split('\n').length;
    if (!hits.has(kind)) hits.set(kind, []);
    hits.get(kind).push(line);
  };
  const declaration = (property, value, offset) =>
    kinds(property, value).forEach((kind) => add(kind, offset));
  const css = (text, offset = 0, foundation = false, strict = false) => {
    try {
      postcss.parse(text).walkDecls((d) => {
        if (
          foundation &&
          d.prop.startsWith('--') &&
          d.parent?.selector?.trim() === ':root'
        )
          return;
        declaration(d.prop, d.value, offset + d.source.start.offset);
      });
    } catch (error) {
      if (strict) throw error;
      /* Embedded fragments need not be complete CSS. */
    }
  };
  const markup = (text, offset = 0) => {
    for (const tag of text.matchAll(/<[^>]+>/g)) {
      for (const a of tag[0].matchAll(
        /\b(style|fill|stroke|color|stop-color|flood-color)\s*=\s*(["'])(.*?)\2/gi,
      )) {
        const pos = offset + tag.index + a.index;
        if (a[1].toLowerCase() === 'style')
          css(
            `x{${a[3].replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")}}`,
            pos - 2,
          );
        else declaration(a[1], a[3], pos);
      }
    }
    for (const block of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi))
      css(block[1], offset + block.index + block[0].indexOf(block[1]));
  };
  if (file.endsWith('.css'))
    css(source, 0, file === 'src/ui/styles/foundation.css', true);
  else if (file.endsWith('.html')) markup(source);
  else {
    const code = maskComments(source);
    for (const literal of code.matchAll(
      /(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*?)\1/g,
    ))
      markup(literal[2].replace(/\\(["'`])/g, '$1'), literal.index + 1);
    for (const m of code.matchAll(
      /\.style\.([\w-]+)\s*=\s*(["'`])((?:\\[\s\S]|(?!\2)[\s\S])*?)\2/g,
    ))
      declaration(m[1], m[3], m.index);
    for (const m of code.matchAll(
      /\.style\.setProperty\(\s*(["'])([^"']+)\1\s*,\s*(["'`])((?:\\[\s\S]|(?!\3)[\s\S])*?)\3/g,
    ))
      declaration(m[2], m[4], m.index);
    for (const m of code.matchAll(
      /\.style\.cssText\s*=\s*(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*?)\1/g,
    ))
      css(`x{${m[2]}}`, m.index - 2);
    for (const m of code.matchAll(
      /\.setAttribute\(\s*(["'])style\1\s*,\s*(["'`])((?:\\[\s\S]|(?!\2)[\s\S])*?)\2/g,
    ))
      css(`x{${m[3]}}`, m.index - 2);
    for (const m of code.matchAll(
      /\.setAttribute\(\s*(["'])(fill|stroke|color|stop-color|flood-color)\1\s*,\s*(["'`])((?:\\[\s\S]|(?!\3)[\s\S])*?)\3/g,
    ))
      declaration(m[2], m[4], m.index);
    for (const object of code.matchAll(
      /Object\.assign\(\s*[\w.$]+\.style\s*,\s*\{([\s\S]*?)\}\s*\)/g,
    )) {
      for (const prop of object[1].matchAll(
        /(?:["']([\w-]+)["']|\b([\w-]+))\s*:\s*(["'])((?:\\[\s\S]|(?!\3)[\s\S])*?)\3/g,
      ))
        declaration(
          prop[1] || prop[2],
          prop[4],
          object.index + object[0].indexOf(object[1]) + prop.index,
        );
    }
  }
  if (file === 'src/designTokens.js')
    for (const m of source.matchAll(
      /['"]--[\w-]+['"]\s*:\s*['"](#[\da-f]{3,8})['"]/gi,
    ))
      add('palette', m.index);
  if (/\.[cm]?js$/.test(file))
    for (const m of maskComments(source).matchAll(
      /(?:Cesium|cesium)\.Color\.fromCssColorString\(\s*(["'`])([^"'`]+)\1\s*\)/g,
    ))
      if (colors.test(m[2])) add('cesium', m.index);
  return [...hits]
    .map(([kind, lines]) => ({ path: file, kind, lines }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}
export function compareCensus(actual, allowed) {
  const key = (row) => `${row.path}\0${row.kind}`;
  const a = new Map(actual.map((row) => [key(row), row]));
  const b = new Map(allowed.map((row) => [key(row), row]));
  const errors = [];
  if (b.size !== allowed.length) errors.push('duplicate allowance rows');
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const found = a.get(k),
      permit = b.get(k),
      count = found?.lines.length ?? 0;
    if (!permit || permit.count !== count || count === 0)
      errors.push(
        `${(found || permit).path}: ${(found || permit).kind}: actual ${count}, allowed ${permit?.count ?? 0}; lines ${(found?.lines || []).join(', ')}`,
      );
  }
  return errors;
}
export async function census(root) {
  const files = ['index.html', 'style.css'];
  async function walk(dir) {
    for (const entry of await readdir(path.join(root, dir), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        if (
          !/^(?:test|tests|fixtures|generated|node_modules|__tests__|__fixtures__)$/i.test(
            entry.name,
          )
        )
          await walk(`${dir}/${entry.name}`);
      } else if (
        /\.(?:css|html)$/.test(entry.name) ||
        (/^src\/ui(?:\/|$)/.test(dir) && /\.js$/.test(entry.name)) ||
        /\.js$/.test(entry.name)
      ) {
        if (!/\.(?:test|spec)\./.test(entry.name))
          files.push(`${dir}/${entry.name}`);
      }
    }
  }
  await walk('src');
  const result = [];
  for (const file of files.sort()) {
    const source = await readFile(path.join(root, file), 'utf8');
    if (/\.js$/.test(file) && !file.startsWith('src/ui/')) {
      for (const row of scanSource(file, source))
        if (row.kind === 'cesium' || row.kind === 'palette') result.push(row);
    } else result.push(...scanSource(file, source));
  }
  return result;
}
