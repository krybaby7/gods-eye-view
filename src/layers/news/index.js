import * as Cesium from 'cesium';
import { isPointerFree } from '../../data/inputOwnership.js';
import {
  filterNewsStories,
  filterStoriesByActor,
  formatBriefOutcome,
  formatDigestOutcome,
  isNewSince,
  isPinnedStory,
  mapNewsAnalystRecord,
  newsCategoryColor,
  normalizeHiddenCategories,
} from './records.js';
import {
  NEWS_OVERLAY_COHORT_LIMIT,
  NEWS_OVERLAY_SOURCE_ID,
  buildNewsHotspotCard,
  buildNewsStoryCard,
  newsHotspotImage,
  newsMarkerImage,
  newsMarkerStyle,
} from './model.js';
import {
  buildHotspots,
  hotspotMarkerStyle,
  hotspotRadiusM,
  nextMapMode,
} from './hotspots.js';
export * from './records.js';
export * from './model.js';
export * from './hotspots.js';
export { createNewsSource } from './source.js';

const HOVER_THROTTLE_MS = 90;

/** "4m", "2h", "3d" — digest age for the HUD line. */
function formatAge(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/**
 * Frame theater's centre longitude. Within half the globe: the midpoint of
 * the shortest span covering every pin (the plain midpoint for one region;
 * pins either side of the antimeridian frame the Pacific, not the far
 * side). Pins all round the world (World): their average longitude, so the
 * frame faces the side of the globe that holds most of them.
 */
function frameCentreLon(lons) {
  const sorted = [...lons].sort((a, b) => a - b);
  let gap = sorted[0] + 360 - sorted.at(-1);
  let start = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > gap) {
      gap = sorted[i] - sorted[i - 1];
      start = sorted[i];
    }
  }
  const rad = Math.PI / 180;
  const x = lons.reduce((sum, lon) => sum + Math.cos(lon * rad), 0);
  const y = lons.reduce((sum, lon) => sum + Math.sin(lon * rad), 0);
  // An even spread has no average; it keeps the span midpoint.
  if (360 - gap > 180 && Math.hypot(x, y) > lons.length * 0.05)
    return Math.atan2(y, x) / rad;
  const centre = start + (360 - gap) / 2;
  return centre > 180 ? centre - 360 : centre;
}
const ENTITY_PREFIX = 'news:';
const HOTSPOT_PREFIX = `${ENTITY_PREFIX}hotspot:`;

/**
 * War monitor layer: one pin per located event story, never per item.
 * Stories without a location, and developments, are list-only and counted.
 * Category toggles and the Situation Brief's actor filter narrow the pins
 * and the Situation panel's stories together; the actor filter is a passing
 * view, not a share-link parameter. With the camera high, the pins give way
 * to one bubble per hotspot (the hotspot view); clicking a bubble flies
 * there and filters the panel's Stories list to that place.
 *
 * @param {{
 *   source: {getSnapshot: Function, requestDigest: Function},
 *   overlayHost: {setEntries: Function, setVisible: Function, clearSource: Function, hitTest?: Function},
 *   services?: {context?: object, picking?: object, focus?: object, render?: object},
 *   screenSpaceEventHandlerFactory?: (viewer: object) => object,
 *   now?: () => number,
 * }} options
 */
