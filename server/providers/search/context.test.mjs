import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSearchContext, nominatimFindingLocation } from './context.js';
import { createDigestStore } from '../news/digest/store.js';

test('search context loads both theater gazetteers and labels registered publishers', async () => {
  const context = await createSearchContext().loadContext();
  assert.ok(context.gazetteer.some((place) => place.name === 'Iran'));
  assert.ok(context.gazetteer.some((place) => place.name === 'Brazil'));
  assert.deepEqual(
    context
      .nameSources([{ domain: 'aljazeera.com' }, { domain: 'test.example' }])
      .map((source) => source.publisher),
    ['Al Jazeera English', 'test.example'],
  );
});

test('Nominatim projection preserves named area precision and rejects invalid coordinates', () => {
  assert.deepEqual(
    nominatimFindingLocation({
      geometry: { location: { lat: 12, lng: 44 } },
      types: ['country'],
      formatted_address: 'A country',
      address_components: [{ long_name: 'Country' }],
    }),
    { lat: 12, lon: 44, name: 'Country', precision: 'country' },
  );
  assert.equal(
    nominatimFindingLocation({ geometry: { location: { lat: 92, lng: 44 } } }),
    null,
  );
});

test('war links use saved citations without writing or running a digest', async (t) => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'gev-search-context-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const { mkdir, writeFile } = await import('node:fs/promises');
  const newsDir = path.join(cacheDir, 'news');
  await mkdir(newsDir);
  const store = createDigestStore({ theaterId: 'world', cacheDir: newsDir });
  await writeFile(
    store.cachePath,
    JSON.stringify({
      version: 1,
      stories: [
        {
          id: 'st_1',
          title: 'Saved story',
          status: 'open',
          updatedAt: new Date().toISOString(),
          itemIds: ['item_1'],
        },
      ],
      citations: [{ id: 'item_1', url: 'https://example.org/article' }],
    }),
  );
  assert.deepEqual(await createSearchContext({ cacheDir }).loadWarStories(), [
    {
      id: 'st_1',
      title: 'Saved story',
      theaterId: 'world',
      urls: ['https://example.org/article'],
    },
  ]);
});

test('a local installation can switch Nominatim endpoints without a code change', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(new URL(url));
    return Response.json([
      {
        lat: '12',
        lon: '44',
        name: 'Fixture City',
        addresstype: 'city',
        display_name: 'Fixture City, Test Country',
      },
    ]);
  });
  const endpoint = 'http://127.0.0.1:17170/search';
  const result = await createSearchContext({
    geocodeEndpoint: endpoint,
  }).geocode('Fixture City', {
    signal: AbortSignal.timeout(1500),
  });
  assert.equal(calls[0]?.origin, 'http://127.0.0.1:17170');
  assert.equal(calls[0]?.searchParams.get('q'), 'Fixture City');
  assert.equal(result.name, 'Fixture City');
});
