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
  const panel = values.get('--panel');
  const panels = [
    'legend',
    'layers',
    'weather',
    'cctv',
    'keys',
    'imagery',
    'radio',
    'context',
    'controls',
    'welcome',
  ];
  if (!panels.includes(panel))
    throw new Error(`Expected --panel ${panels.join('|')}`);
  const state =
    values.get('--state') ?? (panel === 'keys' ? 'empty' : 'filled');
  if (!['empty', 'filled'].includes(state))
    throw new Error('Expected --state empty|filled');
  if (panel === 'legend' && state !== 'filled')
    throw new Error('Legend only supports filled state');
  if (panel === 'keys' && state !== 'empty')
    throw new Error('Keys only supports the keyless state');
  if (panel === 'keys') url.searchParams.set('setup', '1');
  const welcome = panel === 'welcome' ? '1' : '0';
  url.searchParams.set('welcome', welcome);
  url.searchParams.set('world-fixtures', '1');
  for (const query of queries) {
    const at = query.indexOf('=');
    if (at < 1) throw new Error('Expected --query k=v');
    const key = query.slice(0, at);
    const value = query.slice(at + 1);
    if (
      (key === 'welcome' && value !== welcome) ||
      (key === 'world-fixtures' && value !== '1') ||
      (panel === 'keys' && key === 'setup' && value !== '1')
    )
      throw new Error(`Fixture default cannot be overridden: ${key}`);
    url.searchParams.set(key, value);
  }
  return {
    url,
    label,
    panel,
    state,
    out: path.resolve(
      values.get('--out') ?? `qa-artifacts/restyle-1.3/${panel}`,
    ),
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

export function validateWorkerProbe(probe) {
  if (probe.sentinelHits !== 0) throw new Error('worker reached sentinel');
  for (const url of [probe.sentinelUrl, probe.apiUrl]) {
    const beforeDenied = probe.before.denied[url] ?? 0;
    const afterDenied = probe.after.denied[url] ?? 0;
    const count = (rows) => rows.filter((value) => value === url).length;
    if (
      afterDenied <= beforeDenied &&
      count(probe.after.suppressed) <= count(probe.before.suppressed)
    )
      throw new Error(`No exact denial recorded for ${url}`);
    const result = probe.results.find((entry) => entry.url === url);
    if (!result || (![403, 404].includes(result.status) && !result.error))
      throw new Error(`Unexpected worker response for ${url}`);
  }
}

export function afterLegendFailures(data) {
  const failures = [];
  if (data.view === 'band' && data.bandVisible && data.keyOmitted)
    failures.push('Drawn legend cuts its title or Unknown key');
  for (const item of data.captionText) {
    const size = /^([\d.]+)px$/.exec(item.fontSize);
    const line = /^([\d.]+)px$/.exec(item.lineHeight);
    if (!size || Number(size[1]) < 12 || !line || Number(line[1]) < 16)
      failures.push(
        `${item.name} has unreadable type ${item.fontSize}/${item.lineHeight}`,
      );
  }
  return failures;
}

export function missingCoreLenses(lenses) {
  return [
    'condition',
    'strength',
    'energy',
    'data-age',
    'diplomacy',
    'ownership',
  ].filter((id) => !lenses.includes(id));
}

export function requiredContextFailures(data) {
  const failures = [];
  for (const name of ['Today', 'sheet']) {
    const box = data.frames.find((item) => item.name === name);
    if (!box || !(box.right > box.left && box.bottom > box.top))
      failures.push(`Missing visible ${name} box`);
  }
  if (data.sheetCode !== 'IND')
    failures.push(`Expected India sheet, got ${data.sheetCode ?? 'none'}`);
  return failures;
}

export function captureStateFailures(before, after) {
  return ['today', 'sheet', 'lens']
    .filter((key) => before[key] !== after[key])
    .map(
      (key) =>
        `${key} changed during capture: ${before[key] ?? 'none'} → ${after[key] ?? 'none'}`,
    );
}

export function popupContentFailures(data) {
  const failures = [];
  const expected = [
    'title',
    ...Array.from({ length: data.expectedStops }, (_, i) => `stop ${i + 1}`),
    'Unknown',
    ...(data.hasNote ? ['note'] : []),
  ];
  for (const name of expected) {
    const part = data.parts.find((item) => item.name === name);
    if (!part?.whole) failures.push(`Popup ${name} missing or clipped`);
  }
  if (data.scrollable.length)
    failures.push(`Popup content overflows: ${data.scrollable.join(', ')}`);
  return failures;
}
