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

const excludedPassages = new Set(['kiel', 'bering', 'northwest', 'northeast']);

function crossesArcticShortcut(points) {
  return points.some(
    ([lon, lat]) =>
      (lat >= 65.7 && lon >= -171 && lon <= -160) ||
      (lat >= 70 && ((lon >= 99 && lon <= 179) || (lon >= -145 && lon <= -90))),
  );
}

function usesKielCanal(points) {
  return points.some(
    ([lon, lat], index) =>
      index > 0 &&
      [points[index - 1], [lon, lat]].every(
        ([x, y]) => x >= 9.06 && x <= 9.79 && y >= 53.78 && y <= 54.88,
      ) &&
      Math.abs(lon - points[index - 1][0]) > 0.7,
  );
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
    if (excludedPassages.has(properties?.pass)) continue;
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
    const result = { distances, predecessors };
    trees.set(start, result);
    return result;
  }

  const route = (start, end) => {
    const source = closest(start);
    const destination = closest(end);
    if (source === null || destination === null) return null;
    const { distances, predecessors } = tree(source);
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
      distance: distances[destination],
      gates: [...new Set(edges.reverse().flat())],
      coordinates: coordinates.reverse(),
    };
  };
  route.nearestNetworkPort = (coast) => {
    let best = null;
    let nearest = Infinity;
    for (const point of coast) {
      for (const id of ocean) {
        const candidate = points[id];
        // A latitude difference alone supplies a cheap lower bound.
        if (Math.abs(candidate[1] - point[1]) * 111 > nearest) continue;
        const distance = distanceKm(point, candidate);
        if (distance >= nearest) continue;
        best = candidate;
        nearest = distance;
      }
    }
    return best;
  };
  return route;
}

const round = (value, digits = 3) => Number(value.toFixed(digits));
const weightUnit = 'tonnes/year';
const energyUnit = 'PJ/year';
const energyPerTonne = {
  'crude oil': 42.3,
  'refined products': 43,
  lng: 50,
  coal: 24,
};
export const minorImporterFloor = 10;
export const originDistanceLimit = 1.5;
const shortestRouteNote = 'shortest route, before the Red Sea diversions';
const assumptions = [
  'Representative ports and shortest maritime paths approximate routes. A fallback is a geographic mainland proxy. A shipment may use a different port or passage.',
  'The combined measure uses 42.3 GJ/t for crude oil, 43 for refined products, 50 for LNG and 24 for coal. These are draft average heating values. Pipeline gas is reported separately.',
  'The draft minor importer floor is 10 PJ per year.',
  `For measured multiport splits, national export shares are renormalised for each destination over origin ports within ${originDistanceLimit} times the shortest sea route. The distance limit is draft. Route lines show the largest modelled port pair for the product.`,
  'HS 271121 pipeline gas is land-only and kept separate from LNG.',
  'Trade with an unresolved route is included in all imports. Only routes assigned to sea enter the seaborne denominator.',
  'All product shares use tonnes. Missing quantities and quantities priced below one third of the tonne-weighted HS6 median are estimated from declared trade value at that median price.',
  'Declared partners include re-exports. An EIA-documented China crude origin correction affects routing only. The HS product groups are coarse.',
  'Routes describe a baseline, before modelling Red Sea diversions. EIA counts observed transit, including routes and product scopes this model approximates.',
  'IMF PortWatch live traffic is gated pending permission and is not an input to these structural shares.',
];

