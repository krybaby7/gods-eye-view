import {
  actorRoles,
  countryPeople,
  regionalOrganizations,
  worldActor,
} from '../layers/world/peopleModel.js';
import {
  accountLinks,
  actorButton,
  externalLink,
  node,
  portraitCredit,
  portraitImage,
} from './worldPeopleElements.js';

const leadership = ['head-of-state', 'head-of-government'];
const ministries = ['foreign-minister', 'defence-minister'];

function officeText(role) {
  return actorRoles[role] ?? role;
}

export function renderPeopleHeader({
  document,
  snapshot,
  sheetModel,
  openCard,
}) {
  if (
    !sheetModel ||
    sheetModel.disputed ||
    !snapshot.features?.wikidata?.actors
  )
    return null;
  const { iso3 } = sheetModel;
  const actors = countryPeople(snapshot, iso3);
  const container = node(document, 'section', 'world-people-header');
  const government = snapshot.features.wikidata.governments?.[iso3];
  container.append(
    node(
      document,
      'p',
      'world-people-government',
      (Array.isArray(government) ? government.join(' · ') : government) ||
        'Government type unavailable',
    ),
  );
  const grid = node(document, 'div', 'world-people-leaders');
  const state = actors.filter(({ role }) => role === 'head-of-state');
  const executive = actors.filter(({ role }) => role === 'head-of-government');
  const shared =
    state.length &&
    state.length === executive.length &&
    state.every((person) =>
      executive.some(
        ({ id, office }) => id === person.id && office === person.office,
      ),
    );
  const groups = shared
    ? [[leadership[0], 'Head of state · Head of government', state]]
    : [
        [leadership[0], officeText(leadership[0]), state],
        [leadership[1], officeText(leadership[1]), executive],
      ];
  for (const [role, title, holders] of groups) {
    const group = node(document, 'div', 'world-person-leader');
    group.dataset.worldLeader = role;
    group.append(node(document, 'span', 'world-person-role', title));
    if (holders[0]?.collective) {
      group.append(
        node(document, 'span', 'world-person-role', holders[0].collective),
      );
    }
    if (!holders.length) {
      group.append(
        node(
          document,
          'span',
          'world-person-unavailable',
          'Officeholder unavailable',
        ),
      );
    }
    for (const actor of holders) {
      const identity = node(document, 'div', 'world-person-identity');
      const portrait = portraitImage(document, actor);
      if (portrait) identity.append(portrait);
      identity.append(actorButton(document, actor, openCard));
      if (actor.acting)
        identity.append(node(document, 'span', 'world-person-role', 'Acting'));
      group.append(identity);
      if (portrait) group.append(portraitCredit(document, actor.image));
    }
    grid.append(group);
  }
  container.append(grid);
  return container;
}

function actorRow(document, actor, country, openCard) {
  const row = node(document, 'li', 'world-person-row');
  row.append(actorButton(document, actor, openCard));
  row.append(
    node(
      document,
      'span',
      'world-person-role',
      [
        ...new Set(
          actor.offices
            .filter((entry) => entry.country === country)
            .map(({ role }) => officeText(role)),
        ),
      ].join(' · '),
    ),
  );
  if (actor.kind === 'organization' && !actor.reviewed) {
    row.append(
      node(
        document,
        'span',
        'world-person-unavailable',
        'Draft, not yet reviewed',
      ),
    );
  }
  const accounts = accountLinks(document, actor.accountLinks);
  if (accounts.childElementCount) row.append(accounts);
  const post = actor.posts[0];
  const recent =
    post &&
    externalLink(document, post.url, post.text, 'world-person-post-preview');
  if (recent) row.append(recent);
  return row;
}

function actorList(context, ids, country = context.sheetModel.iso3) {
  const { document, snapshot, openCard } = context;
  const list = node(document, 'ul', 'world-people-list');
  for (const id of new Set(ids)) {
    const actor = worldActor(snapshot, id);
    if (actor) list.append(actorRow(document, actor, country, openCard));
  }
  return list;
}

function peopleTab(context) {
  const { document, snapshot, sheetModel } = context;
  const content = node(document, 'section', 'world-people-tab');
  if (!sheetModel || sheetModel.disputed) {
    content.append(
      node(
        document,
        'p',
        'world-detail',
        'No country directory for this disputed territory.',
      ),
    );
    return content;
  }
  const actors = countryPeople(snapshot, sheetModel.iso3);
  const officials = actors.filter(({ kind }) => kind !== 'organization');
  content.append(
    node(document, 'h3', 'world-people-section', 'Public officials'),
  );
  if (officials.length)
    content.append(
      actorList(
        context,
        officials.map(({ id }) => id),
      ),
    );
  else
    content.append(
      node(
        document,
        'p',
        'world-detail',
        'No current officeholders available.',
      ),
    );
  if (snapshot.features?.wikidata?.actors) {
    const missing = [...leadership, ...ministries]
      .filter((role) => !officials.some((actor) => actor.role === role))
      .map(officeText);
    if (missing.length)
      content.append(
        node(
          document,
          'p',
          'world-detail',
          'Unavailable roles · ' + missing.join(' · '),
        ),
      );
  }
  const organizations = actors.filter(({ kind }) => kind === 'organization');
  const regional = regionalOrganizations(snapshot);
  if (organizations.length || regional.length) {
    content.append(
      node(document, 'h3', 'world-people-section', 'Organizations'),
    );
    content.append(
      node(
        document,
        'p',
        'world-detail',
        'Draft, not yet reviewed. For an armed group, the country identifies geographic activity.',
      ),
    );
    if (organizations.length)
      content.append(
        actorList(
          context,
          organizations.map(({ id }) => id),
        ),
      );
    if (regional.length) {
      const disclosure = node(document, 'details', 'world-people-regional');
      disclosure.append(
        node(
          document,
          'summary',
          null,
          'Regional and transnational organizations',
        ),
      );
      disclosure.append(
        actorList(
          context,
          regional.map(({ id }) => id),
          null,
        ),
      );
      content.append(disclosure);
    }
  }
  return content;
}

export function renderPeopleTab(context) {
  const { document, sheetModel, getDetail, snapshot } = context;
  const content = peopleTab(context);
  if (!sheetModel || sheetModel.disputed || !getDetail) return content;
  getDetail(sheetModel.iso3, 'people')
    .then(({ features }) => {
      const next = peopleTab({
        ...context,
        snapshot: { features: { ...snapshot.features, ...features } },
      });
      content.replaceChildren(...next.childNodes);
    })
    .catch(() => {
      content.append(
        node(
          document,
          'p',
          'world-detail',
          'People account details are unavailable.',
        ),
      );
    });
  return content;
}
