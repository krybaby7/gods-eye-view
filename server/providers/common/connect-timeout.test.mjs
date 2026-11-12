import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS,
  applyConnectAttemptTimeout,
  connectAttemptTimeoutMs,
} from './connect-timeout.js';

test('the connection allowance defaults to 2500 ms and refuses values below 250', () => {
  assert.equal(DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS, 2500);
  assert.equal(connectAttemptTimeoutMs({}), 2500);
  assert.equal(
    connectAttemptTimeoutMs({ GEV_CONNECT_ATTEMPT_TIMEOUT_MS: '' }),
    2500,
  );
  assert.equal(
    connectAttemptTimeoutMs({ GEV_CONNECT_ATTEMPT_TIMEOUT_MS: '5000' }),
    5000,
  );
  assert.equal(
    connectAttemptTimeoutMs({ GEV_CONNECT_ATTEMPT_TIMEOUT_MS: '250' }),
    250,
  );
  for (const bad of ['249', '0', '-1', 'abc', 'Infinity', 'NaN'])
    assert.equal(
      connectAttemptTimeoutMs({ GEV_CONNECT_ATTEMPT_TIMEOUT_MS: bad }),
      2500,
      bad,
    );
});

test('the allowance is applied through net, and skipped on a Node without it', () => {
  const calls = [];
  const fakeNet = {
    setDefaultAutoSelectFamilyAttemptTimeout: (ms) => calls.push(ms),
  };
  assert.equal(
    applyConnectAttemptTimeout(
      { GEV_CONNECT_ATTEMPT_TIMEOUT_MS: '4000' },
      fakeNet,
    ),
    4000,
  );
  assert.deepEqual(calls, [4000]);
  assert.equal(applyConnectAttemptTimeout({}, {}), null);
});

test('the local server applies the allowance once, where its providers are created', async (t) => {
  const net = (await import('node:net')).default;
  if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout !== 'function')
    return t.skip('this Node has no setDefaultAutoSelectFamilyAttemptTimeout');
  const calls = [];
  t.mock.method(net, 'setDefaultAutoSelectFamilyAttemptTimeout', (ms) =>
    calls.push(ms),
  );
  const { localProviderPlugins } = await import('../local.js');
  localProviderPlugins();
  localProviderPlugins();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], connectAttemptTimeoutMs());
});
