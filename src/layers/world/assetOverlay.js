import * as Cesium from 'cesium';
import {
  assetKinds,
  assetMarkers,
  assetPoint,
  boardAssetScale,
  ownedAbroad,
  ownerColor,
} from './assets.js';

function assetIcon(document, marker) {
  const { type, owner, focus, members, size } = marker;
  const style = assetKinds[type];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * 2;
  const ctx = canvas.getContext('2d');
  const c = size;
  ctx.beginPath();
  ctx.arc(c, c, c - 5, 0, 2 * Math.PI);
  ctx.fillStyle = '#10212d';
  ctx.fill();
  ctx.strokeStyle = owner ? ownerColor(owner) : style.color;
  ctx.lineWidth = owner ? 5 : 2.5;
  ctx.stroke();
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
  ctx.fillStyle = style.color;
  ctx.fillText(
    members.length > 1 ? String(members.length) : style.glyph,
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
  let snapshot;
  let scale = boardAssetScale(
    viewer.camera.positionCartographic?.height,
    'regional',
  );

  function drawMarkers() {
    markers.removeAll();
    for (const marker of assetMarkers(snapshot, scale)) {
      const key = [
        marker.type,
        marker.owner ? 'owner-' + marker.owner : 'neutral',
        marker.focus ? 'focus' : 'base',
        marker.members.length,
      ].join(':');
      if (!images.has(key))
        images.set(key, assetIcon(scene.canvas.ownerDocument, marker));
      const billboard = markers.add({
        id: 'world-card:asset:' + marker.id,
        position: Cesium.Cartesian3.fromDegrees(...marker.coordinates, 32_000),
        width: marker.size,
        height: marker.size,
      });
      billboard.setImage(key, images.get(key));
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
    for (const asset of ownedAbroad(snapshot, owner)) {
      const location = assetPoint(asset);
      const positions = location ? returnLine(location, endpoint) : [];
      if (positions.length < 2) continue;
      lines.add({
        id: 'world-card:asset:' + asset.id,
        positions,
        width: 2.5,
        material: Cesium.Material.fromType('Color', { color }),
      });
    }
  }

  return {
    update(next) {
      const redraw =
        !snapshot?.visible ||
        snapshot.features !== next.features ||
        snapshot.lens !== next.lens ||
        snapshot.selected !== next.selected;
      snapshot = next;
      markers.show = lines.show = next.visible;
      if (!next.visible || !redraw) return;
      drawMarkers();
      drawLines();
      requestRender();
    },
    frame(camera) {
      const next = boardAssetScale(camera.positionCartographic?.height, scale);
      if (next === scale) return;
      scale = next;
      if (!snapshot?.visible) return;
      drawMarkers();
      requestRender();
    },
    destroy() {
      primitives.remove(markers);
      primitives.remove(lines);
    },
  };
}
