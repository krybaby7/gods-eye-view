// The Overview tab: six lines, each opening the tab that holds its detail.
import { scoreColor } from '../layers/world/model.js';
import { overviewLines, relationsLine } from './worldOverviewModel.js';

if (import.meta.env) {
  import.meta.glob('./styles/world-words.css', { eager: true });
}

function element(document, tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

function miniBar(document, { name, score, band, kind }) {
  const row = element(document, 'span', 'world-overview-bar');
  const track = element(
    document,
    'span',
    score === null ? 'world-score-track world-hatch' : 'world-score-track',
  );
  track.setAttribute('aria-hidden', 'true');
  if (kind === 'forecast' || kind === 'estimate')
    track.classList.add('world-claim-dashed');
  if (score !== null) {
    const fill = element(document, 'span', 'world-score-fill');
    fill.style.width = `${Math.min(100, Math.max(0, score))}%`;
    fill.style.background = `rgb(${scoreColor(score).join(' ')})`;
    track.append(fill);
  }
  row.append(
    element(document, 'span', 'world-overview-bar-name', name),
    track,
    element(
      document,
      'span',
      'world-overview-bar-score',
      score === null ? 'Unknown' : `${band} · ${Math.round(score)} / 100`,
    ),
  );
  return row;
}

function lineContent(document, line) {
  const parts = [element(document, 'span', 'world-overview-title', line.title)];
  if (line.bars) {
    const bars = element(document, 'span', 'world-overview-bars');
    bars.append(...line.bars.map((bar) => miniBar(document, bar)));
    parts.push(bars);
  }
  parts.push(element(document, 'span', 'world-overview-text', line.text));
  if (line.caption) {
    const caption = element(
      document,
      'span',
      'world-overview-caption',
      line.caption,
    );
    if (line.kind === 'estimate') caption.classList.add('world-claim-chip');
    parts.push(caption);
  }
  return parts;
}

function lineNode(document, line, context) {
  const tabs = new Map((context.tabs ?? []).map((tab) => [tab.id, tab]));
  const target = line.target && tabs.get(line.target);
  if (!target || !context.selectTab) {
    const node = element(document, 'div', 'world-overview-line');
    node.dataset.worldOverview = line.id;
    node.append(...lineContent(document, line));
    return node;
  }
  const node = element(
    document,
    'button',
    'panel-surface-control world-overview-line',
  );
  node.type = 'button';
  node.dataset.worldOverview = line.id;
  node.dataset.worldOverviewTarget = target.id;
  node.setAttribute('aria-label', `${line.title}. Open ${target.label}`);
  node.append(
    ...lineContent(document, line),
    element(document, 'span', 'world-overview-go', `${target.label} ›`),
  );
  node.addEventListener('click', () => context.selectTab(target.id));
  return node;
}

export function renderOverviewTab(context) {
  const { document, snapshot, sheetModel, getDetail } = context;
  const panel = element(document, 'section', 'world-overview');
  panel.setAttribute('aria-label', 'Overview');
  if (!sheetModel) return panel;
  const lines = overviewLines(snapshot, sheetModel);
  const nodes = lines.map((line) => lineNode(document, line, context));
  panel.append(...nodes);
  if (!getDetail || sheetModel.disputed) return panel;
  // The Relations tab reads more relations on demand; so does this line.
  const index = lines.findIndex(({ id }) => id === 'relations');
  getDetail(sheetModel.iso3, 'diplomacy')
    .then((detail) => {
      const features = detail?.features;
      if (!features || !panel.isConnected) return;
      const line = relationsLine(
        { ...snapshot, features: { ...snapshot.features, ...features } },
        sheetModel,
      );
      const node = lineNode(document, line, context);
      nodes[index].replaceWith(node);
      nodes[index] = node;
    })
    .catch(() => {});
  return panel;
}
