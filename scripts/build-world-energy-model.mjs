#!/usr/bin/env node
/** Build the compact 2024 trade model. Raw inputs are stored beside the worktree. */
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { zipEntryChunks } from '../server/providers/world/sources/zip.js';
import { csvRows } from '../server/providers/world/sources/csv.js';
import { readEnergyReference } from '../server/providers/world/dependencies.js';
import {
  decodeRing,
  polygonsContain,
  ringAreaKm2,
} from '../src/data/adminBoundaries.js';
import worldGazetteer from '../public/news/theaters/world.json' with { type: 'json' };
import shapes from '../src/data/local_data/natural_earth/countries.json' with { type: 'json' };
import {
  buildEnergyModel,
  commodity,
  distanceKm,
  originDecayKm,
  maritimeRouter,
} from './world-energy-model.mjs';

const root = new URL('../', import.meta.url);
const { values } = parseArgs({
  options: {
    'verify-ports': { type: 'boolean' },
    cache: {
      type: 'string',
      default: fileURLToPath(new URL('../world-board-downloads/baci', root)),
    },
  },
});
const cacheDirectory = values.cache;

function networkData(text) {
  // The pinned data file wraps a JSON string in a fixed module template. Parse its
  // data without executing code fetched from the network.
  const match = /module\.exports = JSON\.parse\(\s*'(.*)',\s*\);\s*$/s.exec(
    text,
  );
  if (!match) throw new Error('Unrecognized MARNET data wrapper.');
  return JSON.parse(match[1]);
}

export function baciCountryIso(code, iso) {
  return code === '490' ? 'TWN' : iso;
}

export function screenBaciQuantities(rows) {
  const declared = rows.filter(
    ({ tonnes }) => Number.isFinite(tonnes) && tonnes > 0,
  );
  const medians = new Map();
  for (const [code, group] of Map.groupBy(declared, ({ code }) => code)) {
    const samples = group.map(({ value, tonnes }) => ({
      price: value / tonnes,
      tonnes,
    }));
    samples.sort((a, b) => a.price - b.price);
    const half = samples.reduce((sum, { tonnes }) => sum + tonnes, 0) / 2;
    let cumulative = 0;
    for (const { price, tonnes } of samples) {
      cumulative += tonnes;
      if (cumulative < half) continue;
      medians.set(code, price);
      break;
    }
  }

  return rows.map((row) => {
    const median = medians.get(row.code);
    if (!(median > 0))
      throw new Error('No positive BACI median price for HS ' + row.code);
    if (!Number.isFinite(row.tonnes)) {
      return {
        ...row,
        tonnes: row.value / median,
        declaredTonnes: null,
        quantityEstimated: true,
      };
    }
    if (row.tonnes > 0 && row.value / row.tonnes < median / 3) {
      return {
        ...row,
        tonnes: row.value / median,
        declaredTonnes: row.tonnes,
        quantityReestimated: true,
      };
    }
    return row;
  });
}

export function applyBaciOriginOverride(flows, evidence) {
  const imports = flows.filter(
    ({ dependent, item }) => dependent === 'CHN' && item === 'crude oil',
  );
  const malaysia = imports.find(({ provider }) => provider === 'MYS');
  const total = imports.reduce((sum, flow) => sum + flow.tonnes, 0);
  const iran = imports.find(({ provider }) => provider === 'IRN')?.tonnes ?? 0;
  if (!malaysia?.tonnes) return { adjusted: flows, correction: null };
  const reroutedTonnes = Math.min(
    malaysia.tonnes,
    Math.max(0, evidence.share * total - iran),
  );
  if (!reroutedTonnes) return { adjusted: flows, correction: null };
  const routeOriginAdjustment = {
    id: evidence.id,
    origin: 'IRN',
    share: reroutedTonnes / malaysia.tonnes,
    reroutedTonnes,
    screenedTonnes: malaysia.tonnes,
    baciDeclaredTonnes: malaysia.baciDeclaredTonnes,
    sourceUrl: evidence.sourceUrl,
  };
  return {
    adjusted: flows.map((flow) =>
      flow === malaysia ? { ...flow, routeOriginAdjustment } : flow,
    ),
    correction: routeOriginAdjustment,
  };
}

