#!/usr/bin/env node
/** Build the compact 2024 trade model. Raw inputs are stored beside the worktree. */
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { downloadWorldFile } from '../server/providers/world/sources/download.js';
import { createWorldFetch } from '../server/providers/world/sources/transport.js';
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
const baci =
  'https://www.cepii.fr/DATA_DOWNLOAD/baci/data/BACI_HS22_V202601.zip';
const networkUrl =
  'https://raw.githubusercontent.com/mayurrawte/searoute-ts/a6666c6de53795a2b81915678291d968cbd21112/data/marnet.cjs';
const portsUrl =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/ne_10m_ports.geojson';
const maximumArchiveBytes = 2_000_000_000;
const { values } = parseArgs({
  options: {
    cache: {
      type: 'string',
      default: fileURLToPath(new URL('../world-board-downloads/baci', root)),
    },
  },
});
const fetchImpl = createWorldFetch();
const cacheDirectory = values.cache;

function sizeFrom(response) {
  const header = response.headers.get('Content-Length');
  if (!response.ok || !/^\d+$/.test(header ?? ''))
    throw new Error('BACI archive size could not be verified.');
  const size = Number(header);
  if (size > maximumArchiveBytes)
    throw new Error(
      `BACI archive is ${size} bytes; stopping above the 2 GB limit.`,
    );
  return size;
}

async function acquire(url, maxBytes, expectedBytes) {
  let checkpoint = 0;
  const started = performance.now();
  const result = await downloadWorldFile(url, {
    cacheDirectory,
    fetchImpl,
    maxBytes,
    immutable: true,
    overallTimeoutMs: 90 * 60_000,
    onProgress({ bytes, totalBytes }) {
      if (bytes - checkpoint < 10_000_000 && bytes !== totalBytes) return;
      checkpoint = bytes;
      console.log(url.split('/').at(-1), bytes, '/', totalBytes ?? '?');
    },
  });
  if (expectedBytes !== undefined && result.bytes !== expectedBytes) {
    throw new Error(
      `BACI archive has ${result.bytes} bytes; CEPII reports ${expectedBytes}.`,
    );
  }
  console.log(
    url,
    result.bytes,
    'bytes',
    result.reused ? 'cached' : 'downloaded',
    Math.round(performance.now() - started),
    'ms',
  );
  return result.path;
}

function networkData(text) {
  // The pinned data file wraps a JSON string in a fixed module template. Parse its
  // data without executing code fetched from the network.
  const match = /module\.exports = JSON\.parse\(\s*'(.*)',\s*\);\s*$/s.exec(
    text,
  );
  if (!match) throw new Error('Unrecognized MARNET data wrapper.');
  return JSON.parse(match[1]);
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
  const iso = new Map([...rows].map((row) => [row[idColumn], row[isoColumn]]));

  const flowFile = (name) => /(^|\/)BACI_HS22_Y2024_V202601\.csv$/i.test(name);
  const input = Readable.from(zipEntryChunks(archive, flowFile, 1_500_000_000));
  const lines = createInterface({ input, crlfDelay: Infinity });
  const totals = new Map();
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
    const key = [provider, dependent, item].join('/');
    const record = totals.get(key) ?? {
      provider,
      dependent,
      item,
      tonnes: 0,
      reportedTonnes: 0,
      value: 0,
    };
    record.value += value;
    const reported = Number.isFinite(tonnes) && tonnes >= 0;
    if (reported) record.reportedTonnes += tonnes;
    record.tonnes =
      record.tonnes !== null && reported ? record.tonnes + tonnes : null;
    totals.set(key, record);
  }
  if (!totals.size) throw new Error('No 2024 BACI energy trade found.');
  return [...totals.values()];
}

const landlocked = new Set(
  'AFG AND ARM AUT AZE BDI BFA BTN BOL BWA CAF TCD CZE ETH HUN KAZ KGZ LAO LSO LIE LUX MDA MKD MLI MNG MWI NER NPL PRY RWA SMR SRB SSD SVK SWZ TJK TKM UGA UZB VAT XKX ZMB ZWE CHE'.split(
    ' ',
  ),
);

