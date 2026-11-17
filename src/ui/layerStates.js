import { layerFeedState } from '../data/feedState.js';

/** Short provider names for the state words; the key registry keeps the rest. */
const KEY_NAMES = Object.freeze({
  'google-maps': 'Google Maps',
  'google-maps-server': 'Google Maps',
  openai: 'OpenAI',
  aisstream: 'AISStream',
  firms: 'NASA FIRMS',
  perplexity: 'Perplexity',
  'search-reliefweb': 'ReliefWeb',
  tomtom: 'TomTom',
  'cesium-ion': 'Cesium ion',
  opensky: 'OpenSky',
  mapillary: 'Mapillary',
  'launch-library': 'Launch Library',
});

function sentence(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function keyWords(layer, prefix) {
  const name = KEY_NAMES[String(layer.requiresKeyId || '').trim()];
  if (!name) return `${prefix} a key`;
  return `${prefix} ${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name} key`;
}

function clock(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Plain words for one layer row, from what the lifecycle and the layer report.
 *
 * Nothing is guessed: a layer that has not said it is live reads "On", and a
 * missing key is only named when the layer says which key it needs.
 *
 * @param {object} layer Row from the layer manager's getAll().
 * @returns {{words: string, na: boolean, reason: string}} `na` marks a switch
 *   that cannot work now; `reason` says why, for its title and label.
 */
export function layerStateWords(layer = {}) {
  const stats = layer.stats || {};
  const lifecycle = layer.lifecycleState;
  if (lifecycle === 'enabling')
    return { words: 'Switching on', na: false, reason: '' };
  if (lifecycle === 'disabling')
    return { words: 'Switching off', na: false, reason: '' };
  if (layer.lifecycleUncertain)
    return { words: 'Checking its state', na: false, reason: '' };

  const unavailable = stats.sourceUnavailable === true;
  const keyRequired = stats.keyRequired === true || stats.missingKey === true;
  if (!layer.enabled) {
    if (unavailable) {
      const reason = sentence(stats.error) || 'Its source is not available';
      return { words: 'Not available', na: true, reason };
    }
    if (keyRequired) {
      const words = keyWords(layer, 'Needs');
      return { words, na: true, reason: words };
    }
    if (layer.id === 'searches')
      return { words: 'Asks before it runs', na: false, reason: '' };
    return { words: 'Off', na: false, reason: '' };
  }

  if (unavailable)
    return {
      words: 'Not available',
      na: false,
      reason: sentence(stats.error) || 'Its source is not available',
    };
  if (keyRequired)
    return { words: keyWords(layer, 'Waiting for'), na: false, reason: '' };
  const status = String(stats.status || '').toLowerCase();
  if (status === 'zoom-in')
    return { words: 'Zoom in to see', na: false, reason: '' };
  if (
    (status === 'idle' || status === 'empty') &&
    typeof stats.statusMessage === 'string' &&
    stats.statusMessage.trim()
  )
    return { words: sentence(stats.statusMessage), na: false, reason: '' };

  const feed = layerFeedState(stats);
  if (feed === 'loading') return { words: 'Loading', na: false, reason: '' };
  if (feed === 'fallback')
    return { words: 'Backup feed', na: false, reason: '' };
  if (feed === 'stale') {
    const since = stats.lastUpdate ? clock(stats.lastUpdate) : '';
    return {
      words: since ? `Stale since ${since}` : 'Stale',
      na: false,
      reason: '',
    };
  }
  if (feed === 'degraded')
    return {
      words: 'Having trouble',
      na: false,
      reason: sentence(
        stats.error || stats.lastError || stats.managerRefreshError,
      ),
    };
  if (feed === 'partial')
    return { words: 'Partly loaded', na: false, reason: '' };
  if (feed === 'unavailable')
    return {
      words: 'Not available',
      na: false,
      reason: sentence(
        stats.error || stats.lastError || stats.managerRefreshError,
      ),
    };
  if (stats.lastUpdate || Number(stats.count) > 0)
    return { words: 'Live', na: false, reason: '' };
  return { words: 'On', na: false, reason: '' };
}

/** Rows switched on, counting only layers the menu shows. */
export function countLayersOn(layers, isListed) {
  let count = 0;
  for (const layer of layers) if (layer.enabled && isListed(layer.id)) count++;
  return count;
}
