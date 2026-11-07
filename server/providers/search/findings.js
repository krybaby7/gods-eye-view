import { createHash } from 'node:crypto';

import { deriveVerification, resolveLocation } from '../news/digest/stories.js';
import { normalizePlaceName } from '../news/geocode.js';
import { assignHotspots } from '../news/hotspots.js';
import { canonicalizeUrl } from '../news/store.js';

const LOOKUP_CAP = 15;
const AREA_PRECISIONS = new Set(['country', 'region']);

function sourceUrl(source) {
  return canonicalizeUrl(source.url ?? source.canonicalUrl);
}

function hostname(url) {
  const canonical = canonicalizeUrl(url);
  return canonical ? new URL(canonical).hostname : null;
}

function registryDomains(registry) {
  const domains = new Map();
  for (const source of registry.sources ?? registry) {
    for (const domain of [
      hostname(source.homepage),
      source.transport?.domain?.toLowerCase().replace(/^www\./, ''),
    ]) {
      if (domain && !domains.has(domain)) domains.set(domain, source);
    }
  }
  return domains;
}

function assignSourceIds(sources, priorSources, registry, runId) {
  const records = [...priorSources];
  const byUrl = new Map(
    priorSources.map((source) => [sourceUrl(source), source]),
  );
  const used = new Set(priorSources.map((source) => source.id));
  const domains = registryDomains(registry);
  const local = new Map();
  let nextId = priorSources.length + 1;

  for (const source of sources) {
    const canonicalUrl = sourceUrl(source);
    if (!canonicalUrl) continue;
    let record = byUrl.get(canonicalUrl);
    if (!record) {
      while (used.has('s' + nextId)) nextId++;
      const id = 's' + nextId++;
      used.add(id);
      const domain = new URL(canonicalUrl).hostname;
      const registered = domains.get(domain);
      record = {
        id,
        url: source.url ?? canonicalUrl,
        canonicalUrl,
        domain,
        title: source.title ?? '',
        date: source.date ?? null,
        snippet: source.snippet ?? '',
        checkedBy: source.checkedBy,
        firstRunId: runId,
        registeredSourceId: registered?.id ?? null,
        publisher: registered?.name ?? domain,
        kind: registered?.kind ?? 'unknown',
        perspective: registered?.perspective ?? 'unregistered',
      };
      byUrl.set(canonicalUrl, record);
      records.push(record);
    }
    local.set(source.id, record);
  }
  return { records, local };
}

function citedSources(ids, local) {
  return [...new Set((ids ?? []).map((id) => local.get(id)).filter(Boolean))];
}

function areaGazetteer(gazetteer) {
  const rowsByName = new Map();
  for (const row of gazetteer) {
    if (!AREA_PRECISIONS.has(row?.precision)) continue;
    for (const name of [row.name, ...(row.aliases ?? [])]) {
      const key = normalizePlaceName(name);
      if (key && !rowsByName.has(key)) rowsByName.set(key, [row]);
    }
  }
  return rowsByName;
}

function gazetteerLocation(finding, gazetteer, areas) {
  const placeName = finding.place?.name;
  if (finding.kind === 'area') {
    // A substring like "Sudan" in "Khartoum, Sudan" cannot justify a ring
    // over the entire country. The area must be named directly.
    const rows = areas.get(normalizePlaceName(placeName));
    return rows ? resolveLocation({ placeName }, rows) : null;
  }
  const location = resolveLocation(
    { placeName, lat: finding.lat, lon: finding.lon },
    gazetteer,
  );
  return location?.method === 'gazetteer' ? location : null;
}

function finalLocation(finding, { gazetteer, areas, geocodes }) {
  const location = gazetteerLocation(finding, gazetteer, areas);
  if (location) return location;
  const name = finding.place?.name ?? null;
  const candidate = geocodes.get(normalizePlaceName(name));
  const point = candidate && resolveLocation(candidate, []);
  if (
    point &&
    (finding.kind !== 'area' ||
      (AREA_PRECISIONS.has(candidate.precision) &&
        normalizePlaceName(name) === normalizePlaceName(candidate.name)))
  ) {
    return {
      lat: point.lat,
      lon: point.lon,
      method: 'nominatim',
      precision: candidate.precision ?? 'approximate',
      name: candidate.name ?? name,
    };
  }
  if (finding.kind === 'area') return null;
  return resolveLocation(
    { placeName: name, lat: finding.lat, lon: finding.lon },
    [],
  );
}

