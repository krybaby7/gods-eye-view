import path from 'node:path';

import { defaultSourceRoot } from '../common/source-root.js';
import { createDigestStore } from '../news/digest/store.js';
import { loadNewsRegistry } from '../news/registry.js';
import { canonicalizeUrl } from '../news/store.js';
import { fetchNominatimSearch } from '../regional/place.js';

const THEATERS = ['iran-israel-us', 'world'];

export function nominatimFindingLocation(result) {
  const { lat, lng: lon } = result?.geometry?.location ?? {};
  if (
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    !Number.isFinite(lon) ||
    Math.abs(lon) > 180
  )
    return null;
  const types = result.types ?? [];
  const precision = types.includes('country')
    ? 'country'
    : types.includes('administrative_area_level_1')
      ? 'region'
      : types.includes('locality')
        ? 'city'
        : 'approximate';
  return {
    lat,
    lon,
    precision,
    name:
      result.address_components?.[0]?.long_name ||
      result.formatted_address ||
      null,
  };
}

export function createSearchContext({
  cacheDir = path.join(process.cwd(), '.gev-cache'),
  sourceRoot = defaultSourceRoot,
} = {}) {
  let context;
  return {
    loadContext() {
      context ??= Promise.all(
        THEATERS.map((theaterId) =>
          loadNewsRegistry({ theaterId, root: sourceRoot }),
        ),
      )
        .then((registries) => {
          const sources = registries[0].sources;
          const perspectives = registries.flatMap(
            ({ theater }) => theater.perspectives,
          );
          const publishers = new Map();
          for (const source of sources) {
            const canonical = canonicalizeUrl(source.homepage);
            if (canonical)
              publishers.set(new URL(canonical).hostname, source.name);
            const domain = source.transport.domain
              ?.toLowerCase()
              .replace(/^www\./, '');
            if (domain) publishers.set(domain, source.name);
          }
          return {
            registry: { sources, perspectives },
            gazetteer: registries.flatMap(({ theater }) => theater.gazetteer),
            mapGazetteers: registries.map(({ theater }) => theater.gazetteer),
            nameSources: (rows) =>
              rows.map((row) => ({
                ...row,
                publisher: publishers.get(row.domain) ?? row.domain,
              })),
          };
        })
        .catch((error) => {
          context = null;
          throw error;
        });
      return context;
    },

    async geocode(name, { signal } = {}) {
      const result = await fetchNominatimSearch(name, null, { signal });
      return nominatimFindingLocation(result.results[0]);
    },

    async loadWarStories() {
      // Read the persisted snapshot without invoking the news service or its collector.
      const snapshots = await Promise.all(
        THEATERS.map(async (theaterId) => {
          const digest = createDigestStore({
            theaterId,
            cacheDir: path.join(cacheDir, 'news'),
          });
          await digest.load();
          return digest.stories().map((story) => ({
            id: story.id,
            title: story.title,
            theaterId,
            urls: story.itemIds
              .map((id) => digest.citation(id)?.url)
              .filter(Boolean),
          }));
        }),
      );
      return snapshots.flat();
    },
  };
}
