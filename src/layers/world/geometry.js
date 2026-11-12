import * as Cesium from 'cesium';
import { renderShapeIds } from './model.js';

const FILL_ALPHA = 0.55;
const BORDER = Cesium.Color.fromCssColorString('#b6f8fa');
const CYAN = Cesium.Color.fromCssColorString('#00d4ff');
const HATCH_BASE = Cesium.Color.fromCssColorString('#172b3e');
const HATCH_LINE = Cesium.Color.fromCssColorString('#a4b4bd');
const LABEL_MIN_KM2 = 850_000;
// Half the country-code badge (54 x 24 px), for testing it against panels.
const LABEL_HALF_WIDTH_PX = 27;
const LABEL_HALF_HEIGHT_PX = 12;

function groundPolygon(hierarchy, id, colored) {
  return new Cesium.GeometryInstance({
    id,
    geometry: new Cesium.PolygonGeometry({
      polygonHierarchy: hierarchy,
      vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
    }),
    attributes: {
      show: new Cesium.ShowGeometryInstanceAttribute(false),
      ...(colored && {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.TRANSPARENT,
        ),
      }),
    },
  });
}

function polylineBatch(lines, width, color) {
  return new Cesium.GroundPolylinePrimitive({
    geometryInstances: lines.map(
      (positions, id) =>
        new Cesium.GeometryInstance({
          id,
          geometry: new Cesium.GroundPolylineGeometry({
            positions,
            width,
            loop: true,
            // The packed borders already include the vertices we need at board zoom.
            granularity: 0,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
          },
        }),
    ),
    classificationType: Cesium.ClassificationType.BOTH,
    appearance: new Cesium.PolylineColorAppearance(),
    allowPicking: false,
  });
}

function colorAttribute(color, alpha, current) {
  return Cesium.ColorGeometryInstanceAttribute.toValue(
    color.withAlpha(alpha),
    current,
  );
}

function codeImage(iso3) {
  // ISO3 comes from the registry, and only three letters can enter the SVG.
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="54" height="24"><rect x="2" y="2" width="50" height="20" rx="5" fill="#0d1b29" fill-opacity=".78"/><text x="27" y="16" text-anchor="middle" fill="#dffcff" font-family="JetBrains Mono, monospace" font-weight="700" font-size="13" letter-spacing="1.6">${iso3}</text></svg>`,
    )
  );
}

function createHatchMaterial() {
  return new Cesium.Material({
    fabric: {
      type: 'GevWorldHatch',
      uniforms: {
        base: HATCH_BASE.withAlpha(0),
        stripe: HATCH_LINE.withAlpha(0),
      },
      // Screen pixels keep the pattern legible on both tiny islands and large states.
      source: `
        czm_material czm_getMaterial(czm_materialInput materialInput) {
          czm_material material = czm_getDefaultMaterial(materialInput);
          float phase = mod(gl_FragCoord.x + gl_FragCoord.y, 9.0);
          vec4 shade = czm_gammaCorrect(mix(base, stripe, 1.0 - smoothstep(1.0, 2.3, phase)));
          material.diffuse = shade.rgb;
          material.alpha = shade.a;
          return material;
        }
      `,
    },
    translucent: true,
  });
}

/** Each map unit participates in both batches. Lens changes only flip attributes. */
export function createWorldGeometry(scene, shapes, countries) {
  const ground = scene.groundPrimitives;
  const shapeById = new Map(shapes.map((shape) => [shape.shapeId, shape]));
  const groups = new Map();
  const solidInstances = [];
  const hatchInstances = [];
  const borders = [];
  for (const country of countries) {
    const group = {
      iso3: country.iso3,
      ids: [],
      lines: [],
      label: null,
      area: 0,
    };
    groups.set(country.iso3, group);
    for (const shapeId of renderShapeIds(country)) {
      const shape = shapeById.get(shapeId);
      if (!shape) continue;
      group.area += shape.areaKm2;
      if (!group.label || shape.areaKm2 > group.label.areaKm2)
        group.label = shape;
      shape.polygons.forEach(([outer, ...holes], index) => {
        const rings = [outer, ...holes].map((ring) =>
          Cesium.Cartesian3.fromDegreesArray(ring.flat()),
        );
        const hierarchy = new Cesium.PolygonHierarchy(
          rings[0],
          rings.slice(1).map((ring) => new Cesium.PolygonHierarchy(ring)),
        );
        const id = `world:${country.iso3}:${shapeId}:${index}`;
        solidInstances.push(groundPolygon(hierarchy, id, true));
        hatchInstances.push(groundPolygon(hierarchy, id, false));
        group.ids.push(id);
        group.lines.push(...rings);
        borders.push(...rings);
      });
    }
  }
  const material = createHatchMaterial();
  const solid = ground.add(
    new Cesium.GroundPrimitive({
      geometryInstances: solidInstances,
      classificationType: Cesium.ClassificationType.BOTH,
    }),
  );
  const hatch = ground.add(
    new Cesium.GroundPrimitive({
      geometryInstances: hatchInstances,
      classificationType: Cesium.ClassificationType.BOTH,
      appearance: new Cesium.MaterialAppearance({ flat: true, material }),
    }),
  );
  const border = ground.add(polylineBatch(borders, 1, BORDER.withAlpha(0)));
  const labels = scene.primitives.add(new Cesium.BillboardCollection());
  for (const { iso3, label, area } of groups.values()) {
    if (area < LABEL_MIN_KM2 || !label || !/^[A-Z]{3}$/.test(iso3)) continue;
    labels.add({
      id: `world:${iso3}:label`,
      position: Cesium.Cartesian3.fromDegrees(label.label.lon, label.label.lat),
      image: codeImage(iso3),
      disableDepthTestDistance: Infinity,
      color: Cesium.Color.TRANSPARENT,
    });
  }

  let selected = { iso3: null, primitive: null };
  let hovered = { iso3: null, primitive: null };
  let borderAlpha = -1;
  let labelAlpha = -1;
  let active = true;
  let previousCamera;
  let previousCoverRevision = 0;
  const labelWindow = new Cesium.Cartesian2();
  const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84);

  function removeOutline(outline) {
    if (outline.primitive) ground.remove(outline.primitive);
  }

  function setOutline(current, iso3, width, color, alpha) {
    if (current.iso3 !== iso3) {
      removeOutline(current);
      const lines = groups.get(iso3)?.lines;
      current = {
        iso3,
        primitive: lines?.length
          ? ground.add(polylineBatch(lines, width, color.withAlpha(alpha)))
          : null,
        count: lines?.length ?? 0,
        alpha,
      };
    }
    if (current.primitive) {
      current.primitive.show = active && alpha > 0;
      if (current.primitive.ready && current.alpha !== alpha) {
        for (let i = 0; i < current.count; i++) {
          const attributes = current.primitive.getGeometryInstanceAttributes(i);
          attributes.color = colorAttribute(color, alpha, attributes.color);
        }
        current.alpha = alpha;
      }
    }
    return current;
  }

  return {
    labelPoint(iso3) {
      return groups.get(iso3)?.label?.label;
    },

    get ready() {
      return solid.ready && hatch.ready;
    },

    get borderReady() {
      return border.ready;
    },

    setActive(value) {
      active = value;
      for (const primitive of [solid, hatch, border, labels])
        primitive.show = value;
      for (const { primitive } of [selected, hovered]) {
        if (primitive) primitive.show = value;
      }
    },

    paint({ colorFor, opacity }) {
      const shown = active && opacity > 0;
      // Unready primitives must still update in Cesium's render loop.
      solid.show = active && (shown || !solid.ready);
      hatch.show = active && (shown || !hatch.ready);
      border.show = active && (shown || !border.ready);
      labels.show = shown;
      if (solid.ready && hatch.ready && shown) {
        for (const { iso3, ids } of groups.values()) {
          const color = colorFor(iso3);
          const known = color != null;
          for (const id of ids) {
            const solidAttr = solid.getGeometryInstanceAttributes(id);
            const hatchAttr = hatch.getGeometryInstanceAttributes(id);
            solidAttr.show = Cesium.ShowGeometryInstanceAttribute.toValue(
              known,
              solidAttr.show,
            );
            hatchAttr.show = Cesium.ShowGeometryInstanceAttribute.toValue(
              !known,
              hatchAttr.show,
            );
            if (color) {
              const bytes = solidAttr.color;
              bytes.set(color);
              bytes[3] = Math.round(255 * FILL_ALPHA * opacity);
              solidAttr.color = bytes;
            }
          }
        }
      }
      material.uniforms.base.alpha = 0.38 * opacity;
      material.uniforms.stripe.alpha = 0.58 * opacity;
      if (border.ready && shown && borderAlpha !== opacity) {
        for (let i = 0; i < borders.length; i++) {
          const attributes = border.getGeometryInstanceAttributes(i);
          attributes.color = colorAttribute(
            BORDER,
            0.4 * opacity,
            attributes.color,
          );
        }
        borderAlpha = opacity;
      }
      if (labelAlpha !== opacity) {
        const color = Cesium.Color.WHITE.withAlpha(opacity);
        for (let i = 0; i < labels.length; i++) labels.get(i).color = color;
        labelAlpha = opacity;
      }
    },

    outline(selectedId, hoveredId, opacity) {
      selected = setOutline(selected, selectedId, 4, CYAN, opacity);
      hovered = setOutline(
        hovered,
        hoveredId === selectedId ? null : hoveredId,
        2.5,
        BORDER,
        opacity,
      );
    },

    cullLabels(camera, cover = null) {
      if (!labels.show) return;
      const position = camera.positionWC;
      const in3D = scene.mode === Cesium.SceneMode.SCENE3D;
      // A panel that opened or moved re-culls even under a still camera.
      const coverRevision = cover ? cover.refresh() : 0;
      if (
        in3D &&
        previousCamera &&
        coverRevision === previousCoverRevision &&
        Cesium.Cartesian3.equalsEpsilon(position, previousCamera, 0, 1)
      )
        return;
      previousCoverRevision = coverRevision;
      previousCamera = in3D
        ? Cesium.Cartesian3.clone(position, previousCamera)
        : undefined;
      occluder.cameraPosition = position;
      for (let i = 0; i < labels.length; i++) {
        const label = labels.get(i);
        let show = !in3D || occluder.isPointVisible(label.position);
        if (show && cover) {
          // The codes are drawn on the globe, beneath see-through panels, so
          // one under a panel would read through it: hide it instead.
          const at = Cesium.SceneTransforms.worldToWindowCoordinates(
            scene,
            label.position,
            labelWindow,
          );
          show =
            !at ||
            !cover.covers(
              at.x,
              at.y,
              LABEL_HALF_WIDTH_PX,
              LABEL_HALF_HEIGHT_PX,
            );
        }
        label.show = show;
      }
    },

    destroy() {
      removeOutline(selected);
      removeOutline(hovered);
      for (const primitive of [solid, hatch, border]) ground.remove(primitive);
      scene.primitives.remove(labels);
    },
  };
}
