import assert from 'node:assert/strict';
import test from 'node:test';

import { keySetupEndpoint } from './key-setup.js';

test('local Provider Settings reads only the search agent status and default', async () => {
  const handlers = new Map();
  const agents = {
    claude: { installed: true, signedIn: true },
    codex: { disabledReason: 'Not available yet' },
  };
  keySetupEndpoint({ searchAgentStatus: async () => agents }).configureServer({
    middlewares: { use: (path, handler) => handlers.set(path, handler) },
  });
  const handler = handlers.get('/api/setup/search-agents');
  assert.equal(typeof handler, 'function');
  const req = {
    method: 'GET',
    headers: { host: 'localhost:5182' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  let payload;
  const res = {
    setHeader() {},
    end(value) {
      payload = JSON.parse(value);
    },
  };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(payload, { agents, defaultAgent: 'claude' });
  await handler({ ...req, socket: { remoteAddress: '192.168.0.2' } }, res);
  assert.equal(res.statusCode, 403);
});
