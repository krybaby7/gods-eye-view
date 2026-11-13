/**
 * A small CSS cascade for tests: the application's real style sheets, read as
 * rules in source order, matched against modelled elements, and resolved by
 * importance, specificity and source order. @media and @supports count as
 * always on, and a state the test cannot know (hover, focus, :has) counts as
 * on where that widens what applies and as off inside :not. Anything the model
 * cannot read fails loudly rather than being skipped. Not a browser.
 */
import assert from 'node:assert/strict';

// ── Style sheets ──

export function splitTop(text, delimiter) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === delimiter && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Style rules in source order; @media and @supports count as always on. */
export function rules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  (function walk(from, to) {
    let at = from;
    while (at < to) {
      const open = src.indexOf('{', at);
      const semi = src.indexOf(';', at);
      if (open < 0 || open >= to) return;
      if (
        semi >= 0 &&
        semi < open &&
        src.slice(at, semi).trim().startsWith('@')
      ) {
        at = semi + 1;
        continue;
      }
      const head = src.slice(at, open).trim();
      let depth = 1;
      let close = open + 1;
      for (; close < to && depth; close += 1) {
        if (src[close] === '{') depth += 1;
        else if (src[close] === '}') depth -= 1;
      }
      const inner = [open + 1, close - 1];
      if (/^@(media|supports|layer)\b/.test(head)) walk(...inner);
      else if (!head.startsWith('@')) {
        const decls = splitTop(src.slice(...inner), ';').flatMap((text) => {
          const colon = text.indexOf(':');
          if (colon < 0) return [];
          const value = text.slice(colon + 1).trim();
          return [
            {
              prop: text.slice(0, colon).trim().toLowerCase(),
              value: value.replace(/\s*!important$/i, ''),
              important: /!important$/i.test(value),
            },
          ];
        });
        out.push({ selectors: splitTop(head, ','), decls });
      }
      at = close;
    }
  })(0, src.length);
  return out;
}

// ── Selectors ──

const STATES =
  /^:(hover|focus|focus-visible|focus-within|active|visited|link|checked|disabled|enabled|empty|first-child|last-child|only-child|first-of-type|last-of-type|nth-child\(.*\)|nth-of-type\(.*\)|nth-last-child\(.*\)|placeholder-shown|target|open|popover-open|modal|fullscreen|-webkit-[\w-]+|-moz-[\w-]+|root|scope|default|indeterminate|invalid|valid|required|optional|read-only|read-write|lang\(.*\)|dir\(.*\)|has\(.*\))$/;

/** A complex selector as compounds and the combinators between them. */
function complex(selector) {
  const tokens = [];
  let depth = 0;
  let current = '';
  const flush = () => {
    if (current.trim()) tokens.push(current.trim());
    current = '';
  };
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i];
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (depth === 0 && /[\s>+~]/.test(char)) {
      flush();
      if (char !== ' ' && char !== '\n' && char !== '\t') tokens.push(char);
      else if (tokens.length && !['>', '+', '~', ' '].includes(tokens.at(-1)))
        tokens.push(' ');
      continue;
    }
    current += char;
  }
  flush();
  const cleaned = [];
  for (const token of tokens) {
    if (['>', '+', '~'].includes(token) && cleaned.at(-1) === ' ')
      cleaned.pop();
    cleaned.push(token);
  }
  while (cleaned.at(-1) === ' ') cleaned.pop();
  return cleaned;
}

