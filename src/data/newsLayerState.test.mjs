import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LAYER_STATE_REGISTRY,
  decodeLayerStateParams,
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';

const roundTrip = (state) => {
  const params = new URLSearchParams([['v', '2']]);
  encodeLayerStateParams(params, normalizeLayerState(state));
  return { params, restored: decodeLayerStateParams(params) };
};

test('the news layer owns token 3 and a category-filter option', () => {
  const entry = LAYER_STATE_REGISTRY.find(({ id }) => id === 'news');
  assert.deepEqual(
    { ...entry },
    {
      id: 'news',
      token: '3',
      disposition: 'enabled+options',
      optionOwner: 'news',
    },
  );
});

test('hidden categories round-trip as stable letters', () => {
  const { params, restored } = roundTrip({
    enabledLayerIds: ['news'],
    options: { news: { hiddenCategories: 'environmental,cyber-information' } },
  });
  assert.match(params.get('lo'), /3\.h\.ce/);
  assert.deepEqual(restored.enabledLayerIds, ['news']);
  assert.equal(
    restored.options.news.hiddenCategories,
    'cyber-information,environmental',
  );
});

test('the default (every category shown) is omitted; unknown ids and codes are refused', () => {
  const shown = roundTrip({
    enabledLayerIds: ['news'],
    options: { news: { hiddenCategories: '' } },
  });
  assert.doesNotMatch(shown.params.get('lo') || '', /(^|_)3\./);
  assert.equal(shown.restored.options.news.hiddenCategories, '');
  const unknown = normalizeLayerState({
    enabledLayerIds: ['news'],
    options: { news: { hiddenCategories: 'sports' } },
  });
  assert.equal(unknown.options.news.hiddenCategories, '');
  const tampered = new URLSearchParams([
    ['v', '2'],
    ['l', '3'],
    ['lo', '3.h.zz'],
  ]);
  // An unreadable option value falls back to the default, like other options.
  assert.equal(
    decodeLayerStateParams(tampered).options.news.hiddenCategories,
    '',
  );
});
