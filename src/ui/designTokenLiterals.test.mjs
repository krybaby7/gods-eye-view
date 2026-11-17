import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { census, compareCensus } from '../testSupport/designTokenLiterals.mjs';

test('design token literal census matches the exact debt ratchet', async () => {
  const root = process.cwd();
  const allowed = JSON.parse(
    await readFile(
      new URL('./designTokenLiterals.allow.json', import.meta.url),
      'utf8',
    ),
  );
  const errors = compareCensus(await census(root), allowed);
  assert.deepEqual(errors, [], errors.join('\n'));
});
