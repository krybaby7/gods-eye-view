#!/usr/bin/env node
/** Verify specific welcome regressions trigger the behavior tests. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, 'src/firstRunExperience.js');
const original = fs.readFileSync(file, 'utf8');
const mutations = [
  {
    defect: 'Skip stops saving the first visit across sessions',
    from: "storeAccess('localStorage', storage, true);",
    to: "storeAccess('localStorage', storage);",
    test: 'skipping the initial welcome remembers the choice across browser sessions',
  },
  {
    defect: 'the last tour step is skipped',
    from: 'if (step === steps.length - 1) dismiss();',
    to: 'if (step === steps.length - 2) dismiss();',
    test: 'the tour has four reachable steps, Back works, and Finish remembers it',
  },
  {
    defect: 'Menu replay loses its click handler',
    from: '[replay, startTour]',
    to: '[replay, () => {}]',
    test: 'a returning visitor can replay from Menu and exit with Escape',
  },
  {
    defect: 'Escape hides the guide without returning focus',
    from: 'onEscape: dismiss,',
    to: 'onEscape: () => dismiss({ restoreFocus: false }),',
    test: 'a returning visitor can replay from Menu and exit with Escape',
  },
  {
    defect: 'explicit welcome suppression is ignored',
    from: "if (params.get('welcome') === '0') return false;",
    to: "if (params.get('welcome') === '0') return true;",
    test: 'explicit welcome URL flags work while shares and embeds suppress auto-show',
  },
  {
    defect: 'tab storage is ignored when persistent storage is blocked',
    from: "storeAccess('sessionStorage', sessionStorageRef) !== 'seen'",
    to: 'true',
    test: 'storage denial leaves Skip usable and suppresses the rest of the tab session',
  },
];

for (const { defect, from, to, test } of mutations) {
  assert.equal(original.split(from).length, 2, `Unexpected mutation anchor: ${defect}`);
  try {
    fs.writeFileSync(file, original.replace(from, to));
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-name-pattern', test, 'src/firstRunExperience.test.mjs'],
      { cwd: root, encoding: 'utf8' },
    );
    if (result.error) throw result.error;
    assert.equal(result.status, 1, `Mutation went undetected: ${defect}\n${result.stdout}`);
    assert.ok(
      result.stdout.split(/\r?\n/).some((line) => line.startsWith(`✖ ${test} (`)),
      `Test did not fail as expected: ${defect}\n${result.stdout}\n${result.stderr}`,
    );
    console.log(`[PASS] ${defect}`);
  } finally {
    fs.writeFileSync(file, original);
  }
}
