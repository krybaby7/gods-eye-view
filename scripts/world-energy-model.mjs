import { dependencyShares } from '../server/providers/world/dependencies.js';

const itemByHeading = new Map([
  ['2709', 'crude oil'],
  ['2710', 'refined products'],
  ['2701', 'coal'],
]);

export function commodity(code) {
  if (code === '271111') return 'lng';
  if (code === '271121') return 'pipeline gas';
  return itemByHeading.get(code.slice(0, 4));
}

export const gateIds = {
  suez: 'chokepoint1',
  panama: 'chokepoint2',
  'bab-el-mandeb': 'chokepoint4',
  malacca: 'chokepoint5',
  hormuz: 'chokepoint6',
  'cape-of-good-hope': 'chokepoint7',
  'danish-straits': 'chokepoint10',
  dardanelles: 'eia-dardanelles',
};

const networkGates = {
  suez: gateIds.suez,
  panama: gateIds.panama,
  babelmandeb: gateIds['bab-el-mandeb'],
  malacca: gateIds.malacca,
};

// Orthogonal cross-channel gates for EIA passages without an upstream edge tag.
// Each gate describes [longitude of a north/south line, min and max latitude].
const meridianGates = [
  [56.4, 25.4, 27.35, gateIds.hormuz],
  [20, -40, -34.8, gateIds['cape-of-good-hope']],
  [26.42, 39.96, 40.33, gateIds.dardanelles],
];
const parallelGates = [[55.5, 10.35, 13.15, gateIds['danish-straits']]];

function gateCrossings(from, to, pass) {
  const hits = [];
  const tag = networkGates[pass];
  if (tag) hits.push([0.5, tag]);
  if (Math.abs(from[0] - to[0]) > 180) return hits.map(([, id]) => id);
  for (const [axis, gates] of [
    [0, meridianGates],
    [1, parallelGates],
  ]) {
    if (from[axis] === to[axis]) continue;
    const transverse = 1 - axis;
    for (const [position, min, max, id] of gates) {
      const fraction = (position - from[axis]) / (to[axis] - from[axis]);
      if (fraction < 0 || fraction > 1) continue;
      const crossing =
        from[transverse] + fraction * (to[transverse] - from[transverse]);
      if (crossing >= min && crossing <= max) hits.push([fraction, id]);
    }
  }
  return hits.sort(([a], [b]) => a - b).map(([, id]) => id);
}

