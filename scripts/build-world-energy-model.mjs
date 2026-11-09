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
import { decodeRing, polygonsContain } from '../src/data/adminBoundaries.js';
import shapes from '../src/data/local_data/natural_earth/countries.json' with { type: 'json' };
import {
  buildEnergyModel,
  commodity,
  distanceKm,
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
  const prices = new Map();
  for (const { code, value, tonnes } of rows) {
    if (!Number.isFinite(tonnes) || tonnes <= 0) continue;
    const samples = prices.get(code) ?? [];
    samples.push(value / tonnes);
    prices.set(code, samples);
  }
  const medians = new Map(
    [...prices].map(([code, samples]) => {
      samples.sort((a, b) => a - b);
      const middle = Math.floor(samples.length / 2);
      return [
        code,
        (samples[middle] + samples[Math.floor((samples.length - 1) / 2)]) / 2,
      ];
    }),
  );
  return rows.map((row) => {
    const median = medians.get(row.code);
    const price = row.value / row.tonnes;
    if (median > 0 && (price < median / 3 || price > median * 3)) {
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
  const total = imports.reduce((sum, flow) => sum + flow.reportedTonnes, 0);
  const iran =
    imports.find(({ provider }) => provider === 'IRN')?.reportedTonnes ?? 0;
  if (!malaysia?.reportedTonnes) return { adjusted: flows, correction: null };
  const reroutedTonnes = Math.min(
    malaysia.reportedTonnes,
    Math.max(0, evidence.share * total - iran),
  );
  if (!reroutedTonnes) return { adjusted: flows, correction: null };
  const routeOriginAdjustment = {
    id: evidence.id,
    origin: 'IRN',
    share: reroutedTonnes / malaysia.reportedTonnes,
    reroutedTonnes,
    screenedTonnes: malaysia.reportedTonnes,
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
  let quantitiesReestimated = 0;
  for (const row of screenBaciQuantities(energyRows)) {
    const { provider, dependent, item, value, tonnes, quantityReestimated } =
      row;
    if (quantityReestimated) quantitiesReestimated++;
    const key = [provider, dependent, item].join('/');
    const record = totals.get(key) ?? {
      provider,
      dependent,
      item,
      tonnes: 0,
      reportedTonnes: 0,
      baciDeclaredTonnes: 0,
      value: 0,
    };
    record.value += value;
    const declaredTonnes = quantityReestimated ? row.declaredTonnes : tonnes;
    if (Number.isFinite(declaredTonnes) && declaredTonnes >= 0)
      record.baciDeclaredTonnes += declaredTonnes;
    if (quantityReestimated) record.quantityReestimated = true;
    const reported = Number.isFinite(tonnes) && tonnes >= 0;
    if (reported) record.reportedTonnes += tonnes;
    record.tonnes =
      record.tonnes !== null && reported ? record.tonnes + tonnes : null;
    totals.set(key, record);
  }
  if (!totals.size) throw new Error('No 2024 BACI energy trade found.');
  return { flows: [...totals.values()], quantitiesReestimated };
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

function ringArea(ring) {
  return Math.abs(
    ring.reduce((area, [x, y], i) => {
      const [lastX, lastY] = ring.at(i - 1);
      return area + lastX * y - x * lastY;
    }, 0),
  );
}

function neighboursAndPorts(ports, router) {
  const countries = shapes.features
    .filter(({ iso }) => /^[A-Z]{3}$/.test(iso))
    .map(({ iso, d, polygons }) => ({
      iso,
      polygons: polygons.map((poly) =>
        poly.map((ring) => decodeRing(ring, d ?? shapes.meta.decimals)),
      ),
    }));
  const owners = new Map();
  const pair = (a, b) => [a, b].sort().join('/');
  const commonVertices = new Map();
  for (const { iso, polygons } of countries) {
    const [mainland] = [...polygons].sort(
      (a, b) => ringArea(b[0]) - ringArea(a[0]),
    );
    if (!mainland) continue;
    for (const point of mainland[0]) {
      const key = point.join(',');
      const other = owners.get(key);
      if (other && other !== iso) {
        const id = pair(iso, other);
        commonVertices.set(id, (commonVertices.get(id) ?? 0) + 1);
      } else owners.set(key, iso);
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
    let iso = countries.find(({ polygons }) =>
      polygonsContain(polygons, lat, lon),
    )?.iso;
    if (!iso) {
      let nearest = 45;
      for (const country of countries) {
        if (landlocked.has(country.iso)) continue;
        for (const [outer] of country.polygons) {
          for (const point of outer) {
            if (
              Math.abs(point[1] - lat) > 0.45 ||
              Math.abs(point[0] - lon) > 2.3
            )
              continue;
            const distance = distanceKm(point, coordinates);
            if (distance >= nearest) continue;
            nearest = distance;
            iso = country.iso;
          }
        }
      }
    }
    if (!iso) continue;
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
  return {
    port: (iso) => fallback.get(iso),
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
    const { iso, direction, product, port: name, coordinates, share } = row;
    const snapped = router(coordinates, coordinates);
    if (!snapped)
      throw new Error(`Energy port cannot resolve: ${iso}/${product}/${name}`);
    const key = [iso, direction, product].join('/');
    const group = endpoints.get(key) ?? [];
    group.push({ name, coordinates, share, approximate: share == null });
    endpoints.set(key, group);
  }
  function terminalOptions(iso, direction, item) {
    const group = endpoints.get([iso, direction, item].join('/'));
    if (!group) return port(iso) ? [port(iso)] : [];
    if (group.some(({ share }) => share !== null)) {
      const options = group.filter(({ share }) => share > 0);
      const total = options.reduce((sum, { share }) => sum + share, 0);
      if (total > 1.000001)
        throw new Error(`Energy port shares exceed 100% for ${iso}/${item}`);
      if (total < 0.999999)
        options.push({ share: Number((1 - total).toFixed(6)) });
      return options;
    }
    return [{ ...group[0], share: 1 }];
  }
  const cache = new Map();
  return (from, to, item) => {
    // CPC and BTC cross a foreign land leg before maritime loading. Direct
    // Kazakh land routes to China and Russia retain their continental mode.
    const maritimeOrigin =
      item === 'crude oil' &&
      ((from === 'KAZ' && to !== 'RUS' && to !== 'CHN') ||
        (from === 'AZE' && to !== 'RUS' && to !== 'IRN'));
    const maritimeDestination = item === 'crude oil' && to === 'AUT';
    if (
      (!maritimeDestination && landlocked.has(to)) ||
      (!maritimeOrigin && landlocked.has(from)) ||
      (item !== 'lng' &&
        !maritimeOrigin &&
        !maritimeDestination &&
        adjacent(from, to, item))
    ) {
      return { mode: 'land' };
    }
    const key = [from, to, item].join('/');
    if (!cache.has(key)) {
      const origins = terminalOptions(from, 'export', item);
      const destinations = terminalOptions(to, 'import', item);
      const routes = origins.flatMap((origin) =>
        destinations.map((destination) => {
          const share = origin.share * destination.share;
          const route =
            origin.coordinates && destination.coordinates
              ? router(origin.coordinates, destination.coordinates)
              : null;
          return route
            ? {
                ...route,
                share,
                ports: [origin.name, destination.name],
                approximate: origin.approximate || destination.approximate,
              }
            : { mode: 'unknown', share };
        }),
      );
      cache.set(key, routes.length ? routes : { mode: 'unknown' });
    }
    return cache.get(key);
  };
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
  const { flows, quantitiesReestimated } = await baciFlows(archive);
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
    if (observed > 0 && flow.reportedTonnes > 0) {
      flow.landShare = Math.min(1, observed / flow.reportedTonnes);
    }
  }
  const { adjusted, correction } = applyBaciOriginOverride(
    flows,
    portTable.sourceOverrides[0],
  );
  const references = (await readEnergyReference()).rows;
  const model = buildEnergyModel(adjusted, { routeFor, references });
  if (correction) {
    const { calibration } = buildEnergyModel(flows, { routeFor, references });
    model.sourceOverride = {
      ...correction,
      note: portTable.sourceOverrides[0].note,
    };
    model.calibrationWithoutOriginCorrection = calibration;
  }
  model.portTableReviewed = [
    ...portTable.rows,
    ...portTable.coverageExceptions,
    ...portTable.sourceOverrides,
    ...portTable.landTransfers,
  ].every(({ reviewed }) => reviewed);
  model.coverage.quantitiesReestimated = quantitiesReestimated;
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
