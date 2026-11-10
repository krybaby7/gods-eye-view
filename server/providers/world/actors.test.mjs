import assert from 'node:assert/strict';
import test from 'node:test';
import './actors.js';
import { worldFeatureViews } from './refreshRegistry.js';

test('keeps roles and portraits on the board and selects actor extras by country', () => {
  const profile = 'https://bsky.app/profile/office.example';
  const actors = [
    {
      id: 'Q1',
      country: 'IND',
      role: 'head-of-state',
      imageFile: 'One.jpg',
      accounts: { bluesky: profile },
    },
    { id: 'Q1', country: 'GBR', role: 'head-of-state' },
    { id: 'Q2', country: 'AUS', role: 'foreign-minister' },
  ];
  const features = {
    wikidata: { actors, governments: {} },
    bluesky: {
      feeds: { [profile]: { posts: [{ text: 'post' }] }, other: { posts: [] } },
    },
  };
  const { summary, combine, detail } = worldFeatureViews.get('people');
  const projected = { ...features };
  combine({ summary: projected, features });
  assert.equal(projected.wikidata.actors[0].imageFile, 'One.jpg');
  assert.equal(projected.wikidata.actors[0].accounts, undefined);
  assert.equal(summary.bluesky(features.bluesky), undefined);
  const selected = detail({ country: 'IND', features }).features;
  assert.deepEqual(
    selected.wikidata.actors.map(({ country }) => country),
    ['IND', 'GBR'],
  );
  assert.deepEqual(Object.keys(selected.bluesky.feeds), [profile]);
});
test('board and People detail select the same dated CIA holder and keep full cache private', () => {
  const { combine, detail } = worldFeatureViews.get('people');
  const features = {
    wikidata: {
      actors: [
        {
          country: 'ARG',
          role: 'foreign-minister',
          id: 'Q1',
          name: 'Gerardo Werthein',
          since: '2024-01-01',
          source: 'wikidata',
        },
      ],
    },
    'cia-world-leaders': {
      pages: {
        argentina: {
          country: 'Argentina',
          slug: 'argentina',
          asOf: '2026-08-06',
          leaders: [
            { name: 'Pablo QUIRNO', title: 'Min. of Foreign Relations' },
          ],
        },
      },
    },
  };
  const registry = { countries: [{ name: 'Argentina', iso3: 'ARG' }] };
  const now = new Date('2026-11-10T12:00:00Z');
  const summary = { ...features };
  combine({ summary, features, registry, now });
  assert.equal(summary['cia-world-leaders'], undefined);
  const [actor] = summary.wikidata.actors;
  assert.equal(actor.name, 'Pablo Quirno');
  assert.equal(actor.asOf, '2026-08-06');
  assert.equal(actor.disagreement.name, 'Gerardo Werthein');
  const result = detail({ country: 'ARG', features, registry, now }).features;
  assert.equal(result.wikidata.actors[0].id, actor.id);
  assert.equal(result.wikidata.actors[0].asOf, actor.asOf);
});
