import path from 'node:path';

export function parseLookArgs(args) {
  const values = new Map();
  const queries = [];
  const allowed = new Set([
    '--url',
    '--label',
    '--panel',
    '--state',
    '--query',
    '--out',
  ]);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.has(key) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new Error(`Invalid argument: ${key}`);
    const value = args[++i];
    if (key === '--query') queries.push(value);
    else {
      if (values.has(key)) throw new Error(`Duplicate argument: ${key}`);
      values.set(key, value);
    }
  }
  const url = new URL(values.get('--url'));
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Expected loopback HTTP origin');
  const label = values.get('--label');
  if (!['before', 'after'].includes(label))
    throw new Error('Expected --label before|after');
  if (values.get('--panel') !== 'legend')
    throw new Error('Only --panel legend is supported');
  const state = values.get('--state') ?? 'filled';
  if (state !== 'filled') throw new Error('Legend only supports filled state');
  url.searchParams.set('welcome', '0');
  url.searchParams.set('world-fixtures', '1');
  for (const query of queries) {
    const at = query.indexOf('=');
    if (at < 1) throw new Error('Expected --query k=v');
    const key = query.slice(0, at);
    const value = query.slice(at + 1);
    if (
      (key === 'welcome' && value !== '0') ||
      (key === 'world-fixtures' && value !== '1')
    )
      throw new Error(`Fixture default cannot be overridden: ${key}`);
    url.searchParams.set(key, value);
  }
  return {
    url,
    label,
    panel: 'legend',
    state,
    out: path.resolve(values.get('--out') ?? 'qa-artifacts/restyle-1.3/legend'),
  };
}
export function collisions(frames, panels) {
  const results = [];
  const meet = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  for (const [i, a] of frames.entries())
    for (const b of frames.slice(i + 1)) if (meet(a, b)) results.push({ a, b });
  for (const [i, a] of panels.entries()) {
    for (const b of [...frames, ...panels.slice(i + 1)]) {
      if (
        a.elementId &&
        b.elementId &&
        (a.ancestors?.includes(b.elementId) ||
          b.ancestors?.includes(a.elementId))
      )
        continue;
      if (meet(a, b)) results.push({ a, b });
    }
  }
  return results;
}
