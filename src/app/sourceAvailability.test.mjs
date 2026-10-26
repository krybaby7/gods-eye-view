import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configuredSourceAvailability,
  localReceiverAvailability,
} from './sourceAvailability.js';
import { keySetupRequirement } from '../keySetupCore.mjs';

test('absent configuration preserves provider and receiver availability', () => {
  assert.equal(configuredSourceAvailability('firms'), null);
  assert.equal(configuredSourceAvailability('vessels', {}), null);
  assert.equal(configuredSourceAvailability('firms', { firms: true }), null);
  assert.equal(localReceiverAvailability(undefined, {}), null);
});

test('only boolean missing-key metadata gates a keyed source, with shared guidance', () => {
  for (const [source, keyId] of [
    ['firms', 'firms'],
    ['vessels', 'aisstream'],
  ]) {
    assert.deepEqual(
      configuredSourceAvailability(source, { [source]: false }),
      {
        available: false,
        source,
        reason: keySetupRequirement(keyId),
        keyRequired: true,
        requiresKeyId: keyId,
      },
    );
    assert.equal(
      configuredSourceAvailability(source, { [source]: 'false' }),
      null,
    );
  }
  assert.equal(
    configuredSourceAvailability('earthquakes', { earthquakes: false }),
    null,
  );
});

test('an absent local receiver is unavailable without opening a device or polling', () => {
  const receiver = { connected: false, webUsbSupported: true, status: 'idle' };
  assert.deepEqual(localReceiverAvailability(false, receiver), {
    available: false,
    source: 'local-adsb',
    reason: 'connect a receiver in Radio',
  });
  assert.equal(
    localReceiverAvailability(false, { ...receiver, webUsbSupported: false })
      .reason,
    'WebUSB needs desktop Chrome or Edge',
  );
});

test('configured decoder feeds and a connected USB receiver are independent inputs', () => {
  const receiver = { connected: false, webUsbSupported: true, status: 'idle' };
  assert.equal(localReceiverAvailability(true, receiver).available, true);
  assert.equal(
    localReceiverAvailability(false, { ...receiver, connected: true })
      .available,
    true,
  );
  assert.equal(
    localReceiverAvailability(false, receiver, { configured: true }).available,
    true,
  );
  assert.equal(
    localReceiverAvailability(false, receiver, { configured: false }).available,
    false,
  );
});
