import { readFile } from 'node:fs/promises';
import {
  registerWorldFeatureView,
  registerWorldSources,
} from './refreshRegistry.js';
import * as fred from './sources/fred.js';
import { portwatch } from './sources/portwatch.js';

const referencePath = new URL(
  '../../../public/world/curated/eia-chokepoints.json',
  import.meta.url,
);

const dependencyPath = new URL(
  '../../../public/world/curated/energy-dependencies.json',
  import.meta.url,
);

export async function readEnergyDependencies() {
  return JSON.parse(await readFile(dependencyPath, 'utf8'));
}

export async function readEnergyReference() {
  return JSON.parse(await readFile(referencePath, 'utf8'));
}

export function dependencyShares({ crossing, seaborne, total }) {
  const ratio = (denominator) =>
    Number.isFinite(crossing) &&
    Number.isFinite(denominator) &&
    crossing >= 0 &&
    denominator > 0 &&
    crossing <= denominator
      ? crossing / denominator
      : null;
  return { seaborne: ratio(seaborne), all: ratio(total) };
}

const eia = {
  shouldCheck: ({ data }) => !data,
  async fetchObservations() {
    const data = await readEnergyReference();
    return {
      data,
      count: data.rows.length,
      unit: 'published transit estimate',
    };
  },
};

const dependencies = {
  version: 6,
  shouldCheck: ({ data, rederive }) =>
    rederive || data?.mode !== 'modelled' || !data.energyExposure,
  async fetchObservations() {
    const data = await readEnergyDependencies();
    return {
      data,
      count: data.rows.length,
      unit: 'modelled dependency',
      detail: `${data.coverage.modelledImporters} importers with a modelled sea route.`,
    };
  },
};

registerWorldSources({
  'eia-chokepoints': eia,
  'energy-dependencies': dependencies,
  portwatch,
  fred,
});

const featureId = 'energy-dependencies';

function selectedRoutes(model, rows) {
  const paths = {};
  const routePorts = {};
  for (const row of rows) {
    const key = row.id ?? `${row.provider}/${row.dependent}`;
    const path = model.paths?.[key];
    const ports = model.routePorts?.[key];
    if (path) paths[key] = path;
    if (ports) routePorts[key] = ports;
  }
  return { rows, paths, routePorts };
}

export function compactEnergyModel(model) {
  if (model?.mode !== 'modelled') return model;
  if (!model.energyExposure) {
    return {
      mode: 'pending',
      period: model.period,
      label: 'Refresh to rebuild energy exposure',
      rebuildRequired: true,
    };
  }
  const {
    exposure,
    importTonnes,
    paths,
    routePorts,
    rows,
    pipelineGas,
    quantityAudit,
    allocationAudit,
    ...summary
  } = model;
  const routeHighlights = rows
    .filter(
      ({ route, volume }) => route.length && volume.unit === 'tonnes/year',
    )
    .sort((a, b) => b.volume.value - a.volume.value)
    .slice(0, 4);
  return { ...summary, ...selectedRoutes(model, routeHighlights) };
}

export function energyDetail(model, country) {
  if (!model) return null;
  if (model.mode === 'modelled' && !model.energyExposure)
    return { rebuildRequired: true };
  if (!country)
    return {
      calibration: model.calibration,
      routeAudit: model.routeAudit,
      quantityAudit: model.quantityAudit,
      allocationAudit: model.allocationAudit,
    };
  return {
    ...selectedRoutes(
      model,
      (model.rows ?? []).filter(
        ({ provider, dependent }) =>
          provider === country || dependent === country,
      ),
    ),
    exposure: model.exposure?.[country] ?? [],
    importTonnes: model.importTonnes?.[country] ?? {},
    pipelineGas: model.pipelineGas?.[country],
  };
}

registerWorldFeatureView('energy', {
  summary: { [featureId]: compactEnergyModel },
  detail: ({ features, country }) => energyDetail(features[featureId], country),
});
