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
  const { summary, detail } = worldFeatureViews.get('people');
  assert.equal(
    summary.wikidata(features.wikidata).actors[0].imageFile,
    'One.jpg',
  );
  assert.equal(
    summary.wikidata(features.wikidata).actors[0].accounts,
    undefined,
  );
  assert.equal(summary.bluesky(features.bluesky), undefined);
  const selected = detail({ country: 'IND', features }).features;
  assert.deepEqual(
    selected.wikidata.actors.map(({ country }) => country),
    ['IND', 'GBR'],
  );
  assert.deepEqual(Object.keys(selected.bluesky.feeds), [profile]);
});
