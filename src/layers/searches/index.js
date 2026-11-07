import * as Cesium from 'cesium';

import { isPointerFree } from '../../data/inputOwnership.js';
import {
  hotspotBubbleImage,
  hotspotStyle,
  newsMapMode,
} from '../news/hotspots.js';
import {
  buildSearchBubbles,
  buildSearchMarkers,
  markerImage,
  searchBubbleCard,
  searchFindingCard,
} from './model.js';
import { localSearchDay } from './records.js';

export { createSearchesSource } from './source.js';

const ID = 'searches';
const PREFIX = `${ID}:`;
const POLL_MS = 3000;
const HOVER_MS = 90;
const at = ({ lon, lat }) => Cesium.Cartesian3.fromDegrees(lon, lat);
const empty = {
  searches: [],
  days: [],
  agents: {},
  defaultAgent: 'claude',
  revision: '',
};

export function createSearchesLayer({
  source,
  overlayHost,
  services: { context = {}, picking = {}, focus = {}, render = {} } = {},
  screenSpaceEventHandlerFactory = (viewer) =>
    new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas),
} = {}) {
  if (!source?.getSnapshot || !overlayHost)
    throw new TypeError('Searches requires a source and an overlay host');

  const listeners = new Set();
  const entries = new Map();
  let viewer;
  let dataSource;
  let enabled = false;
  let destroyed = false;
  let lifetime;
  let pending;
  let poll;
  let loading = false;
  let error = null;
  let snapshot = empty;
  let day = null;
  let shownDay = null;
  let runChoice = null;
  let runRecord = null;
  let pendingAsk = false;
  let mode = 'pins';
  let handler;
  let removeFrame;
  let lastCamera;
  let hover = null;
  let hoverAt = 0;
  let selected = null;
  let placeFilter = null;
  let groupFilters = Object.create(null);

  const displayed = () => (runRecord ? [runRecord] : snapshot.searches);
  const searchById = (id) => displayed().find((search) => search.id === id);
  const findingById = (searchId, findingId) =>
    searchById(searchId)?.findings.find((item) => item.id === findingId);
  const cameraMode = () =>
    newsMapMode(viewer?.camera?.positionCartographic?.height, mode);

  function notify(reason) {
    const state = layer.getSnapshot();
    for (const listener of listeners) listener(state, reason);
  }

  function requestRender() {
    if (render.governorRequestRender) render.governorRequestRender(ID);
    else viewer?.scene?.requestRender?.();
  }

  function selectedKey() {
    const finding =
      selected && findingById(selected.searchId, selected.findingId);
    return finding
      ? (finding.mergeKey ?? `${selected.searchId}:${finding.id}`)
      : null;
  }

  function focusEntry(key) {
    const entry = entries.get(key);
    if (!entry) return false;
    if (entry.bubble) {
      const { bubble } = entry;
      focus.requestWorldFocus?.({
        kind: 'hotspot',
        id: PREFIX + key,
        label: 'PLACE',
        position: entry.position,
        radiusM: bubble.radiusM,
      });
      layer.setPlaceFilter(bubble.key);
      return true;
    }
    const member =
      entry.marker.members.find(
        ({ search, finding }) =>
          selected?.searchId === search.id && selected.findingId === finding.id,
      ) ?? entry.marker.members[0];
    return layer.selectFinding(member.search.id, member.finding.id);
  }

  function drawCards() {
    if (!enabled) return;
    const key = mode === 'pins' ? selectedKey() : null;
    const keys = new Set([key, hover]);
    const cards = [];
    for (const id of keys) {
      const entry = entries.get(id);
      if (!entry) continue;
      const card = entry.bubble
        ? searchBubbleCard(entry.bubble, entry.position)
        : searchFindingCard(entry.marker, entry.position, id === key);
      cards.push({ ...card, activate: () => focusEntry(id) });
    }
    overlayHost.setEntries(ID, cards, {
      cohortLimit: 2,
      collisionCapacity: 2,
      moving: false,
    });
  }

  function cull() {
    const position = viewer?.camera?.positionWC;
    if (
      !position ||
      (lastCamera &&
        Cesium.Cartesian3.equalsEpsilon(lastCamera, position, 0, 1))
    )
      return;
    lastCamera = Cesium.Cartesian3.clone(position, lastCamera);
    const globe = new Cesium.EllipsoidalOccluder(
      Cesium.Ellipsoid.WGS84,
      position,
    );
    const time = Cesium.JulianDate.now();
    for (const { entity, position: point } of entries.values()) {
      const show = globe.isPointVisible(point);
      if (entity.billboard.show?.getValue?.(time) !== show)
        entity.billboard.show = show;
    }
  }

  function draw() {
    if (!enabled || !dataSource) return;
    const searches = displayed();
    const markers = buildSearchMarkers(searches, groupFilters);
    const selection = selectedKey();
    const retainIds = new Set();
    dataSource.entities.suspendEvents();
    try {
      entries.clear();
      dataSource.entities.removeAll();
      const items =
        mode === 'pins'
          ? markers.map((marker) => ({
              key: marker.id,
              marker,
              position: at(marker.location),
              image: markerImage(marker, selection === marker.id),
            }))
          : buildSearchBubbles(markers, searches, selection).map((bubble) => ({
              key: `hotspot:${bubble.key}`,
              bubble,
              position: at(bubble),
              image: hotspotBubbleImage(hotspotStyle(bubble)),
            }));
      for (const entry of items) {
        const { key, marker, bubble, position, image } = entry;
        const entity = dataSource.entities.add({
          id: PREFIX + key,
          position,
          billboard: {
            image,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        entity.gevSearchKey = key;
        if (bubble) entity.gevSearchHotspotKey = bubble.key;
        entries.set(key, { ...entry, entity });
        if (!marker) continue;
        const { search, finding } =
          marker.members.find(
            ({ search, finding }) =>
              selected?.searchId === search.id &&
              selected.findingId === finding.id,
          ) ?? marker.members[0];
        entity.gevSearchFindingId = finding.id;
        entity.__localBaseCartesian = position;
        context.registerEntityContext?.(entity, {
          id: entity.id,
          layerId: ID,
          layerName: 'Searches',
          dataSource,
          label: finding.title,
          source: search.label,
          latitude: marker.location.lat,
          longitude: marker.location.lon,
          properties: {
            search: search.label,
            kind: finding.kind,
            place: finding.location.name,
            verification: finding.verification,
            sources: marker.sourceCount,
          },
        });
        retainIds.add(entity.id);
      }
    } finally {
      dataSource.entities.resumeEvents();
    }
    if (selection && !retainIds.has(PREFIX + selection))
      context.clearSelectedEntityContextForLayer?.(ID);
    context.removeEntityContextsForLayer?.(ID, { retainIds });
    lastCamera = null;
    cull();
    drawCards();
    requestRender();
  }

  function preRender() {
    const next = cameraMode();
    if (next !== mode) {
      mode = next;
      hover = null;
      draw();
      const entity = entries.get(selectedKey())?.entity;
      if (entity) context.selectEntityContext?.(entity);
    }
    cull();
  }

  function installHandlers() {
    handler = screenSpaceEventHandlerFactory(viewer);
    const pick = (position) => viewer.scene.pick?.(position);
    const keyOf = (picked) =>
      picked?.id?.gevSearchKey ?? picked?.primitive?.id?.gevSearchKey;
    handler.setInputAction(({ position }) => {
      if (!isPointerFree()) return;
      const picked = pick(position);
      if (focusEntry(keyOf(picked))) return;
      if (picking.isOwnedByOtherLayer?.(ID, picking.resolvePickId?.(picked)))
        return;
      const hit = overlayHost.hitTest?.(position.x, position.y, {
        sourceId: ID,
      });
      if (hit?.entryId && focusEntry(hit.entryId.replace(/^finding:/, '')))
        return;
      if (!selected) return;
      selected = null;
      context.clearSelectedEntityContextForLayer?.(ID);
      draw();
      notify('select');
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(({ endPosition }) => {
      if (!isPointerFree() || Date.now() - hoverAt < HOVER_MS) return;
      hoverAt = Date.now();
      const key = keyOf(pick(endPosition)) ?? null;
      if (key === hover) return;
      hover = key;
      drawCards();
      requestRender();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    picking.registerPickOwner?.(
      ID,
      (id) => typeof id === 'string' && id.startsWith(PREFIX),
    );
    removeFrame = viewer.scene.preRender?.addEventListener(preRender);
  }

  function schedulePoll() {
    clearTimeout(poll);
    if (
      !enabled ||
      !(
        pendingAsk ||
        Object.values(snapshot.agents).some((agent) => agent.busy) ||
        snapshot.searches.some((search) => search.status === 'running')
      )
    )
      return;
    poll = setTimeout(() => void refresh(), POLL_MS);
  }

  async function refresh({ force = false, signal: parent } = {}) {
    if (!enabled || destroyed) return false;
    clearTimeout(poll);
    pending?.abort();
    const request = new AbortController();
    pending = request;
    const signal = AbortSignal.any([
      request.signal,
      lifetime.signal,
      ...(parent ? [parent] : []),
    ]);
    const revision = !force && day === shownDay ? snapshot.revision : undefined;
    if (!revision) {
      loading = true;
      notify('loading');
    }
    try {
      const next = await source.getSnapshot({
        rev: revision,
        asOf: day,
        signal,
      });
      const record =
        runChoice && (force || !runRecord)
          ? await source.getRun(runChoice.searchId, runChoice.runId, { signal })
          : runRecord;
      if (pending !== request || signal.aborted) return false;
      if (!next.unchanged) snapshot = next;
      shownDay = day;
      runRecord = record;
      pendingAsk = false;
      error = null;
      if (!next.unchanged || force) {
        if (selected && !findingById(selected.searchId, selected.findingId)) {
          selected = null;
          context.clearSelectedEntityContextForLayer?.(ID);
        }
        if (
          placeFilter &&
          !displayed().some((search) =>
            search.findings.some(
              (finding) => finding.hotspot?.key === placeFilter.key,
            ),
          )
        )
          placeFilter = null;
        mode = cameraMode();
        draw();
      }
      return true;
    } catch (cause) {
      if (pending === request && !signal.aborted)
        error = cause.message || 'Searches unavailable';
      return false;
    } finally {
      if (pending === request) {
        pending = null;
        loading = false;
        if (!signal.aborted) {
          notify('snapshot');
          schedulePoll();
        }
      }
    }
  }

  function changeView() {
    hover = selected = placeFilter = null;
    groupFilters = Object.create(null);
    context.clearSelectedEntityContextForLayer?.(ID);
    return refresh({ force: true });
  }

  const layer = {
    id: ID,
    name: 'Searches',
    icon: '⌕',
    source: 'Claude Code · web research',
    updateInterval: 0,

    init(nextViewer) {
      if (viewer) throw new Error('Searches layer is already initialized');
      viewer = nextViewer;
      dataSource = new Cesium.CustomDataSource(ID);
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
      overlayHost.setVisible(ID, false);
    },

    enable(nextViewer) {
      if (enabled || destroyed) return;
      if (!viewer && nextViewer) layer.init(nextViewer);
      lifetime = new AbortController();
      enabled = true;
      if (dataSource) {
        dataSource.show = true;
        installHandlers();
      }
      overlayHost.setVisible(ID, true);
      mode = cameraMode();
      draw();
      notify('state');
    },

    async update(_viewer, { signal } = {}) {
      await refresh({ force: true, signal });
      return enabled && !signal?.aborted;
    },

    disable() {
      if (!enabled) return;
      enabled = false;
      lifetime.abort();
      pending?.abort();
      pending = null;
      clearTimeout(poll);
      loading = false;
      pendingAsk = false;
      selected = hover = placeFilter = null;
      handler?.destroy();
      handler = null;
      removeFrame?.();
      removeFrame = null;
      picking.unregisterPickOwner?.(ID);
      overlayHost.clearSource(ID);
      overlayHost.setVisible(ID, false);
      context.clearSelectedEntityContextForLayer?.(ID);
      context.removeEntityContextsForLayer?.(ID);
      if (dataSource) dataSource.show = false;
      notify('state');
    },

    destroy() {
      layer.disable();
      destroyed = true;
      if (dataSource) viewer.dataSources.remove(dataSource, true);
      viewer = dataSource = null;
      listeners.clear();
      entries.clear();
      snapshot = empty;
      runRecord = runChoice = null;
    },

    getSnapshot() {
      return {
        ...snapshot,
        enabled,
        loading,
        error,
        searches: displayed(),
        asOf: localSearchDay(runRecord?.run?.finishedAt) ?? shownDay,
        selectedRun: runChoice,
        selected,
        placeFilter,
        groupFilters: { ...groupFilters },
      };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    refresh: () => refresh({ force: true }),

    setDay(asOf) {
      day = asOf || null;
      runChoice = runRecord = null;
      return changeView();
    },

    async setRun(searchId, runId) {
      runChoice = runId ? { searchId, runId } : null;
      runRecord = null;
      return changeView();
    },

    setGroup(searchId, groupId) {
      if (groupId) groupFilters[searchId] = groupId;
      else delete groupFilters[searchId];
      draw();
      notify('filter');
    },

    selectFinding(searchId, findingId, { focus: fly = true } = {}) {
      const finding = findingById(searchId, findingId);
      if (!finding) return false;
      selected = { searchId, findingId };
      draw();
      const key = selectedKey();
      const entity = entries.get(key)?.entity;
      if (entity) context.selectEntityContext?.(entity);
      else context.clearSelectedEntityContextForLayer?.(ID);
      if (fly && finding.location)
        focus.requestWorldFocus?.({
          kind: 'story',
          id: PREFIX + key,
          label: 'FINDING',
          position: at(finding.location),
        });
      notify('select');
      return true;
    },

    setPlaceFilter(key) {
      const hotspot =
        key &&
        displayed()
          .flatMap((search) => search.findings)
          .find((finding) => finding.hotspot?.key === key)?.hotspot;
      placeFilter = hotspot ? { key, label: hotspot.label } : null;
      notify('filter');
    },

    async ask(question, { agent } = {}) {
      const result = await source.ask(question, {
        agent,
        signal: lifetime?.signal,
      });
      pendingAsk = true;
      await layer.setDay(null);
      return result;
    },

    async action(action, input) {
      const result = await source.action(action, {
        ...input,
        signal: lifetime?.signal,
      });
      if (['retry', 'update'].includes(action)) pendingAsk = true;
      if (action === 'delete' && runChoice?.searchId === input.id)
        runRecord = runChoice = null;
      await layer.refresh();
      return result;
    },

    getRun(id, runId) {
      return source.getRun(id, runId, { signal: lifetime?.signal });
    },
    getChanges(id, from, to) {
      return source.getChanges(id, from, to, { signal: lifetime?.signal });
    },

    waitForRun(searchId, { signal } = {}) {
      return new Promise((resolve, reject) => {
        let lookingUp = false;
        const settle = (search, reason) => {
          unsubscribe();
          signal?.removeEventListener('abort', onAbort);
          if (reason) reject(reason);
          else if (search?.status === 'ready' && search.run?.status === 'ok')
            resolve(search);
          else
            reject(
              new Error(
                search?.error?.message ||
                  search?.error ||
                  'Search did not finish',
              ),
            );
        };
        const onAbort = () => settle(null, signal.reason);
        const check = (state) => {
          if (!state.enabled) return settle(null);
          const search = state.asOf
            ? null
            : state.searches.find((item) => item.id === searchId);
          if (search && search.status !== 'running') return settle(search);
          if (
            lookingUp ||
            search ||
            pendingAsk ||
            state.loading ||
            state.agents.claude?.busy !== false
          )
            return;
          // A past view can omit the new run. Read Now once after the agent stops.
          lookingUp = true;
          const signals = [lifetime.signal, ...(signal ? [signal] : [])];
          source.getSnapshot({ signal: AbortSignal.any(signals) }).then(
            (current) =>
              settle(current.searches.find((item) => item.id === searchId)),
            (reason) => settle(null, reason),
          );
        };
        const unsubscribe = layer.subscribe(check);
        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort, { once: true });
        check(layer.getSnapshot());
      });
    },

    getAnalystRecords(limit = 500) {
      if (!enabled) return [];
      return displayed()
        .flatMap((search) =>
          search.findings.map((finding) => ({
            id: `${search.id}:${finding.id}`,
            title: finding.title,
            kind: finding.kind,
            searchLabel: search.label,
            place: finding.location?.name ?? finding.place?.name,
            actor: finding.actor,
            verification: finding.verification,
            eventAt: Date.parse(finding.eventAt || '') || null,
            summary: finding.summary,
            lat: finding.location?.lat ?? null,
            lon: finding.location?.lon ?? null,
          })),
        )
        .slice(0, limit);
    },

    getStats() {
      return { count: entries.size };
    },
  };

  return layer;
}
