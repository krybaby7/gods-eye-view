import { isPinnedStory } from '../layers/news/records.js';
import { activeAlerts, ALERT_FEEDS } from './frameGauges.js';
import { citedItems } from './situationPanelModel.js';

/**
 * What each alert feed's flag means, in the words of its rule in
 * server/providers/world/conditionEvents.js. GDELT codes two kinds, told
 * apart by the score slot the flag sets.
 */
const ALERT_KINDS = Object.freeze({
  'live-coups': () => 'coup',
  'live-gdacs': () => 'natural disaster',
  'live-gdelt': ({ slot }) =>
    slot === 'C6' ? 'protest' : slot === 'C2' ? 'armed conflict' : 'unrest',
  'live-fx': () => 'currency',
  'live-imf-cpi': () => 'inflation',
  'live-unhcr': () => 'displacement',
  'live-ucdp-saved': () => 'armed conflict',
  'live-ucdp-token': () => 'armed conflict',
  'live-debt-dsa': () => 'debt distress',
  'live-electionguide': () => 'election',
  'live-hdx': () => 'food crisis',
  'live-ioda': () => 'internet outage',
});

/** A day for the board's own dates: turns are recorded per day. */
function asDate(value) {
  const date =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
      ? Date.parse(value)
      : NaN;
  return Number.isFinite(date)
    ? new Date(date).toISOString().slice(0, 10)
    : null;
}

/**
 * A flag's date at the precision its feed publishes: a year (UNHCR's
 * annual stock), a month (CPI, UCDP, HDX prices), a day, or a moment (IODA).
 * Sortable as text, newest last.
 */
function asPeriod(value) {
  if (typeof value !== 'string') return null;
  if (/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return Number.isFinite(Date.parse(value)) ? value : null;
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

/** A story's moment as a full timestamp, or null. */
function asMoment(value) {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function countryName(countries, iso3) {
  const country = /^[A-Z]{3}$/.test(iso3) ? countries?.[iso3] : null;
  return country?.kind === 'disputed' ? null : country?.name?.trim();
}

const plain = (value) => (typeof value === 'string' ? value.trim() : '');

function boardItems(world) {
  if (!world?.enabled) return [];
  const rows = [];
  for (const flag of activeAlerts(world.features)) {
    const kindOf = ALERT_KINDS[flag.sourceId];
    const place = countryName(world.countries, flag.iso3);
    const date = asPeriod(flag.date);
    if (!kindOf || !place || !date || !flag.id) continue;
    const kind = kindOf(flag);
    rows.push({
      id: `alert:${flag.id}`,
      // The feed wrote what it measured; the generic line is only a fallback.
      title: plain(flag.label) || `${place} has an active ${kind} alert.`,
      place,
      date,
      sources: [plain(flag.sourceName) || ALERT_FEEDS[flag.sourceId]],
      reason: `Active ${kind} alert`,
      target: { kind: 'country', iso3: flag.iso3 },
      order: 1,
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

function storyItems(world, news) {
  if (!news?.enabled || !news.theater?.id || !news.theater.name) return [];
  const sourceNames = new Map(
    (news.sources ?? []).map(({ id, name }) => [id, name]),
  );
  // A name two countries share, or a disputed territory, frames nothing.
  const countryCodes = new Map();
  for (const iso3 of Object.keys(world?.countries ?? {})) {
    const name = countryName(world.countries, iso3)?.toLocaleLowerCase('en');
    if (name) countryCodes.set(name, countryCodes.has(name) ? null : iso3);
  }
  const rows = [];
  // Every open story, not the Situation panel's filtered list: its category,
  // actor and place filters narrow that panel, not Today.
  for (const story of news.stories ?? news.visibleStories ?? []) {
    const title = plain(story.title);
    const date = asMoment(story.updatedAt) ?? asMoment(story.eventAt);
    if (!story.id || !title || story.status !== 'open' || !date) continue;

    // One link per outlet, the first it was cited with; the outlets named
    // are the ones counted.
    const byOutlet = new Map();
    for (const item of citedItems(story, news.items, news.citations)) {
      const citation = citationFor(item, sourceNames);
      if (citation && !byOutlet.has(citation.outlet))
        byOutlet.set(citation.outlet, citation);
    }
    if (!byOutlet.size) continue;
    const sources = [...byOutlet.keys()].sort();
    const place = plain(story.place);
    const iso3 = countryCodes.get(place.toLocaleLowerCase('en'));
    rows.push({
      id: `story:${news.theater.id}:${story.id}`,
      title,
      place: place || news.theater.name,
      date,
      sources,
      citations: sources.map((outlet) => byOutlet.get(outlet)),
      reason: `Reported by ${sources.length} ${sources.length === 1 ? 'outlet' : 'outlets'}`,
      summary: plain(story.summary),
      whatsNew: plain(story.whatsNew),
      target: {
        kind: 'story',
        id: story.id,
        theaterId: news.theater.id,
        mapped: isPinnedStory(story),
        ...(iso3 && { iso3 }),
      },
      order: 0,
    });
  }
  return rows;
}

function compare(a, b) {
  if (a.order !== b.order) return a.order - b.order;
  if (a.order === 0)
    return (
      b.sources.length - a.sources.length ||
      Date.parse(b.date) - Date.parse(a.date) ||
      a.id.localeCompare(b.id)
    );
  return b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
}

/**
 * Today's list from the snapshots already in the browser: the digest's open
 * stories, then the board's active alerts, then its latest turn's changes.
 */
export function buildTodayItems(world, news) {
  return [...storyItems(world, news), ...boardItems(world)].sort(compare);
}