async function baciFlows(archive) {
  const codes = [];
  const countryFile = (name) => /(^|\/)country_codes_V202601\.csv$/i.test(name);
  for await (const chunk of zipEntryChunks(archive, countryFile, 5_000_000))
    codes.push(chunk);
  const rows = csvRows(Buffer.concat(codes).toString('utf8'));
  const header = rows.next().value;
  const idColumn = header.indexOf('country_code');
  const isoColumn = header.indexOf('country_iso3');
  if (idColumn < 0 || isoColumn < 0)
    throw new Error('Unexpected BACI country code header.');
  const iso = new Map(
    [...rows].map((row) => [
      row[idColumn],
      baciCountryIso(row[idColumn], row[isoColumn]),
    ]),
  );

  const flowFile = (name) => /(^|\/)BACI_HS22_Y2024_V202601\.csv$/i.test(name);
  const input = Readable.from(zipEntryChunks(archive, flowFile, 1_500_000_000));
  const lines = createInterface({ input, crlfDelay: Infinity });
  const energyRows = [];
  let first = true;
  for await (const line of lines) {
    if (first) {
      first = false;
      if (line.replace(/^\uFEFF/, '') !== 't,i,j,k,v,q')
        throw new Error(`Unexpected BACI trade header ${line}.`);
      continue;
    }
    if (!line.startsWith('2024,')) continue;
    const [, exporter, importer, code, declaredValue, quantity] =
      line.split(',');
    const item = commodity(code);
    if (!item) continue;
    const dependent = iso.get(importer);
    if (!/^[A-Z]{3}$/.test(dependent ?? '')) continue;
    const provider = iso.get(exporter) || '???';
    if (provider === dependent) continue;
    const value = Number(declaredValue);
    if (!Number.isFinite(value) || value <= 0) continue;
    const tonnes = quantity?.trim() ? Number(quantity) : NaN;
    energyRows.push({ provider, dependent, item, code, value, tonnes });
  }
  const totals = new Map();
  const byCode = {};
  const cargoes = [];
  const cargoIds = new Set([
    'IDN/CHN/270119',
    'MEX/USA/271000',
    'ARE/THA/270900',
  ]);
  for (const row of screenBaciQuantities(energyRows)) {
    const {
      provider,
      dependent,
      item,
      code,
      tonnes,
      declaredTonnes = tonnes,
      quantityEstimated,
      quantityReestimated,
    } = row;
    const stats = (byCode[code] ??= {
      declaredTonnes: 0,
      modelTonnes: 0,
      estimated: 0,
      reestimated: 0,
    });
    stats.declaredTonnes += declaredTonnes ?? 0;
    stats.modelTonnes += tonnes;
    if (quantityEstimated) stats.estimated++;
    if (quantityReestimated) stats.reestimated++;
    if (cargoIds.has([provider, dependent, code].join('/'))) {
      cargoes.push({
        provider,
        dependent,
        code,
        tonnes,
        declaredTonnes,
        quantityReestimated: Boolean(quantityReestimated),
      });
    }
    const key = [provider, dependent, item].join('/');
    const record = totals.get(key) ?? {
      provider,
      dependent,
      item,
      tonnes: 0,
      baciDeclaredTonnes: 0,
    };
    record.baciDeclaredTonnes += declaredTonnes ?? 0;
    if (quantityEstimated) record.quantityEstimated = true;
    if (quantityReestimated) record.quantityReestimated = true;
    record.tonnes += tonnes;
    totals.set(key, record);
  }
  if (!totals.size) throw new Error('No 2024 BACI energy trade found.');
  return { flows: [...totals.values()], quantityAudit: { byCode, cargoes } };
}

const landlocked = new Set(
  'AFG AND ARM AUT AZE BDI BFA BTN BOL BWA CAF TCD CZE ETH HUN KAZ KGZ LAO LSO LIE LUX MDA MKD MLI MNG MWI NER NPL PRY RWA SMR SRB SSD SVK SWZ TJK TKM UGA UZB VAT XKX ZMB ZWE CHE'.split(
    ' ',
  ),
);

