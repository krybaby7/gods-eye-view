const MINUTE = 60_000;
const DAY = 1_440 * MINUTE;
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
    .flatMap((data) => data?.flags ?? [])
    .filter((flag) => flag.iso3 === iso3 && (!slot || flag.slot === slot));
}

export function flagLabels(snapshot, iso3, slot) {
  return liveFlags(snapshot, iso3, slot).map((flag) =>
    [
      flag.label,
      flag.sourceName,
      flag.date,
      flag.reviewed === false ? 'Draft, not yet reviewed' : null,
    ]
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
  let handle;
  let awaiting;
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
    if (!current || current.progress) return schedule(retryMs);
    const turn = current.turn?.number ?? 0;
    if (awaiting) {
      if (
        turn > awaiting.turn &&
        current.turn.sources?.some(({ id }) => id === awaiting.id)
      ) {
        next.set(awaiting.id, clock() + feeds[awaiting.id]);
      } else if (
        turn === awaiting.turn &&
        clock() - awaiting.started < 3 * retryMs
      ) {
        return schedule(retryMs);
      }
      awaiting = null;
    }
    const [id, at] = [...next].sort((a, b) => a[1] - b[1])[0];
    const delay = at - clock();
    if (delay > 0) return schedule(delay);
    awaiting = { id, turn, started: clock() };
    try {
      await refresh(id);
    } catch {
      // The overlay retries an unacknowledged scoped turn after the next poll.
    }
    schedule(retryMs);
  }
  signal?.addEventListener('abort', stop, { once: true });
  schedule(Math.min(...next.values()) - clock());
  return stop;
}
