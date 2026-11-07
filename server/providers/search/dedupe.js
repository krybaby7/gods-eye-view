import { greatCircleKm, normalizePlaceName } from '../news/geocode.js';
import { canonicalizeUrl } from '../news/store.js';

const DAY_MS = 24 * 3600_000;

function words(title) {
  return new Set(normalizePlaceName(title).match(/[\p{L}\p{N}]+/gu) ?? []);
}

function overlap(a, b) {
  let common = 0;
  for (const value of a) if (b.has(value)) common++;
  return common;
}

function sameFinding(a, b) {
  if (a.search.id === b.search.id || a.finding.kind !== b.finding.kind)
    return false;
  const hotspot = a.hotspot && a.hotspot === b.hotspot;
  const nearby = (km) =>
    a.finding.location &&
    b.finding.location &&
    greatCircleKm(a.finding.location, b.finding.location) <= km;
  if (overlap(a.urls, b.urls) && (hotspot || nearby(50))) return true;
  if (a.finding.kind === 'place')
    return Boolean(a.name) && a.name === b.name && nearby(25);
  if (
    (a.finding.kind === 'event' || a.finding.kind === 'statement') &&
    hotspot &&
    Math.abs(a.time - b.time) <= DAY_MS
  ) {
    const common = overlap(a.words, b.words);
    const total = a.words.size + b.words.size - common;
    return total > 0 && common / total >= 0.6;
  }
  return false;
}

function searchFindings(search) {
  const urls = new Map(
    (search.sources ?? []).map((source) => [
      source.id,
      canonicalizeUrl(source.canonicalUrl ?? source.url),
    ]),
  );
  return (search.findings ?? []).map((finding) => ({
    search,
    finding,
    key: search.id + ':' + finding.id,
    hotspot: finding.hotspot?.key,
    urls: new Set(
      (finding.sourceIds ?? []).map((id) => urls.get(id)).filter(Boolean),
    ),
    name: normalizePlaceName(finding.place?.name ?? finding.location?.name),
    time: Date.parse(finding.eventAt ?? ''),
    words: words(finding.title),
  }));
}

function warByUrl(warStories) {
  const byUrl = new Map();
  for (const { id, title, theaterId, urls } of warStories) {
    const link = { id, title, theaterId };
    for (const raw of urls ?? []) {
      const url = canonicalizeUrl(raw);
      if (!url) continue;
      if (!byUrl.has(url)) byUrl.set(url, []);
      byUrl.get(url).push(link);
    }
  }
  return byUrl;
}

export function decorateSearchSnapshots(searches, { warStories = [] } = {}) {
  const linksByUrl = warByUrl(warStories);
  const entries = searches.flatMap(searchFindings);
  const parents = entries.map((_, index) => index);
  function root(index) {
    while (index !== parents[index]) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (sameFinding(entries[i], entries[j])) parents[root(j)] = root(i);
    }
  }

  const groups = new Map();
  for (let i = 0; i < entries.length; i++) {
    const id = root(i);
    const { key, search } = entries[i];
    if (!groups.has(id)) groups.set(id, { key, searches: new Map() });
    const group = groups.get(id);
    if (key < group.key) group.key = key;
    group.searches.set(search.id, { searchId: search.id, label: search.label });
  }

  const bySearch = new Map(searches.map(({ id }) => [id, []]));
  for (let i = 0; i < entries.length; i++) {
    const { search, finding, urls } = entries[i];
    const group = groups.get(root(i));
    const warMonitor = new Map();
    for (const url of urls) {
      for (const link of linksByUrl.get(url) ?? []) {
        warMonitor.set(link.theaterId + ':' + link.id, link);
      }
    }
    bySearch.get(search.id).push({
      ...finding,
      mergeKey: group.key,
      alsoIn: [...group.searches.values()].filter(
        ({ searchId }) => searchId !== search.id,
      ),
      warMonitor: [...warMonitor.values()],
    });
  }
  return searches.map((search) => ({
    ...search,
    findings: bySearch.get(search.id),
  }));
}