const islandBorders = new Set(['BRN/MYS', 'IDN/MYS', 'IDN/PNG', 'IDN/TLS']);
const maritimeBorderTrade = new Set([
  'CHN/RUS/crude oil',
  'MEX/USA/crude oil',
  'IRN/IRQ/crude oil',
  'KWT/SAU/crude oil',
  'ARE/SAU/crude oil',
  'IRQ/KWT/crude oil',
  'IRQ/SAU/crude oil',
]);

const capitals = worldGazetteer.gazetteer.filter(
  ({ precision, prompt }) => precision === 'city' && prompt,
);

function neighboursAndPorts(ports, router) {
  const countries = shapes.features
    .filter(({ iso }) => /^[A-Z]{3}$/.test(iso))
    .map(({ iso, d, polygons }) => {
      const parts = polygons.map((poly) =>
        poly.map((ring) => decodeRing(ring, d ?? shapes.meta.decimals)),
      );
      const largestFirst = parts
        .map((part) => ({ part, area: ringAreaKm2(part[0]) }))
        .sort((a, b) => b.area - a.area);
      const borderPolygons = new Set(
        largestFirst
          .filter(({ area }) => area >= largestFirst[0].area / 3)
          .map(({ part }) => part),
      );
      const mainland =
        [...borderPolygons].find((part) =>
          capitals.some(({ lat, lon }) => polygonsContain([part], lat, lon)),
        ) ?? largestFirst[0].part;
      return { iso, polygons: parts, mainland, borderPolygons };
    });
  const owners = new Map();
  const sharedVertices = new Set();
  const mainlandByCountry = new Map(
    countries.map(({ iso, mainland }) => [iso, mainland]),
  );
  const pair = (a, b) => [a, b].sort().join('/');
  const commonVertices = new Map();
  for (const { iso, polygons, borderPolygons } of countries) {
    for (const polygon of polygons) {
      const [outer] = polygon;
      const eligible = borderPolygons.has(polygon);
      for (const point of outer) {
        const key = point.join(',');
        const countriesAtPoint = owners.get(key) ?? new Map();
        countriesAtPoint.set(
          iso,
          eligible || countriesAtPoint.get(iso) === true,
        );
        owners.set(key, countriesAtPoint);
      }
    }
  }
  for (const [key, countriesAtPoint] of owners) {
    if (countriesAtPoint.size < 2) continue;
    sharedVertices.add(key);
    const atPoint = [...countriesAtPoint]
      .filter(([, eligible]) => eligible)
      .map(([iso]) => iso);
    for (const [index, iso] of atPoint.entries()) {
      for (const other of atPoint.slice(index + 1)) {
        const id = pair(iso, other);
        commonVertices.set(id, (commonVertices.get(id) ?? 0) + 1);
      }
    }
  }
  const fallback = new Map();
  for (const {
    geometry: { coordinates },
    properties: { name },
  } of ports.features) {
    const snapped = router(coordinates, coordinates);
    if (!snapped) continue;
    const [lon, lat] = coordinates;
    let owner;
    let part;
    for (const country of countries) {
      part = country.polygons.find((polygon) =>
        polygonsContain([polygon], lat, lon),
      );
      if (!part) continue;
      owner = country;
      break;
    }
    if (!owner) {
      // Packed boundaries simplify the coast by up to 0.02 degrees. Allow
      // nearby port anchors at docks, while rejecting distant offshore points.
      let nearest = 3;
      const lonScale = Math.cos((lat * Math.PI) / 180);
      for (const country of countries) {
        if (landlocked.has(country.iso)) continue;
        for (const polygon of country.polygons) {
          const [outer] = polygon;
          for (let i = 0; i < outer.length; i++) {
            const [ax, ay] = outer[i];
            const [bx, by] = outer.at(i - 1);
            if (
              lat < Math.min(ay, by) - 0.03 ||
              lat > Math.max(ay, by) + 0.03 ||
              lon < Math.min(ax, bx) - 0.03 / lonScale ||
              lon > Math.max(ax, bx) + 0.03 / lonScale
            )
              continue;
            const dx = (bx - ax) * lonScale;
            const dy = by - ay;
            const length = dx ** 2 + dy ** 2;
            const fraction = length
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    ((lon - ax) * lonScale * dx + (lat - ay) * dy) / length,
                  ),
                )
              : 0;
            const point = [ax + fraction * (bx - ax), ay + fraction * dy];
            const distance = distanceKm(point, coordinates);
            if (distance >= nearest) continue;
            nearest = distance;
            owner = country;
            part = polygon;
          }
        }
      }
    }
    if (!owner || part !== owner.mainland) continue;
    const { iso } = owner;
    const distance = distanceKm(coordinates, snapped.coordinates[0]);
    if (distance >= (fallback.get(iso)?.distance ?? Infinity)) continue;
    fallback.set(iso, {
      name,
      coordinates,
      distance,
      approximate: true,
      share: 1,
    });
  }
  const networkFallbacks = new Map();
  return {
    port(iso, direction) {
      if (landlocked.has(iso)) return undefined;
      const named = fallback.get(iso);
      if (named || direction !== 'import') return named;
      if (!networkFallbacks.has(iso)) {
        const coast = mainlandByCountry
          .get(iso)?.[0]
          .filter((point) => !sharedVertices.has(point.join(',')));
        const coordinates = coast && router.nearestNetworkPort(coast);
        networkFallbacks.set(
          iso,
          coordinates
            ? {
                name: `Approximate network port (${iso})`,
                coordinates,
                approximate: true,
                share: 1,
              }
            : undefined,
        );
      }
      return networkFallbacks.get(iso);
    },
    adjacent: (a, b, item) => {
      const id = pair(a, b);
      return (
        !islandBorders.has(id) &&
        !maritimeBorderTrade.has(id + '/' + item) &&
        (commonVertices.get(id) ?? 0) >= 2
      );
    },
  };
}

