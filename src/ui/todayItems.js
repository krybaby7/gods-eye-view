import { activeAlerts, ALERT_FEEDS } from './frameGauges.js';
import { citedItems } from './situationPanelModel.js';

const CIVIC_ALERTS = Object.freeze({
  'live-gdacs': 'natural disaster',
  'live-fx': 'currency',
  'live-imf-cpi': 'inflation',
  'live-unhcr': 'displacement',
  'live-debt-dsa': 'public debt',
  'live-electionguide': 'election',
  'live-hdx': 'humanitarian',
  'live-ioda': 'internet outage',
});

const CIVIC_DEVELOPMENTS = Object.freeze({
  'elections-governance': 'governance',
  'diplomacy-sanctions': 'international relations',
  'political-diplomatic': 'political affairs',
  humanitarian: 'humanitarian',
});
const OPERATIONAL_CONTENT =
  /\b(?:armed|army|attack\w*|battle\w*|bomb\w*|combat|militar\w*|missile\w*|munition\w*|strike\w*|target\w*|troop\w*|weapon\w*)\b|\b\d{1,3}\.\d+\s*[,/]\s*-?\d{1,3}\.\d+/i;

function asDate(value) {
  const date =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
      ? Date.parse(value)
      : NaN;
  return Number.isFinite(date)
    ? new Date(date).toISOString().slice(0, 10)
    : null;
}

function countryName(countries, iso3) {
  const country = /^[A-Z]{3}$/.test(iso3) ? countries?.[iso3] : null;
  return country?.kind === 'disputed' ? null : country?.name?.trim();
}

function boardItems(world) {
  if (!world?.enabled) return [];
  const rows = [];
  for (const flag of activeAlerts(world.features)) {
    const kind = CIVIC_ALERTS[flag.sourceId];
    const place = countryName(world.countries, flag.iso3);
    const date = asDate(flag.date);
    if (!kind || !place || !date || !flag.id) continue;
    rows.push({
      id: `alert:${flag.id}`,
      title: `${place} has an active ${kind} alert.`,
      place,
      date,
      sources: [ALERT_FEEDS[flag.sourceId]],
      reason: 'Active country alert',
      target: { kind: 'country', iso3: flag.iso3 },
      order: 0,
    });
  }
  const turn = world.turn;
  const turnDate = asDate(turn?.endedAt);
  if (!Number.isSafeInteger(turn?.number) || turn.number < 2 || !turnDate)
    return rows;
  const changed = new Set();
  for (const change of turn.changes ?? []) {
    const place = countryName(world.countries, change.iso3);
    if (!place || change.kind || changed.has(change.iso3)) continue;
    changed.add(change.iso3);
    rows.push({
      id: `turn:${turn.number}:${change.iso3}`,
      title: `The World Board recorded changes for ${place}.`,
      place,
      date: turnDate,
      turn: turn.number,
      sources: ['World Board'],
      reason: 'Country readings changed in the latest turn',
      target: { kind: 'country', iso3: change.iso3 },
      order: 2,
    });
  }
  return rows;
}

function citationFor(item, sourceNames) {
  const outlet = sourceNames.get(item.sourceId);
  if (!outlet) return null;
  try {
    const url = new URL(item.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return { outlet, href: url.href };
  } catch {
    return null;
  }
}

function digestItems(world, news) {
  if (!news?.enabled || !news.theater?.id || !news.theater.name) return [];
  const sourceNames = new Map(
    (news.sources ?? []).map(({ id, name }) => [id, name]),
  );
  const countryCodes = new Map();
  for (const iso3 of Object.keys(world?.countries ?? {})) {
    const name = countryName(world.countries, iso3)?.toLocaleLowerCase('en');
    if (name) countryCodes.set(name, countryCodes.has(name) ? null : iso3);
  }
  const rows = [];
  for (const story of news.visibleStories ?? []) {
    if (
      !story.id ||
      !story.title?.trim() ||
      story.status !== 'open' ||
      story.kind !== 'development' ||
      !Object.hasOwn(CIVIC_DEVELOPMENTS, story.category) ||
      story.location ||
      story.hotspot ||
      OPERATIONAL_CONTENT.test(`${story.title} ${story.summary ?? ''}`)
    )
      continue;

    const place = story.place?.trim().toLocaleLowerCase('en');
    const iso3 = countryCodes.get(place);
    if (place && !iso3 && place !== news.theater.name.toLocaleLowerCase('en'))
      continue;
    const date = asDate(story.updatedAt ?? story.eventAt);
    if (!date) continue;

    const citations = citedItems(story, news.items, news.citations)
      .map((item) => citationFor(item, sourceNames))
      .filter(Boolean);
    if (!citations.length) continue;
    const sources = [...new Set(citations.map(({ outlet }) => outlet))].sort();
    const placeName = iso3
      ? countryName(world.countries, iso3)
      : news.theater.name;
    const topic = CIVIC_DEVELOPMENTS[story.category];
    const article = /^[aeiou]/i.test(topic) ? 'An' : 'A';
    const context = iso3 ? `for ${placeName}` : `in the ${placeName} digest`;
    rows.push({
      id: `digest:${news.theater.id}:${story.id}`,
      title: `${article} ${topic} report is available ${context}.`,
      place: placeName,
      citation: citations[0],
      date,
      sources,
      reason: `Cached development · ${sources.length} cited ${sources.length === 1 ? 'outlet' : 'outlets'}`,
      target: {
        kind: 'development',
        id: story.id,
        theaterId: news.theater.id,
        ...(iso3 && { iso3 }),
      },
      order: 1,
    });
  }
  return rows;
}

/** Rank attributable items from the snapshots already present in the browser. */
export function buildTodayItems(world, news) {
  const rows = [...boardItems(world), ...digestItems(world, news)].sort(
    (a, b) =>
      a.order - b.order ||
      b.sources.length - a.sources.length ||
      (b.date || '').localeCompare(a.date || '') ||
      a.id.localeCompare(b.id),
  );
  const visible = new Set();
  return rows.filter((row) => {
    if (row.target.kind !== 'development') return true;
    const key = JSON.stringify([row.title, row.place, row.date, row.sources]);
    if (visible.has(key)) return false;
    visible.add(key);
    return true;
  });
}
