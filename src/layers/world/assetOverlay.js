import * as Cesium from 'cesium';
import {
  assetConnections,
  assetKinds,
  assetMarkers,
  boardAssetScale,
  ownerColor,
  showAssetMarkers,
} from './assets.js';

function assetIcon(document, marker) {
  const { type, owner, focus, members, size, approximate, closed, draft } =
    marker;
  const style = assetKinds[type];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * 2;
  const ctx = canvas.getContext('2d');
  const c = size;
  ctx.beginPath();
  ctx.arc(c, c, c - 5, 0, 2 * Math.PI);
  ctx.fillStyle = approximate ? '#10212ddd' : '#10212d';
  ctx.fill();
  const accent = closed ? '#98a4aa' : approximate ? '#f6cf85' : style.color;
  ctx.strokeStyle = owner ? ownerColor(owner) : accent;
  ctx.lineWidth = owner ? 5 : 2.5;
  if (approximate || draft || closed) ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (focus) {
    ctx.beginPath();
    ctx.arc(c, c, c - 1.6, 0, 2 * Math.PI);
    ctx.strokeStyle = '#eefaff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = `bold ${members.length > 1 ? Math.min(size, 22) : 24}px system-ui`;
  ctx.fillStyle = accent;
  ctx.fillText(
    approximate
      ? '?'
      : closed
        ? '×'
        : members.length > 1
          ? String(members.length)
          : style.glyph,
    c,
    c + 1,
  );
  return canvas;
}

function returnLine(from, to) {
  const start = Cesium.Cartographic.fromDegrees(...from);
  const end = Cesium.Cartographic.fromDegrees(to.lon, to.lat);
  if (Cesium.Cartographic.equalsEpsilon(start, end, 1e-8)) return [];
  const a = Cesium.Cartesian3.fromDegrees(...from);
  const b = Cesium.Cartesian3.fromDegrees(to.lon, to.lat);
  const angle = Cesium.Cartesian3.angleBetween(a, b);
  if (Math.abs(angle - Math.PI) < 0.013) return [];
  const geodesic = new Cesium.EllipsoidGeodesic(start, end);
  const segments = Math.max(2, Math.ceil(geodesic.surfaceDistance / 160_000));
  return Array.from({ length: segments + 1 }, (_, index) => {
    const point = geodesic.interpolateUsingFraction(index / segments);
    return Cesium.Cartesian3.fromRadians(
      point.longitude,
      point.latitude,
      45_000,
    );
  });
}

export function createAssetOverlay({ viewer, labelPoint, requestRender }) {
  const { scene } = viewer;
  const primitives = scene.primitives;
  const markers = primitives.add(new Cesium.BillboardCollection({ scene }));
  const lines = primitives.add(new Cesium.PolylineCollection());
  const images = new Map();
  const billboards = new Map();
  let snapshot;
  let markerState;

  function drawMarkers(scale) {
    const seen = new Set();
    for (const marker of assetMarkers(snapshot, scale, labelPoint)) {
      seen.add(marker.id);
      const key = [
        marker.type,
        marker.owner ? 'owner-' + marker.owner : 'neutral',
        marker.focus ? 'focus' : 'base',
        marker.members.length,
        marker.approximate ? 'approximate' : 'site',
        marker.closed ? 'closed' : 'active',
        marker.draft ? 'draft' : 'reviewed',
      ].join(':');
      if (!images.has(key))
        images.set(key, assetIcon(scene.canvas.ownerDocument, marker));
      const pickId = `world-${marker.approximate ? 'hint' : 'card'}:asset:${marker.id}`;
      const position = Cesium.Cartesian3.fromDegrees(
        ...marker.coordinates,
        32_000,
      );
      let entry = billboards.get(marker.id);
      if (!entry) {
        entry = { billboard: markers.add({ position, id: pickId }) };
        billboards.set(marker.id, entry);
      }
      const { billboard } = entry;
      billboard.position = position;
      billboard.id = pickId;
      billboard.width = billboard.height = marker.size;
      billboard.pixelOffset = marker.approximate
        ? new Cesium.Cartesian2(22, -14)
        : Cesium.Cartesian2.ZERO;
      if (entry.key !== key) {
        billboard.setImage(key, images.get(key));
        entry.key = key;
      }
    }
    for (const [id, { billboard }] of billboards) {
      if (seen.has(id)) continue;
      markers.remove(billboard);
      billboards.delete(id);
    }
  }

  function drawLines() {
    lines.removeAll();
    const owner = snapshot.selected;
    const endpoint =
      snapshot.lens === 'ownership' && owner && labelPoint(owner);
    if (!endpoint) return;
    const color = Cesium.Color.fromCssColorString(ownerColor(owner)).withAlpha(
      0.8,
    );
    const presenceColor =
      Cesium.Color.fromCssColorString('#d8dce5').withAlpha(0.8);
    for (const {
      asset,
      coordinates,
      approximate,
      kind,
      draft,
    } of assetConnections(snapshot, labelPoint)) {
      const positions = returnLine(coordinates, endpoint);
      if (positions.length < 2) continue;
      const presence = kind === 'presence';
      const baseColor = presence ? presenceColor : color;
      const lineColor = draft ? baseColor.withAlpha(0.45) : baseColor;
      const material =
        presence || approximate || draft
          ? Cesium.Material.fromType('PolylineDash', {
              color: lineColor,
              dashLength: approximate ? 10 : 18,
              dashPattern: approximate
                ? 0b1111000011110000
                : 0b1111111100000000,
            })
          : Cesium.Material.fromType('Color', { color: lineColor });
      lines.add({
        id: 'world-card:asset:' + asset.id,
        positions,
        width: presence ? 2 : 2.5,
        material,
      });
    }
  }

  function updateMarkers(camera) {
    if (!snapshot) return;
    const height = camera.positionCartographic?.height;
    const show = showAssetMarkers(height, snapshot.lens, snapshot.selected);
    if (markers.show !== show) {
      markers.show = show;
      requestRender();
    }
    if (!show) return;
    const scale = boardAssetScale(height, markerState?.scale ?? 'regional');
    const selected = snapshot.lens === 'ownership' ? snapshot.selected : null;
    const features = snapshot.features;
    if (
      markerState?.scale === scale &&
      markerState.selected === selected &&
      markerState.features === features
    )
      return;
    drawMarkers(scale);
    markerState = { scale, selected, features };
    requestRender();
  }

  return {
    update(next) {
      const showLines = next.lens === 'ownership' && Boolean(next.selected);
      const redraw =
        showLines &&
        (!lines.show ||
          snapshot?.features !== next.features ||
          snapshot.selected !== next.selected);
      snapshot = next;
      lines.show = showLines;
      if (redraw) {
        drawLines();
        requestRender();
      }
      updateMarkers(viewer.camera);
    },
    frame: updateMarkers,
    destroy() {
      primitives.remove(markers);
      primitives.remove(lines);
    },
  };
}