const portTablePath = new URL('public/world/curated/energy-ports.json', root);

export function routesFor(network, ports, rows = []) {
  const router = maritimeRouter(network);
  const { port, adjacent } = neighboursAndPorts(ports, router);
  const endpoints = new Map();
  for (const row of rows) {
    const {
      iso,
      direction,
      product,
      port: name,
      coordinates,
      share,
      shareBasis,
    } = row;
    const snapped = router(coordinates, coordinates);
    if (!snapped)
      throw new Error(`Energy port cannot resolve: ${iso}/${product}/${name}`);
    const key = [iso, direction, product].join('/');
    const group = endpoints.get(key) ?? [];
    group.push({
      name,
      coordinates,
      share,
      shareBasis,
      approximate: share == null,
    });
    endpoints.set(key, group);
  }
  function terminalOptions(iso, direction, item) {
    const group = endpoints.get([iso, direction, item].join('/'));
    if (!group) {
      const fallback = port(iso, direction);
      return fallback ? [fallback] : [];
    }
    if (group.some(({ share }) => share !== null)) {
      const options = group.filter(({ share }) => share > 0);
      const total = options.reduce((sum, { share }) => sum + share, 0);
      if (total > 1.000001)
        throw new Error(`Energy port shares exceed 100% for ${iso}/${item}`);
      if (total < 1 - Number.EPSILON)
        options.push({ share: Number((1 - total).toFixed(15)) });
      return total > 1
        ? options.map((option) => ({ ...option, share: option.share / total }))
        : options;
    }
    return [{ ...group[0], share: 1 }];
  }
  function mode(from, to, item) {
    // CPC and BTC cross a foreign land leg before maritime loading. Direct
    // Kazakh land routes to China and Russia retain their continental mode.
    const maritimeOrigin =
      item === 'crude oil' &&
      ((from === 'KAZ' && to !== 'RUS' && to !== 'CHN') ||
        (from === 'AZE' && to !== 'RUS' && to !== 'IRN'));
    const maritimeDestination = item === 'crude oil' && to === 'AUT';
    const kazakhPipeline =
      from === 'KAZ' && (to === 'RUS' || to === 'CHN') && item === 'crude oil';
    if (
      kazakhPipeline ||
      (item !== 'lng' &&
        adjacent(from, to, item) &&
        (!maritimeOrigin || landlocked.has(to)) &&
        !maritimeDestination)
    )
      return 'land';
    if (
      (!maritimeDestination && landlocked.has(to)) ||
      (!maritimeOrigin && landlocked.has(from))
    )
      return 'unknown';
    return 'sea';
  }

  function connection(origin, destination) {
    const route =
      origin.coordinates &&
      destination.coordinates &&
      router(origin.coordinates, destination.coordinates);
    if (!route) return { mode: 'unknown' };
    return {
      ...route,
      ports: [origin.name, destination.name],
      approximate: origin.approximate || destination.approximate,
    };
  }

  const cache = new Map();
  function routeFor(from, to, item) {
    const key = [from, to, item].join('/');
    if (!cache.has(key)) {
      const routeMode = mode(from, to, item);
      if (routeMode !== 'sea') {
        cache.set(key, { mode: routeMode });
      } else {
        const origins = terminalOptions(from, 'export', item);
        const destinations = terminalOptions(to, 'import', item);
        const routes = destinations.flatMap((destination) =>
          origins.map((origin) => ({
            ...connection(origin, destination),
            share: origin.share * destination.share,
          })),
        );
        cache.set(key, routes.length ? routes : { mode: 'unknown' });
      }
    }
    return cache.get(key);
  }

  routeFor.fit = (flows) => {
    const traffic = new Map();
    for (const {
      provider,
      dependent,
      item,
      tonnes,
      landShare = 0,
      routeOriginAdjustment,
    } of flows) {
      for (const [from, share] of [
        [provider, 1 - (routeOriginAdjustment?.share ?? 0)],
        [routeOriginAdjustment?.origin, routeOriginAdjustment?.share ?? 0],
      ]) {
        if (!share || !tonnes || item === 'pipeline gas') continue;
        const source = endpoints.get([from, 'export', item].join('/'));
        if (!source?.some(({ share }) => share > 0)) continue;
        const key = [from, item].join('/');
        const group = traffic.get(key) ?? {
          from,
          item,
          land: 0,
          demands: new Map(),
        };
        const volume = tonnes * share;
        const land =
          mode(from, dependent, item) === 'land' ? volume : volume * landShare;
        group.land += land;
        if (volume > land)
          group.demands.set(
            dependent,
            (group.demands.get(dependent) ?? 0) + volume - land,
          );
        traffic.set(key, group);
      }
    }
    const fitted = new Map();
    const audit = [];
    for (const { from, item, land, demands } of traffic.values()) {
      const origins = terminalOptions(from, 'export', item);
      const source = endpoints.get([from, 'export', item].join('/'));
      const allExports = source.some(
        ({ shareBasis }) => shareBasis === 'all exports',
      );
      const columns = [];
      let unresolved = 0;
      for (const [to, tonnes] of demands) {
        const options =
          mode(from, to, item) === 'sea'
            ? terminalOptions(to, 'import', item)
            : [];
        const routesForDestination = [];
        fitted.set([from, to, item].join('/'), routesForDestination);
        for (const destination of options.length ? options : [{ share: 1 }]) {
          const routes = origins.map((origin) =>
            connection(origin, destination),
          );
          if (routes.some(({ mode }) => mode === 'sea')) {
            columns.push({ to, tonnes: tonnes * destination.share, routes });
          } else {
            unresolved += tonnes * destination.share;
            routesForDestination.push({
              mode: 'unknown',
              share: destination.share,
            });
          }
        }
      }
      const remaining = columns.reduce((sum, { tonnes }) => sum + tonnes, 0);
      const outsideSea = allExports ? land + unresolved : 0;
      const total = remaining + outsideSea;
      const targets = origins.map(
        ({ share, name }) => share * total - (!name ? outsideSea : 0),
      );
      if (targets.some((target) => target < 0))
        throw new Error(
          `Unroutable or land exports exceed the unallocated national share for ${from}/${item}`,
        );

      fitPortShares(columns, origins, targets);
      const allocated = origins.map(() => 0);
      for (const { to, routes, allocation } of columns) {
        const options = fitted.get([from, to, item].join('/'));
        for (const [index, route] of routes.entries()) {
          const tonnes = allocation[index];
          allocated[index] += tonnes;
          if (tonnes > 0)
            options.push({ ...route, share: tonnes / demands.get(to) });
        }
      }
      for (const [index, { name, share }] of origins.entries()) {
        if (!name) continue;
        audit.push({
          provider: from,
          item,
          port: name,
          share,
          basisTonnes: total,
          targetTonnes: targets[index],
          allocatedTonnes: allocated[index],
        });
      }
      for (const { name, share } of source) {
        if (share === 0)
          audit.push({
            provider: from,
            item,
            port: name,
            share,
            basisTonnes: total,
            targetTonnes: 0,
            allocatedTonnes: 0,
          });
      }
    }
    return {
      routeFor: (from, to, item) =>
        fitted.get([from, to, item].join('/')) ?? routeFor(from, to, item),
      audit,
    };
  };
  routeFor.adjacent = adjacent;
  return routeFor;
}

