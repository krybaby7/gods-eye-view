import { pruneLegacyWorldDownloads } from './download.js';
import { cachedDownloadUrls as ucdpUrls } from './ucdp.js';
import { cachedDownloadUrls as vdemUrls } from './vdem.js';

export function cleanupLegacyWorldDownloads(
  cacheDirectory,
  features,
  observations,
  additionalUrls = [],
) {
  const vdemVersions = features.vdem?.sourceVersion
    ? [features.vdem.sourceVersion]
    : observations
        .filter(({ indicator }) => indicator === 'condition.polarisation')
        .map(({ sourceVersion }) => sourceVersion);
  const ucdpVersions = features.ucdp?.sourceVersion
    ? [features.ucdp.sourceVersion]
    : observations
        .filter(
          ({ indicator, period }) =>
            indicator === 'condition.conflict_deaths' &&
            (!features.ucdp?.period || period === features.ucdp.period),
        )
        .map(({ sourceVersion }) => sourceVersion);
  return pruneLegacyWorldDownloads(cacheDirectory, [
    ...additionalUrls,
    ...[...new Set(vdemVersions)].flatMap(vdemUrls),
    ...[...new Set(ucdpVersions)].flatMap(ucdpUrls).flat(),
  ]);
}
