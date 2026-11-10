const MINUTE = 60_000;
const DAY = 1_440 * MINUTE;
const MAX_RETRY_MS = 30_000;
const CADENCE = {
  'live-gdelt': 15 * MINUTE,
  'live-gdacs': 60 * MINUTE,
  'live-fx': DAY,
  'live-coups': 7 * DAY,
  'live-fao': 7 * DAY,
  'live-imf-cpi': 7 * DAY,
  'live-unhcr': 7 * DAY,
};

export function liveFlags(snapshot, iso3, slot) {
  return Object.values(snapshot.features ?? {})
    .flatMap((data) => [...(data?.flags ?? []), ...(data?.inactiveFlags ?? [])])
    .filter(
      (flag) =>
        flag.iso3 === iso3 &&
        (!slot || flag.slot === slot) &&
        (flag.sourceId !== 'live-ucdp-saved' ||
          Number.isSafeInteger(flag.recordedDeaths)),
    );
}

export function liveFlagStatus({ status, staleSince, lastGoodAt }) {
  if (status === 'stale') {
    return [
      staleSince ? `Stale since ${staleSince}` : 'Stale',
      lastGoodAt && `last good ${lastGoodAt}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (status === 'no-recent-data') return 'No recent data';
  if (status === 'cleared') return 'Cleared';
  return null;
}

export function liveFlagNotes(flag) {
  return [
    liveFlagStatus(flag),
    flag.evidence,
    flag.rule && `Rule: ${flag.rule}`,
    (flag.reviewed === false || flag.ruleReviewed === false) &&
      'Draft, not yet reviewed',
  ].filter(Boolean);
}

export function flagLabels(snapshot, iso3, slot) {
  return liveFlags(snapshot, iso3, slot)
    .filter(({ status }) => status !== 'cleared')
    .map((flag) =>
      [flag.label, flag.sourceName, flag.date, ...liveFlagNotes(flag)]
        .filter(Boolean)
        .join(' · '),
    );
}

export function startLiveTimers({
  refresh,
  snapshot,
  signal,
  fixtures,
  feeds = CADENCE,
  retryMs = 5_000,
  clock = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (fixtures || signal?.aborted || !Object.keys(feeds).length)
    return () => {};
  const next = new Map(
    Object.entries(feeds).map(([id, interval]) => [id, clock() + interval]),
  );
  const retries = new Map();
  let handle;
  let stopped = false;
  function stop() {
    stopped = true;
    clearTimer(handle);
    signal?.removeEventListener('abort', stop);
  }
  function schedule(delay) {
    if (!stopped) handle = setTimer(pump, delay);
  }
  async function pump() {
    if (stopped) return;
    const current = snapshot();
    if (!current?.turn || current.progress) return schedule(retryMs);
    const [id, at] = [...next]
      .map(([id, at]) => [id, Math.max(at, retries.get(id)?.at ?? 0)])
      .sort((a, b) => a[1] - b[1])[0];
    const delay = at - clock();
    if (delay > 0) return schedule(delay);
    let accepted = false;
    try {
      accepted = await refresh(id);
    } catch {
      // Retry unconfirmed requests without holding up other due feeds.
    }
    if (accepted) {
      next.set(id, clock() + feeds[id]);
      retries.delete(id);
    } else {
      const previous = retries.get(id);
      const delay = Math.min(
        MAX_RETRY_MS,
        previous ? previous.delay * 2 : retryMs,
      );
      retries.set(id, { delay, at: clock() + delay });
    }
    schedule(retryMs);
  }
  signal?.addEventListener('abort', stop, { once: true });
  schedule(Math.min(...next.values()) - clock());
  return stop;
}
