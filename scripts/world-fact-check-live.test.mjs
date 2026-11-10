import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import live from './world-fact-checks/live.mjs';

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
