import net from 'node:net';

/**
 * Node tries each address of a host for 250 ms by default before giving up
 * on it ("happy eyeballs"). On a slow mobile connection that makes working
 * hosts fail with ETIMEDOUT after about a second, so the local server gives
 * each attempt longer: GEV_CONNECT_ATTEMPT_TIMEOUT_MS, default 2500.
 */

export const DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS = 2500;
const NODE_MINIMUM_MS = 250;

/**
 * The per-attempt connection allowance from the environment. A value that is
 * missing, not finite or below 250 ms gives the default. Pure.
 * @param {Record<string, string|undefined>} [env]
 * @returns {number}
 */
export function connectAttemptTimeoutMs(env = process.env) {
  const raw = String(env.GEV_CONNECT_ATTEMPT_TIMEOUT_MS ?? '').trim();
  const value = raw === '' ? NaN : Number(raw);
  return Number.isFinite(value) && value >= NODE_MINIMUM_MS
    ? Math.round(value)
    : DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS;
}

/**
 * Apply the allowance process-wide. Does nothing on a Node without
 * `net.setDefaultAutoSelectFamilyAttemptTimeout`.
 * @returns {?number} The value applied, or null when unsupported.
 */
export function applyConnectAttemptTimeout(env = process.env, netModule = net) {
  if (typeof netModule?.setDefaultAutoSelectFamilyAttemptTimeout !== 'function')
    return null;
  const ms = connectAttemptTimeoutMs(env);
  netModule.setDefaultAutoSelectFamilyAttemptTimeout(ms);
  return ms;
}