export function createNewsLayer({
  source,
  overlayHost,
  services = {},
  screenSpaceEventHandlerFactory = (viewer) =>
    new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas),
  now = Date.now,
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('News requires a snapshot source');
  if (!overlayHost) throw new TypeError('News requires an overlay host');
  const context = services.context || {};
  const picking = services.picking || {};
  const focus = services.focus || {};

  let _viewer = null;
  let _dataSource = null;
  let _enabled = false;
  let _destroyed = false;
  let _request = null;
  let _snapshot = null;
  let _hidden = new Set();
  let _theaterId = null;
  let _selectedId = null;
  let _hoverId = null;
  let _loading = false;
  let _error = null;
  let _lastUpdate = null;
  let _digestRunning = null;
  let _digestOutcome = null;
  let _briefRunning = null;
  let _actorId = null;
  let _newSinceMs = null;
  // 'pins' or 'bubbles': the data source holds one or the other.
  let _mode = 'pins';
  let _hoverHotspot = null;
  // {key, label}: narrows the panel's Stories list only, never the map.
  let _placeFilter = null;
  let _handler = null;
  let _lastHoverAt = 0;
  let _removeCull = null;
  let _lastCullCamera = null;
  let _contextIds = new Set();
  let _dataManager = null;
  let _rowListener = null;
  const _entities = new Map();
  const _bubbles = new Map();
  const _listeners = new Set();

  function notify(reason = 'state') {
    if (_destroyed) return;
    const snapshot = _listeners.size ? layer.getSnapshot() : null;
    for (const listener of [..._listeners]) {
      try {
        listener(snapshot, reason);
      } catch (error) {
        console.warn('[Data:News] listener failed:', error);
      }
    }
    if (reason === 'state' || reason === 'filter') _rowListener?.();
  }

  function categories() {
    return _snapshot?.theater.categories || [];
  }

  function categoryLabel(id) {
    return categories().find((category) => category.id === id)?.label || id;
  }

  function openStories() {
    return (_snapshot?.stories || []).filter(
      (story) => story.status === 'open',
    );
  }

  function visibleStories() {
    return filterStoriesByActor(
      filterNewsStories(openStories(), _hidden),
      _actorId,
    );
  }

  function isVisible(story) {
    return (
      !_hidden.has(story.category) &&
      (!_actorId || (story.actorIds || []).includes(_actorId))
    );
  }

  function storyById(id) {
    return (_snapshot?.stories || []).find((story) => story.id === id) || null;
  }

  function positionOf(story) {
    return Cesium.Cartesian3.fromDegrees(
      story.location.lon,
      story.location.lat,
    );
  }

  function currentHotspots() {
    return buildHotspots(visibleStories(), categories(), {
      newSinceMs: _newSinceMs,
      selectedId: _selectedId,
    });
  }

  function cameraHeight() {
    return _viewer?.camera?.positionCartographic?.height;
  }

  function requestRender() {
    services.render?.governorRequestRender?.('news');
    _viewer?.scene?.requestRender?.();
  }

  /** Rebuild the map: pins or bubbles, never both. */
  function renderPins() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    _entities.clear();
    _bubbles.clear();
    if (_mode === 'bubbles') renderBubbles();
    else renderStoryPins();
    _lastCullCamera = null;
    cullBehindHorizon();
    requestRender();
  }

  /** One pin per visible, located story. */
  function renderStoryPins() {
    for (const story of visibleStories()) {
      if (!isPinnedStory(story)) continue;
      const color = newsCategoryColor(story.category, categories());
      const entity = new Cesium.Entity({
        id: `${ENTITY_PREFIX}${story.id}`,
        position: positionOf(story),
        billboard: {
          image: newsMarkerImage(
            newsMarkerStyle(
              story,
              color,
              story.id === _selectedId,
              isNewSince(story, _newSinceMs),
            ),
          ),
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          storyId: story.id,
          category: story.category,
          verification: story.verification,
          sourceCount: story.sourceCount,
        },
      });
      entity.gevNewsStoryId = story.id;
      _dataSource.entities.add(entity);
      _entities.set(story.id, entity);
    }
  }

  /** One bubble per hotspot holding a visible pinned story. */
  function renderBubbles() {
    for (const bubble of currentHotspots()) {
      const entity = new Cesium.Entity({
        id: `${HOTSPOT_PREFIX}${bubble.key}`,
        position: Cesium.Cartesian3.fromDegrees(bubble.lon, bubble.lat),
        billboard: {
          image: newsHotspotImage(hotspotMarkerStyle(bubble)),
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { hotspotKey: bubble.key, storyCount: bubble.count },
      });
      entity.gevNewsHotspotKey = bubble.key;
      _dataSource.entities.add(entity);
      _bubbles.set(bubble.key, entity);
    }
  }

  /**
   * Bubbles above one camera height, pins below another; in between the
   * mode stays. Rebuilds the map only when the mode changes.
   */
  function updateMode() {
    const next = nextMapMode(_mode, cameraHeight());
    if (next === _mode) return;
    _mode = next;
    _hoverId = null;
    _hoverHotspot = null;
    if (_enabled) {
      renderPins();
      renderCards();
      registerContexts();
    }
    notify('state');
  }

  /** Each frame: the mode check, then the horizon cull (which returns early when the camera has not moved). */
  function onPreRender() {
    updateMode();
    cullBehindHorizon();
  }

  /**
   * Pins draw over terrain (no depth test), so the far side of the globe is
   * hidden explicitly. Re-evaluated only when the camera moved.
   */
  function cullBehindHorizon() {
    const camera = _viewer?.camera;
    const cameraPosition = camera?.positionWC;
    if (!cameraPosition || !(_entities.size || _bubbles.size)) return;
    if (
      _lastCullCamera &&
      Cesium.Cartesian3.equalsEpsilon(cameraPosition, _lastCullCamera, 0, 1)
    )
      return;
    _lastCullCamera = Cesium.Cartesian3.clone(cameraPosition, _lastCullCamera);
    const occluder = new Cesium.EllipsoidalOccluder(
      Cesium.Ellipsoid.WGS84,
      cameraPosition,
    );
    const at = Cesium.JulianDate.now();
    for (const entity of [..._entities.values(), ..._bubbles.values()]) {
      const visible = occluder.isPointVisible(entity.position.getValue(at));
      if (entity.billboard.show?.getValue?.(at) !== visible)
        entity.billboard.show = visible;
    }
  }

  /**
   * Selected and hovered story cards through the overlay host; in bubble
   * mode only the hovered bubble's card.
   */
  function renderCards() {
    if (!_enabled) return;
    const entries = [];
    const bubble =
      _mode === 'bubbles' && _hoverHotspot
        ? currentHotspots().find((entry) => entry.key === _hoverHotspot)
        : null;
    if (bubble)
      entries.push({
        ...buildNewsHotspotCard(bubble, {
          position: Cesium.Cartesian3.fromDegrees(bubble.lon, bubble.lat),
          color: bubble.topColor,
          size: hotspotMarkerStyle(bubble).size,
        }),
        activate: () => layer.focusHotspot(bubble.key),
      });
    const storyCards =
      _mode === 'bubbles'
        ? []
        : [
            [_selectedId, true],
            [_hoverId, false],
          ];
    for (const [id, selected] of storyCards) {
      if (!id || (!selected && id === _selectedId)) continue;
      const story = storyById(id);
      if (!isPinnedStory(story) || !isVisible(story)) continue;
      entries.push({
        ...buildNewsStoryCard(story, {
          position: positionOf(story),
          categoryLabel: categoryLabel(story.category),
          color: newsCategoryColor(story.category, categories()),
          selected,
        }),
        activate: () => layer.selectStory(story.id, { focus: true }),
      });
    }
    overlayHost.setEntries(NEWS_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: NEWS_OVERLAY_COHORT_LIMIT,
      collisionCapacity: NEWS_OVERLAY_COHORT_LIMIT,
      moving: false,
    });
  }

  /** Register located stories so voice context can resolve them. */
  function registerContexts() {
    if (typeof context.registerEntityContext !== 'function') return;
    const next = new Set();
    try {
      for (const story of visibleStories()) {
        if (!isPinnedStory(story)) continue;
        const id = `${ENTITY_PREFIX}${story.id}`;
        const entity = _entities.get(story.id);
        if (!entity) continue;
        entity.__localBaseCartesian = positionOf(story);
        context.registerEntityContext(entity, {
          id,
          layerId: 'news',
          layerName: 'War monitor',
          source: 'War monitor digest',
          dataSource: _dataSource,
          label: story.title,
          latitude: story.location.lat,
          longitude: story.location.lon,
          properties: {
            category: categoryLabel(story.category),
            verification: story.verification,
            sources: story.sourceCount,
            place: story.place || 'unknown',
            perspectives: story.perspectives.join(', '),
          },
        });
        next.add(id);
      }
      context.removeEntityContextsForLayer?.('news', { retainIds: next });
    } catch {
      // context store unavailable — pins and cards still work
    }
    _contextIds = next;
  }

  function clearContexts() {
    try {
      context.removeEntityContextsForLayer?.('news', { retainIds: new Set() });
    } catch {
      /* store unavailable */
    }
    _contextIds = new Set();
  }

  function pickedStoryId(picked) {
    const id =
      picked?.id?.gevNewsStoryId ?? picked?.primitive?.id?.gevNewsStoryId;
    return typeof id === 'string' && _entities.has(id) ? id : null;
  }

  function pickedHotspotKey(picked) {
    const key =
      picked?.id?.gevNewsHotspotKey ?? picked?.primitive?.id?.gevNewsHotspotKey;
    return typeof key === 'string' && _bubbles.has(key) ? key : null;
  }

  function installHandlers() {
    if (_handler || !_viewer) return;
    _handler = screenSpaceEventHandlerFactory(_viewer);
    _handler.setInputAction((click) => {
      if (!isPointerFree()) return;
      const picked = _viewer.scene.pick(click.position);
      const key = pickedHotspotKey(picked);
      if (key) {
        layer.focusHotspot(key);
        return;
      }
      const id = pickedStoryId(picked);
      if (id) {
        layer.selectStory(id, { focus: true });
        return;
      }
      if (picked) {
        const pickedId = picking.resolvePickId?.(picked);
        if (pickedId && picking.isOwnedByOtherLayer?.('news', pickedId)) return;
      }
      const cardHit = overlayHost.hitTest?.(
        click.position?.x,
        click.position?.y,
        {
          sourceId: NEWS_OVERLAY_SOURCE_ID,
        },
      );
      if (cardHit?.entryId?.startsWith('hotspot:')) {
        layer.focusHotspot(cardHit.entryId.slice('hotspot:'.length));
        return;
      }
      if (cardHit?.entryId?.startsWith('story:')) {
        layer.selectStory(cardHit.entryId.slice('story:'.length), {
          focus: true,
        });
        return;
      }
      layer.clearSelection();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    _handler.setInputAction((movement) => {
      const at = now();
      if (at - _lastHoverAt < HOVER_THROTTLE_MS) return;
      _lastHoverAt = at;
      const picked = _viewer?.scene.pick(movement.endPosition);
      const key = pickedHotspotKey(picked);
      const id = key ? null : pickedStoryId(picked);
      if (id === _hoverId && key === _hoverHotspot) return;
      _hoverId = id;
      _hoverHotspot = key;
      renderCards();
      requestRender();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    picking.registerPickOwner?.(
      'news',
      (pickedId) =>
        typeof pickedId === 'string' && pickedId.startsWith(ENTITY_PREFIX),
    );
    const scene = _viewer.scene;
    if (scene?.preRender?.addEventListener)
      _removeCull = scene.preRender.addEventListener(onPreRender);
  }

  function removeHandlers() {
    _handler?.destroy?.();
    _handler = null;
    _removeCull?.();
    _removeCull = null;
    picking.unregisterPickOwner?.('news');
  }

  function applySnapshot(snapshot) {
    _snapshot = snapshot;
    _theaterId ??= snapshot.theater.id;
    if (_selectedId && !storyById(_selectedId)) _selectedId = null;
    if (_hoverId && !storyById(_hoverId)) _hoverId = null;
    if (_enabled) {
      _mode = nextMapMode(_mode, cameraHeight());
      renderPins();
      renderCards();
      registerContexts();
    }
  }

  function applyFilter() {
    if (_enabled) {
      renderPins();
      renderCards();
      registerContexts();
    }
    notify('filter');
  }

  /** Publish a direct filter change so durable and share state follow it. */
  function publishFilter() {
    try {
      _dataManager?.adoptLayerParams?.(
        layer.id,
        { hiddenCategories: [..._hidden].sort().join(',') },
        { origin: 'user' },
      );
    } catch (error) {
      console.warn('[Data:News] publish failed:', error);
    }
  }

  async function fetchSnapshot({ force = false } = {}) {
    _request?.abort();
    const request = new AbortController();
    _request = request;
    _loading = true;
    notify('loading');
    try {
      const result = await source.getSnapshot({
        signal: request.signal,
        theater: _theaterId || undefined,
        rev: force ? undefined : _snapshot?.revision || undefined,
      });
      if (request.signal.aborted || _request !== request || _destroyed)
        return null;
      if (!result.unchanged) applySnapshot(result);
      _lastUpdate = now();
      _error = null;
      return true;
    } catch (error) {
      if (request.signal.aborted || _request !== request || _destroyed)
        return null;
      console.warn('[Data:News] fetch error:', error?.message || error);
      _error = error?.message || 'News provider unavailable';
      return false;
    } finally {
      if (_request === request) {
        _request = null;
        _loading = false;
        notify('state');
      }
    }
  }

  const layer = {
    id: 'news',
    name: 'War Monitor',
    icon: '◉',
    source: 'Source directory · Perplexity digest',
    requiresKeyId: 'perplexity',
    updateInterval: 60_000,

    init(viewer) {
      if (_viewer) throw new Error('News layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('news');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      overlayHost.setVisible(NEWS_OVERLAY_SOURCE_ID, false);
    },

    enable(viewer) {
      _enabled = true;
      if (viewer && !_viewer) this.init(viewer);
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(NEWS_OVERLAY_SOURCE_ID, true);
      installHandlers();
      _mode = nextMapMode(_mode, cameraHeight());
      if (_snapshot) applySnapshot(_snapshot);
      notify('state');
    },

    disable() {
      _request?.abort();
      _request = null;
      _loading = false;
      _enabled = false;
      _hoverId = null;
      _hoverHotspot = null;
      _selectedId = null;
      _placeFilter = null;
      if (_dataSource) _dataSource.show = false;
      removeHandlers();
      overlayHost.clearSource(NEWS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(NEWS_OVERLAY_SOURCE_ID, false);
      context.clearSelectedEntityContextForLayer?.('news');
      clearContexts();
      notify('state');
    },

    async update() {
      if (!_enabled || _destroyed) return false;
      const ok = await fetchSnapshot();
      // Replaced by a newer reload (Refresh, theater switch): that one reports.
      if (ok === null) return _enabled && !_destroyed;
      return ok;
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _destroyed = true;
      _enabled = false;
      removeHandlers();
      overlayHost.clearSource(NEWS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(NEWS_OVERLAY_SOURCE_ID, false);
      clearContexts();
      if (_dataSource && viewer) viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
      _entities.clear();
      _bubbles.clear();
      _listeners.clear();
      _rowListener = null;
      _dataManager = null;
      _snapshot = null;
    },

    attachDataManager(manager) {
      _dataManager = manager || null;
    },

    /** Share/durable option: the comma-separated hidden category ids. */
    setParams(params = {}) {
      if (!Object.hasOwn(params, 'hiddenCategories')) return true;
      const next = normalizeHiddenCategories(params.hiddenCategories);
      const current = [..._hidden].sort().join(',');
      if (next === current) return true;
      _hidden = new Set(next ? next.split(',') : []);
      applyFilter();
      return true;
    },

    getParams() {
      return { hiddenCategories: [..._hidden].sort().join(',') };
    },

    /**
     * Show only these categories (the panel's chips call this).
     * @param {string[]} visibleIds
     */
    setCategoryFilter(visibleIds) {
      const visible = new Set(Array.isArray(visibleIds) ? visibleIds : []);
      const all = categories().map((category) => category.id);
      _hidden = new Set(all.filter((id) => !visible.has(id)));
      applyFilter();
      publishFilter();
    },

    /** Toggle one category on or off. */
    toggleCategory(categoryId) {
      if (_hidden.has(categoryId)) _hidden.delete(categoryId);
      else _hidden.add(categoryId);
      applyFilter();
      publishFilter();
    },

    /**
     * Show only stories tagged with one theater actor, alongside the
     * category toggles; null (or an unknown actor) clears it. Not a share
     * parameter: it is a passing view from the Situation Brief.
     * @param {?string} actorId
     */
    setActorFilter(actorId) {
      const known = (_snapshot?.theater.actors || []).some(
        (actor) => actor.id === actorId,
      );
      const next = known ? actorId : null;
      if (next === _actorId) return;
      _actorId = next;
      applyFilter();
    },

    /**
     * The viewer's last-seen digest time: stories updated after it get a
     * quiet marker on their pin. The Situation panel owns the stored value.
     * @param {?number} sinceMs
     */
    setNewSince(sinceMs) {
      const next = Number.isFinite(sinceMs) ? sinceMs : null;
      if (next === _newSinceMs) return;
      _newSinceMs = next;
      if (_enabled) renderPins();
      notify('state');
    },

    /**
     * Frame theater: one flight over every visible pin, through the same
     * world-focus request as a story click. False when there is no pin.
     */
    frameTheater() {
      const pinned = visibleStories().filter(isPinnedStory);
      if (!pinned.length || !_enabled) return false;
      const lats = pinned.map((story) => story.location.lat);
      const lons = pinned.map((story) => story.location.lon);
      const centre = Cesium.Cartesian3.fromDegrees(
        frameCentreLon(lons),
        (Math.min(...lats) + Math.max(...lats)) / 2,
      );
      const radiusM = Math.max(
        ...pinned.map((story) =>
          Cesium.Cartesian3.distance(centre, positionOf(story)),
        ),
      );
      focus.requestWorldFocus?.({
        kind: 'theater',
        id: `news-theater:${_theaterId}`,
        label: 'THEATER',
        position: centre,
        radiusM,
      });
      return true;
    },

    /**
     * Click on a bubble: one flight over its visible stories (the `hotspot`
     * framing, capped so it ends low enough for pins) and the place filter
     * on the Stories list. Selects no story. False for an unknown bubble.
     * @param {string} key
     */
    focusHotspot(key) {
      if (!_enabled) return false;
      const bubble = currentHotspots().find((entry) => entry.key === key);
      if (!bubble) return false;
      focus.requestWorldFocus?.({
        kind: 'hotspot',
        id: `${HOTSPOT_PREFIX}${bubble.key}`,
        label: 'HOTSPOT',
        position: Cesium.Cartesian3.fromDegrees(bubble.lon, bubble.lat),
        radiusM: hotspotRadiusM(bubble),
      });
      layer.setPlaceFilter(bubble.key);
      return true;
    },

    /**
     * Narrow the Situation panel's Stories list to one hotspot; null (or a
     * key no story carries) clears it. Pins and bubbles stay unfiltered.
     * Not a share parameter.
     * @param {?string} key
     */
    setPlaceFilter(key) {
      const hotspot = key
        ? (_snapshot?.stories || []).find((story) => story.hotspot?.key === key)
            ?.hotspot
        : null;
      const next = hotspot ? { key: hotspot.key, label: hotspot.label } : null;
      if (next?.key === _placeFilter?.key) return;
      _placeFilter = next;
      notify('filter');
    },

    /** Category chips for the data-panel row. */
    getRowControls() {
      if (!categories().length) return null;
      return {
        chips: categories().map((category) => ({
          id: `category-${category.id}`,
          label: category.label.toUpperCase(),
          active: !_hidden.has(category.id),
          title: _hidden.has(category.id)
            ? `Show ${category.label} stories`
            : `Hide ${category.label} stories`,
          params: {
            hiddenCategories: normalizeHiddenCategories(
              _hidden.has(category.id)
                ? [..._hidden].filter((id) => id !== category.id)
                : [..._hidden, category.id],
            ),
          },
        })),
      };
    },

    setRowControlsListener(listener) {
      _rowListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Select a story: its card, its context record, and (when it has a
     * location and `focus`) one camera flight.
     */
    selectStory(storyId, { focus: fly = true } = {}) {
      const story = storyById(storyId);
      if (!story) return false;
      _selectedId = story.id;
      if (_enabled) {
        renderPins();
        renderCards();
        registerContexts();
        // Select the rebuilt pin; a list-only story has none, so the shared
        // selection must not keep pointing at the previous pin.
        const entity = _entities.get(story.id);
        try {
          if (entity) context.selectEntityContext?.(entity);
          else context.clearSelectedEntityContextForLayer?.('news');
        } catch {
          /* context store unavailable */
        }
        if (fly && isPinnedStory(story))
          focus.requestWorldFocus?.({
            kind: 'story',
            id: `${ENTITY_PREFIX}${story.id}`,
            label: 'STORY',
            position: positionOf(story),
          });
      }
      notify('select');
      return true;
    },

    clearSelection() {
      if (!_selectedId) return;
      _selectedId = null;
      context.clearSelectedEntityContextForLayer?.('news');
      if (_enabled) {
        renderPins();
        renderCards();
        registerContexts();
      }
      notify('select');
    },

    /** Switch theater and reload. */
    async setTheater(theaterId) {
      if (!theaterId || theaterId === _theaterId) return false;
      _theaterId = theaterId;
      _selectedId = null;
      _hoverId = null;
      _hoverHotspot = null;
      _actorId = null;
      _placeFilter = null;
      // The last Refresh outcome describes the other theater.
      _digestOutcome = null;
      return fetchSnapshot({ force: true });
    },

    /** Re-read the snapshot now (the panel's Raw tab, after a digest). */
    refresh() {
      return fetchSnapshot({ force: true });
    },

    /**
     * Run one digest through the provider (Refresh / "refresh news"), then
     * reload the snapshot. Never throws.
     * @returns {Promise<object>} The outcome, with a readable `summary`.
     */
    async requestDigest() {
      if (_digestRunning || _briefRunning)
        return {
          ok: false,
          error: 'in_flight',
          summary: 'A digest is already running.',
        };
      _digestRunning = { startedAt: now() };
      _digestOutcome = null;
      notify('digest');
      let outcome;
      try {
        outcome = await source.requestDigest({
          theater: _theaterId || undefined,
        });
      } catch (error) {
        outcome = {
          ok: false,
          error: 'network',
          message: error?.message || 'News provider unavailable',
        };
      }
      _digestRunning = null;
      if (_destroyed) return outcome;
      await fetchSnapshot({ force: true });
      _digestOutcome = {
        ...outcome,
        at: now(),
        summary: formatDigestOutcome(outcome, _snapshot?.budget),
      };
      notify('digest');
      return _digestOutcome;
    },

    /**
     * Retry brief: rerun the Situation Brief for the latest digest after its
     * brief failed, then reload. Never runs a digest; never throws.
     * @returns {Promise<object>} The outcome, with a readable `summary`.
     */
    async requestBrief() {
      if (_digestRunning || _briefRunning)
        return {
          ok: false,
          error: 'in_flight',
          summary: formatBriefOutcome({ error: 'in_flight' }),
        };
      _briefRunning = { startedAt: now() };
      _digestOutcome = null;
      notify('digest');
      let outcome;
      try {
        outcome = await source.requestBrief({
          theater: _theaterId || undefined,
        });
      } catch (error) {
        outcome = {
          ok: false,
          error: 'network',
          message: error?.message || 'News provider unavailable',
        };
      }
      _briefRunning = null;
      if (_destroyed) return outcome;
      await fetchSnapshot({ force: true });
      _digestOutcome = {
        ...outcome,
        at: now(),
        summary: formatBriefOutcome(outcome),
      };
      notify('digest');
      return _digestOutcome;
    },

    /** Everything the Situation panel renders. */
    getSnapshot() {
      const stories = [...(_snapshot?.stories || [])].sort(
        (a, b) =>
          Number(b.status === 'open') - Number(a.status === 'open') ||
          Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0),
      );
      const server = _snapshot?.digest || null;
      const local = _digestRunning || _briefRunning;
      return {
        enabled: _enabled,
        loading: _loading,
        error: _error,
        lastUpdate: _lastUpdate,
        ready: Boolean(_snapshot),
        theater: _snapshot?.theater || null,
        theaters: _snapshot?.theaters || [],
        categories: categories(),
        hiddenCategories: [..._hidden].sort(),
        actorFilter: _actorId,
        placeFilter: _placeFilter ? { ..._placeFilter } : null,
        mapMode: _mode,
        newSinceMs: _newSinceMs,
        stories,
        // The place filter narrows the panel's list, not the map.
        visibleStories: filterStoriesByActor(
          filterNewsStories(stories, _hidden),
          _actorId,
        ).filter(
          (story) => !_placeFilter || story.hotspot?.key === _placeFilter.key,
        ),
        items: _snapshot?.items || [],
        citations: _snapshot?.citations || [],
        sources: _snapshot?.sources || [],
        budget: _snapshot?.budget || null,
        lastRun: _snapshot?.lastRun || null,
        lastDigest: _snapshot?.lastDigest || null,
        brief: _snapshot?.brief || null,
        briefRun: _snapshot?.briefRun || null,
        briefStatus: _snapshot?.briefStatus || null,
        digest: {
          ...(server || {}),
          running: Boolean(local || server?.running),
          phase: _briefRunning
            ? 'brief'
            : _digestRunning
              ? 'digest'
              : server?.phase || null,
          startedAt: local
            ? new Date(local.startedAt).toISOString()
            : server?.startedAt || null,
          outcome: _digestOutcome,
        },
        selectedStoryId: _selectedId,
      };
    },

    /**
     * @param {(snapshot: object, reason: string) => void} listener
     * @returns {() => void}
     */
    subscribe(listener) {
      _listeners.add(listener);
      return () => _listeners.delete(listener);
    },

    /** Open stories as JSON-safe analyst records (all, located or not). */
    getAnalystRecords(maxCount = 500) {
      if (!_enabled || !_snapshot) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 500;
      return visibleStories()
        .slice(0, limit)
        .map((story, index) => mapNewsAnalystRecord(story, index));
    },

    getStats() {
      const open = openStories();
      const visible = visibleStories();
      const located = visible.filter(isPinnedStory).length;
      const sources = _snapshot?.sources || [];
      const degraded = sources.filter((s) => s.health.degraded).length;
      const lastDigestAt = Date.parse(_snapshot?.lastDigest?.finishedAt || '');
      const budget = _snapshot?.budget || null;
      // The feed loads without a key; only Refresh needs one. Reported apart
      // from `keyRequired`, which the loading status reads as a failed load.
      const keyRequired = Boolean(_snapshot && !_snapshot.digest.keyConfigured);
      let loadingLabel = '';
      if (_loading && !_snapshot) loadingLabel = 'loading...';
      else if (_error) loadingLabel = _error;
      else if (_snapshot)
        loadingLabel = `${open.length} ${open.length === 1 ? 'story' : 'stories'} · ${_snapshot.items.length} items${keyRequired ? ' · digest needs key' : ''}`;
      const summary = !_snapshot
        ? ''
        : [
            `${open.length} ${open.length === 1 ? 'story' : 'stories'}${visible.length - located ? ` (${visible.length - located} list-only)` : ''}`,
            Number.isNaN(lastDigestAt)
              ? 'no digest yet'
              : `digest ${formatAge(now() - lastDigestAt)} ago`,
            degraded
              ? `${degraded} ${degraded === 1 ? 'source' : 'sources'} degraded`
              : null,
            keyRequired
              ? 'digest needs key'
              : budget?.exhausted
                ? 'budget used up'
                : Number.isFinite(budget?.remainingUsd)
                  ? `budget $${budget.remainingUsd.toFixed(2)} left`
                  : null,
          ]
            .filter(Boolean)
            .join(' · ');
      return {
        summary,
        count: located,
        storyCount: open.length,
        visibleStoryCount: visible.length,
        listOnly: visible.length - located,
        itemCount: _snapshot?.items.length ?? 0,
        undigestedCount: _snapshot?.digest.undigestedCount ?? 0,
        lastDigestAt: Number.isNaN(lastDigestAt) ? null : lastDigestAt,
        digestAgeMs: Number.isNaN(lastDigestAt) ? null : now() - lastDigestAt,
        digestRunning: Boolean(_digestRunning || _snapshot?.digest.running),
        degradedSources: degraded,
        budget: budget
          ? {
              dailyUsd: budget.dailyUsd,
              spentTodayUsd: budget.spentTodayUsd,
              remainingUsd: budget.remainingUsd,
              exhausted: budget.exhausted,
            }
          : null,
        digestKeyRequired: keyRequired,
        lastUpdate: _lastUpdate,
        loading: _loading,
        error: _error,
        loadingLabel,
      };
    },

    /** Test seam: pins currently drawn, by story id. */
    _testing: {
      pinIds: () => [..._entities.keys()],
      hotspotKeys: () => [..._bubbles.keys()],
      mapMode: () => _mode,
      contextIds: () => [..._contextIds],
    },
  };
  return layer;
}
