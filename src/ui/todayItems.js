import { isPinnedStory } from '../layers/news/records.js';
import { activeAlerts, ALERT_FEEDS } from './frameGauges.js';
import { citedItems } from './situationPanelModel.js';

/**
 * What each alert feed's flag means, no more than its rule in
 * server/providers/world/conditionEvents.js supports. GDELT is coded from
 * news, so its kinds stay "reported"; it tells them apart by the score slot
 * the flag sets. HDX sets an IPC flag (key 'ipc') or a market price flag
 * (key 'price:...').
 */
const ALERT_KINDS = Object.freeze({
  'live-coups': () => 'coup',
  'live-gdacs': () => 'natural disaster',
  'live-gdelt': ({ slot }) =>
    slot === 'C6'
      ? 'reported protest'
      : slot === 'C2'
        ? 'reported armed conflict'
        : 'reported unrest',
  'live-fx': () => 'currency',
  'live-imf-cpi': () => 'inflation',
  'live-unhcr': () => 'displacement',
  'live-ucdp-saved': () => 'armed conflict',
  'live-ucdp-token': () => 'armed conflict',
  'live-debt-dsa': () => 'debt distress',
  'live-electionguide': () => 'election',
  'live-hdx': ({ key }) =>
    key === 'ipc'
      ? 'food crisis'
      : String(key ?? '').startsWith('price:')
        ? 'food price rise'
        : 'food security',
  'live-ioda': () => 'internet outage',
});

/**
 * One plain sentence and reason per alert. Flag labels carry the feed's
 * working notes (thresholds, sampling), so they are never shown here.
 */
function alertWords(sourceId, place, kind) {
  // ElectionGuide's rule is an election scheduled within 30 days: not a hazard.
  if (sourceId === 'live-electionguide')
    return {
      title: `${place} has an election coming up.`,
      reason: 'Upcoming election',
    };
  return {
    title: `${place} has an active ${kind} alert.`,
    reason: `Active ${kind} alert`,
  };
}

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
    rows.push({
      id: `alert:${flag.id}`,
      ...alertWords(flag.sourceId, place, kindOf(flag)),
      place,
      date,
      sources: [plain(flag.sourceName) || ALERT_FEEDS[flag.sourceId]],
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
    const updated = asMoment(story.updatedAt);
    const date = updated ?? asMoment(story.eventAt);
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
    const sources = [...byOutlet.keys()].sort((a, b) =>
      a.localeCompare(b, 'en'),
    );
    const place = plain(story.place);
    const iso3 = countryCodes.get(place.toLocaleLowerCase('en'));
    rows.push({
      id: `story:${news.theater.id}:${story.id}`,
      title,
      place: place || news.theater.name,
      date,
      // Which moment the time is, so the row says what it dates.
      dateLabel: updated ? 'updated' : 'event',
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
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.id.localeCompare(b.id);
}

/**
 * Today's list from the snapshots already in the browser: the digest's open
 * stories, then the board's active alerts, then its latest turn's changes.
 */
export function buildTodayItems(world, news) {
  return [...storyItems(world, news), ...boardItems(world)].sort(compare);
}
