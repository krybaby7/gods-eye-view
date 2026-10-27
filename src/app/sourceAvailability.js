import { keySetupRequirement } from '../keySetupCore.mjs';
import { localAdsbStatus } from '../layers/localAdsb/status.js';

const SOURCE_KEY_IDS = Object.freeze({ firms: 'firms', vessels: 'aisstream' });

/** Native credential flags do not describe a caller-supplied source transport. */
export function standaloneSourceConfiguration(defaults, sources, explicit) {
  if (explicit !== undefined) return explicit;
  if (defaults === undefined) return undefined;
  const configuration = { ...defaults };
  for (const name of Object.keys(SOURCE_KEY_IDS)) {
    if (Object.hasOwn(sources || {}, name)) delete configuration[name];
  }
  return configuration;
}

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
