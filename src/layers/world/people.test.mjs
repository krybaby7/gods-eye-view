import assert from 'node:assert/strict';
import test from 'node:test';

const portrait = {
  thumbnail: 'https://upload.wikimedia.org/test',
  author: 'Fixture artist',
  licence: 'CC BY 4.0',
};
const state = {
  features: {
    wikidata: {
      actors: [
        {
          id: 'Q1',
          name: 'India state',
          country: 'IND',
          role: 'head-of-state',
          imageFile: 'State.jpg',
        },
        {
          id: 'Q2',
          name: 'India government',
          country: 'IND',
          role: 'head-of-government',
          accounts: { bluesky: 'https://bsky.app/profile/test.example.org' },
          imageFile: 'Government.jpg',
        },
        {
          id: 'Q2',
          name: 'India government',
          country: 'IND',
          role: 'defence-minister',
          accounts: { bluesky: 'https://bsky.app/profile/test.example.org' },
          imageFile: 'Government.jpg',
        },
      ],
    },
    'wikimedia-commons': { portraits: { 'State.jpg': portrait } },
    bluesky: {
      feeds: {
        'https://bsky.app/profile/test.example.org': {
          posts: [
            {
              text: 'Public post',
              url: 'https://bsky.app/profile/test.example.org/post/test',
            },
          ],
        },
        'https://bsky.app/profile/previous.example.org': {
          posts: [{ text: 'Previous account' }],
        },
      },
    },
    'actor-organizations': {
      organizations: {
        Q3: {
          id: 'Q3',
          kind: 'organization',
          country: 'IND',
          role: 'military',
          reviewed: false,
        },
        Q4: {
          id: 'Q4',
          kind: 'organization',
          country: null,
          role: 'central-bank',
          reviewed: false,
        },
      },
    },
  },
};

test('people use current accounts, attributed portraits, and grouped officeholders', async () => {
  const { countryPeople, worldActor, billboardLeader, regionalOrganizations } =
    await import('./peopleModel.js');
  const actors = countryPeople(state, 'IND');
  assert.deepEqual(
    actors.map(({ id }) => id),
    ['Q1', 'Q2', 'Q2', 'Q3'],
  );
  assert.equal(actors[0].image, portrait);
  assert.equal(actors[1].image, null);
  const profile = worldActor(state, 'Q2');
  assert.deepEqual(profile.roles, ['head-of-government', 'defence-minister']);
  assert.deepEqual(
    profile.posts.map(({ text }) => text),
    ['Public post'],
  );
  assert.equal(billboardLeader(actors).id, 'Q1');
  assert.equal(countryPeople(state, 'SAH').length, 0);
  assert.deepEqual(
    regionalOrganizations(state).map(({ id }) => id),
    ['Q4'],
  );
});

test('a shared officeholder preserves each country and role in their card', async () => {
  const { worldActor } = await import('./peopleModel.js');
  const snapshot = {
    features: {
      wikidata: {
        actors: [
          {
            id: 'Q9',
            name: 'Shared head of state',
            country: 'CAN',
            role: 'head-of-state',
            office: 'King of Canada',
          },
          {
            id: 'Q9',
            name: 'Shared head of state',
            country: 'GBR',
            role: 'head-of-state',
            office: 'King of the United Kingdom',
          },
        ],
      },
    },
  };
  const actor = worldActor(snapshot, 'Q9');
  assert.deepEqual(actor.countries, ['CAN', 'GBR']);
  assert.deepEqual(
    actor.offices.map(({ country, role, office }) => [country, role, office]),
    [
      ['CAN', 'head-of-state', 'King of Canada'],
      ['GBR', 'head-of-state', 'King of the United Kingdom'],
    ],
  );
});
