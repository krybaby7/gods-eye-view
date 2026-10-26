import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DATA_CREDITS } from './dataCredits.js';

const sources = JSON.parse(
  readFileSync(
    new URL('../../public/news/sources.json', import.meta.url),
    'utf8',
  ),
).sources;
const dataSources = readFileSync(
  new URL('../../DATA_SOURCES.md', import.meta.url),
  'utf8',
);
const decode = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const warMonitorCredits = DATA_CREDITS.filter(
  (entry) => entry.key.startsWith('war-monitor-') || entry.key === 'reliefweb',
)
  .map((entry) => decode(entry.html))
  .join('\n');

test('every fetched war monitor source is credited in the Data attribution popover', () => {
  for (const source of sources) {
    if (source.transport.type === 'link-only') continue;
    assert.ok(
      warMonitorCredits.includes(source.credit),
      `${source.id}: "${source.credit}" is missing from DATA_CREDITS`,
    );
  }
  assert.match(warMonitorCredits, /Perplexity Agent API/);
  assert.match(warMonitorCredits, /Anthropic/);
  assert.match(
    warMonitorCredits,
    /Headlines and stories are reporting, not verified incidents or risk rankings\./,
  );
});

test('DATA_SOURCES.md lists every registry source with its transport', () => {
  const section = dataSources.slice(dataSources.indexOf('## War monitor'));
  assert.ok(
    section.startsWith('## War monitor'),
    'DATA_SOURCES.md has a War monitor section',
  );
  for (const source of sources) {
    const row = section
      .split('\n')
      .find((line) => line.includes(`\`${source.id}\``));
    assert.ok(row, `${source.id} has a row`);
    assert.ok(
      row.includes(source.transport.type),
      `${source.id} row names its transport`,
    );
  }
});
