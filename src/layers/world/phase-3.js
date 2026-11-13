import * as Cesium from 'cesium';
import {
  classifyDiplomacy,
  currentRelations,
  DIPLOMACY_CLASSES,
  DIPLOMACY_RULES,
  relationPeers,
} from './relations.js';
import { renderRelationsTab } from '../../ui/worldRelationsTab.js';
import { renderRelationCard } from '../../ui/worldRelationCard.js';

const priority = {
  current_armed_conflict: 4,
  alliance: 3,
  defence_pact: 3,
  sanctions: 2,
  territorial_dispute: 1,
};
const lineStyles = {
  current_armed_conflict: ['#f4525d', 12, 3855, 4],
  sanctions: ['#e8933f', 22, 255, 2],
  territorial_dispute: ['#b25ec5', 16, 3855, 2],
  alliance: ['#3da1ea', 22, 255, 3],
  defence_pact: ['#3da1ea', 22, 255, 3],
};
const colors = new Map(DIPLOMACY_CLASSES.map(([key, , color]) => [key, color]));
let lastFeatures;
let lastSelection;
let lensRows;

function diplomacyColor(country, snapshot) {
  if (
    lastFeatures !== snapshot.features ||
    lastSelection !== snapshot.selected
  ) {
    lastFeatures = snapshot.features;
    lastSelection = snapshot.selected;
    lensRows = currentRelations(snapshot).filter(
      (row) => relationPeers(row, lastSelection).length,
    );
  }
  return (
    colors.get(
      classifyDiplomacy(snapshot.selected, country.iso3, lensRows ?? []),
    ) ?? null
  );
}

function positionsBetween(from, to) {
  const origin = Cesium.Cartographic.fromDegrees(from.lon, from.lat);
  const destination = Cesium.Cartographic.fromDegrees(to.lon, to.lat);
  // Cesium's ellipsoid solver rejects exact or near antipodes.
  if (
    Cesium.Cartesian3.angleBetween(
      Cesium.Cartesian3.fromRadians(origin.longitude, origin.latitude),
      Cesium.Cartesian3.fromRadians(
        destination.longitude,
        destination.latitude,
      ),
    ) >
    Math.PI - 0.0125
  )
    return null;
  const arc = new Cesium.EllipsoidGeodesic(origin, destination);
  return Array.from({ length: 41 }, (_, i) => {
    const position = arc.interpolateUsingFraction(i / 40);
    return Cesium.Cartesian3.fromRadians(
      position.longitude,
      position.latitude,
      28_000 + 95_000 * Math.sin((Math.PI * i) / 40),
    );
  });
}

function relationOverlay({ viewer, labelPoint, requestRender }) {
  const group = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  let previousFeatures;
  let previousSelection;
  return {
    update(snapshot) {
      group.show = Boolean(snapshot.visible && snapshot.selected);
      if (
        !group.show ||
        (previousFeatures === snapshot.features &&
          previousSelection === snapshot.selected)
      )
        return;
      previousFeatures = snapshot.features;
      previousSelection = snapshot.selected;
      group.removeAll();
      const origin = labelPoint(snapshot.selected);
      if (!origin) return;
      const pairs = new Map();
      for (const row of currentRelations(snapshot)) {
        const style = lineStyles[row.type];
        if (
          !style ||
          row.end ||
          (row.type === 'sanctions' && row.scope !== 'state')
        )
          continue;
        const other = relationPeers(row, snapshot.selected);
        for (const id of other) {
          if (
            id === snapshot.selected ||
            priority[pairs.get(id)?.row.type] >= priority[row.type] ||
            (row.type === 'current_armed_conflict' &&
              classifyDiplomacy(snapshot.selected, id, [row]) !== 'at-war')
          )
            continue;
          const destination = labelPoint(id);
          if (!destination) continue;
          const positions = positionsBetween(origin, destination);
          if (positions) pairs.set(id, { row, style, positions });
        }
      }
      for (const { row, style, positions } of pairs.values()) {
        const [color, dashLength, dashPattern, width] = style;
        group.add({
          id: 'world-card:relation:' + row.id,
          positions,
          width,
          material: Cesium.Material.fromType('PolylineDash', {
            color: Cesium.Color.fromCssColorString(color),
            dashLength,
            dashPattern,
          }),
        });
      }
      requestRender();
    },
    destroy() {
      viewer.scene.primitives.remove(group);
    },
  };
}

export default {
  lenses: [
    {
      id: 'diplomacy',
      label: 'Diplomacy',
      order: 50,
      color: diplomacyColor,
      legend(snapshot) {
        const selected = snapshot.countryIndex?.find(
          ({ iso3 }) => iso3 === snapshot.selected,
        );
        return {
          name: selected ? 'Diplomacy · ' + selected.name : 'Diplomacy',
          stops: DIPLOMACY_CLASSES.map(([, label]) => label),
          note: selected
            ? DIPLOMACY_RULES
            : 'Select a country to see its relations.',
        };
      },
    },
  ],
  overlays: [relationOverlay],
  tabs: [
    {
      id: 'relations',
      label: 'Relations',
      render: renderRelationsTab,
    },
  ],
  cards: [{ type: 'relation', label: 'Relation', render: renderRelationCard }],
};