/** The simple selectors of one compound. */
function simples(compound) {
  const out = [];
  let i = 0;
  while (i < compound.length) {
    let j = i + 1;
    if (compound[i] === '[') j = compound.indexOf(']', i) + 1;
    else {
      if (compound[i] === ':' && compound[i + 1] === ':') j += 1;
      while (j < compound.length && !/[.#[:]/.test(compound[j])) {
        if (compound[j] === '(') {
          let depth = 1;
          j += 1;
          while (depth) {
            if (compound[j] === '(') depth += 1;
            if (compound[j] === ')') depth -= 1;
            j += 1;
          }
        } else j += 1;
      }
    }
    out.push(compound.slice(i, j));
    i = j;
  }
  return out;
}

const argsOf = (simple) =>
  splitTop(simple.slice(simple.indexOf('(') + 1, -1), ',');

/**
 * Whether a compound matches. A state the test cannot know (hover, focus,
 * :has) counts as on where that widens what applies, and as off inside :not.
 */
function compoundMatches(compound, el, wide) {
  return simples(compound).every((simple) => {
    if (simple === '*') return true;
    if (simple.startsWith('::')) return false;
    if (simple.startsWith('#')) return el.id === simple.slice(1);
    if (simple.startsWith('.')) return el.classes.has(simple.slice(1));
    if (simple.startsWith('[')) {
      const m = /^\[([\w-]+)(?:([~^$*|]?=)['"]?([^'"\]]*)['"]?)?\]$/.exec(
        simple,
      );
      assert.ok(m, `attribute selector the test cannot read: ${simple}`);
      const value = el.attrs.get(m[1]);
      if (value === undefined) return false;
      if (!m[2]) return true;
      const want = m[3];
      return {
        '=': value === want,
        '~=': value.split(/\s+/).includes(want),
        '^=': value.startsWith(want),
        '$=': value.endsWith(want),
        '*=': value.includes(want),
        '|=': value === want || value.startsWith(`${want}-`),
      }[m[2]];
    }
    if (/^:(is|where|matches|-webkit-any)\(/.test(simple))
      return argsOf(simple).some((arg) => selectorMatches(arg, el, wide));
    if (simple.startsWith(':not('))
      return !argsOf(simple).some((arg) => selectorMatches(arg, el, !wide));
    if (STATES.test(simple)) return wide;
    if (simple.startsWith(':')) return wide;
    return el.tag === simple.toLowerCase();
  });
}

export function selectorMatches(selector, el, wide = true) {
  const parts = complex(selector);
  const from = (index, node) => {
    if (!compoundMatches(parts[index], node, wide)) return false;
    if (index === 0) return true;
    const combinator = parts[index - 1];
    if (combinator === '>')
      return Boolean(node.parent) && from(index - 2, node.parent);
    if (combinator === ' ') {
      for (let up = node.parent; up; up = up.parent)
        if (from(index - 2, up)) return true;
      return false;
    }
    // A sibling the test does not model: it may be there, sharing the parent.
    if (!wide) return false;
    return index - 2 === 0 || continueFrom(index - 2, node);
  };
  const continueFrom = (index, node) => {
    const combinator = parts[index - 1];
    if (combinator === '>')
      return Boolean(node.parent) && from(index - 2, node.parent);
    if (combinator === ' ') {
      for (let up = node.parent; up; up = up.parent)
        if (from(index - 2, up)) return true;
      return false;
    }
    return wide;
  };
  return from(parts.length - 1, el);
}

export function specificity(selector) {
  const total = [0, 0, 0];
  const add = (s) => s.forEach((n, i) => (total[i] += n));
  for (const part of complex(selector)) {
    if ([' ', '>', '+', '~'].includes(part)) continue;
    for (const simple of simples(part)) {
      if (simple === '*' || simple.startsWith(':where(')) continue;
      if (/^:(is|matches|not|has)\(/.test(simple)) {
        add(
          argsOf(simple)
            .map(specificity)
            .reduce((a, b) => (compare(a, b) >= 0 ? a : b), [0, 0, 0]),
        );
      } else if (simple.startsWith('#')) total[0] += 1;
      else if (simple.startsWith('::')) total[2] += 1;
      else if (/^[.[:]/.test(simple)) total[1] += 1;
      else total[2] += 1;
    }
  }
  return total;
}

export function compare(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// ── Values ──

export function customProperties(list) {
  const map = new Map();
  for (const rule of list)
    if (rule.selectors.includes(':root'))
      for (const { prop, value } of rule.decls)
        if (prop.startsWith('--')) map.set(prop, value);
  return map;
}

export function resolveVars(value, vars, depth = 0) {
  assert.ok(depth < 10, `custom properties nest too deep: ${value}`);
  const next = value.replace(
    /var\((--[\w-]+)(?:,\s*([^()]*))?\)/g,
    (_, name, fallback) => {
      const found = vars.get(name) ?? fallback;
      assert.ok(found !== undefined, `undefined custom property ${name}`);
      return found;
    },
  );
  return next === value ? value : resolveVars(next, vars, depth + 1);
}

export function modelNode(tag, attrs, parent) {
  const map = new Map(attrs);
  return {
    tag,
    id: map.get('id') ?? '',
    classes: new Set((map.get('class') ?? '').split(/\s+/).filter(Boolean)),
    attrs: map,
    parent,
  };
}

/** Whether a declaration beats the current winner in the author cascade. */
function beats(candidate, best) {
  if (!best) return true;
  const byImportance =
    Number(candidate.decl.important) - Number(best.decl.important);
  if (byImportance) return byImportance > 0;
  const bySpecificity = compare(candidate.spec, best.spec);
  return (
    bySpecificity > 0 || (bySpecificity === 0 && candidate.order >= best.order)
  );
}

/**
 * The winning author declaration for each property, where `longhands` maps a
 * declared property (a shorthand among them) to the properties it sets.
 */
export function winners(element, list, longhands) {
  const out = {};
  list.forEach((rule, order) => {
    for (const selector of rule.selectors) {
      if (!selectorMatches(selector, element)) continue;
      const spec = specificity(selector);
      for (const decl of rule.decls)
        for (const prop of longhands[decl.prop] ?? []) {
          const candidate = { decl, spec, order, selector };
          if (beats(candidate, out[prop])) out[prop] = candidate;
        }
    }
  });
  return out;
}

// ── HTML ──

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Every element of an HTML text as a model node with its parent, in order. */
export function htmlNodes(html) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const nodes = [];
  const stack = [];
  for (const m of body.matchAll(
    /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g,
  )) {
    const [, closing, rawTag, attrText, selfClosing] = m;
    const tag = rawTag.toLowerCase();
    if (closing) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
      continue;
    }
    const attrs = new Map();
    for (const a of attrText.matchAll(
      /([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g,
    ))
      attrs.set(a[1].toLowerCase(), (a[2] ?? '').replace(/^["']|["']$/g, ''));
    const node = modelNode(tag, attrs, stack.at(-1) ?? null);
    nodes.push(node);
    if (!selfClosing && !VOID.has(tag)) stack.push(node);
  }
  return nodes;
}

/** An element and its ancestors, outermost first. */
export function ancestorsOf(html, id) {
  const node = htmlNodes(html).find((item) => item.id === id);
  if (!node) throw new Error(`#${id} is not in the application's HTML`);
  const chain = [];
  for (let at = node; at; at = at.parent) chain.unshift(at);
  return chain;
}