function fitPortShares(columns, origins, targets) {
  for (const column of columns) {
    const distances = column.routes.map(({ distance }) => distance ?? Infinity);
    const shortest = Math.min(...distances);
    column.allocation = targets.map((target, index) => {
      if (target === 0) return 0;
      if (!origins[index].name) return 1;
      if (!Number.isFinite(distances[index])) return 0;
      return Math.exp(-(distances[index] - shortest) / originDecayKm);
    });
  }
  const sums = () =>
    targets.map((_, index) =>
      columns.reduce((sum, { allocation }) => sum + allocation[index], 0),
    );
  let totals = sums();
  for (let iteration = 0; iteration < 10_000; iteration++) {
    const scales = totals.map((total, index) =>
      total ? targets[index] / total : 0,
    );
    for (const { allocation, tonnes } of columns) {
      for (const [index, scale] of scales.entries()) allocation[index] *= scale;
      const scale =
        tonnes / allocation.reduce((sum, amount) => sum + amount, 0);
      for (const index of allocation.keys()) allocation[index] *= scale;
    }
    totals = sums();
    if (
      totals.every(
        (total, index) =>
          Math.abs(total - targets[index]) <= targets[index] * 1e-8,
      )
    )
      return;
  }
  throw new Error('Energy port fitting did not converge');
}