function shareRow(crossing, { seaborne, all, unknown, unit }) {
  const clampRounding = (denominator) =>
    crossing > denominator &&
    crossing - denominator <= Math.abs(denominator) * 1e-12
      ? crossing
      : denominator;
  const shares = dependencyShares({
    crossing,
    seaborne: clampRounding(seaborne),
    total: clampRounding(all),
  });
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
        ...(['suez', 'bab-el-mandeb', 'cape-of-good-hope'].includes(
          routeId,
        ) && { note: shortestRouteNote }),
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
  const energyByImporter = new Map();
  const importTonnes = {};
  const coverage = {
    importers: 0,
    modelledImporters: 0,
    landFlows: 0,
    seaFlows: 0,
    unknownFlows: 0,
  };
  const pipelineGas = {};
  const bilateral = [];
  const routeAudit = { assessed: 0, arcticShortcuts: 0, kiel: 0 };
  const inspectedRoutes = new Set();
  for (const group of groups.values()) {
    const { dependent, item } = group[0];
    const totals = { seaborne: 0, all: 0, unknown: 0, unit: weightUnit };
    const crossings = new Map();
    const routed = [];
    for (const flow of group) {
      const { provider, tonnes: amount } = flow;
      totals.all += amount;
      const energy = ((energyPerTonne[item] ?? 0) * amount) / 1e6;
      const combined = energyByImporter.get(dependent) ?? {
        all: 0,
        seaborne: 0,
        unknown: 0,
        unit: energyUnit,
        crossings: new Map(),
      };
      if (energyPerTonne[item]) {
        energyByImporter.set(dependent, combined);
        combined.all += energy;
        const items = (importTonnes[dependent] ??= {});
        items[item] = (items[item] ?? 0) + amount;
      }
      const routeOptions =
        item === 'pipeline gas'
          ? { mode: 'land' }
          : routeFor(provider, dependent, item);
      const routes = Array.isArray(routeOptions)
        ? [...routeOptions]
        : [routeOptions];
      if (flow.routeOriginAdjustment) {
        const { origin, share } = flow.routeOriginAdjustment;
        const inferred = routeFor(origin, dependent, item);
        const inferredRoutes = Array.isArray(inferred) ? inferred : [inferred];
        for (let index = 0; index < routes.length; index++) {
          routes[index] = {
            ...routes[index],
            share: (routes[index].share ?? 1) * (1 - share),
          };
        }
        routes.push(
          ...inferredRoutes.map((route) => ({
            ...route,
            share: (route.share ?? 1) * share,
          })),
        );
      }
      if (flow.landShare > 0) {
        for (let index = 0; index < routes.length; index++) {
          routes[index] = {
            ...routes[index],
            share: (routes[index].share ?? 1) * (1 - flow.landShare),
          };
        }
        routes.push({ mode: 'land', share: flow.landShare });
      }
      const seaborne = [];
      const flowGates = {};
      for (const route of routes) {
        const share = route.share ?? 1;
        if (share <= 0) continue;
        const portion = amount * share;
        if (route.mode === 'land') {
          coverage.landFlows++;
          continue;
        }
        if (route.mode !== 'sea') {
          coverage.unknownFlows++;
          totals.unknown += portion;
          combined.unknown += energy * share;
          continue;
        }
        coverage.seaFlows++;
        totals.seaborne += portion;
        combined.seaborne += energy * share;
        seaborne.push({ portion, route });
        if (!inspectedRoutes.has(route.coordinates)) {
          inspectedRoutes.add(route.coordinates);
          routeAudit.assessed++;
          if (crossesArcticShortcut(route.coordinates))
            routeAudit.arcticShortcuts++;
          if (usesKielCanal(route.coordinates)) routeAudit.kiel++;
        }
        for (const gate of route.gates) {
          crossings.set(gate, (crossings.get(gate) ?? 0) + portion);
          flowGates[gate] = (flowGates[gate] ?? 0) + share;
          const mix = combined.crossings.get(gate) ?? {};
          mix[item] = (mix[item] ?? 0) + energy * share;
          combined.crossings.set(gate, mix);
          const estimate = transit.get(gate) ?? { oil: 0, lng: 0 };
          const routedTonnes = amount * share;
          // Calendar 2024 has 366 days. Generic factors approximate EIA units.
          if (item === 'crude oil')
            estimate.oil += (routedTonnes * 7.33) / 366_000_000;
          if (item === 'refined products')
            estimate.oil += (routedTonnes * 7.9) / 366_000_000;
          if (item === 'lng')
            estimate.lng += (routedTonnes * 48_700) / 366_000_000_000;
          transit.set(gate, estimate);
        }
      }
      if (seaborne.length) {
        const dominant = seaborne.reduce((a, b) =>
          a.portion >= b.portion ? a : b,
        );
        routed.push({
          provider,
          amount: seaborne.reduce((sum, entry) => sum + entry.portion, 0),
          route: dominant.route,
          gateShares: flowGates,
          portSplits:
            seaborne.length > 1
              ? seaborne.map(({ route }) => ({
                  share: round(route.share, 6),
                  ports: route.ports,
                  gates: route.gates,
                }))
              : undefined,
          quantityEstimated: flow.quantityEstimated,
          quantityReestimated: flow.quantityReestimated,
          routeOriginAdjustment: flow.routeOriginAdjustment,
        });
      }
    }
    if (item === 'pipeline gas') {
      pipelineGas[dependent] = {
        mode: 'land',
        value: round(totals.all),
        unit: weightUnit,
      };
    }
    if (totals.seaborne <= 0) continue;
    exposure[dependent] ??= [];
    for (const [gate, amount] of crossings) {
      exposure[dependent].push({ gate, item, ...shareRow(amount, totals) });
    }
    for (const {
      provider,
      amount,
      route,
      gateShares,
      portSplits,
      quantityEstimated,
      quantityReestimated,
      routeOriginAdjustment,
    } of routed) {
      if (amount <= 0) continue;
      bilateral.push({
        id: [provider, dependent, item].join('/'),
        provider,
        dependent,
        item,
        route: Object.keys(gateShares),
        gateShares,
        ...(portSplits && { portSplits }),
        ...(route.gates.length !== Object.keys(gateShares).length && {
          pathGates: route.gates,
        }),
        ...(quantityEstimated && { quantityEstimated: true }),
        ...(quantityReestimated && { quantityReestimated: true }),
        ...(routeOriginAdjustment && { routeOriginAdjustment }),
        ...(route.approximate && { approximateRoute: true }),
        path: route.coordinates,
        ports: route.ports,
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
  const routePorts = {};
  const rows = [...included].map(({ path, ports, ...row }) => {
    const pair = row.id;
    paths[pair] ??= thinRoute(path);
    if (ports) routePorts[pair] ??= ports;
    return row;
  });
  coverage.importers = new Set(flows.map(({ dependent }) => dependent)).size;
  coverage.modelledImporters = Object.keys(exposure).length;
  for (const rows of Object.values(exposure))
    rows.sort((a, b) => b.shares.all - a.shares.all);
  const energyExposure = {};
  const energyImports = {};
  for (const [dependent, total] of energyByImporter) {
    energyImports[dependent] = round(total.all);
    if (!total.seaborne) continue;
    energyExposure[dependent] = [...total.crossings]
      .map(([gate, mix]) => {
        const items = Object.entries(mix).sort((a, b) => b[1] - a[1]);
        return {
          gate,
          item: items[0][0],
          ...shareRow(
            items.reduce((sum, [, amount]) => sum + amount, 0),
            total,
          ),
        };
      })
      .sort((a, b) => b.volume.value - a.volume.value);
  }
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
    energyExposure,
    energyImports,
    importTonnes,
    routeAudit,
    minorImporterFloor,
    pipelineGas,
    paths,
    routePorts,
    rows,
  };
}
