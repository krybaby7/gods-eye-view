import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('registers each seed indicator with the draft version-one anchors', async () => {
  const { loadWorldRegistry } = await import('./registry.js');
  const { indicators, sources } = await loadWorldRegistry();
  assert.deepEqual(
    indicators.map(({ slot }) => slot),
    [
      ...Array.from({ length: 12 }, (_, i) => `S${i + 1}`),
      ...Array.from({ length: 6 }, (_, i) => `C${i + 1}`),
    ],
  );
  assert.deepEqual(
    sources.map(({ id }) => id),
    ['worldbank', 'imf', 'ucdp', 'vdem'],
  );
  assert.ok(
    indicators.every(
      ({ anchors, draft }) => anchors.version === 1 && draft === true,
    ),
  );
  assert.deepEqual(indicators.at(-1).anchors, {
    a: -3.81,
    b: 3.94,
    version: 1,
  });
  assert.deepEqual(
    indicators
      .filter(({ lowConfidence }) => lowConfidence)
      .map(({ slot }) => slot),
    ['S11', 'S12'],
  );
});

test('covers every pack feature exactly once and groups UK map units', async () => {
  const { loadWorldRegistry } = await import('./registry.js');
  const { countries } = await loadWorldRegistry();
  const pack = JSON.parse(
    await readFile(
      new URL(
        '../../../src/data/local_data/natural_earth/countries.json',
        import.meta.url,
      ),
    ),
  );
  assert.deepEqual(
    countries.flatMap(({ shapeIds }) => shapeIds).sort(),
    pack.features.map(({ iso }) => iso).sort(),
  );
  assert.equal(
    new Set(countries.map(({ iso3 }) => iso3)).size,
    countries.length,
  );
  const byIso = new Map(countries.map((country) => [country.iso3, country]));
  assert.deepEqual(byIso.get('GBR').shapeIds.toSorted(), [
    'ENG',
    'GBR',
    'NIR',
    'SCT',
    'WLS',
  ]);
  assert.deepEqual(byIso.get('PSE').shapeIds, ['PSX']);
  assert.deepEqual(byIso.get('SSD').shapeIds, ['SDS']);
  assert.equal(byIso.get('KOS').aliases.worldbank, 'XKX');
  assert.equal(byIso.get('KOS').aliases.imf, 'UVK');
  assert.equal(byIso.get('PSE').aliases.imf, 'WBG');
  assert.equal(byIso.get('ALD').kind, 'territory');
  assert.equal(byIso.get('ALD').dataIso3, 'FIN');
  for (const iso3 of [
    'CYN',
    'SOL',
    'SAH',
    'KAS',
    'BRT',
    'KAB',
    'CNM',
    'WSB',
    'ESB',
  ]) {
    assert.equal(byIso.get(iso3).kind, 'disputed', iso3);
  }
});
