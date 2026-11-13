// The detail depth of one score: what it means, against the world and
// against its own past. The words come from worldWords.js.

if (import.meta.env) {
  import.meta.glob('./styles/world-words.css', { eager: true });
}

function element(document, tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

function block(document, title, sentence, extra) {
  const node = element(document, 'div', 'world-words-block');
  node.append(element(document, 'strong', 'world-words-title', title));
  if (extra) node.append(extra);
  node.append(element(document, 'p', 'world-words-sentence', sentence));
  return node;
}

function strip(document, position) {
  if (!Number.isFinite(position)) return null;
  const track = element(document, 'span', 'world-words-strip');
  track.setAttribute('aria-hidden', 'true');
  track.title = 'Weakest on the left, strongest on the right';
  const mark = element(document, 'i');
  mark.style.left = `${(position * 100).toFixed(1)}%`;
  track.append(mark);
  return track;
}

export function renderScoreWords(document, row) {
  const { words } = row;
  const container = element(document, 'div', 'world-words');
  container.dataset.worldWords = row.slot;
  container.append(
    element(document, 'p', 'world-words-meaning', words.meaning),
    block(
      document,
      'Against the world',
      words.world.sentence,
      strip(document, words.world.position),
    ),
    block(document, 'Against its own past', words.trend.sentence),
  );
  return container;
}
