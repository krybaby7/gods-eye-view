import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zipOneEntry } from '../src/testSupport/zipFixture.mjs';
import live from './world-fact-checks/live.mjs';

test('the fact checker compares both thresholds on the same recorded archives', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'world-live-compare-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = 'GEV_WORLD_GDELT_EVIDENCE_DIR';
  const frozenKey = 'GEV_WORLD_GDELT_FROZEN_DIR';
  const previous = [process.env[key], process.env[frozenKey]];
  process.env[key] = process.env[frozenKey] = directory;
  t.after(() => {
    for (const [i, name] of [key, frozenKey].entries()) {
      if (previous[i] === undefined) delete process.env[name];
      else process.env[name] = previous[i];
    }
  });
  const filename = '20261109181500.export.CSV';
  const rows = [7, 8, 9].map((day) => {
    const row = Array(61).fill('');
    Object.assign(row, {
      0: String(day),
      1: '2026110' + day,
      5: 'PROTESTERS',
      28: '14',
      52: 'New Delhi',
      53: 'IN',
      54: 'IN07',
      60: 'https://publisher-' + day + '.example/article',
    });
    return row.join('\t');
  });
  const archive = zipOneEntry(filename, rows.join('\n'));
  const md5 = createHash('md5').update(archive).digest('hex');
  const url = 'https://data.gdeltproject.org/gdeltv2/' + filename + '.zip';
  await Promise.all([
    writeFile(join(directory, 'phase6-gdelt.zip'), archive),
    writeFile(
      join(directory, 'phase6-gdelt-manifest.txt'),
      `${archive.length} ${md5} ${url}\n`,
    ),
  ]);
  const facts = await live({ board: { features: {} } });
  for (const sample of ['frozen', 'fresh']) {
    const fact = facts.find(
      ({ id }) => id === `live-gdelt-${sample}-before-after`,
    );
    assert.equal(fact?.pass, true);
    assert.equal(fact.source, url);
    assert.equal(fact.found.before.flagCount, 0);
    assert.equal(fact.found.after.flagCount, 1);
    assert.equal(fact.found.after.flags[0].iso3, 'IND');
  }
});

test('missing GDELT evidence leaves other live fact rows measurable', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'world-live-evidence-test-'));
  const key = 'GEV_WORLD_GDELT_EVIDENCE_DIR';
  const previous = process.env[key];
  process.env[key] = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const rows = await live({ board: { features: {} } });
  for (const id of ['live-gdelt-api', 'live-gdelt-recorded-replay']) {
    const row = rows.find((item) => item.id === id);
    assert.equal(row.pass, null);
    assert.ok(row.reason);
  }
  for (const id of [
    'live-ticks-no-turn',
    'live-tick-cadence',
    'live-net-flag-changes',
    'live-unhcr-release-fallback',
  ]) {
    assert.equal(rows.find((item) => item.id === id)?.pass, true, id);
  }
});
