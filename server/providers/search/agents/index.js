import { createClaudeAdapter } from './claude.js';
import { agentError } from './process.js';

const STATUS_TTL_MS = 5_000;
const CODEX_STATUS = Object.freeze({
  installed: false,
  signedIn: false,
  disabledReason: 'Not available yet',
});

function waitForStatus(check, signal) {
  if (!signal) return check;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(agentError('SEARCH_AGENT_CANCELED'));
    signal.addEventListener('abort', onAbort, { once: true });
    const settle = (callback) => (value) => {
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    check.then(settle(resolve), settle(reject));
  });
}

export function createSearchAgents(options) {
  const claude = createClaudeAdapter(options);
  let cached;
  let expiresAt = 0;
  let pending;
  return {
    get(id) {
      return id === 'claude' ? claude : null;
    },
    async status({ signal, fresh = false } = {}) {
      if (signal?.aborted) throw agentError('SEARCH_AGENT_CANCELED');
      if (!fresh && cached && Date.now() < expiresAt) return cached;
      pending ??= claude
        .status()
        .then((status) => {
          cached = Object.freeze({
            claude: Object.freeze(status),
            codex: CODEX_STATUS,
          });
          expiresAt = Date.now() + STATUS_TTL_MS;
          return cached;
        })
        .finally(() => {
          pending = undefined;
        });
      return waitForStatus(pending, signal);
    },
  };
}