export function getUnresolvedPlaces({ mapped, sources, gazetteer = [] }) {
  const local = new Set(sources.filter(sourceUrl).map((source) => source.id));
  const areas = areaGazetteer(gazetteer);
  const names = new Map();
  for (const finding of mapped.findings) {
    const name = finding.place?.name?.trim();
    const key = normalizePlaceName(name);
    if (
      !key ||
      names.has(key) ||
      !finding.sourceIds?.some((id) => local.has(id)) ||
      gazetteerLocation(finding, gazetteer, areas)
    )
      continue;
    names.set(key, name);
    if (names.size === LOOKUP_CAP) break;
  }
  return [...names.values()];
}

function nextFindingId(searchId, finding, used) {
  const key = JSON.stringify([
    searchId,
    finding.kind,
    finding.title,
    finding.place?.name ?? null,
  ]);
  // Linear probing visits every four-digit id without a collision retry loop
  // that could repeat indefinitely as the search's history grows.
  const seed = Number.parseInt(
    createHash('sha1').update(key).digest('hex').slice(0, 4),
    16,
  );
  for (let offset = 0; offset < 0x10000; offset++) {
    const id = 'f_' + ((seed + offset) % 0x10000).toString(16).padStart(4, '0');
    if (!used.has(id)) return id;
  }
  throw new Error('Search finding ID space exhausted');
}

/** Complete one successful run using validated model output and confirmed pages. */
export function completeRun({
  search,
  run,
  mapped,
  sources,
  gazetteer = [],
  registry = [],
  geocodes = new Map(),
}) {
  const { records, local } = assignSourceIds(
    sources,
    search.sources ?? [],
    registry,
    run.id,
  );
  const perspectiveGroups =
    registry.perspectiveGroups ??
    new Map(
      (registry.perspectives ?? registry.theater?.perspectives ?? []).map(
        ({ id, group }) => [id, group],
      ),
    );
  const placement = {
    gazetteer,
    areas: areaGazetteer(gazetteer),
    geocodes: new Map(
      [...geocodes].map(([name, candidate]) => [
        normalizePlaceName(name),
        candidate,
      ]),
    ),
  };
  const findings = new Map(
    (search.findings ?? []).map((finding) => [finding.id, finding]),
  );
  const newFindings = [];
  const findingIds = new Set();
  let droppedNoSource = 0;

  const summary = [];
  for (const sentence of mapped.summary ?? []) {
    const cited = citedSources(sentence.sourceIds, local);
    if (!cited.length) {
      droppedNoSource++;
      continue;
    }
    summary.push({ text: sentence.text, sourceIds: cited.map(({ id }) => id) });
  }

  for (const finding of mapped.findings) {
    const cited = citedSources(finding.sourceIds, local);
    if (!cited.length) {
      droppedNoSource++;
      continue;
    }

    const prior = run.kind === 'update' && findings.get(finding.sameAs);
    if (prior) {
      findings.set(prior.id, { ...prior, lastSeenAt: run.finishedAt });
      findingIds.add(prior.id);
      continue;
    }

    const id = nextFindingId(search.id, finding, findings);
    const record = {
      id,
      kind: finding.kind,
      title: finding.title,
      summary: finding.summary,
      groupId: finding.groupId ?? null,
      actor: finding.actor ?? null,
      place: finding.place
        ? { name: finding.place.name, basis: finding.place.basis }
        : null,
      location: finalLocation(finding, placement),
      eventAt: finding.eventAt ?? null,
      sourceIds: cited.map(({ id }) => id),
      sourceCount: cited.length,
      firstRunId: run.id,
      firstSeenAt: run.finishedAt,
      lastSeenAt: run.finishedAt,
    };
    if (finding.kind === 'event' || finding.kind === 'statement')
      record.verification = deriveVerification(cited, { perspectiveGroups });
    findings.set(id, record);
    findingIds.add(id);
    newFindings.push(record);
  }

  for (const finding of assignHotspots(newFindings, gazetteer)) {
    findings.set(finding.id, finding);
  }

  const { model, ...runFields } = run;
  const runs = search.runs ?? [];
  return {
    ...search,
    label:
      !search.labelEdited &&
      !runs.some(({ status }) => status === 'ok') &&
      mapped.label
        ? [...mapped.label].slice(0, 40).join('')
        : search.label,
    status: 'ready',
    sources: records,
    findings: [...findings.values()],
    runs: [
      ...runs,
      {
        ...runFields,
        agentModel: run.agentModel ?? model ?? null,
        answer: {
          summary,
          groups: (mapped.groups ?? []).map(({ id, label }) => ({ id, label })),
        },
        findingIds: [...findingIds],
        sourceCount: new Set(local.values()).size,
        droppedNoSource,
        listOnly: [...findingIds].filter((id) => !findings.get(id).location)
          .length,
      },
    ],
  };
}
