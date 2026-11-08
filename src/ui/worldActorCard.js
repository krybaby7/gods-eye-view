import { actorRoles, worldActor } from '../layers/world/peopleModel.js';
import {
  accountLinks,
  externalLink,
  node,
  platformNames,
  portraitCredit,
  portraitImage,
} from './worldPeopleElements.js';

const X_PROFILE = /^https:\/\/x\.com\/(\w{1,15})\/?$/i;
const WIDGET = 'https://platform.twitter.com/widgets.js';

function xTimeline(document, actor) {
  const x = actor.accountLinks.find(
    ({ platform, url }) => platform === 'x' && X_PROFILE.test(url),
  );
  if (!x) return null;
  const [, handle] = X_PROFILE.exec(x.url);
  const wrapper = node(document, 'div', 'world-person-x');
  const button = node(
    document,
    'button',
    'panel-surface-control world-control',
    'Show X timeline',
  );
  button.type = 'button';
  const caveat = node(
    document,
    'p',
    'world-detail',
    'The X timeline may require signing in to X.',
  );
  wrapper.append(button, caveat);
  button.addEventListener(
    'click',
    () => {
      const frame = node(document, 'iframe', 'world-person-x-frame');
      frame.title = 'X timeline for ' + actor.name;
      frame.setAttribute(
        'sandbox',
        'allow-scripts allow-popups allow-popups-to-escape-sandbox',
      );
      frame.referrerPolicy = 'no-referrer';
      // The only interpolated external value is an X handle checked above.
      frame.srcdoc =
        '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer">' +
        '<a class="twitter-timeline" data-theme="dark" data-height="325" data-dnt="true" href="https://x.com/' +
        handle +
        '">View posts on X</a><script async src="' +
        WIDGET +
        '" charset="utf-8"></script>';
      wrapper.append(frame);
      button.remove();
    },
    { once: true },
  );
  return wrapper;
}

export function renderActorCard({ document, snapshot, id }) {
  const actor = worldActor(snapshot, id);
  const card = node(document, 'article', 'world-actor-card');
  if (!actor) {
    card.append(
      node(
        document,
        'p',
        'world-detail',
        'This actor is unavailable in the current directory.',
      ),
    );
    return card;
  }
  card.dataset.worldActor = id;
  card.append(node(document, 'h3', 'world-actor-name', actor.name));
  for (const { role, office, since, country } of actor.offices) {
    const description = [
      actorRoles[role] ?? role,
      country,
      office,
      since && 'since ' + since,
    ]
      .filter(Boolean)
      .join(' · ');
    card.append(node(document, 'p', 'world-person-role', description));
  }
  if (actor.kind === 'organization' && !actor.reviewed) {
    const geographic =
      actor.role === 'armed-group'
        ? ' Country refers to geographic activity.'
        : '';
    card.append(
      node(
        document,
        'p',
        'world-detail',
        'Draft, not yet reviewed.' + geographic,
      ),
    );
  }
  const portrait = portraitImage(document, actor);
  if (portrait) {
    const figure = node(document, 'figure', 'world-actor-portrait');
    const caption = node(document, 'figcaption');
    caption.append(portraitCredit(document, actor.image));
    figure.append(portrait, caption);
    card.append(figure);
  }
  card.append(node(document, 'h4', 'world-people-section', 'Public accounts'));
  const accounts = accountLinks(document, actor.accountLinks);
  card.append(
    accounts.childElementCount
      ? accounts
      : node(document, 'p', 'world-detail', 'No known public accounts.'),
  );
  card.append(node(document, 'h4', 'world-people-section', 'Recent posts'));
  if (actor.posts.length) {
    const posts = node(document, 'ul', 'world-person-posts');
    for (const post of actor.posts) {
      const link = externalLink(
        document,
        post.url,
        post.text,
        'world-person-post',
      );
      if (!link) continue;
      const item = node(document, 'li', 'world-person-post-entry');
      const metadata = [
        platformNames[post.platform],
        post.publishedAt?.slice(0, 10),
      ].filter(Boolean);
      item.append(
        node(document, 'span', 'world-person-role', metadata.join(' · ')),
        link,
      );
      posts.append(item);
    }
    card.append(posts);
  } else {
    card.append(
      node(document, 'p', 'world-detail', 'No recent inline posts available.'),
    );
  }
  const embed = xTimeline(document, actor);
  if (embed) card.append(embed);
  const source = node(document, 'p', 'world-detail');
  const wikidata = externalLink(document, actor.wikidataUrl, 'Wikidata');
  const organization = externalLink(
    document,
    actor.sourceUrl,
    'Organization source',
  );
  if (wikidata) source.append(wikidata);
  if (organization) source.append(wikidata ? ' · ' : '', organization);
  if (actor.lastChecked)
    source.append(' · checked ' + actor.lastChecked.slice(0, 10));
  if (source.childNodes.length) card.append(source);
  return card;
}
