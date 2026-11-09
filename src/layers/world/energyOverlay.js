import * as Cesium from 'cesium';
import { dependencyRows, energyGates, gaugeRatio } from './energy.js';

const styles = {
  unknown: '#9fb4c2',
  normal: '#6cddff',
  reduced: '#ffc47b',
  disrupted: '#ff676e',
};
const commodities = {
  'crude oil': '#f5ad60',
  'refined products': '#e6b58e',
  lng: '#70e2d0',
  coal: '#c0b1da',
};

function gauge(document, status, step) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 36;
  const context = canvas.getContext('2d');
  context.beginPath();
  context.arc(18, 18, 15, 0, 2 * Math.PI);
  context.fillStyle = '#152332';
  context.fill();
  context.strokeStyle = '#466070';
  context.lineWidth = 3;
  context.stroke();
  context.strokeStyle = styles[status] ?? styles.unknown;
  context.lineWidth = 4;
  const start = -Math.PI / 2;
  context.beginPath();
  context.arc(
    18,
    18,
    12,
    start,
    start + (2 * Math.PI * Math.max(step, 1)) / 20,
  );
  context.stroke();
  context.fillStyle = context.strokeStyle;
  context.font = 'bold 12px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(
    status === 'unknown' ? '?' : status === 'disrupted' ? '!' : '•',
    18,
    18,
  );
  return canvas;
}

function routePositions(points) {
  const positions = [];
  for (let i = 1; i < points.length; i++) {
    const first = Cesium.Cartographic.fromDegrees(...points[i - 1]);
    const last = Cesium.Cartographic.fromDegrees(...points[i]);
    if (Cesium.Cartographic.equalsEpsilon(first, last, 1e-9)) continue;
    const line = new Cesium.EllipsoidGeodesic(first, last);
    const segments = Math.max(1, Math.ceil(line.surfaceDistance / 140_000));
    for (let j = 0; j <= segments; j++) {
      const point = line.interpolateUsingFraction(j / segments);
      positions.push(
        Cesium.Cartesian3.fromRadians(point.longitude, point.latitude, 38_000),
      );
    }
  }
  return positions;
}

export function createEnergyOverlay({ viewer, labelPoint, requestRender }) {
  const primitives = viewer.scene.primitives;
  const markers = primitives.add(
    new Cesium.BillboardCollection({ scene: viewer.scene }),
  );
  const routes = primitives.add(new Cesium.PolylineCollection());
  const images = new Map();
  let traffic;
  let dependencies;
  let selected;
  let gates = [];
  let visible = false;

  function drawMarkers(dataTo) {
    markers.removeAll();
    for (const gate of gates) {
      if (!gate.coordinates) continue;
      const { id, coordinates, status } = gate;
      const ratio = gaugeRatio(gate, dataTo);
      const step = Number.isFinite(ratio)
        ? Math.min(20, Math.max(0, Math.round(ratio * 20)))
        : 0;
      const key = status + step;
      if (!images.has(key))
        images.set(key, gauge(viewer.scene.canvas.ownerDocument, status, step));
      const marker = markers.add({
        id: 'world-card:chokepoint:' + id,
        position: Cesium.Cartesian3.fromDegrees(...coordinates, 25_000),
        width: 27,
        height: 27,
      });
      marker.setImage(key, images.get(key));
    }
  }

  function drawRoutes(snapshot) {
    routes.removeAll();
    const points = new Map(
      gates.map(({ id, coordinates }) => [id, coordinates]),
    );
    const rows = selected
      ? dependencyRows(snapshot).filter(
          ({ dependent, provider }) =>
            dependent === selected || provider === selected,
        )
      : dependencies?.mode === 'modelled'
        ? dependencyRows(snapshot)
            .filter(
              ({ route, volume }) =>
                route.length &&
                volume?.unit === 'tonnes/year' &&
                Number.isFinite(volume.value),
            )
            .sort((a, b) => b.volume.value - a.volume.value)
            .slice(0, 4)
        : [];
    for (const row of rows.slice(0, 14)) {
      const from = labelPoint(row.provider);
      const to = labelPoint(row.dependent);
      const gatesOnRoute = row.route.map((id) => points.get(id));
      const path = dependencies?.paths?.[`${row.provider}/${row.dependent}`];
      const coordinates =
        path ??
        (from && to && gatesOnRoute.length && gatesOnRoute.every(Boolean)
          ? [[from.lon, from.lat], ...gatesOnRoute, [to.lon, to.lat]]
          : []);
      const positions = routePositions(coordinates);
      if (positions.length < 2) continue;
      routes.add({
        id: row.route.length
          ? 'world-card:chokepoint:' + row.route[0]
          : undefined,
        positions,
        width: selected ? 2.5 : 1.5,
        material: Cesium.Material.fromType('Color', {
          color: Cesium.Color.fromCssColorString(
            commodities[row.item] ?? '#8dcdf2',
          ).withAlpha(0.82),
        }),
      });
    }
  }

  return {
    update(snapshot) {
      const nextTraffic = snapshot.features?.portwatch;
      const nextDependencies = snapshot.features?.['energy-dependencies'];
      const nextVisible = snapshot.visible;
      markers.show = routes.show = nextVisible;
      if (!nextVisible) {
        visible = false;
        return;
      }
      const trafficChanged = !visible || traffic !== nextTraffic;
      const routesChanged =
        trafficChanged ||
        dependencies !== nextDependencies ||
        selected !== snapshot.selected;
      traffic = nextTraffic;
      dependencies = nextDependencies;
      selected = snapshot.selected;
      visible = true;
      if (trafficChanged) {
        gates = energyGates(snapshot);
        drawMarkers(traffic?.dataTo);
      }
      if (routesChanged) drawRoutes(snapshot);
      if (trafficChanged || routesChanged) requestRender();
    },
    destroy() {
      primitives.remove(markers);
      primitives.remove(routes);
    },
  };
}
