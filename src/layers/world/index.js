import * as Cesium from 'cesium';
import { loadCountryShapes } from '../../data/adminBoundaries.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { createWorldGeometry } from './geometry.js';
import { baseWorldLenses, worldLensColor } from './lensRegistry.js';
import { boardMapMode, worldPickId } from './model.js';
import { worldCardPick, worldPhases } from './phaseRegistry.js';

const lenses = [
  ...baseWorldLenses,
  ...worldPhases.flatMap((phase) => phase.lenses ?? []),
].sort((a, b) => a.order - b.order);
const lensById = new Map(
  lenses.map((definition) => [definition.id, definition]),
);
const overlayFactories = worldPhases.flatMap((phase) => phase.overlays ?? []);

const ID = 'world';
const POLL_MS = 1000;
const MAX_POLL_MS = 30_000;
const FADE_MS = 240;
const EMPTY = {
  asOf: null,
  indicators: [],
  sources: [],
  countries: {},
  countryIndex: [],
  turn: null,
};

export function createWorldLayer({
  source,
  services: { picking = {}, render = {} } = {},
} = {}) {
  const listeners = new Set();
  let viewer;
  let handler;
  let removeFrame;
  let geometry;
  let lifecycle;
  let pending;
  let poll;
  let pollDelay = POLL_MS;
  let snapshot = EMPTY;
  let progress = null;
  let loading = false;
  let error = null;
  let lens = 'condition';
  let area = 'S1';
  let selected = null;
  let card = null;
  let hovered = null;
  let hoverAt = 0;
  let mode = 'detail';
  let opacity = 0;
  let fade = null;
  let needsPaint = false;
  let geometryReady = false;
  let borderReady = false;
  let overlays = [];
  let overlaysDirty = true;

  function notify() {
    for (const listener of listeners) listener();
  }

  function requestRender() {
    render.governorRequestRender?.(ID);
    viewer?.scene.requestRender();
  }

  function clearHover() {
    if (!hovered) return;
    hovered = null;
    geometry?.outline(selected, null, opacity);
    notify();
    requestRender();
  }

  function paint() {
    if (!geometry) return;
    const context = { ...snapshot, lens, area, selected };
    const definition = lensById.get(lens);
    geometry.paint({
      colorFor: (iso3) =>
        worldLensColor(definition, snapshot.countries[iso3], context),
      opacity,
    });
    geometry.outline(selected, hovered?.iso3 ?? null, opacity);
    needsPaint = false;
  }

  function context() {
    return {
      ...snapshot,
      progress,
      lens,
      area,
      selected,
      card,
      visible: mode === 'board' && geometryReady,
    };
  }

  function select(iso3) {
    selected = iso3;
    card = null;
    needsPaint = overlaysDirty = true;
    requestRender();
    notify();
  }

  function openCard(type, id) {
    card = { type, id };
    notify();
  }

  function frame() {
    if (!geometry) return;
    const camera = viewer.camera;
    const next = boardMapMode(camera.positionCartographic?.height, mode);
    const at = performance.now();
    if (next !== mode) {
      mode = next;
      overlaysDirty = true;
      fade = { at, from: opacity, to: mode === 'board' ? 1 : 0 };
      if (mode === 'detail') clearHover();
      notify();
    }
    if (fade) {
      const progress = Math.min(1, (at - fade.at) / FADE_MS);
      opacity = fade.from + (fade.to - fade.from) * progress;
      needsPaint = true;
      if (progress === 1) fade = null;
      else requestRender();
    }
    if (!geometryReady && geometry.ready) {
      geometryReady = true;
      needsPaint = overlaysDirty = true;
      notify();
    }
    if (!borderReady && geometry.borderReady) {
      borderReady = true;
      needsPaint = true;
    }
    if (needsPaint) paint();
    if (overlaysDirty) {
      const state = context();
      for (const overlay of overlays) overlay.update(state);
      overlaysDirty = false;
    }
    geometry.cullLabels(camera);
    for (const overlay of overlays) overlay.frame?.(camera);
  }

  function pickAt(position) {
    const picked = viewer.scene.pick(position, 1, 1);
    return picking.resolvePickId?.(picked) ?? picked?.id;
  }

  function countryAt(id) {
    const iso3 = worldPickId(id);
    return iso3 && Object.hasOwn(snapshot.countries, iso3) ? iso3 : null;
  }

  function installHandlers() {
    const canvas = viewer.scene.canvas;
    handler = new Cesium.ScreenSpaceEventHandler(canvas);
    handler.setInputAction(({ position }) => {
      if (!geometryReady || !isPointerFree()) return;
      const id = pickAt(position);
      const hit = worldCardPick(id);
      if (hit && (mode !== 'board' || !hit.countryFirst))
        return openCard(hit.type, hit.id);
      if (mode !== 'board') return;
      const iso3 = hit?.countryFirst
        ? viewer.scene
            .drillPick(position, undefined, 1, 1)
            .map((picked) =>
              countryAt(picking.resolvePickId?.(picked) ?? picked?.id),
            )
            .find(Boolean)
        : countryAt(id);
      if (iso3 && (selected !== iso3 || card)) select(iso3);
      else if (hit && !iso3) openCard(hit.type, hit.id);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(({ endPosition }) => {
      if (mode !== 'board' || !geometryReady || !isPointerFree()) {
        clearHover();
        return;
      }
      const at = performance.now();
      if (at - hoverAt < 45) return;
      hoverAt = at;
      const iso3 = countryAt(pickAt(endPosition));
      if (!iso3) {
        clearHover();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      hovered = {
        iso3,
        x: rect.left + endPosition.x,
        y: rect.top + endPosition.y,
      };
      geometry.outline(selected, iso3, opacity);
      requestRender();
      notify();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    canvas.addEventListener('pointerleave', clearHover, {
      signal: lifecycle.signal,
    });
    picking.registerPickOwner?.(ID, (id) =>
      Boolean(worldPickId(id) || worldCardPick(id)),
    );
    removeFrame = viewer.scene.preRender.addEventListener(frame);
  }

  async function load(method, parent, sourceId) {
    if (!lifecycle || !source) return;
    if (pending) {
      if (method !== 'refresh' || loading || progress) return;
      // An explicit Refresh can replace the final board read from the last turn.
      pending.abort();
    }
    const controller = new AbortController();
    pending = controller;
    const signals = [controller.signal, lifecycle.signal];
    if (parent) signals.push(parent);
    const signal = AbortSignal.any(signals);
    clearTimeout(poll);
    loading = method !== 'getProgress';
    if (loading) {
      error = null;
      notify();
    }
    let nextDelay = POLL_MS;
    let retry = false;
    try {
      if (method !== 'getSnapshot') {
        const status = await source[method]({ signal, sourceId });
        signal.throwIfAborted();
        progress = status.refresh;
        error = status.error ?? null;
        if (
          method === 'refresh'
            ? progress
            : progress && status.revision === snapshot.revision
        ) {
          pollDelay = POLL_MS;
          return;
        }
        if (method === 'getProgress') notify();
      }
      signal.throwIfAborted();
      const next = await source.getSnapshot({ signal });
      signal.throwIfAborted();
      snapshot = next;
      pollDelay = POLL_MS;
      progress = next.progress ?? null;
      error = next.error ?? null;
      source.invalidateDetails?.();
      if (!geometry && snapshot.countryIndex.length) {
        const shapes = await loadCountryShapes();
        signal.throwIfAborted();
        geometry = createWorldGeometry(
          viewer.scene,
          shapes,
          snapshot.countryIndex,
        );
      }
      needsPaint = overlaysDirty = true;
      requestRender();
    } catch (failure) {
      if (!signal.aborted) {
        error = failure.message;
        if (method === 'getProgress') {
          retry = true;
          nextDelay = pollDelay;
          pollDelay = Math.min(pollDelay * 2, MAX_POLL_MS);
        }
      }
    } finally {
      if (pending === controller) {
        pending = null;
        loading = false;
        if (lifecycle && !signal.aborted) {
          if (progress || retry) {
            poll = setTimeout(() => load('getProgress'), nextDelay);
          }
          notify();
        }
      }
    }
  }

  return {
    id: ID,
    name: 'World Board',
    icon: '◈',
    source: 'World Bank · IMF · UCDP · V-Dem',
    updateInterval: 0,

    init(nextViewer) {
      viewer = nextViewer;
    },

    enable() {
      if (lifecycle) return;
      lifecycle = new AbortController();
      mode = boardMapMode(viewer.camera.positionCartographic?.height, 'detail');
      opacity = mode === 'board' ? 1 : 0;
      geometry?.setActive(true);
      overlays = overlayFactories.map((create) =>
        create({
          viewer,
          signal: lifecycle.signal,
          requestRender,
          getDetail: (country, lens, options) =>
            source.getDetail(country, lens, options),
          labelPoint: (iso3) => geometry?.labelPoint(iso3),
          fixtures: new URLSearchParams(globalThis.location?.search).has(
            'world-fixtures',
          ),
          refresh: (sourceId) => load('refresh', undefined, sourceId),
        }),
      );
      needsPaint = overlaysDirty = true;
      installHandlers();
      notify();
      requestRender();
    },

    async update(_viewer, { signal } = {}) {
      await load('getSnapshot', signal);
    },

    disable() {
      if (!lifecycle) return;
      lifecycle.abort();
      lifecycle = null;
      pending = null;
      clearTimeout(poll);
      progress = null;
      loading = false;
      pollDelay = POLL_MS;
      handler?.destroy();
      handler = null;
      removeFrame?.();
      removeFrame = null;
      picking.unregisterPickOwner?.(ID);
      for (const overlay of overlays) overlay.destroy();
      overlays = [];
      selected = hovered = card = null;
      error = fade = null;
      geometry?.outline(null, null, 0);
      geometry?.setActive(false);
      requestRender();
      notify();
    },

    destroy() {
      this.disable();
      geometry?.destroy();
      geometry = viewer = null;
      listeners.clear();
    },

    getSnapshot() {
      return {
        ...context(),
        enabled: lifecycle !== undefined && lifecycle !== null,
        loading,
        visible: Boolean(lifecycle) && mode === 'board' && geometryReady,
        error,
        lenses,
        hovered,
      };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setLens(next, slot = area) {
      if (!lensById.has(next) || !/^S(?:[1-9]|1[0-2])$/.test(slot)) return;
      if (lens === next && area === slot) return;
      lens = next;
      area = slot;
      overlaysDirty = true;
      if (geometryReady && lifecycle) paint();
      else needsPaint = true;
      requestRender();
      notify();
    },

    refresh() {
      return load('refresh');
    },

    getDetail(country, lens, options) {
      return source.getDetail(country, lens, options);
    },

    clearSelection() {
      if (selected || card) select(null);
    },

    openCard,

    closeCard() {
      card = null;
      notify();
    },
  };
}