const radians = Math.PI / 180;
export function distanceKm([lon1, lat1], [lon2, lat2]) {
  const h =
    Math.sin(((lat2 - lat1) * radians) / 2) ** 2 +
    Math.cos(lat1 * radians) *
      Math.cos(lat2 * radians) *
      Math.sin(((lon2 - lon1) * radians) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

class MinHeap {
  entries = [];

  push(entry) {
    const heap = this.entries;
    let i = heap.length;
    heap.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][1] <= entry[1]) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = entry;
  }

  pop() {
    const heap = this.entries;
    const first = heap[0];
    const last = heap.pop();
    if (!heap.length) return first;
    let i = 0;
    while (2 * i + 1 < heap.length) {
      let child = 2 * i + 1;
      if (child + 1 < heap.length && heap[child + 1][1] < heap[child][1])
        child++;
      if (last[1] <= heap[child][1]) break;
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = last;
    return first;
  }
}

export function maritimeRouter(network, { maxSnapKm = 225 } = {}) {
  const ids = new Map();
  const points = [];
  const graph = [];
  function nodeFor(coordinate) {
    const [lon, lat] = coordinate;
    const key = [lon === 180 ? -180 : lon, lat]
      .map((n) => n.toFixed(5))
      .join(',');
    if (!ids.has(key)) {
      ids.set(key, points.length);
      points.push(coordinate);
      graph.push([]);
    }
    return ids.get(key);
  }
  for (const { geometry, properties } of network.features) {
    const lines =
      geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : [geometry.coordinates];
    for (const coordinates of lines) {
      for (let i = 1; i < coordinates.length; i++) {
        const from = nodeFor(coordinates[i - 1]);
        const to = nodeFor(coordinates[i]);
        if (from === to) continue;
        const weight = distanceKm(points[from], points[to]);
        const gates = gateCrossings(points[from], points[to], properties.pass);
        graph[from].push({ to, weight, gates });
        graph[to].push({ to: from, weight, gates: [...gates].reverse() });
      }
    }
  }

  // Some lanes (for example the Caspian) are disconnected. Snap ports only to
  // the component that represents the world's connected ocean shipping lanes.
  const seen = new Set();
  let ocean = [];
  for (const start of graph.keys()) {
    if (seen.has(start)) continue;
    const component = [start];
    seen.add(start);
    for (const from of component) {
      for (const { to } of graph[from]) {
        if (seen.has(to)) continue;
        seen.add(to);
        component.push(to);
      }
    }
    if (component.length > ocean.length) ocean = component;
  }
  const snaps = new Map();
  function closest(point) {
    const key = point.join(',');
    if (snaps.has(key)) return snaps.get(key);
    let best = null;
    let nearest = maxSnapKm;
    for (const id of ocean) {
      const distance = distanceKm(point, points[id]);
      if (distance >= nearest) continue;
      nearest = distance;
      best = id;
    }
    snaps.set(key, best);
    return best;
  }

  const trees = new Map();
  function tree(start) {
    if (trees.has(start)) return trees.get(start);
    const distances = new Float64Array(points.length).fill(Infinity);
    const predecessors = Array(points.length);
    const queue = new MinHeap();
    distances[start] = 0;
    queue.push([start, 0]);
    while (queue.entries.length) {
      const [from, travelled] = queue.pop();
      if (travelled !== distances[from]) continue;
      for (const { to, weight, gates } of graph[from]) {
        const next = travelled + weight;
        if (next >= distances[to]) continue;
        distances[to] = next;
        predecessors[to] = { from, gates };
        queue.push([to, next]);
      }
    }
    trees.set(start, predecessors);
    return predecessors;
  }

  return (start, end) => {
    const source = closest(start);
    const destination = closest(end);
    if (source === null || destination === null) return null;
    const predecessors = tree(source);
    const coordinates = [];
    const edges = [];
    let node = destination;
    while (node !== source) {
      const previous = predecessors[node];
      if (!previous) return null;
      coordinates.push(points[node]);
      edges.push(previous.gates);
      node = previous.from;
    }
    coordinates.push(points[source]);
    return {
      mode: 'sea',
      gates: [...new Set(edges.reverse().flat())],
      coordinates: coordinates.reverse(),
    };
  };
}

const round = (value, digits = 3) => Number(value.toFixed(digits));
const priceUnit = 'thousand USD/year';
const weightUnit = 'tonnes/year';
const assumptions = [
  'Representative ports and shortest maritime paths approximate routes. A shipment may use a different port or passage.',
  'Adjacent-country trade (except LNG) and trade involving landlocked countries are assigned to land. HS 271121 pipeline gas is land-only and kept separate from LNG.',
  'Trade with an unresolved route is included in all imports. Only routes assigned to sea enter the seaborne denominator.',
  'If a flow has no reported tonnage, the entire importer and product group uses declared trade value for both shares.',
  'Declared partners include re-exports. The HS product groups are coarse.',
  'Routes describe a baseline, before modelling Red Sea diversions. EIA counts observed transit, including routes and product scopes this model approximates.',
  'IMF PortWatch live traffic is gated pending permission and is not an input to these structural shares.',
];

function shareRow(crossing, { seaborne, all, unknown, unit }) {
  const shares = dependencyShares({ crossing, seaborne, total: all });
  return {
    volume: { value: round(crossing), unit },
    shares: {
      seaborne: shares.seaborne === null ? null : round(shares.seaborne, 6),
      all: shares.all === null ? null : round(shares.all, 6),
    },
    denominators: {
      seaborne: round(seaborne),
      all: round(all),
      unknown: round(unknown),
      unit,
    },
  };
}

function thinRoute(coordinates) {
  if (!coordinates.length) return [];
  const sampled = [];
  for (const point of coordinates) {
    if (!sampled.length || distanceKm(sampled.at(-1), point) >= 180)
      sampled.push(point);
  }
  if (sampled.at(-1) !== coordinates.at(-1)) sampled.push(coordinates.at(-1));
  return sampled.map((point) => point.map((value) => round(value, 2)));
}

function calibrate(references, transit) {
  return references
    .filter(({ year }) => year === 2024)
    .map(({ routeId, commodity: kind, value, period, unit }) => {
      const modelled = transit.get(gateIds[routeId])?.[kind] ?? 0;
      return {
        routeId,
        commodity: kind,
        period,
        unit,
        published: value,
        modelled: round(modelled),
        gap: round(modelled - value),
        gapPct: value > 0 ? round((100 * (modelled - value)) / value, 1) : null,
      };
    });
}

export function buildEnergyModel(flows, { routeFor, references }) {
  const groups = Map.groupBy(
    flows,
    ({ dependent, item }) => dependent + '/' + item,
  );
  const transit = new Map();
  const exposure = {};
  const coverage = {
    importers: 0,
    modelledImporters: 0,
    landFlows: 0,
    seaFlows: 0,
    unknownFlows: 0,
    valueGroups: 0,
  };
  const pipelineGas = {};
  const bilateral = [];
  for (const group of groups.values()) {
    const { dependent, item } = group[0];
    const byValue = group.some(({ tonnes }) => tonnes === null);
    if (byValue) coverage.valueGroups++;
    const unit = byValue ? priceUnit : weightUnit;
    const totals = { seaborne: 0, all: 0, unknown: 0, unit };
    const crossings = new Map();
    const routed = [];
    for (const flow of group) {
      const { provider, tonnes, reportedTonnes = tonnes ?? 0, value } = flow;
      const amount = byValue ? value : tonnes;
      totals.all += amount;
      const route =
        item === 'pipeline gas'
          ? { mode: 'land' }
          : routeFor(provider, dependent, item);
      if (route.mode === 'land') {
        coverage.landFlows++;
        continue;
      }
      if (route.mode !== 'sea') {
        coverage.unknownFlows++;
        totals.unknown += amount;
        continue;
      }
      coverage.seaFlows++;
      totals.seaborne += amount;
      routed.push({ provider, amount, route });
      for (const gate of route.gates) {
        crossings.set(gate, (crossings.get(gate) ?? 0) + amount);
        const estimate = transit.get(gate) ?? { oil: 0, lng: 0 };
        // Calendar 2024 has 366 days. Generic conversion factors approximate the EIA units.
        if (item === 'crude oil')
          estimate.oil += (reportedTonnes * 7.33) / 366_000_000;
        if (item === 'refined products')
          estimate.oil += (reportedTonnes * 7.9) / 366_000_000;
        if (item === 'lng')
          estimate.lng += (reportedTonnes * 48_700) / 366_000_000_000;
        transit.set(gate, estimate);
      }
    }
    if (item === 'pipeline gas') {
      pipelineGas[dependent] = { mode: 'land', value: round(totals.all), unit };
    }
    if (totals.seaborne <= 0) continue;
    exposure[dependent] ??= [];
    for (const [gate, amount] of crossings) {
      exposure[dependent].push({ gate, item, ...shareRow(amount, totals) });
    }
    for (const { provider, amount, route } of routed) {
      if (amount <= 0) continue;
      bilateral.push({
        id: [provider, dependent, item].join('/'),
        provider,
        dependent,
        item,
        route: route.gates,
        path: route.coordinates,
        ...shareRow(amount, totals),
        period: '2024',
      });
    }
  }
  const included = new Set();
  for (const key of ['dependent', 'provider']) {
    for (const rows of Map.groupBy(bilateral, (row) => row[key]).values()) {
      for (const row of rows
        .sort((a, b) => b.shares.all - a.shares.all)
        .slice(0, 12))
        included.add(row);
    }
  }
  const largest = bilateral.filter(
    ({ route, volume }) => route.length && volume.unit === weightUnit,
  );
  for (const row of largest
    .sort((a, b) => b.volume.value - a.volume.value)
    .slice(0, 12))
    included.add(row);
  const paths = {};
  const rows = [...included].map(({ path, ...row }) => {
    paths[row.provider + '/' + row.dependent] ??= thinRoute(path);
    return row;
  });
  coverage.importers = new Set(flows.map(({ dependent }) => dependent)).size;
  coverage.modelledImporters = Object.keys(exposure).length;
  for (const rows of Object.values(exposure))
    rows.sort((a, b) => b.shares.all - a.shares.all);
  return {
    mode: 'modelled',
    version: 'BACI HS22 V202601',
    period: '2024',
    label:
      'Modelled from 2024 BACI trade, benchmarked against EIA. Not a published statistic.',
    assumptions,
    coverage,
    calibration: calibrate(references, transit),
    exposure,
    pipelineGas,
    paths,
    rows,
  };
}
