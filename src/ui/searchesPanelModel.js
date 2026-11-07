import { localSearchDay } from '../layers/searches/records.js';

// Calendar keys already identify a local day. Keep the label on that date.
const dayFormat = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const tokenFormat = new Intl.NumberFormat('en-US');
const usdFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 6,
});

export const MAX_SEARCH_QUESTION = 500;

export function formatSearchDay(day) {
  return dayFormat.format(Date.parse(day));
}

export function askDisabledReason(question, agent, { pending, history } = {}) {
  if (pending) return 'Starting search…';
  if (history) return 'Back to now to ask a question.';
  if (agent?.disabledReason) return agent.disabledReason;
  if (!agent) return 'Checking Claude availability…';
  if (!agent.installed) return 'Install Claude Code to ask a question.';
  if (!agent.signedIn) return 'Sign in to Claude Code to ask a question.';
  if (agent.busy) return 'Claude is busy with another search.';
  if (!question.trim()) return 'Enter a question.';
  if (question.trim().length > MAX_SEARCH_QUESTION)
    return 'Use 500 characters or fewer.';
  return '';
}

export function elapsedTime(durationMs) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatRunUsage(run) {
  if (!run) return '';
  const usage = run.usage || {};
  const parts = [run.agent === 'claude' ? 'Claude' : run.agent];
  if (Number.isFinite(usage.durationMs))
    parts.push(elapsedTime(usage.durationMs));
  if (Number.isFinite(usage.inputTokens))
    parts.push(`${tokenFormat.format(usage.inputTokens)} input tokens`);
  if (Number.isFinite(usage.outputTokens))
    parts.push(`${tokenFormat.format(usage.outputTokens)} output tokens`);
  if (Number.isFinite(usage.costUsd))
    parts.push(usdFormat.format(usage.costUsd));
  return parts.filter(Boolean).join(' · ');
}

function activity(search) {
  return (
    Date.parse(
      search.running?.startedAt ||
        search.runs?.at(-1)?.finishedAt ||
        search.run?.finishedAt ||
        search.createdAt,
    ) || 0
  );
}

export function groupSearches(searches, query, now = new Date()) {
  const filter = query.trim().toLowerCase();
  const today = localSearchDay(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const previous = localSearchDay(yesterday);
  const buckets = new Map();
  const ordered = searches
    .filter(
      (search) =>
        [search.label, search.question].some((value) =>
          value?.toLowerCase().includes(filter),
        ) || !filter,
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
        activity(b) - activity(a),
    );
  for (const search of ordered) {
    const day = localSearchDay(activity(search));
    const label = search.pinned
      ? 'Pinned'
      : day === today
        ? 'Today'
        : day === previous
          ? 'Yesterday'
          : formatSearchDay(day);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(search);
  }
  return Array.from(buckets, ([label, searches]) => ({ label, searches }));
}

export function searchFindingSections(search, groupId, placeFilter) {
  const matches = (finding) =>
    (!groupId || finding.groupId === groupId) &&
    (!placeFilter || finding.hotspot?.key === placeFilter.key);
  const mapped = new Map();
  const listOnly = [];
  const groups = new Map(
    (search.run?.answer?.groups || []).map(({ id, label }) => [id, label]),
  );
  for (const finding of search.findings.filter(matches)) {
    if (!finding.location) {
      listOnly.push(finding);
      continue;
    }
    const key = groups.has(finding.groupId) ? finding.groupId : null;
    if (!mapped.has(key)) mapped.set(key, []);
    mapped.get(key).push(finding);
  }
  const sections = Array.from(mapped, ([id, findings]) => ({
    label: groups.get(id) || 'Findings',
    findings,
  }));
  if (listOnly.length)
    sections.push({ label: 'Not on the globe', findings: listOnly });
  const earlier = (search.earlierFindings || []).filter(matches);
  if (earlier.length)
    sections.push({
      label: 'Earlier findings',
      findings: earlier,
      earlier: true,
    });
  return sections;
}
