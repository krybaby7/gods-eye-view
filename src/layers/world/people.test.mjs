import assert from 'node:assert/strict';
import test from 'node:test';

test('People lists one minister with their attributed portrait and account', async () => {
  const { renderPeopleTab } = await import('../../ui/worldPeopleTab.js');
  const document = {
    createElement(tag) {
      return {
        tag,
        children: [],
        get childElementCount() {
          return this.children.length;
        },
        addEventListener() {},
        append(...children) {
          this.children.push(...children);
        },
      };
    },
  };
  const actor = {
    id: 'Q1',
    kind: 'person',
    country: 'RUS',
    role: 'foreign-minister',
    name: 'Sergey Lavrov',
    imageFile: 'Lavrov.jpg',
    accounts: { website: 'https://example.org/lavrov' },
  };
  const snapshot = {
    features: {
      wikidata: { actors: [actor] },
      'wikimedia-commons': { portraits: { 'Lavrov.jpg': portrait } },
    },
  };
  const tree = renderPeopleTab({
    document,
    snapshot,
    sheetModel: { iso3: 'RUS' },
  });
  function walk(node) {
    return node.children ? [node, ...node.children.flatMap(walk)] : [];
  }
  const nodes = walk(tree);
  assert.equal(
    nodes.filter(
      ({ tag, textContent }) => tag === 'button' && textContent === actor.name,
    ).length,
    1,
  );
  assert.equal(
    nodes.find(({ tag, alt }) => tag === 'img' && alt === actor.name)?.src,
    portrait.thumbnail,
  );
  assert.ok(
    nodes.some(({ className }) => className === 'world-portrait-credit'),
  );
  assert.ok(nodes.some(({ href }) => href === 'https://example.org/lavrov'));
});

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
test('role evidence displays date, source, stale cue and the competing holder', async () => {
  const { roleEvidence } = await import('../../ui/worldPeopleElements.js');
  const document = {
    createElement() {
      return {
        values: [],
        append(...values) {
          this.values.push(
            ...values.map((value) => value.textContent ?? value),
          );
        },
      };
    },
  };
  const element = roleEvidence(document, {
    asOf: '2025-07-20',
    source: 'cia-world-leaders',
    stale: true,
    disagreement: {
      name: 'Other Holder',
      source: 'wikidata',
      asOf: '2024-04-03',
    },
    otherEvidence: [
      {
        name: 'Selected Holder',
        source: 'official',
        asOf: '2024-04-04',
        agrees: true,
      },
      {
        name: 'Other Holder',
        source: 'wikidata',
        asOf: '2024-04-03',
        agrees: false,
      },
    ],
  });
  assert.match(element.values.join(''), /as of 2025-07-20 · CIA World Leaders/);
  assert.match(element.values.join(''), /may be out of date/);
  assert.match(
    element.values.join(''),
    /sources disagree: Other Holder per Wikidata, 2024-04-03 · displayed holder confirmed by Official office source, 2024-04-04/,
  );
  const agreed = roleEvidence(document, {
    asOf: '2026-11-09',
    source: 'official',
    otherEvidence: [
      {
        name: 'Selected Holder',
        source: 'wikidata',
        asOf: '2025-10-21',
        agrees: true,
      },
    ],
  });
  assert.match(
    agreed.values.join(''),
    /displayed holder confirmed by Wikidata, 2025-10-21/,
  );
  assert.doesNotMatch(agreed.values.join(''), /sources disagree/);
  const ambiguous = roleEvidence(document, {
    source: 'wikidata',
    asOf: '2026-11-10',
    since: '2024-04-03',
    ambiguity: { alternatives: [{ name: 'Alternative Holder' }] },
  });
  assert.match(
    ambiguous.values.join(''),
    /as of 2026-11-10 · Wikidata · since 2024-04-03/,
  );
  assert.match(
    ambiguous.values.join(''),
    /CIA title ambiguous: also lists Alternative Holder/,
  );
});
