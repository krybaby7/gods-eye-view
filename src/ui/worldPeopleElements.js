export const platformNames = {
  x: 'X',
  bluesky: 'Bluesky',
  youtube: 'YouTube',
  mastodon: 'Mastodon',
  facebook: 'Facebook',
  instagram: 'Instagram',
  vk: 'VK',
  weibo: 'Weibo',
  website: 'Website',
  'government-rss': 'Official RSS',
};

export function node(document, tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text) result.textContent = text;
  return result;
}

export function externalLink(document, url, text, className) {
  if (!url) return null;
  let href;
  try {
    href = new URL(url);
  } catch {
    return null;
  }
  if (
    !['https:', 'http:'].includes(href.protocol) ||
    href.username ||
    href.password
  )
    return null;
  const anchor = node(document, 'a', className, text);
  anchor.href = href.href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

export function portraitImage(document, actor) {
  if (!actor.image?.thumbnail) return null;
  const image = node(document, 'img', 'world-person-portrait');
  image.alt = actor.name;
  image.src = actor.image.thumbnail;
  image.referrerPolicy = 'no-referrer';
  return image;
}

export function portraitCredit(document, image) {
  const caption = node(document, 'span', 'world-portrait-credit');
  caption.append('Photo by ' + image.author + ' · ');
  caption.append(
    externalLink(document, image.licenceUrl, image.licence) ?? image.licence,
  );
  caption.append(' · ');
  caption.append(
    externalLink(document, image.file, 'Wikimedia Commons') ??
      'Wikimedia Commons',
  );
  return caption;
}

export function actorButton(document, actor, openCard) {
  const button = node(document, 'button', 'world-person-open', actor.name);
  button.type = 'button';
  button.addEventListener('click', () => openCard('actor', actor.id));
  return button;
}

export function accountLinks(document, accounts) {
  const links = node(document, 'div', 'world-person-accounts');
  for (const { platform, url } of accounts) {
    const label = platformNames[platform] ?? platform;
    const anchor = externalLink(document, url, label, 'world-person-account');
    if (anchor) links.append(anchor);
  }
  return links;
}
