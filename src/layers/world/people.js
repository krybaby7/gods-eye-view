import * as Cesium from 'cesium';
import { billboardLeader, countryPeople } from './peopleModel.js';

function countryLabels(primitives) {
  const labels = new Map();
  for (let i = 0; i < primitives.length; i++) {
    const collection = primitives.get(i);
    if (!(collection instanceof Cesium.BillboardCollection)) continue;
    for (let j = 0; j < collection.length; j++) {
      const label = collection.get(j);
      const match =
        typeof label.id === 'string' &&
        /^world:([A-Z]{3}):label$/.exec(label.id);
      if (match) labels.set(match[1], label);
    }
  }
  return labels;
}

export function createPeopleOverlay({ viewer, requestRender }) {
  const { primitives } = viewer.scene;
  const portraits = primitives.add(
    new Cesium.BillboardCollection({ scene: viewer.scene }),
  );
  let directory;
  let photos;
  const entries = new Map();

  return {
    update(snapshot) {
      portraits.show = snapshot.visible;
      const actors = snapshot.features?.wikidata;
      const commons = snapshot.features?.['wikimedia-commons'];
      if (!snapshot.visible || (directory === actors && photos === commons))
        return;
      directory = actors;
      photos = commons;
      for (const [iso3, label] of countryLabels(primitives)) {
        const actor = billboardLeader(countryPeople(snapshot, iso3));
        const existing = entries.get(iso3);
        const id = actor && 'world-card:actor:' + actor.id;
        if (
          actor &&
          existing?.portrait.id === id &&
          existing.thumbnail === actor.image.thumbnail
        )
          continue;
        if (existing) {
          portraits.remove(existing.portrait);
          entries.delete(iso3);
        }
        if (!actor) continue;
        const portrait = portraits.add({
          id,
          position: label.position,
          image: actor.image.thumbnail,
          pixelOffset: new Cesium.Cartesian2(41, 0),
          width: 22,
          height: 26,
          disableDepthTestDistance: Infinity,
          show: label.show,
          color: label.color,
        });
        entries.set(iso3, {
          portrait,
          label,
          thumbnail: actor.image.thumbnail,
        });
      }
      requestRender();
    },
    frame() {
      if (!portraits.show) return;
      for (const { portrait, label } of entries.values()) {
        if (portrait.show !== label.show) portrait.show = label.show;
        if (!Cesium.Color.equals(portrait.color, label.color))
          portrait.color = label.color;
      }
    },
    destroy() {
      primitives.remove(portraits);
      entries.clear();
    },
  };
}
