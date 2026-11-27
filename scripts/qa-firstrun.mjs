#!/usr/bin/env node
/** Exercise welcome and tour in the same offline fixture as the look capture. */
const args = process.argv.slice(2).filter((arg) => arg !== '--fixtures');
if (!args.includes('--url')) throw new Error('Use --url with a keyless fixture server.');
process.argv = [
  ...process.argv.slice(0, 2),
  ...args,
  '--label', 'after',
  '--panel', 'welcome',
  '--state', 'filled',
];
await import('./qa-look.mjs');