// Model choices, not port statistics. Use Natural Earth port names to specify
// coasts when the generic port rank is a poor proxy for major energy trade.
const representative = {
  AUS: 'Newcastle',
  BHR: 'Bahrain',
  CHN: 'Ningbo',
  IND: 'Bombay',
  IRN: 'Bandar-e Bushehr',
  IRQ: 'Umm Qasr',
  JPN: 'Yokohama',
  KOR: 'Ulsan',
  KWT: 'Kuwait',
  NLD: 'Rotterdam',
  QAT: 'Doha',
  RUS: 'Novorossiysk',
  SAU: 'Jubail',
  SGP: 'Singapore',
  USA: 'Houston',
  ZAF: 'Richards Bay',
};
const regional = [
  ['ARE', 'Persian Gulf', [54.55, 24.37]],
  ['RUS', 'Nakhodka', [132.9, 42.8]],
  ['IRQ', 'Al Basrah Oil Terminal', [48.79, 29.68]],
];

function neighboursAndPorts(ports) {
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
    for (const [outer] of polygons) {
      for (const point of outer) {
        const key = point.join(',');
        const other = owners.get(key);
        if (other && other !== iso) {
          const id = pair(iso, other);
          commonVertices.set(id, (commonVertices.get(id) ?? 0) + 1);
        } else owners.set(key, iso);
      }
    }
  }
  const ranks = new Map();
  for (const {
    geometry: { coordinates },
    properties: { name, scalerank },
  } of ports.features) {
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
    const isOverride = name === representative[iso];
    const rank = isOverride ? -1 : scalerank;
    const current = ranks.get(iso);
    if (current && current.rank <= rank) continue;
    ranks.set(iso, { name, coordinates, rank });
  }
  for (const [iso, name, coordinates] of regional) {
    if (iso !== 'RUS') ranks.set(iso, { name, coordinates, rank: -1 });
  }
  return {
    port: (iso) => ranks.get(iso),
    adjacent: (a, b) => (commonVertices.get(pair(a, b)) ?? 0) >= 2,
  };
}

export function routesFor(network, ports) {
  const router = maritimeRouter(network);
  const { port, adjacent } = neighboursAndPorts(ports);
  const cache = new Map();
  const [, pacificPort, pacificCoordinates] = regional[1];
  const pacific = new Set(['CHN', 'JPN', 'KOR', 'TWN', 'PHL']);
  return (from, to, item) => {
    if (
      landlocked.has(from) ||
      landlocked.has(to) ||
      (item !== 'lng' && adjacent(from, to))
    )
      return { mode: 'land' };
    const key = from + '/' + to;
    if (!cache.has(key)) {
      const origin =
        from === 'RUS' && pacific.has(to)
          ? { name: pacificPort, coordinates: pacificCoordinates }
          : port(from);
      const destination = port(to);
      const route =
        origin && destination
          ? router(origin.coordinates, destination.coordinates)
          : null;
      cache.set(
        key,
        route
          ? { ...route, ports: [origin.name, destination.name] }
          : { mode: 'unknown' },
      );
    }
    return cache.get(key);
  };
}

if (import.meta.main) {
  const size = sizeFrom(
    await fetchImpl(baci, {
      method: 'HEAD',
      signal: AbortSignal.timeout(45_000),
    }),
  );
  console.log('Official BACI archive bytes', size);
  const archive = await acquire(baci, maximumArchiveBytes, size);
  const network = networkData(
    await readFile(await acquire(networkUrl, 3_000_000), 'utf8'),
  );
  const ports = JSON.parse(
    await readFile(await acquire(portsUrl, 1_000_000), 'utf8'),
  );
  const started = performance.now();
  const flows = await baciFlows(archive);
  console.log(
    'BACI energy country-pair product rows',
    flows.length,
    Math.round(performance.now() - started),
    'ms',
  );
  const model = buildEnergyModel(flows, {
    routeFor: routesFor(network, ports),
    references: (await readEnergyReference()).rows,
  });
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