if (import.meta.main) {
  // This rebuild intentionally uses the pinned inputs already in the local
  // cache. It makes no request to CEPII or to the maritime data hosts.
  const cachePath = (name) => path.join(cacheDirectory, name);
  const archive = cachePath(
    '854c477353db2fd8e3e51e3a9ffba5e5ea765ce4bae09516c6329a7d83733daf',
  );
  const network = networkData(await readFile(cachePath('marnet.cjs'), 'utf8'));
  const ports = JSON.parse(
    await readFile(cachePath('ne-ports.geojson'), 'utf8'),
  );
  const portTable = JSON.parse(await readFile(portTablePath, 'utf8'));
  // The intermediate points approximate the coastal approach, avoiding
  // a straight segment across land or between separate basins.
  for (const coordinates of [
    [
      [38.03, 23.93],
      [37.6, 23.75],
      [36.9, 24.9],
      [36.245, 25.885],
    ],
    [
      [72.54, 21.69],
      [72.23, 21.47],
      [72.1, 21.11],
      [71.95, 20.7],
      [72.4, 19],
    ],
  ]) {
    network.features.push({
      geometry: { type: 'LineString', coordinates },
      properties: {},
    });
  }
  const routeFor = routesFor(network, ports, portTable.rows);
  console.log(
    `Resolved all ${portTable.rows.length} curated energy port anchors.`,
  );
  if (values['verify-ports']) process.exit(0);
  const started = performance.now();
  const { flows, quantityAudit } = await baciFlows(archive);
  console.log(
    'BACI energy country-pair product rows',
    flows.length,
    Math.round(performance.now() - started),
    'ms',
  );
  const landTransfers = new Map(
    portTable.landTransfers.map((row) => [
      [row.provider, row.dependent, row.product].join('/'),
      row.tonnes,
    ]),
  );
  for (const flow of flows) {
    const observed = landTransfers.get(
      [flow.provider, flow.dependent, flow.item].join('/'),
    );
    if (observed > 0 && flow.tonnes > 0) {
      flow.landShare = Math.min(1, observed / flow.tonnes);
    }
  }
  const originEvidence = portTable.sourceOverrides[0];
  const { adjusted, correction } = applyBaciOriginOverride(
    flows,
    originEvidence,
  );
  const references = (await readEnergyReference()).rows;
  const allocation = routeFor.fit(adjusted);
  const model = buildEnergyModel(adjusted, {
    routeFor: allocation.routeFor,
    references,
  });
  const borderPairs = [
    'MYS/THA',
    'ARE/OMN',
    'ARE/SAU',
    'DEU/DNK',
    'CMR/GNQ',
    'GAB/GNQ',
    'FRA/BRA',
    'GBR/IRL',
    'RUS/LTU',
    'AGO/COG',
  ];
  const borderAudit = Object.fromEntries(
    borderPairs.map((pair) => [
      pair,
      routeFor.adjacent(...pair.split('/'), 'refined products'),
    ]),
  );
  const uaeSaudi = adjusted.find(
    ({ provider, dependent, item }) =>
      provider === 'ARE' && dependent === 'SAU' && item === 'refined products',
  );
  model.allocationAudit = {
    ports: allocation.audit,
    borders: borderAudit,
    uaeSaudiRefinedProducts: uaeSaudi && {
      tonnes: uaeSaudi.tonnes,
      route: allocation.routeFor('ARE', 'SAU', 'refined products'),
    },
  };
  if (correction) {
    const baseline = routeFor.fit(flows);
    const { calibration } = buildEnergyModel(flows, {
      routeFor: baseline.routeFor,
      references,
    });
    model.sourceOverride = {
      ...correction,
      note: originEvidence.note,
    };
    model.calibrationWithoutOriginCorrection = calibration;
  }
  for (const row of model.calibration) {
    if (row.routeId === 'malacca' && row.commodity === 'lng') {
      row.dataNote = {
        text: 'US LNG to Asia is routed via Panama in this model. In 2024 much of it went round the Cape of Good Hope and through Malacca.',
        sourceUrl:
          'https://www.shell.com/what-we-do/oil-and-natural-gas/liquefied-natural-gas-lng/lng-outlook-2025/_jcr_content/root/main/section_125126292_co/promo_copy_copy_copy/links/item0.stream/1740577530786/97f8aacf1e8b27cd8dd32f6070d6463f60cff411/lng-outlook-2025-full-report.pdf#page=14',
      };
    }
    if (row.commodity !== 'oil') continue;
    if (correction && ['hormuz', 'malacca'].includes(row.routeId)) {
      row.dataNote = {
        text: originEvidence.label,
        sourceUrl: correction.sourceUrl,
      };
    }
    if (row.routeId === 'dardanelles') {
      const crudeMt = model.importTonnes.TUR['crude oil'] / 1e6;
      row.dataNote = {
        text: `BACI holds about ${crudeMt.toFixed(1)} Mt of Türkiye’s crude imports; Türkiye reports about 30 Mt`,
        sourceUrl:
          'https://www.mapeg.gov.tr/Uploads/Dosyalar/MAPEG2024YiliIdareFaaliyetRaporu27.02.2025.pdf',
      };
    }
  }
  model.portTableReviewed = [
    ...portTable.rows,
    ...portTable.coverageExceptions,
    ...portTable.sourceOverrides,
    ...portTable.landTransfers,
  ].every(({ reviewed }) => reviewed);
  model.quantityAudit = quantityAudit;
  for (const [field, stat] of [
    ['quantitiesEstimated', 'estimated'],
    ['quantitiesReestimated', 'reestimated'],
  ]) {
    model.coverage[field] = Object.values(quantityAudit.byCode).reduce(
      (sum, code) => sum + code[stat],
      0,
    );
  }
  console.log('BACI HS6 quantity audit', JSON.stringify(quantityAudit));
  const json = JSON.stringify(model);
  await writeFile(
    new URL('public/world/curated/energy-dependencies.json', root),
    json + '\n',
  );
  console.log(
    'Model bytes',
    Buffer.byteLength(json),
    'coverage',
    model.coverage,
  );
  console.table(model.calibration);
}
