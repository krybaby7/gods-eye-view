import { liveFlagNotes } from '../layers/world/events.js';

export function renderLiveFlagPanel(document, flags) {
  if (!flags.length) return null;
  const panel = document.createElement('details');
  panel.className = 'world-live-evidence';
  const summary = document.createElement('summary');
  summary.textContent = 'Condition flags · ' + flags.length;
  panel.append(summary);
  const list = document.createElement('ul');
  for (const flag of flags) {
    const item = document.createElement('li');
    item.dataset.status = flag.status ?? 'active';
    item.append(flag.label + ' · ' + flag.date + ' · ');
    const url = URL.parse(flag.source);
    if (url?.protocol === 'https:') {
      const link = document.createElement('a');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = flag.sourceName;
      item.append(link);
    } else item.append(flag.sourceName);
    if (flag.dsaMonth) item.append(' · DSA ' + flag.dsaMonth);
    if (flag.sourceLocator) item.append(' · ' + flag.sourceLocator);
    for (const note of liveFlagNotes(flag)) item.append(' · ' + note);
    list.append(item);
  }
  panel.append(list);
  return panel;
}
