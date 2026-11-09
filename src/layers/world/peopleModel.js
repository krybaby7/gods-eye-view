export const actorRoles = {
  'head-of-state': 'Head of state',
  'head-of-government': 'Head of government',
  'foreign-minister': 'Foreign minister',
  'defence-minister': 'Defence minister',
  military: 'Military',
  'central-bank': 'Central bank',
  'armed-group': 'Armed group',
};

const directory = (snapshot) => snapshot.features?.wikidata?.actors ?? [];
const organizations = (snapshot) =>
  Object.values(
    snapshot.features?.['actor-organizations']?.organizations ?? {},
  );

function attributed(snapshot, actor) {
  const portraits = snapshot.features?.['wikimedia-commons']?.portraits ?? {};
  const image = Object.hasOwn(portraits, actor.imageFile)
    ? portraits[actor.imageFile]
    : null;
  return { ...actor, image };
}

export function countryPeople(snapshot, country) {
  return [...directory(snapshot), ...organizations(snapshot)]
    .filter((actor) => actor.country === country)
    .map((actor) => attributed(snapshot, actor));
}

export function regionalOrganizations(snapshot) {
  return organizations(snapshot).filter(({ country }) => country === null);
}

export function billboardLeader(actors) {
  return ['head-of-government', 'head-of-state']
    .map((role) =>
      actors.find((actor) => actor.role === role && actor.image?.thumbnail),
    )
    .find(Boolean);
}

function actorAccountEntries(accounts = {}) {
  return Object.entries(accounts).flatMap(([platform, value]) =>
    (Array.isArray(value) ? value : [value]).map((url) => ({ platform, url })),
  );
}

export function worldActor(snapshot, id) {
  const person = directory(snapshot).filter((actor) => actor.id === id);
  const actor =
    person[0] ?? organizations(snapshot).find((entry) => entry.id === id);
  if (!actor) return null;
  const features = snapshot.features ?? {};
  const records = person.length ? person : [actor];
  const accounts = [
    ...new Map(
      records.flatMap(({ accounts }) =>
        actorAccountEntries(accounts).map((entry) => [entry.url, entry]),
      ),
    ).values(),
  ];
  const feedEntries = [
    ...accounts.flatMap(({ platform, url }) => {
      const source = { bluesky: 'bluesky', youtube: 'youtube-rss' }[platform];
      const feed = source && features[source]?.feeds?.[url];
      return feed ? [{ platform, url, ...feed }] : [];
    }),
    ...Object.entries(features['government-rss']?.feeds ?? {})
      .filter(([, feed]) => feed.actorId === id)
      .map(([url, feed]) => ({ platform: 'government-rss', url, ...feed })),
  ];
  const known = new Set();
  const posts = feedEntries
    .flatMap(({ platform, posts }) =>
      posts.flatMap((post) => {
        if (known.has(post.url)) return [];
        known.add(post.url);
        return [{ ...post, platform }];
      }),
    )
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  return {
    ...attributed(snapshot, actor),
    roles: [...new Set(records.map(({ role }) => role))],
    countries: [
      ...new Set(records.map(({ country }) => country).filter(Boolean)),
    ],
    offices: records.map(({ office, role, since, country }) => ({
      office,
      role,
      since,
      country,
    })),
    accountLinks: [
      ...accounts,
      ...feedEntries.filter(({ platform }) => platform === 'government-rss'),
    ],
    posts,
  };
}
