import { keySetupRequirement } from '../keySetupCore.mjs';
import { localAdsbStatus } from '../layers/localAdsb/status.js';

const SOURCE_KEY_IDS = Object.freeze({ firms: 'firms', vessels: 'aisstream' });

/** Read non-secret key-presence metadata without starting source acquisition. */
export function configuredSourceAvailability(source, configuration) {
  const requiresKeyId = SOURCE_KEY_IDS[source];
  if (!requiresKeyId || configuration?.[source] !== false) return null;
  return {
    available: false,
    source,
    reason: keySetupRequirement(requiresKeyId),
    keyRequired: true,
    requiresKeyId,
  };
}

/** Local receiver configuration and the existing device snapshot are sufficient. */
export function localReceiverAvailability(configured, receiver, feedState) {
  if (typeof configured !== 'boolean') return null;
  const available = Boolean(
    configured || receiver?.connected || feedState?.configured === true,
  );
  const status = available
    ? null
    : localAdsbStatus({ receiver, feedState, heard: 0 });
  return {
    available,
    source: 'local-adsb',
    reason: available ? null : status.statusMessage || status.error,
  };
}
