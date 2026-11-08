import * as Cesium from 'cesium';
import { loadCountryShapes } from '../../data/adminBoundaries.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { createWorldGeometry } from './geometry.js';
import { boardMapMode, worldPickId } from './model.js';

const ID = 'world';
const POLL_MS = 1000;
const FADE_MS = 240;
const EMPTY = {
  asOf: null,
  indicators: [],
  sources: [],
  countries: {},
  countryIndex: [],
  turn: null,
  progress: null,
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
  let snapshot = EMPTY;
  let error = null;
  let lens = 'condition';
  let area = 'S1';
  let selected = null;
  let hovered = null;
  let hoverAt = 0;
  let mode = 'detail';
  let opacity = 0;
  let fade = null;
  let needsPaint = false;
  let geometryReady = false;
  let borderReady = false;

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
    const year =
      Number(snapshot.asOf?.slice(0, 4)) || new Date().getUTCFullYear();
    geometry.paint({
      countries: snapshot.countries,
      lens,
      area,
      year,
      opacity,
    });
    geometry.outline(selected, hovered?.iso3 ?? null, opacity);
    needsPaint = false;
  }

  function frame() {
    if (!geometry) return;
    const camera = viewer.camera;
    const next = boardMapMode(camera.positionCartographic?.height, mode);
    const at = performance.now();
    if (next !== mode) {
      mode = next;
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
      needsPaint = true;
      notify();
    }
    if (!borderReady && geometry.borderReady) {
      borderReady = true;
      needsPaint = true;
    }
    if (needsPaint) paint();
    geometry.cullLabels(camera);
  }

  function countryAt(position) {
    const picked = viewer.scene.pick(position, 1, 1);
    const id = picking.resolvePickId?.(picked) ?? picked?.id;
    const iso3 = worldPickId(id);
    return iso3 && Object.hasOwn(snapshot.countries, iso3) ? iso3 : null;
  }

  function installHandlers() {
    const canvas = viewer.scene.canvas;
    handler = new Cesium.ScreenSpaceEventHandler(canvas);
    handler.setInputAction(({ position }) => {
      if (mode !== 'board' || !geometryReady || !isPointerFree()) return;
      const iso3 = countryAt(position);
      if (!iso3 || selected === iso3) return;
      selected = iso3;
      geometry.outline(selected, hovered?.iso3 ?? null, opacity);
      requestRender();
      notify();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(({ endPosition }) => {
      if (mode !== 'board' || !geometryReady || !isPointerFree()) {
        clearHover();
        return;
      }
      const at = performance.now();
      if (at - hoverAt < 45) return;
      hoverAt = at;
      const iso3 = countryAt(endPosition);
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
    picking.registerPickOwner?.(ID, (id) => worldPickId(id) !== null);
    removeFrame = viewer.scene.preRender.addEventListener(frame);
  }

  async function load(method, parent) {
    if (!lifecycle || !source || pending) return;
    const controller = new AbortController();
    pending = controller;
    const signals = [controller.signal, lifecycle.signal];
    if (parent) signals.push(parent);
    const signal = AbortSignal.any(signals);
    clearTimeout(poll);
    error = null;
    notify();
    try {
      const next = await source[method]({ signal });
      signal.throwIfAborted();
      snapshot = next;
      if (!geometry && snapshot.countryIndex.length) {
        const shapes = await loadCountryShapes();
        signal.throwIfAborted();
        geometry = createWorldGeometry(
          viewer.scene,
          shapes,
          snapshot.countryIndex,
        );
      }
      needsPaint = true;
      requestRender();
    } catch (failure) {
      if (!signal.aborted) error = failure.message;
    } finally {
      if (pending === controller) {
        pending = null;
        if (lifecycle && !signal.aborted) {
          if (!error && snapshot.progress) {
            poll = setTimeout(() => load('getSnapshot'), POLL_MS);
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
      needsPaint = true;
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
      handler?.destroy();
      handler = null;
      removeFrame?.();
      removeFrame = null;
      picking.unregisterPickOwner?.(ID);
      selected = hovered = null;
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
        ...snapshot,
        enabled: lifecycle !== undefined && lifecycle !== null,
        loading: Boolean(pending),
        visible: Boolean(lifecycle) && mode === 'board' && geometryReady,
        error: error || snapshot.error || null,
        lens,
        area,
        selected,
        hovered,
      };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setLens(next, slot = area) {
      if (
        !['condition', 'strength', 'data-age'].includes(next) ||
        !/^S(?:[1-9]|1[0-2])$/.test(slot)
      )
        return;
      if (lens === next && area === slot) return;
      lens = next;
      area = slot;
      if (geometryReady && lifecycle) paint();
      else needsPaint = true;
      requestRender();
      notify();
    },

    refresh() {
      return load('refresh');
    },

    clearSelection() {
      if (!selected) return;
      selected = null;
      geometry?.outline(null, hovered?.iso3 ?? null, opacity);
      requestRender();
      notify();
    },
  };
}
