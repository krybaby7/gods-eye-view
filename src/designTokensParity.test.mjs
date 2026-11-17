import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  customProperties,
  resolveVars,
  rules,
} from './testSupport/cssCascade.mjs';

// CSS and globe drawing both consume these semantic colours; compare values,
// not the spelling or organisation of either consumer's implementation.
test('globe semantic colours agree with the corresponding CSS tokens', async () => {
  const { DESIGN_COLORS } = await import('./designTokens.js');
  const css = readFileSync(
    new URL('./ui/styles/foundation.css', import.meta.url),
    'utf8',
  );
  const properties = customProperties(rules(css));
  const keys = [
    '--rel-war',
    '--rel-sanctions',
    '--rel-ally',
    '--rel-rival',
    '--rel-partner',
    '--rel-neutral',
    '--rel-armed',
    '--ramp-0',
    '--ramp-25',
    '--ramp-50',
    '--ramp-75',
    '--ramp-100',
    '--live-civil',
    '--live-military',
    '--live-sea',
    '--live-space',
    '--ownership-documented',
  ];
  for (const key of keys) {
    assert.ok(properties.has(key), `missing CSS token ${key}`);
    assert.equal(
      DESIGN_COLORS[key]?.toLowerCase(),
      resolveVars(`var(${key})`, properties).toLowerCase(),
      key,
    );
  }
  assert.equal(DESIGN_COLORS['--rel-armed'].toLowerCase(), '#f4525d');
  assert.equal(
    DESIGN_COLORS['--ownership-documented'].toLowerCase(),
    '#519bd4',
  );
  assert.notEqual(DESIGN_COLORS['--rel-armed'], DESIGN_COLORS['--rel-war']);
});
