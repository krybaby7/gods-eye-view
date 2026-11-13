/**
 * The world gauges and dates the frame's top bar shows. Pure: every figure is
 * read from the board's stored snapshot, and a gauge whose data is not held
 * is left out rather than shown as zero.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'Fri 13 Nov 2026' for a date, in local time. */
export function frameDate(date) {
  if (!(date instanceof Date) || Number.isNaN(+date)) return '';
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** 'Oct 2026' for a month period such as '2026-10'. */
export function monthLabel(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period ?? ''));
  const month = match && MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : null;
}

/** '11 Nov' for an ISO timestamp, in UTC as the board stores it. */
export function dayLabel(timestamp) {
  const date = new Date(timestamp ?? NaN);
  if (Number.isNaN(+date)) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

function nextMonth(period) {
  const [year, month] = period.split('-').map(Number);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** '+8.6%', '−1.3%' (a true minus sign) or '0.0%'. */
export function formatChange(percent) {
  if (!Number.isFinite(percent)) return null;
  const rounded = Math.round(percent * 10) / 10;
  if (rounded === 0) return '0.0%';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}%`;
}

function oilGauge(features) {
  const series = features?.fred?.series?.MCOILBRENTEU;
  if (!Array.isArray(series) || !series.length) return null;
  const last = series.at(-1);
  const month = monthLabel(last?.month);
  if (!Number.isFinite(last?.value) || !month) return null;
  const previous = series.at(-2);
  const change =
    previous && Number.isFinite(previous.value) && previous.value > 0
      ? nextMonth(previous.month) === last.month
        ? ((last.value - previous.value) * 100) / previous.value
        : null
      : null;
  return {
    id: 'oil',
    label: 'Oil',
    value: `$${last.value.toFixed(2)}`,
    change: formatChange(change),
    caption: `Brent crude · ${month} · FRED`,
    title:
      'Brent crude, US dollars a barrel, monthly average (FRED series MCOILBRENTEU)',
  };
}

function foodGauge(features) {
  const banner = features?.['live-fao']?.banner;
  const month = monthLabel(banner?.date);
  if (!Number.isFinite(banner?.value) || !month) return null;
  return {
    id: 'food',
    label: 'Food',
    value: banner.value.toFixed(1),
    change: formatChange(banner.change),
    caption: `Food price index · ${month} · FAO`,
    title: 'FAO Food Price Index, monthly',
  };
}

/**
 * The live condition feeds that can set a flag, with the short name the
 * gauge shows. These are the feeds with a rule in
 * server/providers/world/conditionEvents.js (a test keeps the two in step).
 * Feeds such as live-fao carry a banner and never a flag, so they say
 * nothing about how many alerts there are.
 */
export const ALERT_FEEDS = {
  'live-coups': 'coups',
  'live-gdacs': 'GDACS',
  'live-gdelt': 'GDELT',
  'live-fx': 'FX',
  'live-imf-cpi': 'IMF CPI',
  'live-unhcr': 'UNHCR',
  'live-ucdp-saved': 'UCDP',
  'live-ucdp-token': 'UCDP',
  'live-debt-dsa': 'debt DSA',
  'live-electionguide': 'ElectionGuide',
  'live-hdx': 'HDX',
  'live-ioda': 'IODA',
};

/** A flag feed counts once it has loaded: it holds its flag list and is not stale or failed. */
function loadedAlertFeeds(features) {
  return Object.keys(ALERT_FEEDS).filter((id) => {
    const data = features?.[id];
    return (
      Array.isArray(data?.flags) &&
      !data.staleSince &&
      !(data.error && !data.lastGoodAt)
    );
  });
}

/**
 * Alerts are the active flags of the loaded live condition feeds: not
 * cleared, stale or out of recent data.
 */
export function activeAlerts(features) {
  return loadedAlertFeeds(features)
    .flatMap((id) => features[id].flags)
    .filter(
      (flag) =>
        flag &&
        (flag.status ?? 'active') === 'active' &&
        (flag.sourceId !== 'live-ucdp-saved' ||
          Number.isSafeInteger(flag.recordedDeaths)),
    );
}

function alertsGauge(features, turn) {
  // Until a feed that can carry flags has loaded, the count is unknown, not zero.
  const feeds = loadedAlertFeeds(features);
  if (!feeds.length) return null;
  const day = dayLabel(turn?.endedAt);
  if (!day) return null;
  const alerts = activeAlerts(features);
  const countries = new Set(alerts.map(({ iso3 }) => iso3).filter(Boolean));
  const names = [...new Set(feeds.map((id) => ALERT_FEEDS[id]))];
  const source =
    names.length <= 2 ? names.join(', ') : `${names.length} live feeds`;
  return {
    id: 'alerts',
    label: 'Alerts',
    value: String(alerts.length),
    change: null,
    caption: `in ${countries.size} ${countries.size === 1 ? 'country' : 'countries'} · ${day} · ${source}`,
    title: `Active condition flags from the live feeds: ${names.join(', ')}`,
  };
}

/** The gauges the stored board holds, in the mock's order. */
export function worldGauges(snapshot) {
  const features = snapshot?.features;
  return [
    oilGauge(features),
    foodGauge(features),
    alertsGauge(features, snapshot?.turn),
  ].filter(Boolean);
}

/** 'Refreshed 11 Nov' from the last turn, or null before the first. */
export function refreshedLabel(turn) {
  const day = dayLabel(turn?.endedAt);
  return day ? `Refreshed ${day}` : null;
}
